import { config } from 'dotenv';
config({ path: '.env.local' });

import http from 'http';
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

const WEB_SERVER_URL = process.env.WEB_SERVER_URL ?? 'http://localhost:3000';
const DAEMON_PORT = parseInt(process.env.DAEMON_PORT ?? '3001', 10);

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
      args: ['exec', '--ephemeral', '--skip-git-repo-check', '--color', 'never', '-s', 'workspace-write', prompt],
    };
  }
  return {
    command: 'claude',
    args: ['--print', prompt, '--model', schedule.model, '--permission-mode', permissionModeArg(schedule.permissionMode)],
  };
}

function commandForConversion(agentCli: AgentCli, prompt: string) {
  if (agentCli === 'codex') {
    return {
      command: 'codex',
      args: ['exec', '--ephemeral', '--skip-git-repo-check', '--color', 'never', prompt],
    };
  }
  return {
    command: 'claude',
    args: ['--print', prompt],
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

async function convertCronExpression(description: string): Promise<{ expression: string } | { error: string; status: number }> {
  const prompt = `Convert this schedule description to a cron expression. Reply with ONLY the cron expression (5 fields: minute hour day month weekday), nothing else, no explanation.\n\nDescription: ${description}`;

  try {
    const agentCli = await getAgentCli();
    const { command, args } = commandForConversion(agentCli, prompt);
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

// ─── HTTP server ──────────────────────────────────────────────────────────────

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function respond(res: http.ServerResponse, status: number, body: unknown) {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(json);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${DAEMON_PORT}`);
  const method = req.method ?? 'GET';

  try {
    if (method === 'POST' && url.pathname === '/tasks/run') {
      const { taskId, scheduleId } = await readBody(req) as { taskId: string; scheduleId: string };
      runTask(taskId, scheduleId).catch(err => console.error(`[task:${taskId}] error`, err));
      return respond(res, 202, { ok: true });
    }

    if (method === 'POST' && url.pathname === '/schedules/register') {
      const { scheduleId } = await readBody(req) as { scheduleId: string };
      registerSchedule(scheduleId).catch(err => console.error(`[scheduler:${scheduleId}] error`, err));
      return respond(res, 202, { ok: true });
    }

    const deleteMatch = url.pathname.match(/^\/schedules\/([^/]+)$/);
    if (method === 'DELETE' && deleteMatch) {
      const scheduleId = deleteMatch[1];
      unregisterSchedule(scheduleId).catch(err => console.error(`[scheduler:${scheduleId}] error`, err));
      return respond(res, 202, { ok: true });
    }

    if (method === 'POST' && url.pathname === '/cron-expression') {
      const { description } = await readBody(req) as { description: string };
      if (!description) return respond(res, 400, { error: 'description is required' });
      const result = await convertCronExpression(description);
      if ('status' in result) return respond(res, result.status, { error: result.error });
      return respond(res, 200, { data: result });
    }

    respond(res, 404, { error: 'Not found' });
  } catch (err: unknown) {
    const e = err as { message?: string };
    respond(res, 500, { error: e.message ?? 'Internal error' });
  }
});

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  await registerAllSchedules();

  server.listen(DAEMON_PORT, () => {
    console.log(`Daemon HTTP server listening on port ${DAEMON_PORT}`);
    console.log(`Web server: ${WEB_SERVER_URL}`);
  });
}

main().catch(err => {
  console.error('Daemon failed to start', err);
  process.exit(1);
});
