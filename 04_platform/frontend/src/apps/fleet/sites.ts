import type { Result, SbgClient } from '../../lib/sbg';
import type { components } from '../../lib/sbg/schema';
import type { MessageKey, Translate } from '../../shared/i18n';

export type FleetSites = components['schemas']['FleetSitesView'];
export type FleetSite = components['schemas']['FleetSiteView'];
export type SiteHome = components['schemas']['SiteHome'];
export type FleetUse = components['schemas']['FleetUseView'];
export type UseTotals = components['schemas']['UseTotals'];
export type VehicleUse = components['schemas']['VehicleUse'];
export type SiteWeek = components['schemas']['SiteWeek'];

/** A week's days in order: Sunday to Saturday (the user, 2026-10-26: "saturday should be the last day of the week"). */
export const WEEK = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export type Weekday = (typeof WEEK)[number];

/** The weekday a calendar day (YYYY-MM-DD) falls on — the same wherever it is read. */
export function weekdayOf(day: string): Weekday {
  return WEEK[new Date(`${day}T12:00:00Z`).getUTCDay()];
}
export type WeekForm = Record<Weekday, { open: string; close: string } | null>;
export const DAY_NAME: Record<Weekday, MessageKey> = { mon: 'fleet.sites.dayName.mon', tue: 'fleet.sites.dayName.tue', wed: 'fleet.sites.dayName.wed', thu: 'fleet.sites.dayName.thu', fri: 'fleet.sites.dayName.fri', sat: 'fleet.sites.dayName.sat', sun: 'fleet.sites.dayName.sun' };
export const DAY_SHORT: Record<Weekday, MessageKey> = { mon: 'fleet.sites.day.mon', tue: 'fleet.sites.day.tue', wed: 'fleet.sites.day.wed', thu: 'fleet.sites.day.thu', fri: 'fleet.sites.day.fri', sat: 'fleet.sites.day.sat', sun: 'fleet.sites.day.sun' };

/** What the office writes about a site: what is not sent stays as it was. */
export interface SiteInput {
  name?: string;
  lat?: number;
  lng?: number;
  address?: string;
  hours?: Record<string, { open: string; close: string } | null> | null;
  /** Null: no longer counted. */
  loadingBays?: number | null;
  shifts?: Array<{ shiftId?: string; name: string; start: string; hours: number }>;
}

/**
 * A FLEET'S SITES, over the wire — the depots and yards its trucks and drivers work from. Read when the Sites screen
 * opens, so it lives beside that screen rather than in the app's one big hook.
 */
export function sitesApi(sbg: SbgClient, fleetDid: string) {
  const path = { did: fleetDid };
  return {
    view: (): Promise<Result<FleetSites>> => sbg.request((c) => c.GET('/v1/sbg/fleet/managers/{did}/sites', { params: { path } })) as never,
    add: (body: SiteInput): Promise<Result<FleetSites>> => sbg.request((c) => c.POST('/v1/sbg/fleet/managers/{did}/sites', { params: { path }, body: body as never })) as never,
    update: (siteId: string, body: SiteInput): Promise<Result<FleetSites>> =>
      sbg.request((c) => c.POST('/v1/sbg/fleet/managers/{did}/sites/{siteId}', { params: { path: { ...path, siteId } }, body: body as never })) as never,
    close: (siteId: string): Promise<Result<FleetSites>> => sbg.request((c) => c.POST('/v1/sbg/fleet/managers/{did}/sites/{siteId}/close', { params: { path: { ...path, siteId } } })) as never,
    setHome: (kind: 'vehicle' | 'driver', id: string, siteId: string): Promise<Result<FleetSites>> =>
      sbg.request((c) => c.POST('/v1/sbg/fleet/managers/{did}/site-homes', { params: { path }, body: { kind, id, siteId } })) as never,
    /** The fleet's own clock: what its today is. */
    clock: (): Promise<Result<components['schemas']['FleetClockView']>> => sbg.request((c) => c.GET('/v1/sbg/fleet/managers/{did}/clock', { params: { path } })) as never,
    /** How the vehicles were used, from a day to a day. */
    use: (from: string, to: string): Promise<Result<FleetUse>> => sbg.request((c) => c.GET('/v1/sbg/fleet/managers/{did}/use', { params: { path, query: { from, to } } })) as never,
  };
}

export type SitesApi = ReturnType<typeof sitesApi>;

/** A site's name, from its id — the id itself where the site is not (or no longer) on the list. */
export function siteName(sites: Pick<FleetSite, 'siteId' | 'name'>[], siteId: string): string {
  return sites.find((s) => s.siteId === siteId)?.name ?? siteId;
}

/** A point typed as "-1.2921, 36.8219": both numbers, in range — or nothing. */
export function pointOf(text: string): { lat: number; lng: number } | null {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(text);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 ? { lat, lng } : null;
}

/** The seven days ending on a day: the stretch the use card shows. */
export function weekEnding(day: string): { from: string; to: string } {
  return { from: shiftDay(day, -6), to: day };
}

/** A day so many days on (or back). Worked at noon, so no clock change moves it. */
export function shiftDay(day: string, n: number): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/**
 * HOW A VEHICLE — or a site, or the fleet — WAS USED, in a few lines: days out of the days counted, hours on shift; what
 * it carried and how much of its running was loaded; days off the road and idle. Only what was recorded: km only where
 * readings were given, and the loaded share only where loads were.
 */
export function useLines(u: UseTotals, days: number, t: Translate): string[] {
  const possible = days * u.vehicles;
  // For more than one vehicle the days are vehicle-days: three trucks over a week could have gone out on twenty-one.
  const lines = [t(u.vehicles > 1 ? 'fleet.use.outMany' : 'fleet.use.out', { out: u.daysOut, of: possible, hours: Math.round(u.hoursOnShift), shifts: u.shifts })];
  const run = u.loadedKm + u.emptyKm;
  const carried = [
    u.km !== undefined ? t('fleet.use.km', { km: Math.round(u.km).toLocaleString() }) : '',
    u.loads ? t('fleet.use.loads', { n: u.loads, kg: Math.round(u.kgDelivered).toLocaleString() }) : '',
    run > 0 ? t('fleet.use.loaded', { pct: Math.round((u.loadedKm / run) * 100) }) : '',
    u.runs ? t('fleet.use.runs', { n: u.runs, kg: Math.round(u.runKg).toLocaleString() }) : '',
  ].filter(Boolean);
  lines.push(carried.length ? carried.join(' · ') : t('fleet.use.nothing'));
  if (u.daysOffRoad || u.daysIdle) lines.push([u.daysOffRoad ? t('fleet.use.offRoad', { n: u.daysOffRoad }) : '', u.daysIdle ? t('fleet.use.idle', { n: u.daysIdle }) : ''].filter(Boolean).join(' · '));
  return lines;
}

/**
 * WHEN A SITE IS OPEN FOR LOADING, in one line: days that keep the same hours run together ("Mon–Fri 06:00–18:00 · Sat
 * 06:00–12:00 · Sun closed"). A day the hours leave out is a closed day. Null where the site keeps no hours: it never closes.
 */
export function hoursLine(week: SiteWeek | undefined, t: Translate): string | null {
  if (!week) return null;
  const runs: Array<{ from: Weekday; to: Weekday; hours: string | null }> = [];
  for (const d of WEEK) {
    const h = week[d];
    const hours = h ? `${h.open}–${h.close}` : null;
    const last = runs[runs.length - 1];
    if (last && last.hours === hours) last.to = d;
    else runs.push({ from: d, to: d, hours });
  }
  return runs
    .map((r) => {
      const days = r.from === r.to ? t(DAY_SHORT[r.from]) : t('fleet.sites.dayRun', { from: t(DAY_SHORT[r.from]), to: t(DAY_SHORT[r.to]) });
      return r.hours ? t('fleet.sites.openRun', { days, hours: r.hours }) : t('fleet.sites.closedRun', { days });
    })
    .join(' · ');
}

/** What a site says about loading there, in a line: its bays and its hours. Null where it says neither. */
export function loadsLine(s: Pick<FleetSite, 'loadingBays' | 'hours'>, t: Translate): string | null {
  const parts = [s.loadingBays ? t('fleet.sites.baysCount', { n: s.loadingBays }) : null, hoursLine(s.hours, t)].filter((x): x is string => Boolean(x));
  return parts.length ? t('fleet.sites.loadsLine', { what: parts.join(' · ') }) : null;
}

/** A site's hours as the form holds them: each day open with its times, or closed. A site that keeps none: every day 08:00–18:00, to start from. */
export function weekForm(hours: SiteWeek | undefined): WeekForm {
  return Object.fromEntries(WEEK.map((d) => [d, hours ? (hours[d] ? { open: hours[d]!.open, close: hours[d]!.close } : null) : { open: '08:00', close: '18:00' }])) as WeekForm;
}

/** The bays as typed: blank is "not counted". */
export function baysOf(text: string): number | null {
  const s = text.trim();
  return s ? Number(s) : null;
}
