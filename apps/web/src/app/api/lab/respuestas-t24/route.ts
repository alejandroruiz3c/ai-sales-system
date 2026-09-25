import { NextResponse } from 'next/server';

import { respuestasT24ComoCsv } from '@sales-os/prompts/fixtures';

import { checkLabAccess } from '@/lib/lab-guard.ts';

export const dynamic = 'force-dynamic';

/** El CSV de las 20 respuestas de T2.4, para descargarlo desde `/lab`. */
export async function GET() {
  if ((await checkLabAccess()) !== 'autorizado') {
    return NextResponse.json({ error: 'Solo administradores de plataforma.' }, { status: 403 });
  }
  return new NextResponse(respuestasT24ComoCsv(), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="respuestas-t24.csv"',
    },
  });
}
