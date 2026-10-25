import type { Result, SbgClient } from '../../lib/sbg';

/**
 * INBOUND SUPPLY, READING A (backend inbound.service.ts; the user, 2026-10-25: "Yes, A then B") — a business receiving
 * goods at its own places. A place of its own receives with a code; the business gives the code to its suppliers, who
 * write it as "Deliver to" when they post a load; what is addressed there, it sees coming in: its own number for the
 * order, who from, how much, where it is and who brings it — never the price.
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
