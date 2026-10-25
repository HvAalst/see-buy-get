/**
 * Pure hub domain logic — no DOM, no fetch, no Preact. Deterministic and unit-tested.
 * The queue rules, the swatch hash and the fill maths are harvested from the legacy
 * mdp.js so the PWA and the old page can never disagree about what the floor sees.
 */

import type { Translate } from '../../shared/i18n';
import { cash } from '../../shared/money';
import type { Benchmark, MdpView, ParcelRow, SortView, ToteView } from './types';

/* ------------------------------------------------------------------- hub -- */

/** The signed-in DID's own hub. Login binds the token to the hub's real DID (S2). */
/**
 * A HUB NOT YET APPROVED (the ISO 28000 check: "hubs are vetted"), and whose move it is: `send` — the hub's, with the
 * reason when its papers came back; `with_staff` — ours, and nothing for the hub to do. Null once approved, and while
 * the hub is not read yet: a screen says nothing about papers it has not seen.
 */
export type HubPapersStep = { kind: 'send'; refusedWhy?: string } | { kind: 'with_staff' };
export function hubPapersStep(hub: Pick<MdpView, 'vetting'> | null | undefined): HubPapersStep | null {
  if (!hub) return null;
  if (hub.vetting?.state === 'approved') return null;
  if (hub.vetting?.state === 'pending') return { kind: 'with_staff' };
  // Quoted inside a sentence on the screen, so without the full stop its writer may have ended it on.
  const why = hub.vetting?.refusal?.reason?.trim().replace(/[.\s]+$/, '');
  return why ? { kind: 'send', refusedWhy: why } : { kind: 'send' };
}

/** The floor is open: the hub is approved. The floor screens ask this, and send a hub that is not to its papers. */
export function floorOpen(hub: Pick<MdpView, 'vetting'> | null | undefined): boolean {
  return hub?.vetting?.state === 'approved';
}

export function findMyHub(mdps: MdpView[] | null, did: string): MdpView | null {
  return (mdps ?? []).find((m) => m.did === did) ?? null;
}

/* ----------------------------------------------------------------- queue -- */

/** Parcels physically here and still loose (no tote) — what the sort loop feeds on. */
export function unsortedAt(parcels: ParcelRow[] | null, mdpId: string): ParcelRow[] {
  return (parcels ?? []).filter((p) => p.atMdpId === mdpId && !p.toteId);
}

/** Sorted into a destination bag, waiting for the bus. */
export function sortedWaitingAt(parcels: ParcelRow[] | null, mdpId: string): ParcelRow[] {
  return (parcels ?? []).filter((p) => p.atMdpId === mdpId && Boolean(p.toteId));
}

/** Append without duplicates, preserving first-seen order (the physical pile's order). */
export function addToQueue(queue: string[], ids: string[]): string[] {
  return [...new Set([...queue, ...ids])];
}

export function dropFromQueue(queue: string[], id: string): string[] {
  return queue.filter((x) => x !== id);
}

/* --------------------------------------------------------------- swatches -- */

/**
 * A stable colour per destination so the worker matches bag ↔ destination at a glance —
 * the same 31-hash the legacy page used, so a destination keeps its colour across the
 * migration. Returns an INDEX into the 8 css swatch classes, not a hex value: the palette
 * lives in mdp.css where contrast against white text is guaranteed.
 */
export const SWATCH_COUNT = 8;

export function swatchIndex(id: string | undefined | null): number {
  let h = 0;
  for (const c of String(id ?? '')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % SWATCH_COUNT;
}

/* ------------------------------------------------------------------ bags -- */

/** Bag fill against BAG_CAPACITY_UNITS (10) — the legacy bar formula, clamped. */
export function fillPercent(unitsUsed: number): number {
  return Math.min(100, Math.round((unitsUsed / 10) * 100));
}

export function fillingBags(totes: ToteView[] | null): ToteView[] {
  return (totes ?? []).filter((t) => t.status === 'filling');
}

export function freeBags(totes: ToteView[] | null): ToteView[] {
  return (totes ?? []).filter((t) => t.status === 'free');
}

/**
 * Only a bag with something in it can go on a bus — still filling, or (round 36) closed for the road and so offered to
 * drivers: a bag the hub has just closed is the one it is about to load.
 */
export function loadableBags(totes: ToteView[] | null): ToteView[] {
  return (totes ?? []).filter((t) => (t.status === 'filling' || t.status === 'available' || t.status === 'claimed') && t.parcels.length > 0);
}

export function bagLine(tote: ToteView, t: Translate): string {
  const dest = tote.destinationLabel || tote.destinationNodeId || t('mdp.logic.unassigned');
  const n = tote.parcels.length;
  return n === 1 ? t('mdp.logic.bagLineOne', { dest, count: n }) : t('mdp.logic.bagLineMany', { dest, count: n });
}

/* ------------------------------------------------------------------ sort -- */

/** The placement instruction, in plain words: where this parcel's bag is heading. */
export function placeLine(sort: SortView, t: Translate): string {
  const kind = sort.nextDestination.type === 'pudo' ? t('mdp.logic.lastMile') : t('mdp.logic.onwardHub');
  return t('mdp.logic.placeLine', { label: sort.nextDestination.label, kind });
}

/* ------------------------------------------------------------------ money -- */

/** A fee with two decimals, in the money the server named for it (the hub’s company’s); bare where none is named —
 *  what the fee box holds. */
export function money(v: number | null | undefined, currency: string | undefined): string {
  return cash(v, currency);
}

export function roundMoney(v: number): number {
  return Math.round(v * 100) / 100;
}

export interface PriceBand {
  pct: number;
  headline: string;
  detail: string;
  showMatch: boolean;
  matchPrice: number;
  matchLabel: string;
}

/** The hub's sort fee against nearby hubs — same band rules as the agent app, hub wording. Null without the money
 *  the hubs were compared in: a comparison that cannot say its money is not shown at all. */
export function priceBand(pricePerParcel: number | null | undefined, benchmark: Benchmark | null | undefined, t: Translate, currency?: string): PriceBand | null {
  if (!benchmark || !benchmark.count || !currency) return null;

  const mine = Number(pricePerParcel ?? 0);
  const pct = benchmark.median > 0 ? Math.round(((mine - benchmark.median) / benchmark.median) * 100) : 0;

  const headline =
    pct > 1
      ? t('mdp.logic.chargeMore', { pct })
      : pct < -1
        ? t('mdp.logic.chargeLess', { pct: -pct })
        : t('mdp.logic.chargeSame');

  const detail = t('mdp.logic.bandDetail', {
    mine: money(mine, currency),
    median: money(benchmark.median, currency),
    min: money(benchmark.min, currency),
    max: money(benchmark.max, currency),
    count: benchmark.count,
  });

  return {
    pct,
    headline,
    detail,
    showMatch: Math.abs(pct) > 1,
    matchPrice: roundMoney(benchmark.median),
    matchLabel: t('mdp.logic.matchLabel', { price: money(benchmark.median, currency) }),
  };
}

/* --------------------------------------------------------------- speaking -- */

export function homeSummary(unsorted: number, filling: number, t: Translate): string {
  const a = unsorted === 1 ? t('mdp.logic.toSortOne', { count: unsorted }) : t('mdp.logic.toSortMany', { count: unsorted });
  const b = filling === 1 ? t('mdp.logic.bagsBuildingOne', { count: filling }) : t('mdp.logic.bagsBuildingMany', { count: filling });
  return `${a} ${b}`;
}

export function sortSummary(queue: number, last: SortView | null, t: Translate): string {
  if (last) return t('mdp.logic.sortPlace', { id: last.parcelId, bag: last.toteCode, count: queue });
  if (queue === 0) return t('mdp.logic.sortEmpty');
  return queue === 1 ? t('mdp.logic.sortQueuedOne', { count: queue }) : t('mdp.logic.sortQueuedMany', { count: queue });
}
