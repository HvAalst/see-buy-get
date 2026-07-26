import type { MediaView, RetentionClass } from './media';

/**
 * Media-library logic (S27) — the pure half of "find all your photos in one place, and see that nothing
 * is hoarded". Groups a person's media by its retention BIN and turns each item's machine state
 * (retentionClass + expiresAt + status) into a plain-language line a non-reader can act on. The whole
 * point is retention TRANSPARENCY: an image says "kept until X, then removed automatically", so a user
 * never worries the server is quietly piling up their old photos.
 */

export interface BinMeta {
  title: string;
  blurb: string;
  /** Whether the owner may remove items in this bin early (evidence bins are locked until expiry). */
  deletable: boolean;
}

/** Display order + copy per bin. */
export const BIN_META: Record<RetentionClass, BinMeta> = {
  'shipment-proof': {
    title: 'Delivery proofs',
    blurb: 'Kept for 90 days after the parcel is done, then removed automatically.',
    deletable: false,
  },
  'dispute-evidence': {
    title: 'Problem reports',
    blurb: 'Kept while a problem is being sorted out.',
    deletable: false,
  },
  'vehicle-asset': {
    title: 'Vehicle & trailer photos',
    blurb: 'Yours to manage — replace or remove any time.',
    deletable: true,
  },
  'account-doc': {
    title: 'Your documents',
    blurb: 'Kept while your account is open.',
    deletable: false,
  },
};

/** The order bins appear in the library. */
export const BIN_ORDER: RetentionClass[] = ['shipment-proof', 'dispute-evidence', 'vehicle-asset', 'account-doc'];

export interface MediaGroup {
  bin: RetentionClass;
  meta: BinMeta;
  items: MediaView[];
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Active media grouped by bin, in display order, newest-first within each group. Empty bins are dropped. */
export function groupByBin(media: MediaView[]): MediaGroup[] {
  const active = media.filter((m) => m.status === 'active');
  return BIN_ORDER.map((bin) => ({
    bin,
    meta: BIN_META[bin],
    items: active.filter((m) => m.retentionClass === bin).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
  })).filter((g) => g.items.length > 0);
}

export interface RetentionLabel {
  text: string;
  tone: 'ok' | 'idle' | 'warn';
}

/**
 * A plain-language retention chip for one media at a given moment. Active-with-no-clock reads as the
 * bin's steady state (an asset is "Saved", open-case evidence is "Kept — case open"); a running clock
 * counts down; the last week warns; a past clock reads "Removing…" (the sweep will take it shortly).
 */
export function retentionLabel(m: MediaView, nowMs: number): RetentionLabel {
  if (m.status === 'expired') return { text: 'Removed', tone: 'idle' };
  if (!m.expiresAt) {
    // No clock yet. If it isn't attached to anything, it's an abandoned upload the server reaps within a
    // couple of days — say so, don't promise it's "Saved". A LINKED item legitimately persists until its
    // own lifecycle event starts the clock.
    if (!m.link) return { text: 'Not saved yet', tone: 'warn' };
    if (m.retentionClass === 'dispute-evidence') return { text: 'Kept — case open', tone: 'warn' };
    return { text: 'Saved', tone: 'ok' };
  }
  const days = Math.ceil((new Date(m.expiresAt).getTime() - nowMs) / MS_PER_DAY);
  if (days <= 0) return { text: 'Removing…', tone: 'idle' };
  if (days === 1) return { text: 'Kept 1 more day', tone: 'warn' };
  if (days <= 7) return { text: `Kept ${days} more days`, tone: 'warn' };
  return { text: `Kept ${days} more days`, tone: 'ok' };
}
