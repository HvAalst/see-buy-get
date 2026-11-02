import { useEffect } from 'preact/hooks';

/**
 * 2026-11-02 — THE SCREEN STAYS ON WHERE IT MATTERS (the owner: "make it as native as today can be").
 *
 * A phone dims and locks after half a minute; a native app keeps the screen on while it is being used without being
 * touched: the camera scanning a label at the counter, a code held up for somebody to read or scan, a driver's route on
 * the dashboard. The screen is held only while that is on screen and the app is in front; the phone takes the hold back
 * whenever the app goes to the background, so it is asked for again on return. Where a browser cannot hold the screen,
 * nothing happens and nothing breaks.
 */
interface Sentinel {
  released?: boolean;
  release(): Promise<void>;
}
export interface WakeEnv {
  request?: () => Promise<Sentinel>;
  visible: () => boolean;
  onVisible: (cb: () => void) => () => void;
}

const browserEnv = (): WakeEnv => {
  const nav = globalThis.navigator as unknown as { wakeLock?: { request(type: 'screen'): Promise<Sentinel> } } | undefined;
  const doc = globalThis.document;
  return {
    request: nav?.wakeLock ? () => nav.wakeLock!.request('screen') : undefined,
    visible: () => doc?.visibilityState === 'visible',
    onVisible: (cb) => {
      const h = () => {
        if (doc?.visibilityState === 'visible') cb();
      };
      doc?.addEventListener('visibilitychange', h);
      return () => doc?.removeEventListener('visibilitychange', h);
    },
  };
};

/** Hold the screen on until the returned function is called. */
export function holdScreen(env: WakeEnv = browserEnv()): () => void {
  if (!env.request) return () => undefined;
  let lock: Sentinel | null = null;
  let live = true;
  const ask = async () => {
    if (!live || !env.visible() || (lock && !lock.released)) return;
    try {
      const got = await env.request!();
      if (live) lock = got;
      else void got.release().catch(() => undefined);
    } catch {
      /* refused (battery saver, not allowed here): the screen simply sleeps as usual */
    }
  };
  void ask();
  const stop = env.onVisible(() => void ask());
  return () => {
    live = false;
    stop();
    void lock?.release().catch(() => undefined);
    lock = null;
  };
}

/** Keep the screen on while `on` is true and this is on screen. */
export function useWakeLock(on: boolean = true): void {
  useEffect(() => (on ? holdScreen() : undefined), [on]);
}
