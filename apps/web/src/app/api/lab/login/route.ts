import { NextResponse } from 'next/server';

import { isSecureRequest, redirectRelative } from '@/lib/http.ts';
import {
  createLabToken,
  isLabConfigured,
  LAB_COOKIE,
  LAB_SESSION_SECONDS,
  verifyLabPassword,
} from '@/lib/lab-auth.ts';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!isLabConfigured()) {
    return NextResponse.json(
      {
        error: 'La sala de pruebas no está habilitada en este entorno: falta LAB_ACCESS_PASSWORD.',
      },
      { status: 503 },
    );
  }

  const form = await request.formData();
  const password = form.get('password');

  if (typeof password !== 'string' || !verifyLabPassword(password)) {
    return redirectRelative('/lab/login?error=1');
  }

  const response = redirectRelative('/lab');
  response.cookies.set({
    name: LAB_COOKIE,
    value: createLabToken(),
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecureRequest(request),
    path: '/',
    maxAge: LAB_SESSION_SECONDS,
  });
  return response;
}
