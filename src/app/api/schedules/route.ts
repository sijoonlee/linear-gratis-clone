import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { schedules, users } from '@/db/schema';
import { eq, desc } from 'drizzle-orm';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const teamId = searchParams.get('teamId');

  const rows = await db
    .select({
      id: schedules.id,
      teamId: schedules.teamId,
      name: schedules.name,
      description: schedules.description,
      prompt: schedules.prompt,
      cronExpression: schedules.cronExpression,
      workingDirectory: schedules.workingDirectory,
      enabled: schedules.enabled,
      lastRunAt: schedules.lastRunAt,
      createdAt: schedules.createdAt,
      updatedAt: schedules.updatedAt,
      agentUserId: schedules.agentUserId,
      agentUserName: users.name,
      agentUserCli: users.agentCli,
      agentUserModel: users.agentModel,
      agentUserPermissionMode: users.permissionMode,
    })
    .from(schedules)
    .leftJoin(users, eq(schedules.agentUserId, users.id))
    .where(teamId ? eq(schedules.teamId, teamId) : undefined)
    .orderBy(desc(schedules.createdAt));

  const data = rows.map(r => ({
    id: r.id,
    teamId: r.teamId,
    name: r.name,
    description: r.description,
    prompt: r.prompt,
    cronExpression: r.cronExpression,
    workingDirectory: r.workingDirectory,
    enabled: r.enabled,
    lastRunAt: r.lastRunAt,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    agentUser: r.agentUserId ? {
      id: r.agentUserId,
      name: r.agentUserName,
      agentCli: r.agentUserCli,
      agentModel: r.agentUserModel,
      permissionMode: r.agentUserPermissionMode,
    } : null,
  }));

  return NextResponse.json({ data });
}

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    teamId: string;
    name: string;
    prompt: string;
    agentUserId: string;
    workingDirectory?: string | null;
    description?: string;
    cronExpression?: string;
    enabled?: boolean;
  };
  if (!body.teamId || !body.name || !body.prompt || !body.agentUserId) {
    return NextResponse.json(
      { error: 'teamId, name, prompt, and agentUserId are required' },
      { status: 400 }
    );
  }

  const [agentUser] = await db.select({
    id: users.id,
    type: users.type,
    agentCli: users.agentCli,
  }).from(users).where(eq(users.id, body.agentUserId));

  if (!agentUser || agentUser.type !== 'agent' || !agentUser.agentCli) {
    return NextResponse.json({ error: 'valid agentUserId is required' }, { status: 400 });
  }

  const [row] = await db.insert(schedules).values({
    teamId: body.teamId,
    agentUserId: body.agentUserId,
    name: body.name,
    prompt: body.prompt,
    workingDirectory: body.workingDirectory?.trim() || null,
    description: body.description,
    cronExpression: body.cronExpression ?? null,
    enabled: body.enabled ?? true,
  }).returning();
  return NextResponse.json({ data: row }, { status: 201 });
}
