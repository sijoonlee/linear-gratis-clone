import { NextResponse } from 'next/server';
import { markAllRead } from '@/lib/notifications';

export async function POST() {
  markAllRead();
  return NextResponse.json({ data: null });
}
