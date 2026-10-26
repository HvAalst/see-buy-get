import type { Result, SbgClient } from '../../lib/sbg';
import type { Measure } from '../../lib/sbg/personas/vendor';
import { WEEK, type SiteWeek } from '../fleet/sites';
import type { QuoteView } from './types';

/** When a hub receives, said as a site's days and hours are said everywhere (en.site-hours.ts). */
export { hoursLine } from '../fleet/sites';

/**
 * INBOUND SUPPLY, READING B — A HUB AS A CROSS-DOCK, from the store's side (backend hub-arrival.service.ts; the user,
 * 2026-10-25: "Yes, A then B"). A hub may say it takes stores' parcels in bulk. A store shipping a parcel may choose such a
 * hub as where it starts — priced from the hub: no shop, no road before it. Then it books the hand-in: which of those
 * parcels, on how many pallets or cartons, which day the hub receives. The hub counts them at its door and scans each one
 * off; what was not on it is still the store's, which is told and books it again.
 */
export type HubUnitKind = 'pallet' | 'carton' | 'cage' | 'sack';
export const HUB_UNIT_KINDS: readonly HubUnitKind[] = ['pallet', 'carton', 'cage', 'sack'];

export interface HubOptionView {
  mdpId: string;
  name: string;
  location: { lat: number; lng: number };
  address?: string;
  hours?: SiteWeek;
  doors?: number;
  zone?: string;
  zoneName?: string;
  since: string;
  quote?: QuoteView;
  error?: string;
}

export interface HubArrivalParcel {
  parcelId: string;
  trackingKey?: string;
  sscc?: string;
  destination: string;
  scanned: boolean;
  withdrawn?: boolean;
}

export type HubArrivalState = 'expected' | 'receiving' | 'received' | 'withdrawn' | 'missed';

export interface HubArrivalView {
  arrivalId: string;
  mdpId: string;
  hubName: string;
  vendorId: string;
  storeName: string;
  parcels: HubArrivalParcel[];
  unitKind: HubUnitKind;
  units: number;
  expectedOn: string;
  reference?: string;
  bringer?: string;
  state: HubArrivalState;
  createdAt: string;
  received?: { at: string; by: string; units: number; note?: string };
  scannedCount: number;
  finished?: { at: string; by: string; missing: string[] };
  withdrawn?: { at: string; by: string };
  /** Its day went by and nothing came: the hub said so. Its parcels are free to book again. */
  missed?: { at: string; by: string };
  today?: boolean;
  late?: boolean;
}

export interface HubWaiting {
  mdpId: string;
  hubName: string;
  /** When the hub receives, on its clock. Absent: it no longer takes parcels in bulk. */
  bulk?: Omit<HubOptionView, 'quote' | 'error'>;
  parcels: HubArrivalParcel[];
}

export interface StoreHubArrivals {
  waiting: HubWaiting[];
  arrivals: HubArrivalView[];
}

export interface BookArrival {
  mdpId: string;
  parcelIds: string[];
  unitKind: HubUnitKind;
  units: number;
  expectedOn: string;
  reference?: string;
  bringer?: string;
}

export interface HubsApi {
  options(vendorId: string, destDid: string, size: string, measure?: Measure, fragile?: boolean): Promise<Result<{ hubs: HubOptionView[] }>>;
  arrivals(vendorId: string): Promise<Result<StoreHubArrivals>>;
  book(vendorId: string, body: BookArrival): Promise<Result<HubArrivalView>>;
  withdraw(vendorId: string, arrivalId: string): Promise<Result<HubArrivalView>>;
}

export function createHubsApi(sbg: SbgClient): HubsApi {
  const call = <T>(fn: Parameters<SbgClient['request']>[0]) => sbg.request(fn) as unknown as Promise<Result<T>>;
  const v = (id: string) => encodeURIComponent(id);
  return {
    options: (vendorId, destDid, size, measure, fragile) => {
      const q = new URLSearchParams({ dest: destDid, size });
      if (measure && [measure.l, measure.w, measure.h, measure.kg].every((n) => Number.isFinite(n) && n > 0)) {
        q.set('l', String(measure.l));
        q.set('w', String(measure.w));
        q.set('h', String(measure.h));
        q.set('kg', String(measure.kg));
      }
      if (fragile) q.set('fragile', 'true');
      return call((c) => c.GET(`/v1/sbg/vendors/${v(vendorId)}/hubs?${q.toString()}` as never, {} as never) as never);
    },
    arrivals: (vendorId) => call((c) => c.GET(`/v1/sbg/vendors/${v(vendorId)}/hub-arrivals` as never, {} as never) as never),
    book: (vendorId, body) => call((c) => c.POST(`/v1/sbg/vendors/${v(vendorId)}/hub-arrivals` as never, { body } as never) as never),
    withdraw: (vendorId, arrivalId) => call((c) => c.POST(`/v1/sbg/vendors/${v(vendorId)}/hub-arrivals/${v(arrivalId)}/withdraw` as never, {} as never) as never),
  };
}

/** A hub chosen as where a parcel starts, as the mint form keeps it beside a shop's id: "hub:<mdpId>". */
export const HUB_ORIGIN = 'hub:';
export function hubOriginOf(originDid: string): string | null {
  return originDid.startsWith(HUB_ORIGIN) ? originDid.slice(HUB_ORIGIN.length) || null : null;
}

/** Today on a hub's clock (YYYY-MM-DD) — its own zone where it has one, else the reader's. */
export function todayAt(zone: string | undefined, now: number = Date.now()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  } catch {
    return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  }
}

/** The days a store may book a hand-in: from today on the hub's clock, the next `n`, only those the hub receives. */
export function bookableDays(hours: SiteWeek | undefined, today: string, n = 14): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const day = new Date(Date.parse(`${today}T12:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10);
    const key = WEEK[(new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7];
    if (!hours || hours[key]) out.push(day);
  }
  return out;
}

/** Where an arrival stands for the store, in one word the list can colour. */
export type ArrivalWord = 'expected' | 'late' | 'receiving' | 'all_in' | 'some_missing' | 'withdrawn' | 'missed';

export function arrivalWord(a: Pick<HubArrivalView, 'state' | 'late' | 'finished'>): ArrivalWord {
  if (a.state === 'withdrawn') return 'withdrawn';
  if (a.state === 'missed') return 'missed';
  if (a.state === 'receiving') return 'receiving';
  if (a.state === 'received') return a.finished?.missing.length ? 'some_missing' : 'all_in';
  return a.late ? 'late' : 'expected';
}

/** What a booking needs before it can be sent: at least one parcel, a count of units, a day. */
export function bookingReady(form: { parcelIds: string[]; units: string; expectedOn: string }): boolean {
  const n = Number(form.units);
  return form.parcelIds.length > 0 && Number.isInteger(n) && n >= 1 && n <= 100 && /^\d{4}-\d{2}-\d{2}$/.test(form.expectedOn);
}
