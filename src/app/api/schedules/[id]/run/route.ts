import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { schedules, cronTasks } from '@/db/schema';
import { and, eq, isNull, isNotNull, lt, or } from 'drizzle-orm';

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await req.json() as { scheduledFor: string };
  const scheduledFor = new Date(body.scheduledFor);

  const task = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(schedules)
      .set({ lastRunAt: scheduledFor, updatedAt: new Date() })
      .where(
        and(
          eq(schedules.id, id),
          eq(schedules.enabled, true),
          isNotNull(schedules.cronExpression),
          or(isNull(schedules.lastRunAt), lt(schedules.lastRunAt, scheduledFor))
        )
      )
      .returning({ id: schedules.id });

    if (!updated) return null;

    const [row] = await tx
      .insert(cronTasks)
      .values({
        scheduleId: id,
        status: 'pending',
        triggeredBy: 'schedule',
        scheduledFor,
      })
      .returning();

    return row;
  });

  if (!task) return NextResponse.json({ data: null });
  return NextResponse.json({ data: task }, { status: 201 });
}
