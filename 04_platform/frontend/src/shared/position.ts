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
 * 2026-11-10 — WHERE THE PHONE WAS AT A HANDOVER: the reading sent beside a load's pickup or delivery, a door where it
 * could not be delivered, or a bag taken on its seal — or that there was none. The photo itself goes stripped of its
 * hidden data, so the position is read here, at the moment of the act, never out of the picture.
 */
export type HandoverFix = { lat: number; lng: number; accuracyM?: number; fixAt?: string } | { none: true };

/** A reading this fresh is the phone's position at the act: the shift's own watch usually has one. */
export const HANDOVER_FIX_FRESH_MS = 30_000;

/** The latest reading the phone gave anywhere in this app, with how sure it was and when. */
let lastFix: { lat: number; lng: number; accuracyM?: number; ms: number } | null = null;

function remember(pos: GeolocationPosition): void {
  const { latitude: lat, longitude: lng, accuracy } = pos.coords;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
  lastFix = { lat, lng, ...(Number.isFinite(accuracy) ? { accuracyM: Math.round(accuracy) } : {}), ms: Number.isFinite(pos.timestamp) ? pos.timestamp : Date.now() };
}

/** As sent: rounded to about a metre, the reading's own time. */
function asFix(f: { lat: number; lng: number; accuracyM?: number; ms: number }): HandoverFix {
  const r = (n: number) => Math.round(n * 1e6) / 1e6;
  return { lat: r(f.lat), lng: r(f.lng), ...(f.accuracyM !== undefined ? { accuracyM: f.accuracyM } : {}), fixAt: new Date(f.ms).toISOString() };
}

/**
 * The phone's position for a handover: the shift's latest reading if it is fresh, else asked now, waiting no longer than
 * `timeoutMs`. Never fails: no position is an answer (`{ none: true }`), and the handover goes ahead with it.
 */
export async function handoverFix(timeoutMs = 6_000, now: () => number = Date.now): Promise<HandoverFix> {
  if (lastFix && now() - lastFix.ms <= HANDOVER_FIX_FRESH_MS) return asFix(lastFix);
  if (!canLocate()) return { none: true };
  const got = await new Promise<boolean>((resolve) => {
    let settled = false;
    const done = (ok: boolean) => {
      if (!settled) {
        settled = true;
        resolve(ok);
      }
    };
    try {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          remember(pos);
          done(true);
        },
        () => done(false),
        { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: HANDOVER_FIX_FRESH_MS },
      );
    } catch {
      done(false);
    }
  });
  return got && lastFix ? asFix(lastFix) : { none: true };
}

/** For tests: forget the last reading. */
export function forgetFix(): void {
  lastFix = null;
}

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

/**
 * A phone standing still may say nothing at all: many devices only call a watch when the fix changes. So ask once
 * every so often as well, and a vehicle parked for an hour is confirmed as parked THERE (round 16: its fleet is told
 * when it stands too long). A phone that cannot answer stays silent — which the server reads as a phone gone dark,
 * never as a vehicle standing still. Returns a stop function, like the watch.
 */
export function askEvery(onFix: (p: GeoPoint) => void, everyMs: number, ask: () => Promise<GeoPoint | null> = () => currentPosition()): StopWatch {
  const id = setInterval(() => {
    void ask().then((p) => {
      if (!p) return;
      try {
        onFix(p);
      } catch {
        /* a bad handler must not stop the asking */
      }
    });
  }, everyMs);
  return () => clearInterval(id);
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
        (pos) => {
          remember(pos);
          done({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        },
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
        remember(pos); // every reading, reported or not: a handover asks for the freshest
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
