/**
 * Lista blanca de destinatarios de prueba.
 *
 * Todo lo de aquí está escrito para **fallar cerrado**: si una entrada o un
 * destinatario no se pueden interpretar con seguridad, no coinciden. Preferimos
 * bloquear un envío legítimo de prueba a permitir uno a un prospecto real.
 */

import type { OutboundChannel } from './types.ts';

export interface AllowlistRule {
  /** Texto original de la entrada, para poder citarla en la auditoría. */
  readonly raw: string;
  readonly kind: 'email' | 'email-domain' | 'phone' | 'linkedin' | 'social';
  /** Valor normalizado con el que se compara. */
  readonly value: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;
const PHONE_RE = /^\+[1-9]\d{6,14}$/;

/** Quita espacios, guiones, puntos y paréntesis de un teléfono. */
function normalizePhone(value: string): string | null {
  const cleaned = value.replace(/[\s\-().]/g, '');
  return PHONE_RE.test(cleaned) ? cleaned : null;
}

/**
 * Normaliza una dirección de email.
 *
 * Devuelve también la dirección "base" sin el alias `+…`, porque en Google
 * Workspace y en Microsoft 365 `alex.ruiz+t1@` y `alex.ruiz@` son el mismo buzón
 * y el plan usa precisamente alias con `+` para las pruebas (§5B.2).
 */
export function normalizeEmail(value: string): { full: string; base: string } | null {
  const trimmed = value.trim().toLowerCase();
  if (!EMAIL_RE.test(trimmed)) return null;
  const at = trimmed.lastIndexOf('@');
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  const plus = local.indexOf('+');
  const baseLocal = plus === -1 ? local : local.slice(0, plus);
  if (baseLocal === '') return null;
  return { full: trimmed, base: `${baseLocal}@${domain}` };
}

/** `true` si el texto parece un teléfono, aunque esté mal escrito. */
function looksLikePhone(value: string): boolean {
  const cleaned = value.replace(/[\s\-().+]/g, '');
  return cleaned !== '' && /^\d{6,20}$/.test(cleaned);
}

/** Extrae el identificador de un perfil de LinkedIn (`/in/<slug>`). */
export function normalizeLinkedIn(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  if (trimmed === '') return null;
  // Un teléfono mal escrito no es un identificador de LinkedIn. Sin esto, una
  // entrada como «600111222» (sin prefijo) se colaría como regla de LinkedIn.
  if (looksLikePhone(trimmed)) return null;
  const match = /(?:linkedin\.com\/(?:in|sales\/lead)\/)([^/?#\s]+)/.exec(trimmed);
  if (match?.[1]) return decodeURIComponent(match[1]);
  // Un handle suelto sirve, siempre que no parezca una URL de otra cosa.
  if (/^[a-z0-9\-_%]{3,100}$/.test(trimmed)) return decodeURIComponent(trimmed);
  return null;
}

/** Normaliza un handle social a `plataforma:handle` o `handle`. */
export function normalizeSocial(value: string): string | null {
  const trimmed = value.trim().toLowerCase().replace(/\s/g, '');
  if (trimmed === '') return null;
  if (!/^[a-z0-9:@._\-/*]{2,120}$/.test(trimmed)) return null;
  return trimmed.replace(/^@/, '').replace(/:@/, ':');
}

/**
 * Interpreta una entrada de la lista blanca. Devuelve `null` si no se reconoce:
 * una entrada que no se entiende no protege a nadie, así que se descarta y no
 * autoriza nada.
 */
export function parseAllowlistEntry(entry: string): AllowlistRule | null {
  const raw = entry.trim();
  if (raw === '' || raw.startsWith('#')) return null;

  if (raw.startsWith('@') && raw.includes('.') && !raw.includes('/')) {
    const domain = raw.slice(1).toLowerCase();
    return /^[^\s@.]+(?:\.[^\s@.]+)+$/.test(domain)
      ? { raw, kind: 'email-domain', value: domain }
      : null;
  }

  const email = normalizeEmail(raw);
  if (email) return { raw, kind: 'email', value: email.base };

  const phone = normalizePhone(raw);
  if (phone) return { raw, kind: 'phone', value: phone };

  if (raw.toLowerCase().includes('linkedin.com/')) {
    const slug = normalizeLinkedIn(raw);
    return slug ? { raw, kind: 'linkedin', value: slug } : null;
  }

  if (raw.includes(':')) {
    const social = normalizeSocial(raw);
    return social ? { raw, kind: 'social', value: social } : null;
  }

  const slug = normalizeLinkedIn(raw);
  if (slug) return { raw, kind: 'linkedin', value: slug };

  return null;
}

/** Interpreta la lista blanca completa, descartando lo que no se reconoce. */
export function parseAllowlist(entries: readonly string[]): AllowlistRule[] {
  const rules: AllowlistRule[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const rule = parseAllowlistEntry(entry);
    if (!rule) continue;
    const key = `${rule.kind}:${rule.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rules.push(rule);
  }
  return rules;
}

/** Trocea el valor de `SANDBOX_ALLOWLIST` (comas, saltos de línea o punto y coma). */
export function splitAllowlistValue(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[,;\n]/)
    .map((part) => part.trim())
    .filter((part) => part !== '');
}

export interface AllowlistMatch {
  readonly matched: boolean;
  readonly rule?: AllowlistRule;
  /** `true` si el destinatario no se pudo interpretar para su canal. */
  readonly uninterpretable?: boolean;
}

/**
 * Comprueba si un destinatario está en la lista blanca **para su canal**.
 *
 * El canal importa: que un teléfono esté autorizado para WhatsApp no autoriza a
 * llamar a un perfil de LinkedIn con el mismo texto.
 */
export function matchesAllowlist(
  channel: OutboundChannel,
  recipient: string,
  rules: readonly AllowlistRule[],
): AllowlistMatch {
  switch (channel) {
    case 'email': {
      const email = normalizeEmail(recipient);
      if (!email) return { matched: false, uninterpretable: true };
      const domain = email.base.slice(email.base.lastIndexOf('@') + 1);
      for (const rule of rules) {
        if (rule.kind === 'email' && rule.value === email.base) return { matched: true, rule };
        if (rule.kind === 'email-domain' && rule.value === domain) return { matched: true, rule };
      }
      return { matched: false };
    }

    case 'voice':
    case 'whatsapp':
    case 'sms': {
      const phone = normalizePhone(recipient);
      if (!phone) return { matched: false, uninterpretable: true };
      for (const rule of rules) {
        if (rule.kind === 'phone' && rule.value === phone) return { matched: true, rule };
      }
      return { matched: false };
    }

    case 'linkedin': {
      const slug = normalizeLinkedIn(recipient);
      if (!slug) return { matched: false, uninterpretable: true };
      for (const rule of rules) {
        if (rule.kind === 'linkedin' && rule.value === slug) return { matched: true, rule };
      }
      return { matched: false };
    }

    case 'social': {
      const handle = normalizeSocial(recipient);
      if (!handle) return { matched: false, uninterpretable: true };
      for (const rule of rules) {
        if (rule.kind !== 'social') continue;
        if (rule.value === handle) return { matched: true, rule };
        // `youtube:*` autoriza cualquier handle de esa plataforma de prueba.
        if (rule.value.endsWith(':*') && handle.startsWith(rule.value.slice(0, -1))) {
          return { matched: true, rule };
        }
      }
      return { matched: false };
    }
  }
}
