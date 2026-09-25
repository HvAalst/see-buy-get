import type { MessageKey, Translate } from './i18n';

/**
 * WHERE COVER STANDS ON A LOAD — and the answer is never "with us".
 *
 * This network does not insure goods on a fleet's own run and is not going to. What it was doing instead
 * was saying NOTHING, and silence on a screen that quotes a price reads as cover: a shipper who books 450
 * through us and is never told otherwise reasonably assumes somebody is behind the goods. That assumption
 * is the thing people would feel misled by, and it costs nothing to prevent.
 *
 * So the carrier states their own position and the shipper states what the load is worth, and the two
 * numbers are put side by side. Neither is a promise of ours. Together they are the gap, which is the most
 * this network can honestly offer: not the cover, but a state legible enough for a forwarder to price.
 *
 * Three answers, and the third is the one that had to be written:
 *
 *  - a LIMIT, with what it is good for
 *  - ZERO, which is a real answer and a different fact from silence
 *  - NOTHING SAID, which is said out loud rather than left blank
 */
export function coverWords(cover: { limit: number; policy?: string } | undefined, currency: string, t: Translate): string {
  if (!cover) return t('cover.unsaid');
  if (cover.limit <= 0) return t('cover.none');
  return cover.policy
    ? t('cover.limitPolicy', { amount: cover.limit, currency, policy: cover.policy })
    : t('cover.limit', { amount: cover.limit, currency });
}

/**
 * Is the declared value beyond what the carrier covers?
 *
 * The one arithmetic worth doing on this screen. A shipper putting 450,000 of solar panels on a truck
 * whose policy stops at 200,000 is not doing anything wrong — they are doing something they should know
 * about, and nobody was in a position to tell them.
 */
export function coverShortfall(
  declaredValue: number | undefined,
  cover: { limit: number } | undefined,
): number | null {
  if (declaredValue == null || declaredValue <= 0) return null;
  const limit = cover?.limit ?? 0;
  return declaredValue > limit ? Math.round((declaredValue - limit) * 100) / 100 : null;
}

const HANDLES: Record<string, MessageKey> = {
  coldChain: 'cover.handles.cold',
  hazmat: 'cover.handles.hazmat',
  carriesBulk: 'cover.handles.bulk',
  allowsFragile: 'cover.handles.fragile',
};

/**
 * What the vehicle can take, in words — read BEFORE the form rather than as a refusal after it.
 *
 * The server refuses a load the truck cannot carry either way. This is so a shipper with a chilled load
 * does not fill in four fields to be told no.
 */
export function handlesWords(handles: string[], t: Translate): string {
  const said = handles.map((h) => HANDLES[h]).filter(Boolean) as MessageKey[];
  if (!said.length) return '';
  return t('cover.handles', { what: said.map((k) => t(k)).join(', ') });
}
