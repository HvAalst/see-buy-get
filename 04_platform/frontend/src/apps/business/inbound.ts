import type { Result, SbgClient } from '../../lib/sbg';
import type { FoundLine } from '../../shared/found';
import { formatDate, type MessageKey } from '../../shared/i18n';

/**
 * INBOUND SUPPLY, READING A (backend inbound.service.ts; the user, 2026-10-25: "Yes, A then B") — a business receiving
 * goods at its own places. A place of its own receives with a code; the business gives the code to its suppliers, who
 * write it as "Deliver to" when they post a load; what is addressed there, it sees coming in: its own number for the
 * order, who from, how much, where it is and who brings it — never the price.
 *
 * THE RECEIVING MOMENT (D9): what was found at the handover — short, over, damaged, wrong — is on the note beside the
 * receiver's name and on its row here; what did not come, or came and is not the goods, stays expected until one of its
 * people closes it. ITS CLOCK (D10): when a load is expected, and whether it is late, is read on the receiving place's own.
 */

/** One of the business's receiving points, and the code its suppliers write. */
export interface ReceivingPoint {
  siteId: string;
  name: string;
  location: { lat: number; lng: number };
  code: string;
  since: string;
  by: string;
}

/** What a "Deliver to" code names, for a business about to send there. */
export interface ReceivingPointNamed {
  name: string;
  siteName: string;
  location: { lat: number; lng: number };
}

/** D10 — when a load is expected and whether it is late, on the receiving place's own clock. */
export interface InboundDue {
  zone: string;
  zoneName: string;
  day: string;
  about?: string;
  today: boolean;
  late?: 'day' | 'hour';
}

export type InboundClosingHow = 'came' | 'not_coming';

/** D9 — what was still expected of a load, closed by one of the receiver's people. */
export interface InboundClosed {
  how: InboundClosingHow;
  note?: string;
  at: string;
  by: string;
}

/** A load coming in — the tracking link's view of it, and the receiver's own facts. */
export interface InboundRow {
  freightId: string;
  ref: string;
  trackingKey?: string;
  reference?: string;
  site: { siteId: string; name: string };
  from: string;
  description: string;
  weightKg: number;
  packages?: number;
  packaging?: string;
  status: string;
  scheduledPickupAt?: string;
  expectedOn?: string;
  expectedAbout?: string;
  late?: string;
  carrier?: { name: string; driverName?: string; plate?: string; vehicleClass?: string };
  receiverName?: string;
  steps: Array<{ status: string; at: string }>;
  /** D9 — what was found at the handover, as it stands on the note. */
  exceptions?: FoundLine[];
  /** D9 — packages still expected: short, and not the goods — 0 once closed. */
  stillExpected?: number;
  closed?: InboundClosed;
  /** D10 — on the place's own clock; where it is given, it is the row's one answer to when. */
  due?: InboundDue;
}

export interface InboundView {
  points: ReceivingPoint[];
  items: InboundRow[];
}

export interface InboundApi {
  comingIn(): Promise<Result<InboundView>>;
  open(siteId: string): Promise<Result<ReceivingPoint>>;
  newCode(siteId: string): Promise<Result<ReceivingPoint>>;
  close(siteId: string): Promise<Result<ReceivingPoint[]>>;
  named(code: string): Promise<Result<ReceivingPointNamed>>;
  /** D9 — close what is still expected of a delivered load: it came after all, or it is not coming. */
  closeExpected(freightId: string, how: InboundClosingHow, note?: string): Promise<Result<InboundRow>>;
}

export function inboundApi(sbg: SbgClient): InboundApi {
  const call = <T>(fn: Parameters<SbgClient['request']>[0]) => sbg.request(fn) as unknown as Promise<Result<T>>;
  const site = (siteId: string) => encodeURIComponent(siteId);
  return {
    comingIn: () => call((c) => c.GET('/v1/sbg/business/me/inbound' as never, {} as never) as never),
    open: (siteId) => call((c) => c.POST(`/v1/sbg/business/me/receiving/${site(siteId)}` as never, {} as never) as never),
    newCode: (siteId) => call((c) => c.POST(`/v1/sbg/business/me/receiving/${site(siteId)}/code` as never, {} as never) as never),
    close: (siteId) => call((c) => c.DELETE(`/v1/sbg/business/me/receiving/${site(siteId)}` as never, {} as never) as never),
    named: (code) => call((c) => c.GET(`/v1/sbg/receiving/${encodeURIComponent(code.trim())}` as never, {} as never) as never),
    closeExpected: (freightId, how, note) =>
      call((c) => c.POST(`/v1/sbg/business/me/inbound/${encodeURIComponent(freightId)}/close` as never, { body: { how, ...(note ? { note } : {}) } } as never) as never),
  };
}

/** Where a load coming in stands, in one word the list can colour: waiting for a carrier, coming, here, or not coming. */
export type InboundState = 'booked' | 'carrier' | 'on_its_way' | 'delivered' | 'withdrawn';

export function inboundState(row: Pick<InboundRow, 'status'>): InboundState {
  switch (row.status) {
    case 'claimed':
      return 'carrier';
    case 'in_transit':
      return 'on_its_way';
    case 'delivered':
      return 'delivered';
    case 'cancelled':
      return 'withdrawn';
    default:
      return 'booked';
  }
}

/** D9 — delivered, and something of it still expected (short, or not the goods) until one of the receiver's people closes it. */
export function isStillExpected(row: Pick<InboundRow, 'status' | 'stillExpected'>): boolean {
  return row.status === 'delivered' && (row.stillExpected ?? 0) > 0;
}

/** What the row is called: the receiver's own number for the order, where the supplier gave it; else what it is. */
export function inboundTitle(row: Pick<InboundRow, 'reference' | 'description'>): { kind: 'order' | 'goods'; text: string } {
  return row.reference ? { kind: 'order', text: row.reference } : { kind: 'goods', text: row.description };
}

/** A "Deliver to" code as it is written down: capitals, in two fours — or null for something that cannot be one. */
export function codeOf(raw: string): string | null {
  const plain = raw.toUpperCase().replace(/[\s-]/g, '');
  return /^[A-Z0-9]{8}$/.test(plain) ? `${plain.slice(0, 4)}-${plain.slice(4)}` : null;
}

/** The load's own tracking page — the whole of it, as anybody holding the link sees it. */
export function trackingPathOf(row: Pick<InboundRow, 'trackingKey'>): string | null {
  return row.trackingKey ? `/send/?track=${encodeURIComponent(row.trackingKey)}` : null;
}

/** Who is bringing it, as they would be met at the gate: the carrier, its driver, the vehicle — a name said once (an owner-driver is both). */
export function carrierLine(carrier: NonNullable<InboundRow['carrier']>): string {
  return [...new Set([carrier.name, carrier.driverName, carrier.plate].map((x) => x?.trim()).filter((x): x is string => Boolean(x)))].join(' · ');
}

/** "Tue 27 Oct" — a day as the place keeps it (YYYY-MM-DD): the same date wherever it is read. */
export function dayLabel(day: string): string {
  return formatDate(`${day}T12:00:00Z`, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/**
 * D10 — WHEN, ON THE PLACE'S OWN CLOCK, in words: late first, then today, then its day — and about when, where something
 * says the hour. The message and what goes in it; the screen says it.
 */
export function dueLine(due: InboundDue): { key: MessageKey; params: Record<string, string> } {
  const day = dayLabel(due.day);
  if (due.late === 'hour' && due.about) return { key: 'business.inbound.due.lateHour', params: { about: due.about } };
  if (due.late) return { key: 'business.inbound.due.lateDay', params: { day } };
  if (due.today) return due.about ? { key: 'business.inbound.due.todayAbout', params: { about: due.about } } : { key: 'business.inbound.due.today', params: {} };
  return due.about ? { key: 'business.inbound.due.dayAbout', params: { day, about: due.about } } : { key: 'business.inbound.due.day', params: { day } };
}

/** Whether the viewer's own clock shows the place's time just now: where it does not, the place's clock is named beside it. */
export function sameClockAs(zone: string, now: number = Date.now(), viewerZone?: string): boolean {
  try {
    const at = (timeZone?: string) => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', ...(timeZone ? { timeZone } : {}) }).format(now);
    return at(zone) === at(viewerZone);
  } catch {
    return true;
  }
}
