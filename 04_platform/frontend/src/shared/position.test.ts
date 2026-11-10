import { describe, expect, it, vi } from 'vitest';
import { afterEach, beforeEach } from 'vitest';
import { askEvery, forgetFix, handoverFix, HANDOVER_FIX_FRESH_MS, shouldReport } from './position';

const at = (lat: number, lng: number) => ({ lat, lng });

describe('shouldReport — what is worth telling the server about', () => {
  it('always reports the first fix — it is the one that turns the live half of the network on', () => {
    expect(shouldReport(at(0, 0), null, 1000)).toBe(true);
  });

  it('stays quiet for a phone sitting on a counter', () => {
    // Same spot, seconds later: reporting this costs battery and data and tells nobody anything.
    const last = { at: at(-1.2, 36.8), ms: 1_000 };
    expect(shouldReport(at(-1.2, 36.80001), last, 5_000)).toBe(false);
  });

  it('reports a real move before the clock says so', () => {
    // A rider who has crossed town should be findable now, not in another minute.
    const last = { at: at(-1.2, 36.8), ms: 1_000 };
    expect(shouldReport(at(-1.2, 36.83), last, 5_000)).toBe(true);
  });

  it('confirms a parked driver once the clock runs out — parked THERE is also news', () => {
    const last = { at: at(-1.2, 36.8), ms: 0 };
    expect(shouldReport(at(-1.2, 36.8), last, 61_000)).toBe(true);
  });

  it('refuses a nonsense fix rather than poisoning the live map', () => {
    expect(shouldReport({ lat: Number.NaN, lng: 36.8 }, null, 1_000)).toBe(false);
  });
});

describe('askEvery — a phone standing still is asked, not waited for (round 16)', () => {
  it('asks every few minutes, passes on what the phone says, stays silent when it cannot say — and stops', async () => {
    vi.useFakeTimers();
    const answers = [at(-0.3, 36.08), null, at(-0.3, 36.0801)];
    const heard: Array<{ lat: number; lng: number }> = [];
    const stop = askEvery((p) => heard.push(p), 240_000, () => Promise.resolve(answers.shift() ?? null));
    await vi.advanceTimersByTimeAsync(239_000);
    expect(heard).toEqual([]);
    await vi.advanceTimersByTimeAsync(3 * 240_000);
    expect(heard).toEqual([at(-0.3, 36.08), at(-0.3, 36.0801)]);
    stop();
    answers.push(at(1, 1));
    await vi.advanceTimersByTimeAsync(480_000);
    expect(heard).toHaveLength(2);
    vi.useRealTimers();
  });
});

describe('handoverFix — where the phone was at a handover (2026-11-10)', () => {
  let answer: ((ok: (p: GeolocationPosition) => void, no: () => void) => void) | null = null;
  const asked = vi.fn();
  const reading = (lat: number, lng: number, accuracy: number, timestamp: number) => ({ coords: { latitude: lat, longitude: lng, accuracy }, timestamp }) as unknown as GeolocationPosition;
  beforeEach(() => {
    forgetFix();
    asked.mockReset();
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition: (ok: (p: GeolocationPosition) => void, no: () => void) => { asked(); answer?.(ok, no); } },
    });
  });
  afterEach(() => {
    answer = null;
  });

  it('sends the reading with how sure the phone was and when it took it', async () => {
    answer = (ok) => ok(reading(-1.2812345678, 36.8212345678, 14.4, Date.parse('2026-11-10T09:00:00Z')));
    expect(await handoverFix(100)).toEqual({ lat: -1.281235, lng: 36.821235, accuracyM: 14, fixAt: '2026-11-10T09:00:00.000Z' });
  });

  it('uses a fresh reading the phone already gave, without asking again', async () => {
    const t0 = Date.parse('2026-11-10T09:00:00Z');
    answer = (ok) => ok(reading(-1.28, 36.82, 9, t0));
    await handoverFix(100);
    expect(asked).toHaveBeenCalledTimes(1);
    expect(await handoverFix(100, () => t0 + HANDOVER_FIX_FRESH_MS)).toMatchObject({ lat: -1.28, accuracyM: 9 });
    expect(asked).toHaveBeenCalledTimes(1);
    // Older than that: asked again.
    await handoverFix(100, () => t0 + HANDOVER_FIX_FRESH_MS + 1);
    expect(asked).toHaveBeenCalledTimes(2);
  });

  it('answers "none" when the phone says no or stays silent — the handover goes ahead with it', async () => {
    answer = (_ok, no) => no();
    expect(await handoverFix(100)).toEqual({ none: true });
    answer = null; // never answers: the browser's own timeout would fire; here the refusal path stands for it
    answer = (_ok, no) => setTimeout(no, 5);
    expect(await handoverFix(100)).toEqual({ none: true });
  });
});
