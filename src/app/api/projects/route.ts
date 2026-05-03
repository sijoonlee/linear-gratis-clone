import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { projects } from '@/db/schema';
import { eq } from 'drizzle-orm';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const teamId = searchParams.get('teamId');

  const rows = teamId
    ? await db.select().from(projects).where(eq(projects.teamId, teamId)).orderBy(projects.createdAt)
    : await db.select().from(projects).orderBy(projects.createdAt);

  return NextResponse.json({ data: rows });
}

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    teamId: string;
    name: string;
    description?: string;
    status?: 'backlog' | 'planned' | 'in_progress' | 'completed' | 'cancelled';
    color?: string;
    workingDirectory?: string;
    startDate?: string;
    targetDate?: string;
  };
  const workingDirectory = body.workingDirectory?.trim();
  const name = body.name?.trim();
  if (!body.teamId || !name || !workingDirectory) {
    return NextResponse.json({ error: 'teamId, name, and workingDirectory are required' }, { status: 400 });
  }
  const [row] = await db.insert(projects).values({
    teamId: body.teamId,
    name,
    description: body.description,
    status: body.status ?? 'planned',
    color: body.color,
    workingDirectory,
    startDate: body.startDate ? new Date(body.startDate) : undefined,
    targetDate: body.targetDate ? new Date(body.targetDate) : undefined,
  }).returning();
  return NextResponse.json({ data: row }, { status: 201 });
}
