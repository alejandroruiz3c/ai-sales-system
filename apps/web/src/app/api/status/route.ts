import { NextResponse } from 'next/server';

import { getStatusReport } from '@/lib/status.ts';

export const dynamic = 'force-dynamic';

/**
 * Estado en JSON. Lo consumen los tests E2E de fase y cualquier monitor
 * externo (Better Stack, F0.11).
 */
export async function GET() {
  const report = await getStatusReport();
  return NextResponse.json(report, {
    status: 200,
    headers: { 'Cache-Control': 'no-store' },
  });
}
