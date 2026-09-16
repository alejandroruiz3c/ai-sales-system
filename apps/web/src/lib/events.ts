/**
 * Bus de eventos en memoria para el visor de `/lab` (F0.16).
 *
 * **Provisional y a propósito.** El registro de verdad es la tabla `events`
 * append-only de F1.10, con su `tenant_id` y sus políticas RLS. Hasta que exista
 * la base de datos, esto es un anillo en memoria del proceso: en Vercel cada
 * instancia tiene el suyo y los eventos no sobreviven a un despliegue. Sirve
 * para ver que el bus existe y que los eventos tienen la forma correcta, que es
 * lo que F0 tiene que demostrar.
 */

export const EVENT_KINDS = [
  'sistema',
  'sandbox',
  'inngest',
  'error',
  'aprobacion',
  'coste',
] as const;

export type EventKind = (typeof EVENT_KINDS)[number];

export interface SystemEvent {
  readonly id: string;
  readonly at: string;
  readonly kind: EventKind;
  /** Nombre versionado del evento cuando existe en el bus (plan §2.5). */
  readonly name: string;
  /** Todo evento lleva tenant. En F0 hay un único tenant de sistema. */
  readonly tenantId: string;
  readonly agent: string;
  readonly message: string;
  readonly data?: Readonly<Record<string, unknown>>;
}

const MAX_EVENTS = 200;

interface EventStore {
  events: SystemEvent[];
}

/**
 * En desarrollo, Next recarga los módulos en caliente. Guardamos el anillo en
 * `globalThis` para que el visor no se quede en blanco en cada recarga.
 */
const globalStore = globalThis as typeof globalThis & { __salesOsEvents?: EventStore };

function store(): EventStore {
  globalStore.__salesOsEvents ??= { events: [] };
  return globalStore.__salesOsEvents;
}

export function recordEvent(event: Omit<SystemEvent, 'id' | 'at'> & { at?: string }): SystemEvent {
  const full: SystemEvent = {
    id: crypto.randomUUID(),
    at: event.at ?? new Date().toISOString(),
    kind: event.kind,
    name: event.name,
    tenantId: event.tenantId,
    agent: event.agent,
    message: event.message,
    ...(event.data ? { data: event.data } : {}),
  };
  const current = store();
  current.events = [full, ...current.events].slice(0, MAX_EVENTS);
  return full;
}

export function listEvents(limit = 50): readonly SystemEvent[] {
  return store().events.slice(0, limit);
}

export function clearEvents(): void {
  store().events = [];
}
