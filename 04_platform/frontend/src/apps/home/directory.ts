import { publicRequest, type Result } from '../../lib/sbg';
import { homeConfig } from './api';

/**
 * THE LOGISTICS DIRECTORY'S ADDRESSES AND WHAT THEY SHOW (the user, 2026-10-30: "a directory much similar to that of
 * fiata.org but in our own style"). `/directory/` — the countries, on a map and in a list; `/directory/<cc>/` — one
 * country's firms, alphabetical. Both built into HTML at build time (prerender.tsx), then read again live.
 */
export const DIRECTORY_PATH = '/directory/';
export const directoryCountryPath = (country: string) => `/directory/${country.toLowerCase()}/`;

export type DirectoryPage = { kind: 'index' } | { kind: 'country'; country: string };

/** Which directory page an address is, or null. */
export function directoryPageOf(path: string): DirectoryPage | null {
  if (/^\/directory\/?$/.test(path)) return { kind: 'index' };
  const cc = /^\/directory\/([a-zA-Z]{2})\/?$/.exec(path)?.[1];
  return cc ? { kind: 'country', country: cc.toUpperCase() } : null;
}

export const DIRECTORY_KINDS = ['forwarder', 'clearing_agent', 'depot', 'haulier'] as const;
export type DirectoryKind = (typeof DIRECTORY_KINDS)[number];

export interface DirectoryCountry {
  country: string;
  name: string;
  total: number;
  forwarder: number;
  clearing_agent: number;
  haulier: number;
  depot: number;
  at?: { lat: number; lng: number };
}

export interface DirectoryIndex {
  countries: DirectoryCountry[];
}

export interface DirectoryEntry {
  handle: string;
  name: string;
  kinds: DirectoryKind[];
  country: string;
  since: string;
  words?: string;
  says?: { clears: string[]; places: string[] };
  seen: { appointed?: number; cleared?: number; delivered?: number; arranged?: number };
  checks: Array<{ paper: string; what: string; at: string }>;
  contact?: { phone?: string; email?: string; website?: string; address?: string; hours?: string };
}

export interface DirectoryCountryView {
  country: string;
  name: string;
  entries: DirectoryEntry[];
}

export function fetchDirectory(): Promise<Result<DirectoryIndex>> {
  return publicRequest<DirectoryIndex>(homeConfig(), '/v1/sbg/directory');
}

export function fetchDirectoryCountry(country: string): Promise<Result<DirectoryCountryView>> {
  return publicRequest<DirectoryCountryView>(homeConfig(), `/v1/sbg/directory/${encodeURIComponent(country.toUpperCase())}`);
}

export interface DirectorySearch {
  entries: DirectoryEntry[];
  /** How many were found; at most a hundred are sent. */
  total: number;
}

/** Every country at once: firms whose entries carry every word, and do the work asked. */
export function searchDirectory(q: string, kind: DirectoryKind | 'all'): Promise<Result<DirectorySearch>> {
  const params = new URLSearchParams();
  if (q.trim()) params.set('q', q.trim());
  if (kind !== 'all') params.set('kind', kind);
  return publicRequest<DirectorySearch>(homeConfig(), `/v1/sbg/directory/search?${params.toString()}`);
}

/** What a search page's address asks for: `/directory/?q=reefer+mombasa&kind=haulier`. Read in a browser only. */
export function searchAsked(search: string): { q: string; kind: DirectoryKind | 'all' } {
  const p = new URLSearchParams(search);
  const kind = p.get('kind');
  return { q: (p.get('q') ?? '').slice(0, 80), kind: kind && (DIRECTORY_KINDS as readonly string[]).includes(kind) ? (kind as DirectoryKind) : 'all' };
}

/** The address a search is kept at, so it can be shared or come back to. */
export function searchPath(q: string, kind: DirectoryKind | 'all'): string {
  const params = new URLSearchParams();
  if (q.trim()) params.set('q', q.trim());
  if (kind !== 'all') params.set('kind', kind);
  const s = params.toString();
  return `${DIRECTORY_PATH}${s ? `?${s}` : ''}`;
}

/** What the build read for a directory page — the same data the page was built with, so the first frame matches it. */
export interface DirectoryBuilt {
  index?: DirectoryIndex;
  country?: DirectoryCountryView;
}

type BuildGlobals = { __SBG_PRERENDER__?: { directory?: DirectoryBuilt } };

export function prerenderedDirectory(): DirectoryBuilt {
  const g = (globalThis as BuildGlobals).__SBG_PRERENDER__;
  if (g) return g.directory ?? {};
  try {
    const el = globalThis.document?.getElementById('prerender-data');
    const data = el?.textContent ? (JSON.parse(el.textContent) as { directory?: DirectoryBuilt }) : null;
    return data?.directory ?? {};
  } catch {
    return {};
  }
}

/** A website's address without its scheme and trailing slash — what the button's title says. */
export function siteHost(url: string): string {
  return url.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
}

/** A phone number as a `tel:` address: its digits and a leading plus, nothing else. */
export function telOf(phone: string): string {
  return `tel:${phone.trim().startsWith('+') ? '+' : ''}${phone.replace(/\D/g, '')}`;
}

/** The firms matching a kind and a few typed words — over the name, its own line and what it says it clears. */
export function matching(entries: DirectoryEntry[], kind: DirectoryKind | 'all', words: string): DirectoryEntry[] {
  const q = words.trim().toLowerCase();
  return entries.filter((e) => (kind === 'all' || e.kinds.includes(kind)) && (!q || [e.name, e.words ?? '', ...(e.says?.places ?? []), ...(e.says?.clears ?? [])].some((s) => s.toLowerCase().includes(q))));
}
