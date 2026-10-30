import type { MessageKey } from './i18n';

/**
 * A FIRM'S OWN PLACE IN THE LOGISTICS DIRECTORY (the user, 2026-10-30) — what the Business and Fleet apps show on the
 * card where a firm says whether it is shown, and in what words. The firm's to say, never staff's.
 */
export type DirectoryKind = 'forwarder' | 'clearing_agent' | 'depot' | 'haulier';

export interface DirectoryListingView {
  listed: boolean;
  /** It may be shown: checked by our staff, and doing work the directory lists. */
  eligible: boolean;
  kinds: DirectoryKind[];
  words?: string;
  contact?: { phone?: string; email?: string; website?: string };
  handle?: string;
  country?: string;
}

export type ListingState = 'shown' | 'off' | 'notChecked' | 'noKinds';

/** Where it stands: shown; taken off by itself; not yet checked; or doing nothing the directory lists. */
export function listingState(v: DirectoryListingView): ListingState {
  if (v.listed) return 'shown';
  if (v.eligible) return 'off';
  return v.kinds.length ? 'notChecked' : 'noKinds';
}

/** Why it is not shown, in words — for a business or a fleet. */
export function listingWhy(state: ListingState, who: 'business' | 'fleet'): MessageKey | null {
  if (state === 'shown') return null;
  if (state === 'off') return 'directory.app.whyOff';
  if (who === 'fleet') return 'directory.app.whyFleet';
  return state === 'noKinds' ? 'directory.app.whyKinds' : 'directory.app.whyChecked';
}

/** Its own entry on the public page: /directory/<cc>/#<handle>. */
export function listingLink(v: DirectoryListingView): string {
  return v.country ? `/directory/${v.country.toLowerCase()}/${v.handle ? `#${v.handle}` : ''}` : '/directory/';
}

/** A website as typed — "baobab.example" — with the https:// it needs; empty stays empty, anything else is the server's to refuse. */
export function websiteOf(typed: string): string {
  const s = typed.trim();
  return s && !/^[a-z][a-z0-9+.-]*:\/\//i.test(s) && /^[^\s/]+\.[^\s]{2,}/.test(s) ? `https://${s}` : s;
}

/** A line of its own, as it will be kept: spaces folded, at most 240 letters. */
export function cleanLine(words: string): string {
  return words.replace(/\s+/g, ' ').trim().slice(0, 240);
}
