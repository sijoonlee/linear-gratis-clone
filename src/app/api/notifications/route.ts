import { NextRequest, NextResponse } from 'next/server';
import { getNotifications, addNotification, clearAll, type NotificationType } from '@/lib/notifications';

export async function GET() {
  return NextResponse.json({ data: getNotifications() });
}

export async function POST(req: NextRequest) {
  const body = await req.json() as { title: string; body?: string; type?: NotificationType };
  if (!body.title) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 });
  }
  const n = addNotification(body.title, body.body, body.type);
  return NextResponse.json({ data: n }, { status: 201 });
}

export async function DELETE() {
  clearAll();
  return NextResponse.json({ data: null });
}
