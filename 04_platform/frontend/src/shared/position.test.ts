import { describe, expect, it } from 'vitest';
import { shouldReport } from './position';

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
