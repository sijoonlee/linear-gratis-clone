import { NextRequest, NextResponse } from 'next/server';

const DAEMON_URL = process.env.DAEMON_URL ?? 'http://localhost:3001';

export async function POST(req: NextRequest) {
  const { description } = await req.json() as { description: string };
  if (!description) {
    return NextResponse.json({ error: 'description is required' }, { status: 400 });
  }

  const res = await fetch(`${DAEMON_URL}/cron-expression`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description }),
  });

  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
