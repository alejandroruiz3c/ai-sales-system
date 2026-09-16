/**
 * Acceso a la sala de pruebas `/lab` (F0.16).
 *
 * **Provisional.** El control definitivo es el rol `admin` de Supabase Auth
 * (F1.3/F1.4). Hasta entonces `/lab` se protege con una contraseña de entorno.
 * Dos decisiones que sí se mantienen:
 *
 * - **Si no hay contraseña configurada, `/lab` no existe.** Falla cerrado: un
 *   panel de administración sin protección es peor que no tenerlo.
 * - **La cookie no guarda la contraseña**, sino un HMAC con caducidad, y se
 *   compara en tiempo constante.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

import { env } from './env.ts';

export const LAB_COOKIE = 'sales_os_lab';
const SESSION_MS = 8 * 60 * 60 * 1000;

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function isLabConfigured(): boolean {
  return env.labPassword !== undefined;
}

/** Comprueba la contraseña en tiempo constante. */
export function verifyLabPassword(candidate: string): boolean {
  const expected = env.labPassword;
  if (expected === undefined) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function createLabToken(now = Date.now()): string {
  const secret = env.labPassword;
  if (secret === undefined) throw new Error('LAB_ACCESS_PASSWORD no está configurada');
  const expiresAt = String(now + SESSION_MS);
  return `${expiresAt}.${sign(expiresAt, secret)}`;
}

export function verifyLabToken(token: string | undefined, now = Date.now()): boolean {
  const secret = env.labPassword;
  if (secret === undefined || token === undefined) return false;
  const dot = token.indexOf('.');
  if (dot <= 0) return false;
  const expiresAt = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (!/^\d+$/.test(expiresAt)) return false;
  if (Number(expiresAt) < now) return false;

  const expected = Buffer.from(sign(expiresAt, secret));
  const received = Buffer.from(signature);
  if (expected.length !== received.length) return false;
  return timingSafeEqual(expected, received);
}

export const LAB_SESSION_SECONDS = SESSION_MS / 1000;
