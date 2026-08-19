/**
 * Pure agent domain logic — no DOM, no fetch, no Preact. Deterministic and unit-tested,
 * because these lines decide whether a shopkeeper may take a parcel (and someone's money).
 *
 * The gate messaging and the price-vs-market maths are harvested from the legacy agent.js
 * so the PWA and the old page can never disagree about what "locked" or "12% above" means.
 *
 * Prose is threaded through `t` (the translate function from useT()/the plain t) so this module
 * stays pure and testable — English is the base catalog, so a test passing the real `t` sees the
 * English literals. Enumerated presentation (status/size/nature/…) resolves catalog keys via `t`.
 */

import { distanceLabel, haversineKm, type GeoPoint } from '../../shared/geo';
import type { MessageKey, Translate } from '../../shared/i18n';
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
export function gateNotice(agent: Pick<AgentView, 'status'> | null, gate: GateView | null, t: Translate): GateNotice | null {
  if (!agent || !gate || gate.ok) return null;
  if (agent.status === 'LOCKED' || gate.code === 'AGENT_LOCKED') {
    return {
      tone: 'danger',
      title: t('agent.logic.gateLockedTitle'),
      detail: t('agent.logic.gateLockedDetail'),
    };
  }
  return {
    tone: 'warn',
    title: t('agent.logic.gateLowTitle'),
    detail:
      gate.shortfall && gate.shortfall > 0
        ? t('agent.logic.gateLowShortfall', { amount: money(gate.shortfall) })
        : t('agent.logic.gateLowDetail'),
  };
}

/** Accepting is possible only when the gate says so — every accept costs wallet money. */
export function canAccept(gate: GateView | null): boolean {
  return Boolean(gate?.ok);
}

/** The shop must be through onboarding before the counter flows make sense. */
export function statusNotice(status: AgentStatus | undefined, t: Translate): string | null {
  if (!status || status === 'ACTIVE' || status === 'LOCKED') return null;
  return t('agent.logic.statusNotice', { status: status.replace(/_/g, ' ').toLowerCase() });
}

/* ------------------------------------------------------------------ money -- */

/** Money is always shown with two decimals — a shopkeeper reconciles against this figure. */
export function money(v: number | null | undefined): string {
  return (Number(v) || 0).toFixed(2);
}

/* ------------------------------------------------------------------ shelf -- */

/** Mirror of the backend SHELF_COLORS (pudo.config.ts) — the colour a column gets, so the client draws the
 *  same "Green-3" grid the server labels. Presentation only; the server stays authoritative on real slots. */
export const SHELF_COLORS = ['Red', 'Orange', 'Amber', 'Green', 'Teal', 'Blue', 'Indigo', 'Violet', 'Pink', 'Brown'];

/** A shelf must hold at least this many slots (mirrors the backend MIN_SLOTS). */
export const MIN_SHELF_SLOTS = 6;

/** The current grid's dimensions, read back from its slots (max row/col), or null for an empty grid. */
export function gridDims(slots: ReadonlyArray<{ row: number; col: number }> | undefined): { rows: number; cols: number } | null {
  if (!slots || !slots.length) return null;
  return { rows: Math.max(...slots.map((s) => s.row)), cols: Math.max(...slots.map((s) => s.col)) };
}

/* ------------------------------------------------------------------ zones -- */

/** Destinations this shop can send toward: active corridors leaving the shop's zone. */
export function destinationZones(corridors: CorridorRow[] | null, myZone: string | undefined): string[] {
  if (!corridors || !myZone) return [];
  return [...new Set(corridors.filter((c) => c.originZone === myZone && c.status === 'active').map((c) => c.destZone))];
}

/* ----------------------------------------------------------------- accept -- */

/** Plain-language size tiers for a low-literacy counter, resolved through `t`. */
const SIZE_KEYS: Record<ParcelSize, { labelKey: MessageKey; hintKey: MessageKey }> = {
  S: { labelKey: 'agent.size.s.label', hintKey: 'agent.size.s.hint' },
  M: { labelKey: 'agent.size.m.label', hintKey: 'agent.size.m.hint' },
  L: { labelKey: 'agent.size.l.label', hintKey: 'agent.size.l.hint' },
  HEAVY: { labelKey: 'agent.size.heavy.label', hintKey: 'agent.size.heavy.hint' },
};

/** The commodity's primary cargo nature (S30). Plain-language labels for a low-literacy counter; the code
 *  drives the backend compatibility matrix (e.g. cement powder never rides with fresh food). GEN is default. */
export type CargoNature = 'GEN' | 'FOD' | 'FOP' | 'HAZ-CHEM' | 'HAZ-DUST' | 'HAZ-BIO' | 'HAZ-FLAM' | 'FRG' | 'ODR' | 'HUM';
export const NATURES: Array<{ key: CargoNature; labelKey: MessageKey }> = [
  { key: 'GEN', labelKey: 'agent.nature.gen' },
  { key: 'FOD', labelKey: 'agent.nature.fod' },
  { key: 'FOP', labelKey: 'agent.nature.fop' },
  { key: 'FRG', labelKey: 'agent.nature.frg' },
  { key: 'ODR', labelKey: 'agent.nature.odr' },
  { key: 'HUM', labelKey: 'agent.nature.hum' },
  { key: 'HAZ-CHEM', labelKey: 'agent.nature.hazChem' },
  { key: 'HAZ-DUST', labelKey: 'agent.nature.hazDust' },
  { key: 'HAZ-BIO', labelKey: 'agent.nature.hazBio' },
  { key: 'HAZ-FLAM', labelKey: 'agent.nature.hazFlam' },
];

/** Plain words for a cargo nature code (falls back to the raw code for an unknown one). */
export function natureLabel(code: string, t: Translate): string {
  const n = NATURES.find((x) => x.key === code);
  return n ? t(n.labelKey) : code;
}

/** F3 — the durable dry commodities a consolidation lot may hold (grain/dry food, general goods, cement/
 *  powder). Perishables are excluded — they book freight directly; the backend enforces the same via tempBand,
 *  this is the curated on-screen subset. */
export const DURABLE_NATURES: CargoNature[] = ['GEN', 'FOD', 'HAZ-DUST'];

/** F3 — a lot's fill progress for the UI: the accumulated vs target weight with a clamped percentage. */
export function consignmentProgress(lot: { weightKg: number; targetKg: number }): { pct: number; label: string } {
  const pct = lot.targetKg > 0 ? Math.min(100, Math.max(0, Math.round((lot.weightKg / lot.targetKg) * 100))) : 0;
  return { pct, label: `${lot.weightKg} / ${lot.targetKg} kg` };
}

/** REP2 — the driver failings an agent can flag alongside the star rating, in plain words (the movement
 *  leg the shop actually witnesses). Keys mirror the backend DRIVER_ISSUES. */
export const DRIVER_ISSUE_LABELS: Array<{ key: string; labelKey: MessageKey }> = [
  { key: 'LATE_PICKUP', labelKey: 'agent.driverIssue.latePickup' },
  { key: 'LATE_ARRIVAL', labelKey: 'agent.driverIssue.lateArrival' },
  { key: 'KEPT_OVERNIGHT', labelKey: 'agent.driverIssue.keptOvernight' },
  { key: 'AFTER_HOURS', labelKey: 'agent.driverIssue.afterHours' },
  { key: 'EQUIPMENT_FAILURE', labelKey: 'agent.driverIssue.equipment' },
  { key: 'ROUGH_HANDLING', labelKey: 'agent.driverIssue.roughHandling' },
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
  // F2 — the counter-freight fields (only used when the DERIVED class is dedicated/P4+; a bus-sized load
  // ignores them). A too-big walk-up is booked as freight instead of refused: a cash budget cap, immediate or
  // planned pickup, and an optional customer phone.
  budgetCap: string; // the cash cap the customer prepays → the freight's maxSpend ceiling
  freightWhen: 'now' | 'planned';
  freightDate: string; // a datetime-local value (local time), when planned
  allowEarlyClaim: boolean; // planned: may a driver reserve it before its date (default true)
  customerMobile: string; // optional — the walk-in customer's phone (joins it to their "my shipments")
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
  budgetCap: '',
  freightWhen: 'now',
  freightDate: '',
  allowEarlyClaim: true,
  customerMobile: '',
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
export function sizeMeta(size: ParcelSize, t: Translate): { label: string; hint: string } {
  const k = SIZE_KEYS[size];
  return k ? { label: t(k.labelKey), hint: t(k.hintKey) } : { label: size, hint: '' };
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
export function acceptMissing(f: AcceptForm, t: Translate): string | null {
  if (!f.parcelId.trim()) return t('agent.logic.acceptScanFirst');
  if (!parseDims(f.dims)) return t('agent.logic.acceptMeasure');
  if (!f.destPudoDid) return t('agent.logic.acceptPickDest');
  if (!f.photoRef) return t('agent.logic.acceptPhoto');
  return null;
}

/* ----------------------------------------------------------- book freight (F2) -- */

/** Parse the cash budget cap (accepts a decimal comma), or null while it's missing / not a positive amount. */
export function parseBudget(s: string): number | null {
  const v = num(s);
  return Number.isFinite(v) && v > 0 ? roundMoney(v) : null;
}

/**
 * Convert the planned-pickup datetime-local value → a canonical ISO instant WITH a timezone offset (what the
 * API's @Matches guard requires), or undefined for an immediate booking / an empty or unparseable date. A
 * datetime-local string carries no offset, so it is read as LOCAL time and normalised to a UTC instant here.
 */
export function plannedPickupIso(f: Pick<AcceptForm, 'freightWhen' | 'freightDate'>): string | undefined {
  if (f.freightWhen !== 'planned' || !f.freightDate) return undefined;
  const t = Date.parse(f.freightDate);
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
}

/**
 * What still blocks a counter FREIGHT booking (the dedicated/P4+ branch), ordered by the counter flow so the
 * first missing thing is the next thing to do. No sticker and no proof photo — freight isn't scanned onto a
 * shelf; the tracking code IS the artefact. `now` is injected so this stays pure and testable.
 */
export function bookFreightMissing(f: AcceptForm, now: number, t: Translate): string | null {
  if (!parseDims(f.dims)) return t('agent.logic.freightMeasure');
  if (!f.destPudoDid) return t('agent.logic.acceptPickDest');
  if (parseBudget(f.budgetCap) == null) return t('agent.logic.freightBudget');
  if (f.freightWhen === 'planned') {
    const at = Date.parse(f.freightDate);
    if (!f.freightDate || Number.isNaN(at)) return t('agent.logic.freightPlannedDate');
    if (at <= now) return t('agent.logic.freightFutureDate');
  }
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

export function releaseBlockedDetail(status: ParcelStatus, t: Translate): string {
  return t('agent.logic.releaseBlocked', { status: status.replace(/_/g, ' ').toLowerCase() });
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
export function priceBand(pricePerParcel: number | null | undefined, benchmark: Benchmark | null | undefined, t: Translate): PriceBand | null {
  if (!benchmark || !benchmark.count) return null;

  const mine = Number(pricePerParcel ?? 0);
  const pct = benchmark.median > 0 ? Math.round(((mine - benchmark.median) / benchmark.median) * 100) : 0;

  const headline =
    pct > 1
      ? t('agent.logic.priceMore', { pct })
      : pct < -1
        ? t('agent.logic.priceLess', { pct: -pct })
        : t('agent.logic.priceSame');

  const detail = t('agent.logic.priceDetail', {
    mine: money(mine),
    median: money(benchmark.median),
    min: money(benchmark.min),
    max: money(benchmark.max),
    count: benchmark.count,
  });

  return {
    pct,
    headline,
    detail,
    showMatch: Math.abs(pct) > 1,
    matchPrice: roundMoney(benchmark.median),
    matchLabel: t('agent.logic.priceMatch', { price: money(benchmark.median) }),
  };
}

/* --------------------------------------------------------------- speaking -- */

export function homeSummary(agent: AgentView | null, gate: GateView | null, t: Translate): string {
  if (!agent) return t('agent.logic.homeConnecting');
  const canScan = Boolean(gate?.ok);
  const bits = [t('agent.logic.homeWallet', { balance: money(agent.balance) })];
  bits.push(canScan ? t('agent.logic.homeCanAccept') : t('agent.logic.homeTopUp'));
  if (agent.openState === 'closed') bits.push(t('agent.logic.homeClosed'));
  return bits.join(' ');
}

export function handoverSummary(count: number, selected: number, missed: number, t: Translate): string {
  if (count === 0) return t('agent.logic.handoverNone');
  const base = t('agent.logic.handoverBase', { count, selected });
  // S25: after the gate refuses a short load, speak the number still owed to this bus.
  if (missed > 0) return `${base} ${t('agent.logic.handoverMissed', { missed })}`;
  return `${base} ${t('agent.logic.handoverScan')}`;
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
export function voidCountdownLabel(ms: number, t: Translate): string {
  if (ms <= 0) return t('agent.logic.voidWindowClosed');
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) return t('agent.logic.voidSecLeft', { seconds });
  return t('agent.logic.voidMinLeft', { minutes: Math.ceil(seconds / 60) });
}

/* --------------------------------------------------------------- registers (R4) -- */

/** The word the SHOP reads for a parcel's status in its history register. */
export function parcelStatusWord(status: ParcelStatus, t: Translate): string {
  switch (status) {
    case 'Created':
      return t('agent.status.created');
    case 'At_PUDO':
      return t('agent.status.atPudo');
    case 'On_Bus':
      return t('agent.status.onBus');
    case 'At_MDP':
      return t('agent.status.atMdp');
    case 'Ready_For_Pickup':
      return t('agent.status.ready');
    case 'Delivered':
      return t('agent.status.delivered');
    case 'Disputed':
      return t('agent.status.disputed');
    case 'Voided':
      return t('agent.status.voided');
  }
}

/** The shop's role in a parcel's journey — it took the parcel IN, or handed it OUT. */
export function parcelRoleWord(role: 'origin' | 'dest', t: Translate): string {
  return role === 'origin' ? t('agent.logic.roleOrigin') : t('agent.logic.roleDest');
}

/** The shop's word for an earnings-ledger entry type. */
export function agentLedgerTypeWord(type: string, t: Translate): string {
  switch (type) {
    case 'TOP_UP':
      return t('agent.logic.ledgerTopUp');
    case 'FEE':
      return t('agent.logic.ledgerFee');
    case 'LABOR_PAYOUT':
      return t('agent.logic.ledgerPayout');
    case 'REFUND':
      return t('agent.logic.ledgerRefund');
    default:
      // Historical 'OVERDRAFT' rows land here and render as their raw type — the concept was removed
      // with the trade-credit line, so nothing new can carry it.
      return type;
  }
}
