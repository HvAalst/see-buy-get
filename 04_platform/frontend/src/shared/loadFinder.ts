import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import type { Result, SbgClient } from '../lib/sbg';

/**
 * ROUND 19 — A SCAN FINDS THE LOAD ("A scan finds the load"; "Every scan box we have").
 *
 * A package's GS1-128 barcode (its SSCC), scanned into any box at a counter, a hub or a driver's pickup, finds its load —
 * for whoever could already open it. An app says HOW to look (its own signed-in client) and, where it has a screen for a
 * load, how to open one; every ScanField reads it from here, so no box mistakes a load's package for a parcel, a bag or
 * a badge. An app with no finder (a hub, which opens no loads) still says what was scanned.
 */
export interface LoadFound {
  freightId: string;
  code: string;
  description: string;
  pickupLabel: string;
  destLabel: string;
  status: string;
  package?: number;
  packages?: number;
  sscc?: string;
}

export interface LoadFinder {
  find: (scanned: string) => Promise<Result<LoadFound>>;
  /** Present where the app has a screen for a load: what "Open the load" does. */
  open?: (found: LoadFound) => void;
  /** Whether this load opens here now; absent, every load found does. */
  canOpen?: (found: LoadFound) => boolean;
}

export const LoadFinderContext = createContext<LoadFinder | null>(null);

export function useLoadFinder(): LoadFinder | null {
  return useContext(LoadFinderContext);
}

/** The finder an app's signed-in client gives: `GET dispatch/find-load`, answered only to whoever may open the load. */
export function loadFinderFor(sbg: SbgClient, open?: (found: LoadFound) => void): LoadFinder {
  return {
    find: (scanned) => sbg.request((c) => c.GET('/v1/sbg/dispatch/find-load', { params: { query: { scanned } } })) as never,
    ...(open ? { open } : {}),
  };
}
