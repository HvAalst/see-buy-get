import type { components } from '../../lib/sbg';
import type { MessageKey } from '../../shared/i18n';

/*
 * 2026-11-18 — PARCELS ACROSS A BORDER ON THE CONSOLE (the plan "Parcels across a border", step 1). The words of the screen,
 * kept apart from it so they can be tested.
 */
export type BorderRoutes = components['schemas']['BorderRoutesView'];
export type BorderRoute = components['schemas']['BorderRouteView'];
export type BorderArrival = components['schemas']['BorderArrivalView'];
export type BorderChange = components['schemas']['BorderChange'];

type T = (key: MessageKey, params?: Record<string, string | number>) => string;

/** A route's state as a tag: on, waiting for a second person, or off. */
export function routeStateTag(r: BorderRoute, t: T): { tone: 'ok' | 'warn' | 'muted'; tag: string } {
  if (r.state === 'on') return { tone: 'ok', tag: t('tower.abroad.state.on') };
  if (r.state === 'waiting') return { tone: 'warn', tag: t('tower.abroad.state.waiting') };
  return { tone: 'muted', tag: t('tower.abroad.state.off') };
}

/** One thing a route needs, said with its countries' names. */
export function conditionLine(key: BorderRoute['conditions'][number]['key'], from: string, to: string, t: T): string {
  return t(`tower.abroad.cond.${key}` as MessageKey, { from, to });
}

/** What may be done with a route by this reader now: propose, approve (never one's own), decline or withdraw, switch off. */
export function routeActs(r: BorderRoute): Array<'propose' | 'approve' | 'decline' | 'off'> {
  if (r.state === 'on') return ['off'];
  if (r.state === 'waiting') return r.mine ? ['decline'] : ['approve', 'decline'];
  return r.conditions.every((c) => c.met) ? ['propose'] : [];
}

/** Who clears in a country, in one line. */
export function clearerLine(a: BorderArrival, when: (iso: string) => string, t: T): string {
  const c = a.clearer;
  if (!c) return t('tower.abroad.clearer.none');
  if (c.kind === 'company') return t('tower.abroad.clearer.company', { name: c.name, registration: c.registration ?? '' });
  return c.acceptedAt ? t('tower.abroad.clearer.agentAccepted', { name: c.name, when: when(c.acceptedAt) }) : t('tower.abroad.clearer.agentWaiting', { name: c.name });
}

/** A change, as the log says it: who did what, where. */
export function abroadChangeLine(c: BorderChange, nameOf: (code: string) => string, t: T): string {
  const params = { who: c.by, from: nameOf(c.country), to: c.to ? nameOf(c.to) : '', country: nameOf(c.country), airport: c.airport ?? '' };
  const known = ['propose', 'approve', 'decline', 'off', 'airport-open', 'airport-block', 'warehouse', 'clearer', 'clearer-accepted', 'fee', 'departure', 'carrier', 'prices'];
  return known.includes(c.what) ? t(`tower.abroad.change.${c.what}` as MessageKey, params) : `${c.by}: ${c.what}`;
}
