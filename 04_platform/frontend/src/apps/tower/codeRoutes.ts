import type { components } from '../../lib/sbg';
import type { MessageKey } from '../../shared/i18n';

/*
 * 2026-11-16 — SIGN-IN CODES ON THE STAFF CONSOLE (the owner: "Can we build it in a way that it becomes visual and controlable
 * from the staff console? If so, we implement."). The words of the screen, kept apart from it so they can be tested.
 */
export type CodeRoutes = components['schemas']['CodeRoutesView'];
export type CountryRoutes = components['schemas']['CountryCodeRoutes'];
export type RouteStatus = components['schemas']['CodeRouteStatus'];
export type RouteChange = components['schemas']['CodeRouteChange'];
export type RouteCount = components['schemas']['CodeRouteCount'];
export type RouteId = CountryRoutes['order'][number];

type T = (key: MessageKey, params?: Record<string, string | number>) => string;

/** The providers' own names: brands, the same in every language. */
export const ROUTE_NAME: Record<RouteId, string> = { africastalking: 'Africa’s Talking', twilio: 'Twilio' };

/** A route moved one place up (-1) or down (1): the new order. At an end, the order as it was. */
export function moved(order: RouteId[], route: RouteId, by: -1 | 1): RouteId[] {
  const i = order.indexOf(route);
  const j = i + by;
  if (i < 0 || j < 0 || j >= order.length) return order;
  const next = [...order];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/** A route as a tag: sending, partly set up, not set up, or set up and held back on a test server. */
export function routeTag(r: RouteStatus, t: T): { tone: 'ok' | 'warn' | 'muted'; tag: string } {
  if (r.state === 'ready') return { tone: 'ok', tag: t('tower.codes.state.ready') };
  if (r.state === 'half_set_up') return { tone: 'warn', tag: t('tower.codes.state.half') };
  if (r.state === 'sandbox') return { tone: 'muted', tag: t('tower.codes.state.sandbox') };
  return { tone: 'muted', tag: t('tower.codes.state.none') };
}

/** Where a country's codes go now — and, when it is not its first route on, why that one is passed over. */
export function goesByLine(c: CountryRoutes, routes: RouteStatus[], t: T): { tone: 'ok' | 'warn'; line: string } {
  if (!c.goesBy) return { tone: 'warn', line: t('tower.codes.goesNone') };
  const first = c.order.find((r) => !c.off.includes(r));
  if (first && first !== c.goesBy) {
    const why = routes.find((r) => r.id === first)?.state === 'sandbox' ? t('tower.codes.passed.sandbox') : t('tower.codes.passed.notSetUp');
    return { tone: 'warn', line: t('tower.codes.goesByInstead', { route: ROUTE_NAME[c.goesBy], first: ROUTE_NAME[first], why }) };
  }
  return { tone: 'ok', line: t('tower.codes.goesBy', { route: ROUTE_NAME[c.goesBy] }) };
}

/** A route's last seven days in a country, in one line; nothing when it was given no code. */
export function countLine(n: RouteCount | undefined, t: T): string {
  if (!n || n.asked === 0) return t('tower.codes.count.none');
  return t('tower.codes.count', { asked: n.asked, delivered: n.delivered, entered: n.entered, failed: n.failed });
}

/** A change, as the log says it: who, which country, what. */
export function changeLine(c: RouteChange, countryName: (code: string) => string, t: T): string {
  const country = countryName(c.country);
  if (c.what === 'order') return t('tower.codes.change.order', { who: c.by, country, order: (c.order ?? []).map((r) => ROUTE_NAME[r]).join(', ') });
  return t(c.what === 'on' ? 'tower.codes.change.on' : 'tower.codes.change.off', { who: c.by, country, route: c.route ? ROUTE_NAME[c.route] : '' });
}
