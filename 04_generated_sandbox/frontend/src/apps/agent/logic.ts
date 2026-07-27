/**
 * Pure agent domain logic — no DOM, no fetch, no Preact. Deterministic and unit-tested,
 * because these lines decide whether a shopkeeper may take a parcel (and someone's money).
 *
 * The gate messaging and the price-vs-market maths are harvested from the legacy agent.js
 * so the PWA and the old page can never disagree about what "locked" or "12% above" means.
 */

import type { AgentStatus, AgentView, Benchmark, CorridorRow, GateView, ParcelSize, ParcelStatus, ParcelView } from './types';

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

export interface AcceptForm {
  parcelId: string;
  size: ParcelSize | '';
  destZone: string;
  senderMobile: string;
  receiverMobile: string;
  photoRef: string;
  natureCode: CargoNature;
}

export const EMPTY_ACCEPT: AcceptForm = {
  parcelId: '',
  size: '',
  destZone: '',
  senderMobile: '',
  receiverMobile: '',
  photoRef: '',
  natureCode: 'GEN',
};

/**
 * What still blocks the accept. Ordered by the physical flow at the counter, so the first
 * missing thing is the next thing to do — the CTA subtitle reads it out.
 */
export function acceptMissing(f: AcceptForm): string | null {
  if (!f.parcelId.trim()) return 'Scan the parcel sticker first.';
  if (!f.size) return 'Tap the size of the parcel.';
  if (!f.destZone.trim()) return 'Pick where it is going.';
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
