import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { views } from '@/db/schema';
import { eq } from 'drizzle-orm';

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const [row] = await db.select().from(views).where(eq(views.id, id));
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ data: row });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await req.json() as Partial<{
    name: string;
    description: string | null;
    query: string;
    isShared: boolean;
  }>;

  const [row] = await db.update(views).set({
    ...(body.name !== undefined && { name: body.name }),
    ...(body.description !== undefined && { description: body.description }),
    ...(body.query !== undefined && { filters: JSON.stringify({ query: body.query }) }),
    ...(body.isShared !== undefined && { isShared: body.isShared }),
    updatedAt: new Date(),
  }).where(eq(views.id, id)).returning();

  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ data: row });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  await db.delete(views).where(eq(views.id, id));
  return NextResponse.json({ success: true });
}
