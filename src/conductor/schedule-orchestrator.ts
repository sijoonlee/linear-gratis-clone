import { execFile } from 'child_process';
import { promisify } from 'util';
import cron, { type ScheduledTask, type TaskContext } from 'node-cron';
import { normalizeAgentCli } from '../lib/agent-cli';
import { type ApiClient } from './api-client';
import { commandForAgentCli, runAgent, type AgentUserRow } from './agent-runner';

const exec = promisify(execFile); // used only for cron expression conversion

type ScheduleRow = {
  id: string;
  enabled: boolean;
  cronExpression: string | null;
};

type ScheduleExecutionRow = {
  name: string;
  prompt: string;
  workingDirectory: string | null;
  agentUser: AgentUserRow | null;
};

const scheduleJobs = new Map<string, ScheduledTask>();

const cronField = String.raw`(?:\*|\d{1,2})(?:-\d{1,2})?(?:\/\d{1,2})?`;
const cronExpressionRegex = new RegExp(
  String.raw`^${cronField}(?:,${cronField})* ${cronField}(?:,${cronField})* ${cronField}(?:,${cronField})* ${cronField}(?:,${cronField})* ${cronField}(?:,${cronField})*$`
);

const CONVERSION_TIMEOUT_MS = 60_000;

function minuteStart(date = new Date()) {
  const d = new Date(date);
  d.setSeconds(0, 0);
  return d;
}

async function sendNotification(
  api: ApiClient,
  title: string,
  body?: string,
  type: 'info' | 'success' | 'warning' | 'error' = 'info',
) {
  await api('/api/notifications', {
    method: 'POST',
    body: JSON.stringify({ title, body, type }),
  }).catch(() => {});
}

function commandForConversion(agentUser: AgentUserRow, prompt: string) {
  const agentCli = normalizeAgentCli(agentUser.agentCli);
  if (agentCli === 'codex') {
    return {
      command: 'codex',
      args: ['exec', '--ephemeral', '--skip-git-repo-check', '--color', 'never', '--model', 'gpt-5.4-mini', prompt],
    };
  }
  return {
    command: 'claude',
    args: ['--print', prompt, '--model', 'claude-haiku-4-5-20251001', '--allowedTools', ''],
  };
}

async function enqueueScheduleRun(scheduleId: string, dueAt: Date, api: ApiClient) {
  await api(`/api/schedules/${scheduleId}/run`, {
    method: 'POST',
    body: JSON.stringify({ scheduledFor: dueAt.toISOString() }),
  });
}

export async function runTask(taskId: string, scheduleId: string, api: ApiClient) {
  const { data: schedule } = await api<{ data: ScheduleExecutionRow | null }>(`/api/schedules/${scheduleId}`);

  if (!schedule) {
    console.error(`Schedule ${scheduleId} not found`);
    return;
  }

  const builtPrompt = schedule.prompt;
  console.log(`[task:${taskId}] running — ${builtPrompt.slice(0, 80)}`);

  await api(`/api/cron-tasks/${taskId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'running', startedAt: new Date().toISOString() }),
  });

  let output = '';
  let exitCode = 0;
  let status = 'completed';

  try {
    if (!schedule.agentUser?.agentCli) {
      throw new Error('schedule has no configured agent user');
    }
    const agentCli = normalizeAgentCli(schedule.agentUser.agentCli);
    const spec = commandForAgentCli(agentCli, schedule.agentUser, builtPrompt);
    output = await runAgent(spec, schedule.workingDirectory ?? process.cwd(), 10 * 60 * 1000);
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string; code?: number };
    output = [e.stdout, e.stderr, e.message].filter(Boolean).join('\n').trim() || 'unknown error';
    exitCode = e.code ?? 1;
    status = 'failed';
  }

  await api(`/api/cron-tasks/${taskId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status, output, exitCode, finishedAt: new Date().toISOString() }),
  });

  console.log(`[task:${taskId}] ${status}`);

  const notificationBody = output.trim() || builtPrompt;
  await sendNotification(
    api,
    `${status === 'completed' ? 'Task completed' : 'Task failed'}: ${schedule.name}`,
    notificationBody.slice(0, 240),
    status === 'completed' ? 'success' : 'error',
  );
}

export async function unregisterSchedule(scheduleId: string) {
  const existing = scheduleJobs.get(scheduleId);
  if (!existing) return;
  await existing.destroy();
  scheduleJobs.delete(scheduleId);
  console.log(`[scheduler:${scheduleId}] unregistered`);
}

export async function registerSchedule(scheduleId: string, api: ApiClient) {
  await unregisterSchedule(scheduleId);

  const { data: schedule } = await api<{ data: ScheduleRow | null }>(`/api/schedules/${scheduleId}`);

  if (!schedule || !schedule.enabled || !schedule.cronExpression) return;

  if (!cron.validate(schedule.cronExpression)) {
    console.error(`[scheduler:${schedule.id}] invalid cron expression: ${schedule.cronExpression}`);
    await sendNotification(
      api,
      'Invalid schedule cron expression',
      `Schedule ${schedule.id} has invalid cron expression: ${schedule.cronExpression}`,
      'error',
    );
    return;
  }

  const job = cron.schedule(
    schedule.cronExpression,
    (context: TaskContext) => {
      const dueAt = minuteStart(context.date);
      enqueueScheduleRun(schedule.id, dueAt, api).catch(err =>
        console.error(`[scheduler:${schedule.id}] error`, err)
      );
    },
    { name: schedule.id, noOverlap: true },
  );

  scheduleJobs.set(schedule.id, job);
  console.log(`[scheduler:${schedule.id}] registered ${schedule.cronExpression}`);
}

export async function registerAllSchedules(api: ApiClient) {
  for (const job of scheduleJobs.values()) {
    await job.destroy();
  }
  scheduleJobs.clear();

  const { data: allSchedules } = await api<{ data: ScheduleRow[] }>('/api/schedules');
  const enabled = allSchedules.filter(s => s.enabled && s.cronExpression);

  await Promise.all(enabled.map(s => registerSchedule(s.id, api)));
  console.log(`[scheduler] registered ${scheduleJobs.size} schedule(s)`);
}

export async function convertCronExpression(
  description: string,
  agentUser: AgentUserRow | null,
): Promise<{ expression: string } | { error: string; status: number }> {
  if (!agentUser?.agentCli) {
    return { error: 'agentUser with agentCli is required', status: 400 };
  }

  const prompt = `Convert this schedule description to a cron expression. Reply with ONLY the cron expression (5 fields: minute hour day month weekday), nothing else, no explanation.\n\nDescription: ${description}`;

  try {
    const { command, args } = commandForConversion(agentUser, prompt);
    const child = exec(command, args, { timeout: CONVERSION_TIMEOUT_MS });
    child.child.stdin?.end();
    const { stdout } = await child;
    const expression = stdout
      .split(/\r?\n/)
      .map(line => line.trim())
      .find(line => cronExpressionRegex.test(line));
    if (!expression) {
      return { error: 'generated expression is not a valid 5-field cron expression', status: 422 };
    }
    return { expression };
  } catch (err: unknown) {
    const e = err as { message?: string };
    return { error: e.message ?? 'failed to convert', status: 500 };
  }
}
