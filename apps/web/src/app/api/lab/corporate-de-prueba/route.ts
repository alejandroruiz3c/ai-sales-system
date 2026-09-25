import { NextResponse } from 'next/server';
import { z } from 'zod';

import { env } from '@/lib/env.ts';
import { errorDeLab } from '@/lib/http.ts';
import { checkLabAccess } from '@/lib/lab-guard.ts';
import { crearCorporateDePrueba, PRESUPUESTO_MAXIMO_DE_PRUEBA_EUR } from '@/lib/lab-pruebas.ts';

export const dynamic = 'force-dynamic';

const cuerpo = z.object({
  nombre: z.string().trim().min(3, 'Ponle un nombre.').max(120),
  presupuestoEur: z.number().min(0).max(PRESUPUESTO_MAXIMO_DE_PRUEBA_EUR),
});

/** Crea un corporate de prueba con presupuesto para el probador de modelos (F2). */
export async function POST(peticion: Request) {
  if ((await checkLabAccess()) !== 'autorizado') {
    return NextResponse.json({ error: 'Solo administradores de plataforma.' }, { status: 403 });
  }
  try {
    const { nombre, presupuestoEur } = cuerpo.parse(await peticion.json());
    return NextResponse.json(await crearCorporateDePrueba(env.salesOsEnv, nombre, presupuestoEur));
  } catch (error) {
    return errorDeLab(error);
  }
}
