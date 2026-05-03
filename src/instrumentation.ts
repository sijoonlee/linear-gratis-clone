export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { default: postgres } = await import('postgres');

  const DATABASE_URL = process.env.DATABASE_URL!;
  const DAEMON_URL = process.env.DAEMON_URL ?? 'http://localhost:3001';

  const sql = postgres(DATABASE_URL);

  await sql.listen('cron_task_pending', async (payload) => {
    const { id, schedule_id } = JSON.parse(payload) as { id: string; schedule_id: string };
    await fetch(`${DAEMON_URL}/tasks/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId: id, scheduleId: schedule_id }),
    }).catch(err => console.error('[instrumentation] cron_task_pending forward failed', err));
  });

  await sql.listen('schedule_changed', async (payload) => {
    const { id, operation } = JSON.parse(payload) as { id: string; operation: string };
    if (operation === 'DELETE') {
      await fetch(`${DAEMON_URL}/schedules/${id}`, { method: 'DELETE' })
        .catch(err => console.error('[instrumentation] schedule unregister failed', err));
      return;
    }
    await fetch(`${DAEMON_URL}/schedules/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scheduleId: id }),
    }).catch(err => console.error('[instrumentation] schedule register failed', err));
  });

  await sql.listen('issue_changed', async (payload) => {
    const { id } = JSON.parse(payload) as { id: string };
    await fetch(`${DAEMON_URL}/issues/dispatch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ issueId: id }),
    }).catch(err => console.error('[instrumentation] issue dispatch failed', err));
  });

  console.log('[instrumentation] Postgres LISTEN active');
}
