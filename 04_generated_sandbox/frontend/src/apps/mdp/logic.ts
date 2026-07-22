/**
 * Pure hub domain logic — no DOM, no fetch, no Preact. Deterministic and unit-tested.
 * The queue rules, the swatch hash and the fill maths are harvested from the legacy
 * mdp.js so the PWA and the old page can never disagree about what the floor sees.
 */

import type { Benchmark, MdpView, ParcelRow, SortView, ToteView } from './types';

/* ------------------------------------------------------------------- hub -- */

/** The signed-in DID's own hub. Login binds the token to the hub's real DID (S2). */
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

/** Only a bag with something in it can go on a bus. */
export function loadableBags(totes: ToteView[] | null): ToteView[] {
  return fillingBags(totes).filter((t) => t.parcels.length > 0);
}

export function bagLine(t: ToteView): string {
  const dest = t.destinationLabel || t.destinationNodeId || 'unassigned';
  const n = t.parcels.length;
  return `→ ${dest} · ${n} parcel${n === 1 ? '' : 's'}`;
}

/* ------------------------------------------------------------------ sort -- */

/** The placement instruction, in plain words: where this parcel's bag is heading. */
export function placeLine(sort: SortView): string {
  const kind = sort.nextDestination.type === 'pudo' ? 'last mile' : 'onward hub';
  return `→ ${sort.nextDestination.label} (${kind})`;
}

/* ------------------------------------------------------------------ money -- */

export function money(v: number | null | undefined): string {
  return (Number(v) || 0).toFixed(2);
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

/** The hub's sort fee against nearby hubs — same band rules as the agent app, hub wording. */
export function priceBand(pricePerParcel: number | null | undefined, benchmark: Benchmark | null | undefined): PriceBand | null {
  if (!benchmark || !benchmark.count) return null;

  const mine = Number(pricePerParcel ?? 0);
  const pct = benchmark.median > 0 ? Math.round(((mine - benchmark.median) / benchmark.median) * 100) : 0;

  const headline =
    pct > 1
      ? `You charge ${pct}% more than nearby hubs.`
      : pct < -1
        ? `You charge ${-pct}% less than nearby hubs.`
        : 'You charge about the same as nearby hubs.';

  const detail =
    `Your sort fee ${money(mine)} per parcel. Nearby hubs charge ${money(benchmark.median)} ` +
    `(${money(benchmark.min)}–${money(benchmark.max)} across ${benchmark.count} hubs).`;

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

export function homeSummary(unsorted: number, filling: number): string {
  return `${unsorted} parcel${unsorted === 1 ? '' : 's'} to sort. ${filling} outbound bag${filling === 1 ? '' : 's'} building.`;
}

export function sortSummary(queue: number, last: SortView | null): string {
  if (last) return `Place parcel ${last.parcelId} in bag ${last.toteCode}. ${queue} left to sort.`;
  if (queue === 0) return 'The queue is empty. Drop a bag to unload one, or scan any parcel here.';
  return `${queue} parcel${queue === 1 ? '' : 's'} queued. Scan the next one.`;
}
