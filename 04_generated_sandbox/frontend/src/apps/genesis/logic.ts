/**
 * Pure Send-app logic — no DOM, no fetch, no Preact. Deterministic and unit-tested.
 * The status ladder wording is the consumer-facing half of the parcel state machine;
 * the quote presentation decides what a sender is told a journey costs.
 */

import type { IconName } from '../../shared/ui/Icon';
import type { NetworkPoint, ParcelSize, ParcelStatus, QuoteView, TrackView } from './types';

/* ------------------------------------------------------------------ sizes -- */

export const SIZES: Array<{ key: ParcelSize; label: string; hint: string }> = [
  { key: 'S', label: 'Small', hint: 'Fits in one hand' },
  { key: 'M', label: 'Medium', hint: 'Shoebox' },
  { key: 'L', label: 'Large', hint: 'Needs both arms' },
  { key: 'HEAVY', label: 'Heavy', hint: 'Over 20 kg' },
];

/* ------------------------------------------------------------------ money -- */

export function money(v: number | null | undefined): string {
  return (Number(v) || 0).toFixed(2);
}

/* ----------------------------------------------------------------- points -- */

/** Shops a sender can choose: open ones first, each group A→Z by name. */
export function selectablePoints(points: NetworkPoint[] | null, excludeDid?: string): NetworkPoint[] {
  return (points ?? [])
    .filter((p) => p.did !== excludeDid)
    .sort((a, b) => {
      if (a.openState !== b.openState) return a.openState === 'open' ? -1 : 1;
      return a.shopName.localeCompare(b.shopName);
    });
}

export function pointLine(p: NetworkPoint): string {
  const bits = [`Zone ${p.zone}`];
  if (p.landmark) bits.push(p.landmark);
  bits.push(`${money(p.pricePerParcel)} handling`);
  if (p.rating?.count) bits.push(`rated ${p.rating.average.toFixed(1)}`);
  return bits.join(' · ');
}

/* ------------------------------------------------------------------ quote -- */

export interface PriceCard {
  key: 'locked' | 'flexible';
  title: string;
  sub: string;
  total: number;
}

/**
 * The two ways to buy the same journey, CHEAPEST FIRST — a sender comparing prices reads
 * top-down, and anchoring on the dearer option would be a dark pattern. `locked` rides the
 * bottom of the per-km market (waits for that carrier); `flexible` pays the top so any
 * passing vehicle can take it.
 */
export function priceCards(q: QuoteView): PriceCard[] {
  return [
    { key: 'locked', title: 'Cheapest', sub: 'Waits for the lowest-price bus', total: q.locked.total },
    { key: 'flexible', title: 'Fastest', sub: 'Any bus can take it', total: q.flexible.total },
  ];
}

/** "Shop A → Central hub → Shop B" — the journey in names, not ids. */
export function journeyLine(q: QuoteView): string {
  return q.hops.map((h) => h.label).join(' → ');
}

export function quoteSummary(q: QuoteView): string {
  return (
    `${Math.round(q.totalKm)} kilometres across ${q.hops.length} stops. ` +
    `Cheapest ${money(q.locked.total)}, fastest ${money(q.flexible.total)}.`
  );
}

/* ------------------------------------------------------------------ track -- */

/** Tracking keys are printed T-XXXX; scanners and thumbs add noise. */
export function normalizeKey(input: string): string {
  return input.trim().toUpperCase();
}

/** The consumer ladder. Disputed/Voided fall off it and render as a note instead. */
export const LADDER: ParcelStatus[] = ['Created', 'At_PUDO', 'On_Bus', 'At_MDP', 'Ready_For_Pickup', 'Delivered'];

export function ladderIndex(status: ParcelStatus): number {
  return LADDER.indexOf(status);
}

export interface StatusPresentation {
  word: string;
  icon: IconName;
  tone: 'ok' | 'info' | 'danger';
}

/** Plain words for every state — grade-3 reading level, no logistics jargon. */
export function statusPresentation(status: ParcelStatus): StatusPresentation {
  switch (status) {
    case 'Created':
      return { word: 'Label made', icon: 'edit', tone: 'info' };
    case 'At_PUDO':
      return { word: 'At the shop', icon: 'home', tone: 'info' };
    case 'On_Bus':
      return { word: 'On the bus', icon: 'truck', tone: 'info' };
    case 'At_MDP':
      return { word: 'At the sort hub', icon: 'grid', tone: 'info' };
    case 'Ready_For_Pickup':
      return { word: 'Ready to collect', icon: 'box', tone: 'ok' };
    case 'Delivered':
      return { word: 'Delivered', icon: 'check', tone: 'ok' };
    case 'Disputed':
      return { word: 'Problem reported', icon: 'warning', tone: 'danger' };
    case 'Voided':
      return { word: 'Cancelled', icon: 'block', tone: 'danger' };
  }
}

export function trackSummary(t: TrackView): string {
  const p = statusPresentation(t.status);
  const where = t.status === 'Ready_For_Pickup' || t.status === 'Delivered' ? ` at ${t.destination}` : '';
  return `Parcel ${t.ref}: ${p.word.toLowerCase()}${where}.`;
}

/** When a step happened, in the reader's locale — falls back to the raw string. */
export function stepTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/**
 * "Show me the way" — a maps link for the destination pin, or null without one. A plain
 * geo query URL: it opens whatever maps app the phone has, and degrades to the browser.
 */
export function mapsHref(t: Pick<TrackView, 'destinationLocation' | 'destination'>): string | null {
  const loc = t.destinationLocation;
  if (!loc) return null;
  return `https://www.google.com/maps?q=${encodeURIComponent(`${loc.lat},${loc.lng}`)}`;
}

/** The collect card renders once the parcel is somewhere a receiver can act on. */
export function showCollectCard(status: ParcelStatus): boolean {
  return status === 'Ready_For_Pickup' || status === 'Delivered';
}
