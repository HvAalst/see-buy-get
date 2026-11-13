import { describe, expect, it } from 'vitest';
import { weighedFor } from './logic';

/*
 * 2026-11-13 — A PERSON'S SEND WEIGHED AT THE COUNTER (the owner: "shop and hub tools", T2): on a scale that counts the weight is
 * sent with the take-in — only once the preview shows the cash at that weight, so the cash taken is the cash shown.
 */
describe('a weighed take-in', () => {
  const send = { kind: 'peer_send', weighs: true };
  it('sends nothing where the scale does not count, for a store’s order, or with no weight typed', () => {
    expect(weighedFor({ kind: 'peer_send', weighs: false }, '9')).toBeUndefined();
    expect(weighedFor({ kind: 'vendor_order', weighs: true }, '9')).toBeUndefined();
    expect(weighedFor(send, '')).toBeUndefined();
  });
  it('sends the weight once the preview is at it; waits while it is not', () => {
    expect(weighedFor({ ...send, weighedKg: 9 }, '9')).toBe(9);
    expect(weighedFor({ ...send, weighedKg: 9 }, '9,0')).toBe(9);
    expect(weighedFor(send, '9')).toBeNull();
    expect(weighedFor({ ...send, weighedKg: 8.5 }, '9')).toBeNull();
    // Cleared after a weighing: wait for the booking's price to come back.
    expect(weighedFor({ ...send, weighedKg: 9 }, '')).toBeNull();
  });
});
