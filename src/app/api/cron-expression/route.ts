import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { db } from '@/db';
import { appSettings } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { AGENT_CLI_SETTING_KEY, DEFAULT_AGENT_CLI, normalizeAgentCli, type AgentCli } from '@/lib/agent-cli';

const exec = promisify(execFile);
const CONVERSION_TIMEOUT_MS = 60_000;

const cronField = String.raw`(?:\*|\d{1,2})(?:-\d{1,2})?(?:\/\d{1,2})?`;
const cronExpressionRegex = new RegExp(
  String.raw`^${cronField}(?:,${cronField})* ${cronField}(?:,${cronField})* ${cronField}(?:,${cronField})* ${cronField}(?:,${cronField})* ${cronField}(?:,${cronField})*$`
);

async function getAgentCli(): Promise<AgentCli> {
  try {
    const [setting] = await db
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, AGENT_CLI_SETTING_KEY));
    return normalizeAgentCli(setting?.value);
  } catch {
    return DEFAULT_AGENT_CLI;
  }
}

function commandForAgentCli(agentCli: AgentCli, prompt: string) {
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

export async function POST(req: NextRequest) {
  const { description } = await req.json() as { description: string };
  if (!description) {
    return NextResponse.json({ error: 'description is required' }, { status: 400 });
  }

  const prompt = `Convert this schedule description to a cron expression. Reply with ONLY the cron expression (5 fields: minute hour day month weekday), nothing else, no explanation.

Description: ${description}`;

  try {
    const agentCli = await getAgentCli();
    const { command, args } = commandForAgentCli(agentCli, prompt);
    const child = exec(command, args, { timeout: CONVERSION_TIMEOUT_MS });
    child.child.stdin?.end();
    const { stdout } = await child;
    const expression = stdout
      .split(/\r?\n/)
      .map(line => line.trim())
      .find(line => cronExpressionRegex.test(line));
    if (!expression) {
      return NextResponse.json(
        { error: 'generated expression is not a valid 5-field cron expression' },
        { status: 422 }
      );
    }
    return NextResponse.json({ data: { expression } });
  } catch (err: unknown) {
    const e = err as { message?: string };
    return NextResponse.json({ error: e.message ?? 'failed to convert' }, { status: 500 });
  }
}
