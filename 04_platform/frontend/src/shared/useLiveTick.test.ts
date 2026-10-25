import { describe, expect, it } from 'vitest';
import { concerns } from './useLiveTick';

describe('which screens a live message moves', () => {
  it('moves a screen for the names it lists, and only those', () => {
    // The bell: its own name, never what the fleet's people did.
    expect(concerns(['bell'], ['bell'])).toBe(true);
    expect(concerns(['bell'], ['changed', 'orders'])).toBe(false);
    // The orders list: what its office did, and each step of its orders, loads and plan.
    expect(concerns(['changed', 'orders', 'loads', 'plan'], ['map', 'loads'])).toBe(true);
    expect(concerns(['changed', 'orders', 'loads', 'plan'], ['map', 'bell'])).toBe(false);
    // A screen that names nothing moves for everything.
    expect(concerns(undefined, ['map'])).toBe(true);
  });
});
