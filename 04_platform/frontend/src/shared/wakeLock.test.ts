import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { holdScreen, type WakeEnv } from './wakeLock';

/*
 * THE SCREEN STAYS ON WHERE IT MATTERS (the owner, 2026-11-02: "make it as native as today can be").
 */
function env(visible = true) {
  const st = { visible, asked: 0, released: 0, back: null as null | (() => void) };
  const e: WakeEnv = {
    request: async () => {
      st.asked++;
      const s = {
        released: false,
        release: async () => {
          s.released = true;
          st.released++;
        },
      };
      return s;
    },
    visible: () => st.visible,
    onVisible: (cb) => {
      st.back = cb;
      return () => (st.back = null);
    },
  };
  return { st, e };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('the screen stays on', () => {
  it('holds it while shown, and gives it back when closed', async () => {
    const { st, e } = env();
    const stop = holdScreen(e);
    await tick();
    expect(st.asked).toBe(1);
    stop();
    expect(st.released).toBe(1);
    expect(st.back).toBeNull();
  });

  it('asks again when the app comes back to the front — the phone took the hold when it left', async () => {
    const { st, e } = env(false);
    const stop = holdScreen(e);
    await tick();
    expect(st.asked).toBe(0); // in the background: nothing to hold
    st.visible = true;
    st.back?.();
    await tick();
    expect(st.asked).toBe(1);
    stop();
  });

  it('does nothing where a browser cannot hold the screen', () => {
    expect(() => holdScreen({ visible: () => true, onVisible: () => () => undefined })()).not.toThrow();
  });

  it('is held by the scanner, a code, a QR and a driver’s departed run', () => {
    expect(readFileSync('src/shared/ui/Scanner.tsx', 'utf8')).toMatch(/useWakeLock\(open\)/);
    expect(readFileSync('src/shared/ui/QrBlock.tsx', 'utf8')).toMatch(/useWakeLock\(\)/);
    expect(readFileSync('src/shared/ui/CodeCard.tsx', 'utf8')).toMatch(/useWakeLock\(\)/);
    expect(readFileSync('src/apps/driver/screens/RunSection.tsx', 'utf8')).toMatch(/useWakeLock\(runs\.some\(\(d\) => d\.status === 'departed'\)\)/);
  });
});
