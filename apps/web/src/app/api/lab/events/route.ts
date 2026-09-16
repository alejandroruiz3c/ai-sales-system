import { NextResponse } from 'next/server';

import { listEvents } from '@/lib/events.ts';
import { checkLabAccess } from '@/lib/lab-guard.ts';

export const dynamic = 'force-dynamic';

export async function GET() {
  const access = await checkLabAccess();
  if (access !== 'autorizado') {
    return NextResponse.json({ error: 'Solo administradores.' }, { status: 403 });
  }
  return NextResponse.json(
    { events: listEvents(50) },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
