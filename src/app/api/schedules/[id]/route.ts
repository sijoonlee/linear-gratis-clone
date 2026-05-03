import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { schedules, cronTasks, users } from '@/db/schema';
import { eq, desc } from 'drizzle-orm';

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;

  const [row] = await db
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
    .where(eq(schedules.id, id));

  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const recentTasks = await db
    .select()
    .from(cronTasks)
    .where(eq(cronTasks.scheduleId, id))
    .orderBy(desc(cronTasks.createdAt))
    .limit(20);

  const data = {
    id: row.id,
    teamId: row.teamId,
    name: row.name,
    description: row.description,
    prompt: row.prompt,
    cronExpression: row.cronExpression,
    workingDirectory: row.workingDirectory,
    enabled: row.enabled,
    lastRunAt: row.lastRunAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    agentUser: row.agentUserId ? {
      id: row.agentUserId,
      name: row.agentUserName,
      agentCli: row.agentUserCli,
      agentModel: row.agentUserModel,
      permissionMode: row.agentUserPermissionMode,
    } : null,
    cronTasks: recentTasks,
  };

  return NextResponse.json({ data });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await req.json() as Partial<{
    name: string;
    description: string;
    prompt: string;
    cronExpression: string | null;
    workingDirectory: string | null;
    agentUserId: string;
    enabled: boolean;
    lastRunAt: string | null;
  }>;
  const { lastRunAt, ...fields } = body;

  if (body.agentUserId === null || body.agentUserId === '') {
    return NextResponse.json({ error: 'agentUserId is required' }, { status: 400 });
  }

  if (body.agentUserId !== undefined) {
    const [agentUser] = await db.select({
      id: users.id,
      type: users.type,
      agentCli: users.agentCli,
    }).from(users).where(eq(users.id, body.agentUserId));

    if (!agentUser || agentUser.type !== 'agent' || !agentUser.agentCli) {
      return NextResponse.json({ error: 'valid agentUserId is required' }, { status: 400 });
    }
  }

  const [row] = await db.update(schedules).set({
    ...fields,
    ...(lastRunAt !== undefined && { lastRunAt: lastRunAt ? new Date(lastRunAt) : null }),
    updatedAt: new Date(),
  }).where(eq(schedules.id, id)).returning();
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ data: row });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  await db.delete(schedules).where(eq(schedules.id, id));
  return NextResponse.json({ success: true });
}
