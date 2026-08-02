import { Injectable } from '@nestjs/common';
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
