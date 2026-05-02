import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { views } from '@/db/schema';
import { desc, eq } from 'drizzle-orm';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const teamId = searchParams.get('teamId');

  const rows = teamId
    ? await db.select().from(views).where(eq(views.teamId, teamId)).orderBy(desc(views.createdAt))
    : await db.select().from(views).orderBy(desc(views.createdAt));

  return NextResponse.json({ data: rows });
}

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    teamId: string;
    name: string;
    description?: string;
    query: string;
    isShared?: boolean;
  };

  if (!body.teamId || !body.name || !body.query) {
    return NextResponse.json({ error: 'teamId, name, and query are required' }, { status: 400 });
  }

  const [row] = await db.insert(views).values({
    teamId: body.teamId,
    name: body.name,
    description: body.description,
    filters: JSON.stringify({ query: body.query }),
    isShared: body.isShared ?? false,
  }).returning();

  return NextResponse.json({ data: row }, { status: 201 });
}
