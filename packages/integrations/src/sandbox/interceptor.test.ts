import { describe, expect, it } from 'vitest';

import { SandboxBlockedError, SandboxInterceptor, resolveSandboxConfig } from './interceptor.ts';
import type { OutboundAttempt, OutboundChannel } from './types.ts';

const ALLOWLIST = [
  'alex.ruiz@turbineh.com',
  '+34600111222',
  'https://www.linkedin.com/in/alex-ruiz-demo/',
  'youtube:*',
  '@turbineh-demo.com',
];

function interceptor(
  overrides: { env?: string; mode?: string; allowlist?: readonly string[] } = {},
): SandboxInterceptor {
  return SandboxInterceptor.fromEnv({
    SALES_OS_ENV: overrides.env ?? 'staging',
    SANDBOX_MODE: overrides.mode,
    SANDBOX_ALLOWLIST: (overrides.allowlist ?? ALLOWLIST).join(','),
  });
}

function attempt(channel: OutboundChannel, recipient: string): OutboundAttempt {
  return { tenantId: 'tenant-turbineh', channel, recipient, agent: 'email' };
}

describe('configuración del sandbox', () => {
  it('está activo cuando no hay ninguna variable definida', () => {
    const config = resolveSandboxConfig({});
    expect(config.enabled).toBe(true);
    expect(config.env).toBe('preview');
  });

  it('solo se puede desactivar en producción', () => {
    const production = resolveSandboxConfig({ SALES_OS_ENV: 'production', SANDBOX_MODE: 'off' });
    expect(production.enabled).toBe(false);
    expect(production.ignoredDisableRequest).toBe(false);
  });

  it('ignora la petición de desactivarlo en staging y deja constancia', () => {
    const staging = resolveSandboxConfig({ SALES_OS_ENV: 'staging', SANDBOX_MODE: 'off' });
    expect(staging.enabled).toBe(true);
    expect(staging.ignoredDisableRequest).toBe(true);
  });

  it('ignora la petición de desactivarlo en una preview', () => {
    const preview = resolveSandboxConfig({ SALES_OS_ENV: 'preview', SANDBOX_MODE: 'false' });
    expect(preview.enabled).toBe(true);
    expect(preview.ignoredDisableRequest).toBe(true);
  });
});

describe('bloqueo de destinatarios no autorizados', () => {
  it('bloquea un email que no está en la lista blanca', () => {
    const decision = interceptor().check(attempt('email', 'director@empresa-real.es'));
    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    expect(decision.reason).toBe('no-en-lista-blanca');
    expect(decision.message).toContain('no está en la lista blanca');
  });

  it('bloquea un teléfono que no está en la lista blanca', () => {
    const decision = interceptor().check(attempt('voice', '+34911223344'));
    expect(decision.allowed).toBe(false);
  });

  it('bloquea un perfil de LinkedIn que no está en la lista blanca', () => {
    const decision = interceptor().check(
      attempt('linkedin', 'https://www.linkedin.com/in/otra-persona/'),
    );
    expect(decision.allowed).toBe(false);
  });

  it('bloquea todo cuando la lista blanca está vacía', () => {
    const decision = interceptor({ allowlist: [] }).check(
      attempt('email', 'alex.ruiz@turbineh.com'),
    );
    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    expect(decision.reason).toBe('lista-blanca-vacia');
  });

  it('bloquea cuando la lista blanca solo tiene entradas ininteligibles', () => {
    const sandbox = interceptor({ allowlist: ['esto no es un destinatario', '???'] });
    expect(sandbox.rules).toHaveLength(0);
    expect(sandbox.invalidEntries).toHaveLength(2);
    expect(sandbox.check(attempt('email', 'alex.ruiz@turbineh.com')).allowed).toBe(false);
  });

  it('bloquea un destinatario que no se puede interpretar para su canal', () => {
    const decision = interceptor().check(attempt('voice', 'alex.ruiz@turbineh.com'));
    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    expect(decision.reason).toBe('destinatario-no-interpretable');
  });

  it('no deja que un teléfono autorizado autorice el mismo texto en otro canal', () => {
    const decision = interceptor().check(attempt('linkedin', '+34600111222'));
    expect(decision.allowed).toBe(false);
  });

  it('bloquea un intento sin tenant', () => {
    const decision = interceptor().check({
      tenantId: '  ',
      channel: 'email',
      recipient: 'alex.ruiz@turbineh.com',
      agent: 'email',
    });
    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    expect(decision.reason).toBe('intento-incompleto');
  });
});

describe('destinatarios autorizados', () => {
  it('permite un email de la lista blanca', () => {
    const decision = interceptor().check(attempt('email', 'alex.ruiz@turbineh.com'));
    expect(decision.allowed).toBe(true);
    if (!decision.allowed) return;
    expect(decision.via).toBe('lista-blanca');
    expect(decision.matchedRule).toBe('alex.ruiz@turbineh.com');
  });

  it('permite un alias con + del mismo buzón, que es como se prueba en staging', () => {
    expect(interceptor().check(attempt('email', 'alex.ruiz+t1@turbineh.com')).allowed).toBe(true);
    expect(interceptor().check(attempt('email', 'alex.ruiz+lector@turbineh.com')).allowed).toBe(
      true,
    );
  });

  it('no confunde un alias con otro buzón parecido', () => {
    expect(interceptor().check(attempt('email', 'alex.ruizz@turbineh.com')).allowed).toBe(false);
    expect(interceptor().check(attempt('email', 'alex.ruiz@turbineh.es')).allowed).toBe(false);
  });

  it('no distingue mayúsculas ni espacios sobrantes', () => {
    expect(interceptor().check(attempt('email', '  Alex.Ruiz@Turbineh.com ')).allowed).toBe(true);
  });

  it('permite un dominio completo declarado con @dominio', () => {
    expect(interceptor().check(attempt('email', 'cualquiera@turbineh-demo.com')).allowed).toBe(
      true,
    );
  });

  it('permite un teléfono de la lista blanca con separadores', () => {
    expect(interceptor().check(attempt('whatsapp', '+34 600 111 222')).allowed).toBe(true);
    expect(interceptor().check(attempt('sms', '+34-600-111-222')).allowed).toBe(true);
  });

  it('permite un perfil de LinkedIn independientemente del formato de la URL', () => {
    for (const recipient of [
      'https://www.linkedin.com/in/alex-ruiz-demo/',
      'linkedin.com/in/alex-ruiz-demo',
      'https://es.linkedin.com/in/alex-ruiz-demo?originalSubdomain=es',
      'alex-ruiz-demo',
    ]) {
      expect(interceptor().check(attempt('linkedin', recipient)).allowed, recipient).toBe(true);
    }
  });

  it('permite cualquier handle de una plataforma social declarada con comodín', () => {
    expect(interceptor().check(attempt('social', 'youtube:@canal-de-pruebas')).allowed).toBe(true);
    expect(interceptor().check(attempt('social', 'reddit:u/otro')).allowed).toBe(false);
  });

  it('permite todo en producción con el sandbox desactivado', () => {
    const decision = interceptor({ env: 'production', mode: 'off', allowlist: [] }).check(
      attempt('email', 'director@empresa-real.es'),
    );
    expect(decision.allowed).toBe(true);
    if (!decision.allowed) return;
    expect(decision.via).toBe('produccion');
  });

  it('sigue bloqueando en producción si el sandbox no se ha desactivado', () => {
    expect(
      interceptor({ env: 'production' }).check(attempt('email', 'director@empresa-real.es'))
        .allowed,
    ).toBe(false);
  });
});

describe('guard y assert', () => {
  it('assert lanza SandboxBlockedError con la decisión dentro', () => {
    try {
      interceptor().assert(attempt('email', 'director@empresa-real.es'));
      expect.unreachable('tenía que lanzar');
    } catch (error) {
      expect(error).toBeInstanceOf(SandboxBlockedError);
      const blocked = error as SandboxBlockedError;
      expect(blocked.decision.reason).toBe('no-en-lista-blanca');
      expect(blocked.decision.attempt.channel).toBe('email');
    }
  });

  it('guard no ejecuta el envío cuando el destinatario está bloqueado', async () => {
    let enviado = false;
    const send = async () => {
      enviado = true;
      return await Promise.resolve('enviado');
    };

    await expect(
      interceptor().guard(attempt('email', 'director@empresa-real.es'), send),
    ).rejects.toBeInstanceOf(SandboxBlockedError);
    expect(enviado).toBe(false);
  });

  it('guard ejecuta el envío cuando el destinatario está autorizado', async () => {
    const result = await interceptor().guard(attempt('email', 'alex.ruiz+t1@turbineh.com'), () =>
      Promise.resolve('enviado'),
    );
    expect(result).toBe('enviado');
  });
});
