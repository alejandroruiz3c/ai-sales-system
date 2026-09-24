import { describe, expect, it } from 'vitest';

import {
  claveDeConcurrencia,
  desdeNombreInngest,
  NOMBRES_DE_EVENTO,
  nombreInngest,
  validarEvento,
} from './eventos.ts';

const TENANT = '11111111-1111-4111-8111-111111111111';

describe('el esquema es la frontera', () => {
  it('un evento bien formado entra, con sus valores por defecto', () => {
    const resultado = validarEvento({ tenantId: TENANT, nombre: 'prospect.qualified' });
    expect(resultado.valido).toBe(true);
    expect(resultado.evento).toMatchObject({
      version: 1,
      agente: 'sistema',
      origen: 'panel',
      datos: {},
    });
  });

  it('un nombre no declarado no entra, y el mensaje dice dónde declararlo', () => {
    const resultado = validarEvento({ tenantId: TENANT, nombre: 'prospecto.inventado' });
    expect(resultado.valido).toBe(false);
    expect(resultado.errores.join(' ')).toMatch(/packages\/core\/src\/eventos\.ts/);
  });

  it('un evento sin tenant no entra: no hay evento de plataforma en este bus', () => {
    const resultado = validarEvento({ nombre: 'prospect.qualified' });
    expect(resultado.valido).toBe(false);
    expect(resultado.errores.join(' ')).toMatch(/tenantId/);
  });

  it('un tenant que no es uuid no entra', () => {
    const resultado = validarEvento({ tenantId: 'aurora', nombre: 'prospect.qualified' });
    expect(resultado.valido).toBe(false);
  });

  it('una versión cero no entra', () => {
    const resultado = validarEvento({ tenantId: TENANT, nombre: 'deal.won', version: 0 });
    expect(resultado.valido).toBe(false);
  });
});

describe('nombres en Inngest', () => {
  it('ida y vuelta', () => {
    for (const nombre of NOMBRES_DE_EVENTO) {
      expect(desdeNombreInngest(nombreInngest(nombre, 3))).toEqual({ nombre, version: 3 });
    }
  });

  it('un nombre de otro sistema no se reconoce', () => {
    expect(desdeNombreInngest('otro-sistema/algo.v1')).toBeUndefined();
  });

  it('un nombre sin versión no se reconoce', () => {
    expect(desdeNombreInngest('sales-os/deal.won')).toBeUndefined();
  });
});

describe('claves de concurrencia', () => {
  it('empiezan siempre por el tenant', () => {
    expect(claveDeConcurrencia(TENANT, 'emailing', 'buzon-1')).toBe(`${TENANT}:emailing:buzon-1`);
  });

  it('con una sola parte, el tenant sigue estando', () => {
    expect(claveDeConcurrencia(TENANT)).toBe(TENANT);
  });
});

describe('la lista de nombres', () => {
  it('no tiene duplicados', () => {
    expect(new Set(NOMBRES_DE_EVENTO).size).toBe(NOMBRES_DE_EVENTO.length);
  });

  it('todos siguen el formato dominio.accion en minúsculas', () => {
    for (const nombre of NOMBRES_DE_EVENTO) {
      expect(nombre, nombre).toMatch(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/);
    }
  });

  it('cubre los veinte contratos que enumera el plan §2.5', () => {
    const delPlan = [
      'prospect.ingested',
      'prospect.qualified',
      'prospect.disqualified',
      'crm.lead.created',
      'outreach.step.scheduled',
      'outreach.step.sent',
      'outreach.reply.received',
      'outreach.channel.succeeded',
      'meeting.booked',
      'call.completed',
      'deal.close_intent',
      'deal.won',
      'payment.succeeded',
      'customer.created',
      'cs.feedback.product',
      'opinion.opportunity.detected',
      'machine.limit.reached',
      'machine.health.degraded',
      'budget.threshold.reached',
    ];
    for (const nombre of delPlan) {
      expect(NOMBRES_DE_EVENTO, `falta ${nombre}`).toContain(nombre);
    }
  });
});
