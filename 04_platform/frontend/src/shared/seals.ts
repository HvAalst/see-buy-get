import type { Translate } from './i18n';

/**
 * A SEAL ON A LOAD (round 15: "shipper writes driver matches according to iso 17712 including the required photographs
 * etc"). The shipper writes each seal — its number, its ISO 17712 class, the maker marked on it, who closed it — with three
 * photographs; the driver reads it off the door at pickup; customs may replace it at a border post; one may be found broken
 * on the road; the receiver looks at the door at delivery. The Business app, the driver's app and the tracking page say it
 * in the same words, from here.
 */
export type SealClass = 'I' | 'S' | 'H';
export type SealState = 'on' | 'replaced' | 'broken';
export type SealBreakCause = 'police' | 'customs' | 'repair' | 'found_broken' | 'other';
export type SealsAtDelivery = 'as_on_the_note' | 'not_as_on_the_note';

export const SEAL_CLASSES: SealClass[] = ['H', 'S', 'I'];
export const SEAL_BREAK_CAUSES: SealBreakCause[] = ['police', 'customs', 'repair', 'found_broken', 'other'];

export interface SealView {
  sealId: string;
  number: string;
  sealClass?: SealClass;
  maker?: string;
  appliedBy: 'sender' | 'customs';
  /** The container it closes, as the load named it when the seal was written. */
  containerNo?: string;
  /** The load's package codes (SSCC) it closes. */
  ssccs?: string[];
  state: SealState;
  writtenAt: string;
  matchedAt?: string;
  replaces?: string;
  replaced?: { at: string; post?: string; officer?: string; by: string };
  broken?: { at: string; cause: SealBreakCause; note?: string };
  atDelivery?: { at: string; result: SealsAtDelivery };
}

/** A seal as the driver's app is told it: which to find and what it is — never its number. */
export interface SealToFind {
  sealId: string;
  no: number;
  sealClass?: SealClass;
  maker?: string;
  appliedBy: 'sender' | 'customs';
  /** The container to find it on: it is read off THAT door. */
  containerNo?: string;
  state: SealState;
  /** sha256 of `<freightId>|<number folded>`: a reading is checked against it on the phone, with or without a signal. */
  check: string;
}

/** A seal number folded as the server folds it: what a person reads off a bolt, without the spaces, dashes and dots. */
export function sealKey(number: string): string {
  return number.toUpperCase().replace(/[\s\-./]/g, '');
}

/**
 * IS THIS THE NUMBER WRITTEN? Checked on the phone against the seal's fingerprint, so a pickup made where there is no
 * signal is told on the spot — not after the truck has left. Where the phone cannot hash, the server answers instead.
 */
export async function readingMatches(freightId: string, reading: string, check: string): Promise<boolean | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  const bytes = new TextEncoder().encode(`${freightId}|${sealKey(reading.trim())}`);
  const hash = await subtle.digest('SHA-256', bytes);
  const hex = [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return hex === check;
}

/** What a seal is, in a line: its number (where it may be shown), class and maker. */
export function sealWhat(s: { number?: string; sealClass?: SealClass; maker?: string; appliedBy: 'sender' | 'customs' }, t: Translate): string {
  return [s.number, s.sealClass ? t('common.seal.class', { c: s.sealClass }) : '', s.maker ?? '', t(s.appliedBy === 'customs' ? 'common.seal.byCustoms' : 'common.seal.bySender')].filter(Boolean).join(' · ');
}

/**
 * WHAT A SEAL CLOSES, in a line (the ISO 28000 check: "a seal bound to the container number and the SSCCs"): the
 * container it was put on, and the packages under it — one by its code, more by their count. Empty where it names neither.
 */
export function sealOver(s: { containerNo?: string; ssccs?: string[] }, t: Translate): string {
  const n = s.ssccs?.length ?? 0;
  return [s.containerNo ? t('common.seal.onContainer', { container: s.containerNo }) : '', n === 1 ? t('common.seal.overPackage', { sscc: s.ssccs![0] }) : n > 1 ? t('common.seal.overPackages', { n }) : ''].filter(Boolean).join(' · ');
}

/** What became of a seal, in a line. */
export function sealStory(s: SealView, t: Translate, when: (iso: string) => string): string {
  if (s.state === 'broken' && s.broken) return t('common.seal.broken', { how: t(`common.seal.cause.${s.broken.cause}` as 'common.seal.cause.police'), when: when(s.broken.at) });
  if (s.state === 'replaced' && s.replaced) return t('common.seal.replaced', { by: s.replaced.by, post: s.replaced.post ?? '—', when: when(s.replaced.at) });
  if (s.atDelivery) return t(s.atDelivery.result === 'as_on_the_note' ? 'common.seal.deliveredAsWritten' : 'common.seal.deliveredNotAsWritten', { when: when(s.atDelivery.at) });
  if (s.matchedAt) return t('common.seal.matched', { when: when(s.matchedAt) });
  return s.replaces ? t('common.seal.inPlaceOf', { number: s.replaces }) : t('common.seal.written');
}
