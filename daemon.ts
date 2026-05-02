import { config } from 'dotenv';
config({ path: '.env.local' });

import postgres from 'postgres';
import cron, { type ScheduledTask, type TaskContext } from 'node-cron';
import { execFile } from 'child_process';
import { promisify } from 'util';
import {
  AGENT_CLI_SETTING_KEY,
  DEFAULT_AGENT_CLI,
  normalizeAgentCli,
  type AgentCli,
} from './src/lib/agent-cli';

const exec = promisify(execFile);

const DATABASE_URL = process.env.DATABASE_URL;
const WEB_SERVER_URL = process.env.WEB_SERVER_URL ?? 'http://localhost:3000';

if (!DATABASE_URL) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

// Only used for LISTEN/NOTIFY — no writes go through this connection.
const sql = postgres(DATABASE_URL);

type TaskPayload = { id: string; schedule_id: string };
type SchedulePayload = { id: string; operation: 'INSERT' | 'UPDATE' | 'DELETE' };
type ScheduleRow = {
  id: string;
  enabled: boolean;
  cronExpression: string | null;
};
type ScheduleExecutionRow = {
  name: string;
  prompt: string;
  workingDirectory: string | null;
  agentCli: string | null;
  model: string;
  permissionMode: string;
};

const scheduleJobs = new Map<string, ScheduledTask>();

function minuteStart(date = new Date()) {
  const d = new Date(date);
  d.setSeconds(0, 0);
  return d;
}

function permissionModeArg(mode: string) {
  switch (mode) {
    case 'auto': return 'auto';
    case 'accept-edits': return 'acceptEdits';
    case 'plan': return 'plan';
    default: return 'default';
  }
}

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${WEB_SERVER_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  });
  return res.json() as Promise<T>;
}

async function sendNotification(title: string, body?: string, type: 'info' | 'success' | 'warning' | 'error' = 'info') {
  await api('/api/notifications', {
    method: 'POST',
    body: JSON.stringify({ title, body, type }),
  }).catch(() => {});
}

async function getAgentCli(): Promise<AgentCli> {
  try {
    const { data } = await api<{ data: Record<string, string> }>('/api/settings');
    return normalizeAgentCli(data[AGENT_CLI_SETTING_KEY]);
  } catch {
    return DEFAULT_AGENT_CLI;
  }
}

function commandForAgentCli(agentCli: AgentCli, schedule: ScheduleExecutionRow, prompt: string) {
  if (agentCli === 'codex') {
    return {
      command: 'codex',
      args: [
        'exec',
        '--ephemeral',
        '--skip-git-repo-check',
        '--color',
        'never',
        '-s',
        'workspace-write',
        prompt,
      ],
    };
  }

  return {
    command: 'claude',
    args: [
      '--print',
      prompt,
      '--model',
      schedule.model,
      '--permission-mode',
      permissionModeArg(schedule.permissionMode),
    ],
  };
}

async function runTask(taskId: string, scheduleId: string) {
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
    const agentCli = schedule.agentCli ? normalizeAgentCli(schedule.agentCli) : await getAgentCli();
    const { command, args } = commandForAgentCli(agentCli, schedule, builtPrompt);
    const child = exec(command, args, { cwd: schedule.workingDirectory ?? process.cwd() });
    child.child.stdin?.end();
    const result = await child;
    output = result.stdout;
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
    `${status === 'completed' ? 'Task completed' : 'Task failed'}: ${schedule.name}`,
    notificationBody.slice(0, 240),
    status === 'completed' ? 'success' : 'error'
  );
}

async function enqueueScheduleRun(scheduleId: string, dueAt: Date) {
  await api(`/api/schedules/${scheduleId}/run`, {
    method: 'POST',
    body: JSON.stringify({ scheduledFor: dueAt.toISOString() }),
  });
}

async function unregisterSchedule(scheduleId: string) {
  const existing = scheduleJobs.get(scheduleId);
  if (!existing) return;
  await existing.destroy();
  scheduleJobs.delete(scheduleId);
  console.log(`[scheduler:${scheduleId}] unregistered`);
}

async function registerSchedule(scheduleId: string) {
  await unregisterSchedule(scheduleId);

  const { data: schedule } = await api<{ data: ScheduleRow | null }>(`/api/schedules/${scheduleId}`);

  if (!schedule || !schedule.enabled || !schedule.cronExpression) return;

  if (!cron.validate(schedule.cronExpression)) {
    console.error(`[scheduler:${schedule.id}] invalid cron expression: ${schedule.cronExpression}`);
    await sendNotification(
      'Invalid schedule cron expression',
      `Schedule ${schedule.id} has invalid cron expression: ${schedule.cronExpression}`,
      'error'
    );
    return;
  }

  const job = cron.schedule(
    schedule.cronExpression,
    (context: TaskContext) => {
      const dueAt = minuteStart(context.date);
      enqueueScheduleRun(schedule.id, dueAt).catch(err => console.error(`[scheduler:${schedule.id}] error`, err));
    },
    { name: schedule.id, noOverlap: true }
  );

  scheduleJobs.set(schedule.id, job);
  console.log(`[scheduler:${schedule.id}] registered ${schedule.cronExpression}`);
}

async function registerAllSchedules() {
  for (const job of scheduleJobs.values()) {
    await job.destroy();
  }
  scheduleJobs.clear();

  const { data: allSchedules } = await api<{ data: ScheduleRow[] }>('/api/schedules');
  const enabled = allSchedules.filter(s => s.enabled && s.cronExpression);

  await Promise.all(enabled.map(s => registerSchedule(s.id)));
  console.log(`[scheduler] registered ${scheduleJobs.size} schedule(s)`);
}

async function main() {
  console.log(`Daemon started — listening on cron_task_pending`);
  console.log(`Web server: ${WEB_SERVER_URL}`);

  await sql.listen('cron_task_pending', async (payload) => {
    const { id, schedule_id } = JSON.parse(payload) as TaskPayload;
    runTask(id, schedule_id).catch(err => console.error(`[task:${id}] error`, err));
  });

  await sql.listen('schedule_changed', async (payload) => {
    const { id, operation } = JSON.parse(payload) as SchedulePayload;
    if (operation === 'DELETE') {
      unregisterSchedule(id).catch(err => console.error(`[scheduler:${id}] error`, err));
      return;
    }
    registerSchedule(id).catch(err => console.error(`[scheduler:${id}] error`, err));
  });

  await registerAllSchedules();
}

main().catch(err => {
  console.error('Daemon failed to start', err);
  process.exit(1);
});
