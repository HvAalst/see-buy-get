/**
 * The phone's own position — the one fact the whole live half of this network runs on.
 *
 * A load "near you", a patch a rider works, the market's read on where supply actually is, the fleet map:
 * every one of them is a lie without a real fix. This is the thin, guarded seam that produces one.
 *
 * Deliberately small and defensive, because it runs on a $40 Android in a pocket:
 *  - permission is never assumed, and a refusal is a normal outcome, not an error state;
 *  - readings are throttled by TIME and by DISTANCE, so a phone sitting on a counter costs nothing;
 *  - everything is wrapped, because a geolocation callback that throws takes the watch down with it.
 */

import { haversineKm, type GeoPoint } from './geo';

export interface WatchOptions {
  /** Never report more often than this, however chatty the device is. */
  minMs?: number;
  /** …and never report a fix that has barely moved (km). A parked phone's GPS drifts all day. */
  minKm?: number;
}

/** Stop watching. Safe to call twice. */
export type StopWatch = () => void;

const DEFAULT_MIN_MS = 60_000;
const DEFAULT_MIN_KM = 0.2;

/**
 * Decide whether a new fix is worth reporting. Pure, so the throttle is testable without a browser: the
 * expensive half of this feature is the judgement, not the plumbing.
 */
export function shouldReport(
  next: GeoPoint,
  last: { at: GeoPoint; ms: number } | null,
  nowMs: number,
  opts: WatchOptions = {},
): boolean {
  if (!Number.isFinite(next.lat) || !Number.isFinite(next.lng)) return false;
  if (!last) return true; // the first fix always counts — it is the one that turns everything on
  const minMs = opts.minMs ?? DEFAULT_MIN_MS;
  const minKm = opts.minKm ?? DEFAULT_MIN_KM;
  // Either gate alone is enough to report: a driver who has moved a long way deserves to be found before the
  // clock says so, and a driver parked for an hour should still be confirmed as parked THERE.
  return nowMs - last.ms >= minMs || haversineKm(last.at, next) >= minKm;
}

/** Is a position available at all on this device/browser? */
export function canLocate(): boolean {
  return typeof navigator !== 'undefined' && 'geolocation' in navigator;
}

/**
 * One-shot: where am I now? Resolves null when the device cannot say or the driver says no — which is a
 * normal answer, and callers must have a way to carry on without it (name a place instead).
 */
export function currentPosition(timeoutMs = 10_000): Promise<GeoPoint | null> {
  if (!canLocate()) return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    const done = (p: GeoPoint | null) => {
      if (!settled) {
        settled = true;
        resolve(p);
      }
    };
    try {
      navigator.geolocation.getCurrentPosition(
        (pos) => done({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => done(null),
        { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30_000 },
      );
    } catch {
      done(null);
    }
  });
}

/**
 * Follow the phone while the shift lasts, reporting only fixes worth reporting. Returns a stop function;
 * calling it releases the watch, which matters — a forgotten watch is a battery drain on a device whose
 * owner is working a 12-hour day on it.
 */
export function watchPosition(onFix: (p: GeoPoint) => void, opts: WatchOptions = {}): StopWatch {
  if (!canLocate()) return () => undefined;
  let last: { at: GeoPoint; ms: number } | null = null;
  let id: number | null = null;
  try {
    id = navigator.geolocation.watchPosition(
      (pos) => {
        const next = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        const now = Date.now();
        if (!shouldReport(next, last, now, opts)) return;
        last = { at: next, ms: now };
        try {
          onFix(next);
        } catch {
          /* a bad handler must not kill the watch — the next fix should still get through */
        }
      },
      () => undefined, // refused, or no signal: silence is the honest outcome, not an error banner
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 30_000 },
    );
  } catch {
    return () => undefined;
  }
  return () => {
    if (id != null) {
      try {
        navigator.geolocation.clearWatch(id);
      } catch {
        /* already gone */
      }
      id = null;
    }
  };
}
