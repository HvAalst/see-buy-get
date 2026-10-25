import { Inject, Injectable, Logger } from '@nestjs/common';
import { GeoPoint } from './pudo.types';
import { geocodeAddress } from './geo';
import { lookupPlace } from './geo-gazetteer';

/**
 * The result of resolving a free-text place/address to a point. `confidence` lets a caller (or the UI)
 * distinguish a real gazetteer hit from a best-guess fallback, so an approximate pin can be flagged as
 * such instead of being shown as exact.
 */
export interface GeocodeResult {
  location: GeoPoint;
  confidence: 'exact' | 'approx' | 'fallback';
  /** The gazetteer place that matched (undefined on fallback). */
  matched?: string;
}

/**
 * The geocoding seam. The sandbox binds it to GazetteerGeocoder (offline, real coords for known
 * places). A production deployment swaps in an HTTP adapter over a Nominatim-compatible service —
 * `GET {GLOS_GEOCODER_URL}/search?q=<address>&format=json&limit=1`, mapping the top hit's {lat, lon}
 * to a GeocodeResult and falling back to the gazetteer offline / on error. That adapter is one provider
 * swap in pudo.module.ts and touches no call site (mirrors the PUSH_SENDER / BlobStore pattern).
 *
 * The interface is synchronous because the sandbox resolution is a local lookup and the PRIMARY path is
 * a client-supplied map pin (this only runs when no pin is given). A network-backed production geocoder
 * that must be async would either resolve address→pin in the app before submit, or make the register
 * path await — a documented deployment choice, not a sandbox concern.
 */
export interface Geocoder {
  geocode(query: string): GeocodeResult;
}

export const GEOCODER = Symbol('GEOCODER');

/**
 * The sandbox geocoder. Resolve against the offline gazetteer first (a true location for a known place
 * or an address that names one); for anything unknown, fall back to the deterministic near-centroid
 * hash (stable + offline) so a never-seen address still gets A point — flagged 'fallback' so it can be
 * treated as approximate. `exact` = the query IS a known place; `approx` = a known place appears inside
 * a longer address.
 */
@Injectable()
export class GazetteerGeocoder implements Geocoder {
  geocode(query: string): GeocodeResult {
    const q = query?.trim() ?? '';
    const match = q ? lookupPlace(q) : null;
    if (match) {
      return { location: match.entry.location, confidence: match.kind === 'exact' ? 'exact' : 'approx', matched: match.entry.name };
    }
    return { location: geocodeAddress(q), confidence: 'fallback' };
  }
}

/** How long one answer is kept: a street does not move, and the outside service is asked as little as it can be. */
const KEEP_MS = 24 * 3_600_000;
/** How many answers are kept at most — the oldest goes first. */
const KEEP_MOST = 500;
/** The least time between two asks of the outside service: OpenStreetMap's own allows one a second. */
const SPACING_MS = 1_100;
/** How many may wait their turn; past that the offline gazetteer answers, rather than a person waiting on a queue. */
const MOST_WAITING = 5;
/** How long an ask may take before the gazetteer answers instead. */
const TIMEOUT_MS = 6_000;

/** One hit of a Nominatim-compatible search (format=jsonv2, addressdetails=1) — only what is read. */
interface NominatimHit {
  lat?: string;
  lon?: string;
  display_name?: string;
  address?: { house_number?: string };
}

/**
 * AN ADDRESS, ANYWHERE THE NETWORK RUNS (the user, 2026-10-25: "A map is the better option and a toggle for an address
 * which would work for pretty many countries as well. Address is for many places a legal physical reference point
 * anyway.").
 *
 * The offline gazetteer knows the places it was written with. An address anywhere else needs a real geocoder: with
 * GLOS_GEOCODER_URL set, a Nominatim-compatible service — OpenStreetMap's own (light use, one ask a second, the app
 * named), an instance of the operator's, or a provider speaking the same API (GLOS_GEOCODER_KEY is sent as `key` for
 * one that wants it) — answers first, limited to the countries asked about. The gazetteer answers what it cannot, and
 * whenever it is out of reach, slow or busy.
 *
 * WHAT NEITHER FINDS IS NOT FOUND. Never the gazetteer's stand-in point for an unknown name: a confident pin somewhere
 * nobody said is the one answer worse than none, and a person can always tap the map instead.
 *
 * A house number found is `exact`; a street, a suburb or a town is `approx` — its middle, said as "near".
 */
@Injectable()
export class AddressSearchService {
  private readonly logger = new Logger(AddressSearchService.name);
  private readonly kept = new Map<string, { at: number; found: GeocodeResult | null }>();
  private nextAt = 0;
  private waiting = 0;
  /** The platform's fetch; a test puts its own here. */
  fetcher: (url: string, init: { signal: AbortSignal; headers: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }> = (url, init) => fetch(url, init);

  constructor(@Inject(GEOCODER) private readonly offline: Geocoder) {}

  private base(): string {
    return (process.env.GLOS_GEOCODER_URL ?? '').trim().replace(/\/+$/, '');
  }

  /** A place for `query`, in one of `countries` (ISO-3166 alpha-2) where they are named — or nothing found. */
  async search(query: string, countries: string[] = [], now: number = Date.now()): Promise<GeocodeResult | null> {
    const q = query.trim();
    if (!q) return null;
    const known = this.offlineHit(q);
    const base = this.base();
    if (!base) return known;
    const codes = [...new Set(countries.map((c) => c.trim().toLowerCase()).filter((c) => /^[a-z]{2}$/.test(c)))].sort();
    const id = `${codes.join(',')}|${q.toLowerCase()}`;
    const kept = this.kept.get(id);
    if (kept && now - kept.at < KEEP_MS) return kept.found ?? known;
    if (this.waiting >= MOST_WAITING) return known;
    const found = await this.ask(base, q, codes);
    if (found === undefined) return known; // out of reach, slow or refused: what the gazetteer knows, kept nowhere
    this.kept.set(id, { at: now, found });
    if (this.kept.size > KEEP_MOST) this.kept.delete(this.kept.keys().next().value!);
    return found ?? known;
  }

  /** The gazetteer's answer when it is a real place — never its stand-in for a name it does not know. */
  private offlineHit(q: string): GeocodeResult | null {
    const hit = this.offline.geocode(q);
    return hit.confidence === 'fallback' ? null : hit;
  }

  /** Ask the service, one ask at a time and no faster than it allows. `null` = it found nothing; `undefined` = no answer. */
  private async ask(base: string, q: string, codes: string[]): Promise<GeocodeResult | null | undefined> {
    this.waiting++;
    try {
      const wait = this.nextAt - Date.now();
      this.nextAt = Math.max(Date.now(), this.nextAt) + SPACING_MS;
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      const params = new URLSearchParams({ q, format: 'jsonv2', addressdetails: '1', limit: '1' });
      if (codes.length) params.set('countrycodes', codes.join(','));
      const key = process.env.GLOS_GEOCODER_KEY?.trim();
      if (key) params.set('key', key);
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
      try {
        // Named, as OpenStreetMap's own service asks of every app that uses it.
        const site = (process.env.SBG_PUBLIC_URL ?? '').trim() || 'https://seebuyget.com';
        const res = await this.fetcher(`${base}/search?${params}`, { signal: ctl.signal, headers: { 'User-Agent': `SeeBuyGet (${site})`, Accept: 'application/json' } });
        if (!res.ok) {
          this.logger.warn(`The geocoder answered ${res.status}; the offline gazetteer answers instead`);
          return undefined;
        }
        const hits = (await res.json()) as NominatimHit[];
        const hit = Array.isArray(hits) ? hits[0] : undefined;
        const lat = Number(hit?.lat);
        const lng = Number(hit?.lon);
        if (!hit || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        return { location: { lat, lng }, confidence: hit.address?.house_number ? 'exact' : 'approx', ...(hit.display_name ? { matched: hit.display_name } : {}) };
      } finally {
        clearTimeout(timer);
      }
    } catch (e) {
      this.logger.warn(`The geocoder could not be reached (${(e as Error).message}); the offline gazetteer answers instead`);
      return undefined;
    } finally {
      this.waiting--;
    }
  }
}
