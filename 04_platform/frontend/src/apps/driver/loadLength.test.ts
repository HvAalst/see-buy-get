import { describe, expect, it } from 'vitest';
import { loadLengthOf } from './logic';

/** 2026-11-13 — the load space's length (unusual loads, U3): a long item is offered only where it fits, and nothing is guessed. */
describe('the length of a load space, as the driver types it', () => {
  it('takes metres from 0.5 to 20, with a comma or a point; empty is not known', () => {
    expect(loadLengthOf('')).toEqual({ m: null });
    expect(loadLengthOf(' 3,2 ')).toEqual({ m: 3.2 });
    expect(loadLengthOf('2.45')).toEqual({ m: 2.5 });
    expect(loadLengthOf('0.3')).toEqual({ error: 'driver.load.errLength' });
    expect(loadLengthOf('25')).toEqual({ error: 'driver.load.errLength' });
    expect(loadLengthOf('long')).toEqual({ error: 'driver.load.errLength' });
  });
});
