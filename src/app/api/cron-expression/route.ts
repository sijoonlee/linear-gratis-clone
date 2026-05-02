import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { promisify } from 'util';

const exec = promisify(execFile);

export async function POST(req: NextRequest) {
  const { description } = await req.json() as { description: string };
  if (!description) {
    return NextResponse.json({ error: 'description is required' }, { status: 400 });
  }

  const prompt = `Convert this schedule description to a cron expression. Reply with ONLY the cron expression (5 fields: minute hour day month weekday), nothing else, no explanation.

Description: ${description}`;

  try {
    const { stdout } = await exec('claude', ['--print', prompt]);
    const expression = stdout.trim();
    return NextResponse.json({ data: { expression } });
  } catch (err: unknown) {
    const e = err as { message?: string };
    return NextResponse.json({ error: e.message ?? 'failed to convert' }, { status: 500 });
  }
}
