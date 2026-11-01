import { SLOT_MAX_H, slotOf, slotWords } from './terminal-slot.types';

/** 2026-11-01 — a truck's slot at an airline's cargo terminal: a window the shed gives, checked, and said. */
describe('a truck’s slot at the cargo terminal', () => {
  const now = Date.parse('2026-11-02T06:00:00Z');
  it('takes a window that starts before it ends, is not over and not longer than a working stretch', () => {
    expect(slotOf({ from: '2026-11-02T10:00:00Z', to: '2026-11-02T11:00:00Z', reference: ' S-120 ' }, now)).toEqual({ from: '2026-11-02T10:00:00.000Z', to: '2026-11-02T11:00:00.000Z', reference: 'S-120' });
    expect(() => slotOf({ from: '2026-11-02T11:00:00Z', to: '2026-11-02T10:00:00Z' }, now)).toThrow(/must end after it starts/);
    expect(() => slotOf({ from: '2026-11-02T07:00:00Z', to: new Date(Date.parse('2026-11-02T07:00:00Z') + (SLOT_MAX_H + 1) * 3_600_000).toISOString() }, now)).toThrow(/12 at most/);
    expect(() => slotOf({ from: '2026-11-02T04:00:00Z', to: '2026-11-02T05:00:00Z' }, now)).toThrow(/over already/);
    expect(() => slotOf({ from: 'soon', to: '2026-11-02T05:00:00Z' }, now)).toThrow(/start and end/);
  });

  it('refuses a handing-in slot that ends after the latest acceptance time — the truck could not make the flight in it', () => {
    const lat = { at: '2026-11-02T10:30:00Z', what: 'the latest acceptance time' };
    expect(() => slotOf({ from: '2026-11-02T10:00:00Z', to: '2026-11-02T11:00:00Z' }, now, lat)).toThrow(/ends after the latest acceptance time/);
    expect(slotOf({ from: '2026-11-02T09:00:00Z', to: '2026-11-02T10:00:00Z' }, now, lat).to).toBe('2026-11-02T10:00:00.000Z');
  });

  it('says it in the driver’s words', () => {
    expect(slotWords({ from: '2026-11-02T10:00:00.000Z', to: '2026-11-02T11:00:00.000Z', reference: 'S-120' })).toBe('10:00–11:00 UTC on 2026-11-02 (slot S-120)');
    expect(slotWords({ from: '2026-11-02T23:00:00.000Z', to: '2026-11-03T01:00:00.000Z' })).toBe('23:00–2026-11-03 01:00 UTC on 2026-11-02');
  });
});
