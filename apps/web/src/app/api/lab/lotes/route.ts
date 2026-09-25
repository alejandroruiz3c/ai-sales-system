import { NextResponse } from 'next/server';

import { errorDeLab } from '@/lib/http.ts';
import { lotesRecientes } from '@/lib/lab-modelos.ts';
import { checkLabAccess } from '@/lib/lab-guard.ts';

export const dynamic = 'force-dynamic';

/** Los últimos lotes de los corporates de prueba, con su corrección si ya volvieron (T2.4). */
export async function GET() {
  if ((await checkLabAccess()) !== 'autorizado') {
    return NextResponse.json({ error: 'Solo administradores de plataforma.' }, { status: 403 });
  }
  try {
    return NextResponse.json({ lotes: await lotesRecientes() });
  } catch (error) {
    return errorDeLab(error);
  }
}
