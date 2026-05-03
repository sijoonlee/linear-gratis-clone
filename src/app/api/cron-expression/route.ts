import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { users } from '@/db/schema';

const DAEMON_URL = process.env.DAEMON_URL ?? 'http://localhost:3001';

export async function POST(req: NextRequest) {
  const { description, agentUserId } = await req.json() as { description: string; agentUserId?: string };
  if (!description) {
    return NextResponse.json({ error: 'description is required' }, { status: 400 });
  }
  if (!agentUserId) {
    return NextResponse.json({ error: 'agentUserId is required' }, { status: 400 });
  }

  const [agentUser] = await db.select({
    id: users.id,
    type: users.type,
    agentCli: users.agentCli,
    agentModel: users.agentModel,
    permissionMode: users.permissionMode,
  }).from(users).where(eq(users.id, agentUserId));

  if (!agentUser || agentUser.type !== 'agent') {
    return NextResponse.json({ error: 'agent user not found' }, { status: 404 });
  }

  const res = await fetch(`${DAEMON_URL}/cron-expression`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      description,
      agentUser: {
        agentCli: agentUser.agentCli,
        agentModel: agentUser.agentModel,
        permissionMode: agentUser.permissionMode,
      },
    }),
  });

  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
