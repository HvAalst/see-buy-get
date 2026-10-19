import { describe, expect, it, vi } from 'vitest';
import { askEvery, shouldReport } from './position';

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
