import { config } from 'dotenv';
config({ path: '.env.local' });

import http from 'http';
import { createApiClient } from './src/conductor/api-client';
import { type AgentUserRow } from './src/conductor/agent-runner';
import {
  runTask,
  unregisterSchedule,
  registerSchedule,
  registerAllSchedules,
  convertCronExpression,
} from './src/conductor/schedule-orchestrator';
import { dispatchIssue } from './src/conductor/issue-orchestrator';

const WEB_SERVER_URL = process.env.WEB_SERVER_URL ?? 'http://localhost:3000';
const CONDUCTOR_PORT = parseInt(process.env.CONDUCTOR_PORT ?? '3001', 10);

const api = createApiClient(WEB_SERVER_URL);

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
  const url = new URL(req.url ?? '/', `http://localhost:${CONDUCTOR_PORT}`);
  const method = req.method ?? 'GET';

  try {
    if (method === 'POST' && url.pathname === '/tasks/run') {
      const { taskId, scheduleId } = await readBody(req) as { taskId: string; scheduleId: string };
      runTask(taskId, scheduleId, api).catch(err => console.error(`[task:${taskId}] error`, err));
      return respond(res, 202, { ok: true });
    }

    if (method === 'POST' && url.pathname === '/schedules/register') {
      const { scheduleId } = await readBody(req) as { scheduleId: string };
      registerSchedule(scheduleId, api).catch(err => console.error(`[scheduler:${scheduleId}] error`, err));
      return respond(res, 202, { ok: true });
    }

    const deleteMatch = url.pathname.match(/^\/schedules\/([^/]+)$/);
    if (method === 'DELETE' && deleteMatch) {
      const scheduleId = deleteMatch[1];
      unregisterSchedule(scheduleId).catch(err => console.error(`[scheduler:${scheduleId}] error`, err));
      return respond(res, 202, { ok: true });
    }

    if (method === 'POST' && url.pathname === '/cron-expression') {
      const { description, agentUser } = await readBody(req) as { description: string; agentUser?: AgentUserRow | null };
      if (!description) return respond(res, 400, { error: 'description is required' });
      const result = await convertCronExpression(description, agentUser ?? null);
      if ('status' in result) return respond(res, result.status, { error: result.error });
      return respond(res, 200, { data: result });
    }

    if (method === 'POST' && url.pathname === '/issues/dispatch') {
      const { issueId } = await readBody(req) as { issueId: string };
      if (!issueId) return respond(res, 400, { error: 'issueId is required' });
      dispatchIssue(issueId, api).catch(err => console.error(`[issue:${issueId}] error`, err));
      return respond(res, 202, { ok: true });
    }

    respond(res, 404, { error: 'Not found' });
  } catch (err: unknown) {
    const e = err as { message?: string };
    respond(res, 500, { error: e.message ?? 'Internal error' });
  }
});

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  await registerAllSchedules(api);

  server.listen(CONDUCTOR_PORT, () => {
    console.log(`Conductor HTTP server listening on port ${CONDUCTOR_PORT}`);
    console.log(`Web server: ${WEB_SERVER_URL}`);
  });
}

main().catch(err => {
  console.error('Conductor failed to start', err);
  process.exit(1);
});
