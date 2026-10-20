import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import type { Result, SbgClient } from '../lib/sbg';

/**
 * ROUND 32 — A STORE PARCEL'S SSCC FINDS ITS PARCEL ("A store parcel's SSCC at our counters"; "Every scan box").
 *
 * Since round 29 a store's parcel carries its own GS1-128 barcode beside our QR. Scanned into a parcel's box at a shop or a
 * hub, it found nothing: the box looked only for a load. Now the box asks here first, and goes on with the parcel as if
 * our QR had been read. The server answers only to whoever handles that parcel now; to anybody else it is no parcel.
 */
export interface ParcelFound {
  parcelId: string;
  sscc: string;
  status: string;
}

export interface ParcelFinder {
  find: (scanned: string) => Promise<Result<ParcelFound>>;
}

export const ParcelFinderContext = createContext<ParcelFinder | null>(null);

export function useParcelFinder(): ParcelFinder | null {
  return useContext(ParcelFinderContext);
}

export function parcelFinderFor(sbg: SbgClient): ParcelFinder {
  return { find: (scanned) => sbg.request((c) => c.GET('/v1/sbg/scan/parcel', { params: { query: { scanned } } })) as never };
}
