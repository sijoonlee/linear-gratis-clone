import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { appSettings } from '@/db/schema';
import { eq } from 'drizzle-orm';

export async function GET() {
  const rows = await db.select().from(appSettings);
  const data = rows.reduce<Record<string, string>>((acc, row) => {
    acc[row.key] = row.value;
    return acc;
  }, {});
  return NextResponse.json({ data });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json() as { key: string; value: string };
  if (!body.key || body.value === undefined) {
    return NextResponse.json({ error: 'key and value are required' }, { status: 400 });
  }

  const [row] = await db
    .insert(appSettings)
    .values({ key: body.key, value: body.value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: body.value, updatedAt: new Date() },
    })
    .returning();

  return NextResponse.json({ data: row });
}
