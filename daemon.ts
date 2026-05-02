import { config } from 'dotenv';
config({ path: '.env.local' });

import postgres from 'postgres';
import { execFile } from 'child_process';
import { promisify } from 'util';

const exec = promisify(execFile);

const DATABASE_URL = process.env.DATABASE_URL;
const WEB_SERVER_URL = process.env.WEB_SERVER_URL ?? 'http://localhost:3000';

if (!DATABASE_URL) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const sql = postgres(DATABASE_URL);

type TaskPayload = { id: string; schedule_id: string };

async function runTask(taskId: string, scheduleId: string) {
  const [schedule] = await sql`
    SELECT name, prompt, cron_expression, working_directory, model FROM schedules WHERE id = ${scheduleId}
  `;

  if (!schedule) {
    console.error(`Schedule ${scheduleId} not found`);
    return;
  }

  const builtPrompt = schedule.cron_expression
    ? `Please add a schedule doing this: ${schedule.prompt} by cron expression ${schedule.cron_expression}`
    : `Please add a schedule doing this: ${schedule.prompt} (run manually, no cron expression)`;

  console.log(`[task:${taskId}] running — ${builtPrompt.slice(0, 80)}`);

  await sql`
    UPDATE cron_tasks SET status = 'running', started_at = now() WHERE id = ${taskId}
  `;

  let output = '';
  let exitCode = 0;
  let status = 'completed';

  try {
    const result = await exec(
      'claude',
      ['--print', builtPrompt, '--model', schedule.model],
      { cwd: schedule.working_directory }
    );
    output = result.stdout;
  } catch (err: unknown) {
    const e = err as { stdout?: string; message?: string; code?: number };
    output = e.stdout ?? e.message ?? 'unknown error';
    exitCode = e.code ?? 1;
    status = 'failed';
  }

  await sql`
    UPDATE cron_tasks
    SET status = ${status}, output = ${output}, exit_code = ${exitCode}, finished_at = now()
    WHERE id = ${taskId}
  `;

  console.log(`[task:${taskId}] ${status}`);

  await fetch(`${WEB_SERVER_URL}/api/notifications`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: status === 'completed' ? 'Task completed' : 'Task failed',
      body: builtPrompt.slice(0, 80),
      type: status === 'completed' ? 'success' : 'error',
    }),
  }).catch(() => {});
}

async function main() {
  console.log(`Daemon started — listening on cron_task_pending`);
  console.log(`Web server: ${WEB_SERVER_URL}`);

  await sql.listen('cron_task_pending', async (payload) => {
    const { id, schedule_id } = JSON.parse(payload) as TaskPayload;
    runTask(id, schedule_id).catch(err => console.error(`[task:${id}] error`, err));
  });
}

main().catch(err => {
  console.error('Daemon failed to start', err);
  process.exit(1);
});
