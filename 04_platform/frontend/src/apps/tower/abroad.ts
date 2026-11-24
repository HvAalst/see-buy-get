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
  const known = ['propose', 'approve', 'decline', 'off', 'airport-open', 'airport-block', 'warehouse', 'clearer', 'clearer-accepted', 'fee', 'readdress', 'departure', 'arrival', 'carrier', 'prices', 'ends'];
  return known.includes(c.what) ? t(`tower.abroad.change.${c.what}` as MessageKey, params) : `${c.by}: ${c.what}`;
}

/**
 * 2026-11-24 — A ROAD ROUTE'S CHARGES AT ITS ENDS (route plan part 9): one line per end that charges anything, each group named in
 * its country's words with what it adds; nothing where no group adds anything.
 */
export function endsLines(r: BorderRoute, nameOf: (code: string) => string, money: (n: number) => string, t: T): string[] {
  const side = (country: string, charges: Record<string, number> | undefined, groups: Array<{ key: string; name: string }> | undefined): string | undefined => {
    const named = Object.entries(charges ?? {})
      .filter(([, v]) => v > 0)
      .map(([k, v]) => t('tower.abroad.ends.group', { group: groups?.find((g) => g.key === k)?.name ?? k, amount: money(v) }));
    return named.length ? t('tower.abroad.ends.side', { country: nameOf(country), groups: named.join(', ') }) : undefined;
  };
  return [side(r.from, r.ends?.from, r.fromGroups), side(r.to, r.ends?.to, r.toGroups)].filter((l): l is string => Boolean(l));
}

/** What the end-charge form sends, or that a figure is not one: each from 0 to 1,000; an empty field adds nothing. */
export function endsBody(form: { from: Record<string, string>; to: Record<string, string> }): { body: { from: Record<string, number>; to: Record<string, number> } } | { error: 'tower.abroad.ends.err' } {
  const side = (f: Record<string, string>): Record<string, number> | undefined => {
    const out: Record<string, number> = {};
    for (const [k, raw] of Object.entries(f)) {
      const v = raw.trim().replace(',', '.');
      if (!v) continue;
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || n > 1000) return undefined;
      out[k] = Math.round(n * 100) / 100;
    }
    return out;
  };
  const from = side(form.from);
  const to = side(form.to);
  return from && to ? { body: { from, to } } : { error: 'tower.abroad.ends.err' };
}
