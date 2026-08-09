/**
 * Pure agent domain logic — no DOM, no fetch, no Preact. Deterministic and unit-tested,
 * because these lines decide whether a shopkeeper may take a parcel (and someone's money).
 *
 * The gate messaging and the price-vs-market maths are harvested from the legacy agent.js
 * so the PWA and the old page can never disagree about what "locked" or "12% above" means.
 */

import { distanceLabel, haversineKm, type GeoPoint } from '../../shared/geo';
import type { AgentStatus, AgentView, Benchmark, CorridorRow, GateView, NetworkPoint, ParcelSize, ParcelStatus, ParcelView } from './types';

/* ------------------------------------------------------------------- gate -- */

export interface GateNotice {
  tone: 'warn' | 'danger';
  title: string;
  detail: string;
}

/**
 * What the shopkeeper is told when the wallet gate says no. The legacy page had one
 * sentence for both cases; the S4 error contract gives us the machine code, so a locked
 * account and a thin wallet get their own words (and their own icons upstream).
 */
export function gateNotice(agent: Pick<AgentView, 'status'> | null, gate: GateView | null): GateNotice | null {
  if (!agent || !gate || gate.ok) return null;
  if (agent.status === 'LOCKED' || gate.code === 'AGENT_LOCKED') {
    return {
      tone: 'danger',
      title: 'Account locked',
      detail: 'Top up your wallet to start accepting parcels again.',
    };
  }
  return {
    tone: 'warn',
    title: 'Wallet is low',
    detail:
      gate.shortfall && gate.shortfall > 0
        ? `Top up at least ${money(gate.shortfall)} to keep accepting parcels.`
        : 'Top up to keep accepting parcels.',
  };
}

/** Accepting is possible only when the gate says so — every accept costs wallet money. */
export function canAccept(gate: GateView | null): boolean {
  return Boolean(gate?.ok);
}

/** The shop must be through onboarding before the counter flows make sense. */
export function statusNotice(status: AgentStatus | undefined): string | null {
  if (!status || status === 'ACTIVE' || status === 'LOCKED') return null;
  return `Your shop is ${status.replace(/_/g, ' ').toLowerCase()}. SeeBuyGet must activate it before you can take parcels.`;
}

/* ------------------------------------------------------------------ money -- */

/** Money is always shown with two decimals — a shopkeeper reconciles against this figure. */
export function money(v: number | null | undefined): string {
  return (Number(v) || 0).toFixed(2);
}

/* ------------------------------------------------------------------ zones -- */

/** Destinations this shop can send toward: active corridors leaving the shop's zone. */
export function destinationZones(corridors: CorridorRow[] | null, myZone: string | undefined): string[] {
  if (!corridors || !myZone) return [];
  return [...new Set(corridors.filter((c) => c.originZone === myZone && c.status === 'active').map((c) => c.destZone))];
}

/* ----------------------------------------------------------------- accept -- */

export const SIZES: Array<{ key: ParcelSize; label: string; hint: string }> = [
  { key: 'S', label: 'Small', hint: 'Fits in one hand' },
  { key: 'M', label: 'Medium', hint: 'Shoebox' },
  { key: 'L', label: 'Large', hint: 'Needs both arms' },
  { key: 'HEAVY', label: 'Heavy', hint: 'Over 20 kg' },
];

/** The commodity's primary cargo nature (S30). Plain-language labels for a low-literacy counter; the code
 *  drives the backend compatibility matrix (e.g. cement powder never rides with fresh food). GEN is default. */
export type CargoNature = 'GEN' | 'FOD' | 'FOP' | 'HAZ-CHEM' | 'HAZ-DUST' | 'HAZ-BIO' | 'HAZ-FLAM' | 'FRG' | 'ODR' | 'HUM';
export const NATURES: Array<{ key: CargoNature; label: string }> = [
  { key: 'GEN', label: 'General goods' },
  { key: 'FOD', label: 'Dry food — rice, tins' },
  { key: 'FOP', label: 'Fresh or frozen food' },
  { key: 'FRG', label: 'Fragile — glass, electronics' },
  { key: 'ODR', label: 'Strong smell — perfume, fish' },
  { key: 'HUM', label: 'Medicine or aid' },
  { key: 'HAZ-CHEM', label: 'Chemicals — paint, bleach' },
  { key: 'HAZ-DUST', label: 'Cement or powder' },
  { key: 'HAZ-BIO', label: 'Medical or biological' },
  { key: 'HAZ-FLAM', label: 'Gas, fuel or flammable' },
];

/** The measure-your-parcel fields (free-typed strings until they parse). */
export interface DimsForm {
  l: string;
  w: string;
  h: string;
  kg: string;
}

/** The redesigned walk-up intake: MEASURE the parcel (tier derived), pick a destination PUDO by Map or
 *  Address, plus nature, phones and a photo. No manual S/M/L/HEAVY, no typed zone. */
export interface AcceptForm {
  parcelId: string;
  dims: DimsForm;
  fragile: boolean;
  natureCode: CargoNature;
  /** How the counter is picking the destination: on a map, or by typing an area. */
  destMode: 'map' | 'address';
  destPudoDid: string;
  destZone: string; // the picked shop's zone (carried to accept())
  destShopName: string; // for display
  addressText: string; // the Address-mode query
  senderMobile: string;
  receiverMobile: string;
  photoRef: string;
}

export const EMPTY_ACCEPT: AcceptForm = {
  parcelId: '',
  dims: { l: '', w: '', h: '', kg: '' },
  fragile: false,
  natureCode: 'GEN',
  destMode: 'map',
  destPudoDid: '',
  destZone: '',
  destShopName: '',
  addressText: '',
  senderMobile: '',
  receiverMobile: '',
  photoRef: '',
};

/** The smallest measurement we accept, in cm — 1 mm, so a thin item (a letter ~0.5 cm) is shippable.
 *  Mirrors the backend @Min. */
export const MIN_DIM_CM = 0.1;

/** Accept a European decimal comma ("0,5") as well as a dot before parsing. */
function num(s: string): number {
  return Number(String(s).trim().replace(',', '.'));
}

/** Parse the measured dims, or null while anything is missing/invalid (explicit range checks — never a
 *  `Number(x) || fallback` that lets a truthy negative slip through). */
export function parseDims(d: DimsForm): { l: number; w: number; h: number; kg: number } | null {
  const l = num(d.l);
  const w = num(d.w);
  const h = num(d.h);
  const kg = num(d.kg);
  const cm = (v: number) => Number.isFinite(v) && v >= MIN_DIM_CM;
  if (!cm(l) || !cm(w) || !cm(h)) return null;
  if (!Number.isFinite(kg) || kg < 0.01) return null;
  return { l, w, h, kg };
}

/** The plain-words presentation of a DERIVED tier. */
export function sizeMeta(size: ParcelSize): { label: string; hint: string } {
  return SIZES.find((s) => s.key === size) ?? { key: size, label: size, hint: '' };
}

/**
 * Destination PUDOs the counter can pick: open ones first; with a reference point (a geocoded address),
 * NEAREST first; otherwise A→Z. Mirrors the Send app's picker so a shop and a sender rank shops the same.
 */
export function selectablePoints(points: NetworkPoint[] | null, excludeDid?: string, near?: GeoPoint | null): NetworkPoint[] {
  return (points ?? [])
    .filter((p) => p.did !== excludeDid) // never offer the accepting shop as its own destination (origin ≠ dest)
    .sort((a, b) => {
      if (a.openState !== b.openState) return a.openState === 'open' ? -1 : 1;
      if (near) {
        const da = a.location ? haversineKm(near, a.location) : Number.POSITIVE_INFINITY;
        const db = b.location ? haversineKm(near, b.location) : Number.POSITIVE_INFINITY;
        if (da !== db) return da - db;
      }
      return a.shopName.localeCompare(b.shopName);
    });
}

/** The "400 m away" suffix for a destination row, when both ends are known. */
export function pointDistance(p: NetworkPoint, near: GeoPoint | null | undefined): string | null {
  if (!near || !p.location) return null;
  return distanceLabel(haversineKm(near, p.location));
}

/**
 * What still blocks the accept. Ordered by the physical flow at the counter, so the first
 * missing thing is the next thing to do — the CTA subtitle reads it out.
 */
export function acceptMissing(f: AcceptForm): string | null {
  if (!f.parcelId.trim()) return 'Scan the parcel sticker first.';
  if (!parseDims(f.dims)) return 'Measure the parcel: length, width, height and weight.';
  if (!f.destPudoDid) return 'Pick where it is going.';
  if (!f.photoRef) return 'Take the proof photo.';
  return null;
}

/* ---------------------------------------------------------------- release -- */

export type ReleaseStage = 'arrive' | 'otp' | 'rate' | 'blocked';

/**
 * Which release step a found parcel is on. The legacy page buried this in render branches;
 * making it a value keeps the screen a dumb switch and makes the state machine testable.
 */
export function releaseStage(status: ParcelStatus): ReleaseStage {
  if (status === 'On_Bus') return 'arrive';
  if (status === 'Ready_For_Pickup') return 'otp';
  if (status === 'Delivered') return 'rate';
  return 'blocked';
}

export function releaseBlockedDetail(status: ParcelStatus): string {
  return `This parcel is ${status.replace(/_/g, ' ').toLowerCase()} — nothing to hand over here.`;
}

/** The pickup code: exactly four digits, as the backend issues them. */
export function otpValid(otp: string): boolean {
  return /^\d{4}$/.test(otp.trim());
}

/* ------------------------------------------------------------------ rates -- */

export interface PriceBand {
  pct: number;
  headline: string;
  detail: string;
  showMatch: boolean;
  matchPrice: number;
  matchLabel: string;
}

/** Prices per parcel carry two decimals end-to-end (display AND the PATCH body). */
export function roundMoney(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * The shop's handling fee against nearby shops. Same shape and dead zone as the driver's
 * per-km band, but 2-decimal money and "shops" wording. Null without a usable benchmark —
 * a median of one shop would talk an agent into repricing against themselves.
 */
export function priceBand(pricePerParcel: number | null | undefined, benchmark: Benchmark | null | undefined): PriceBand | null {
  if (!benchmark || !benchmark.count) return null;

  const mine = Number(pricePerParcel ?? 0);
  const pct = benchmark.median > 0 ? Math.round(((mine - benchmark.median) / benchmark.median) * 100) : 0;

  const headline =
    pct > 1
      ? `You charge ${pct}% more than nearby shops.`
      : pct < -1
        ? `You charge ${-pct}% less than nearby shops.`
        : 'You charge about the same as nearby shops.';

  const detail =
    `Your price ${money(mine)} per parcel. Nearby shops charge ${money(benchmark.median)} ` +
    `(${money(benchmark.min)}–${money(benchmark.max)} across ${benchmark.count} shops).`;

  return {
    pct,
    headline,
    detail,
    showMatch: Math.abs(pct) > 1,
    matchPrice: roundMoney(benchmark.median),
    matchLabel: `Match ${money(benchmark.median)}`,
  };
}

/* --------------------------------------------------------------- speaking -- */

export function homeSummary(agent: AgentView | null, gate: GateView | null): string {
  if (!agent) return 'Connecting to your shop.';
  const canScan = Boolean(gate?.ok);
  return (
    `Wallet balance ${money(agent.balance)}. ` +
    (canScan ? 'You can accept parcels.' : 'Top up to accept parcels.') +
    (agent.openState === 'closed' ? ' Your shop is marked closed.' : '')
  );
}

export function handoverSummary(count: number, selected: number, missed = 0): string {
  if (count === 0) return 'No parcels are waiting for the bus.';
  const base = `${count} parcels waiting. ${selected} selected.`;
  // S25: after the gate refuses a short load, speak the number still owed to this bus.
  if (missed > 0) return `${base} ${missed} for this bus are still waiting. Load them, or leave them behind.`;
  return `${base} Scan the driver badge, then finish the handover.`;
}

/* -------------------------------------------------------------------- void -- */

/**
 * Reverse-logistics window — must match backend VOID_WINDOW_MS (pudo.config.ts). The client
 * computes the countdown so the list drops a parcel the moment its window closes; the server
 * is still the authority and rejects a late void with WINDOW_EXPIRED.
 */
export const VOID_WINDOW_MS = 5 * 60 * 1000;

/** Milliseconds left to undo this drop-off, clamped to zero (never negative). */
export function voidRemainingMs(acceptedAt: string | undefined, now: number): number {
  if (!acceptedAt) return 0;
  const t = Date.parse(acceptedAt);
  if (Number.isNaN(t)) return 0;
  return Math.max(0, VOID_WINDOW_MS - (now - t));
}

/** Only an At_PUDO parcel still inside its window can be voided — mirrors the server's guard. */
export function isVoidable(p: Pick<ParcelView, 'status' | 'acceptedAt'>, now: number): boolean {
  return p.status === 'At_PUDO' && voidRemainingMs(p.acceptedAt, now) > 0;
}

/** The recent drop-offs a shop may still undo, soonest-to-expire first. */
export function voidableParcels(parcels: ParcelView[] | null, now: number): ParcelView[] {
  return (parcels ?? [])
    .filter((p) => isVoidable(p, now))
    .sort((a, b) => voidRemainingMs(a.acceptedAt, now) - voidRemainingMs(b.acceptedAt, now));
}

/** "3 min left to undo" / "45 sec left to undo" — never a bare number. */
export function voidCountdownLabel(ms: number): string {
  if (ms <= 0) return 'Window closed';
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) return `${seconds} sec left to undo`;
  return `${Math.ceil(seconds / 60)} min left to undo`;
}

/* --------------------------------------------------------------- registers (R4) -- */

/** The word the SHOP reads for a parcel's status in its history register. */
export function parcelStatusWord(status: ParcelStatus): string {
  switch (status) {
    case 'Created':
      return 'Label made';
    case 'At_PUDO':
      return 'At a shop';
    case 'On_Bus':
      return 'On the bus';
    case 'At_MDP':
      return 'At the sort hub';
    case 'Ready_For_Pickup':
      return 'Ready for pickup';
    case 'Delivered':
      return 'Collected';
    case 'Disputed':
      return 'Problem reported';
    case 'Voided':
      return 'Cancelled';
  }
}

/** The shop's role in a parcel's journey — it took the parcel IN, or handed it OUT. */
export function parcelRoleWord(role: 'origin' | 'dest'): string {
  return role === 'origin' ? 'Took in' : 'Handed out';
}

/** The shop's word for an earnings-ledger entry type. */
export function agentLedgerTypeWord(type: string): string {
  switch (type) {
    case 'TOP_UP':
      return 'Top-up';
    case 'FEE':
      return 'Shipping fee';
    case 'LABOR_PAYOUT':
      return 'Handling pay';
    case 'REFUND':
      return 'Refund';
    case 'OVERDRAFT':
      return 'Credit';
    default:
      return type;
  }
}
