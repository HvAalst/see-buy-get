import { BorderRuleService, euCabotageRefusal, type CabotageLoad } from './border-rules.service';

/**
 * 2026-11-22 — CABOTAGE THE EU WAY (the owner's BG-4: "As recommend"; Regulation (EC) No 1072/2009 art. 8, as amended by
 * Regulation (EU) 2020/1055): a vehicle from another EU country carries loads inside Bulgaria only after a load into Bulgaria
 * is unloaded, at most three within seven days of that, and then waits four days after its last one before another round.
 */
describe('cabotage the EU way', () => {
  const DAY = 86_400_000;
  const t0 = Date.parse('2026-12-01T08:00:00Z');
  const iso = (ms: number) => new Date(ms).toISOString();
  const into = (deliveredAt: number): CabotageLoad => ({ pickupCountry: 'NL', destCountry: 'BG', status: 'delivered', startedAt: iso(deliveredAt - 2 * DAY), deliveredAt: iso(deliveredAt) });
  const inside = (startedAt: number, deliveredAt?: number, status = deliveredAt ? 'delivered' : 'claimed'): CabotageLoad => ({ pickupCountry: 'BG', destCountry: 'BG', status, startedAt: iso(startedAt), ...(deliveredAt ? { deliveredAt: iso(deliveredAt) } : {}) });

  it('carries nothing inside before a load into the country is unloaded', () => {
    expect(euCabotageRefusal('BG', [], t0)).toMatch(/only after a load into Bulgaria is unloaded, and this one has none/);
    // On its way in, not yet unloaded: still none.
    expect(euCabotageRefusal('BG', [{ ...into(t0 + DAY), status: 'in_transit', deliveredAt: undefined }], t0)).toMatch(/has none/);
    // Delivered only later than now: not yet unloaded now.
    expect(euCabotageRefusal('BG', [into(t0 + DAY)], t0)).toMatch(/has none/);
  });

  it('allows three within seven days of the unloading, and no fourth', () => {
    const loads = [into(t0)];
    expect(euCabotageRefusal('BG', loads, t0 + DAY)).toBeUndefined();
    loads.push(inside(t0 + DAY, t0 + DAY + 3_600_000), inside(t0 + 2 * DAY, t0 + 2 * DAY + 3_600_000));
    expect(euCabotageRefusal('BG', loads, t0 + 3 * DAY)).toBeUndefined();
    loads.push(inside(t0 + 3 * DAY)); // the third, claimed and not yet delivered, counts
    expect(euCabotageRefusal('BG', loads, t0 + 4 * DAY)).toMatch(/at most 3 loads inside Bulgaria after a load into it, and this one has carried 3/);
    // A load called off does not count.
    loads[3] = { ...loads[3], status: 'cancelled' };
    expect(euCabotageRefusal('BG', loads, t0 + 4 * DAY)).toBeUndefined();
  });

  it('ends seven days after the unloading', () => {
    expect(euCabotageRefusal('BG', [into(t0)], t0 + 7 * DAY)).toBeUndefined();
    expect(euCabotageRefusal('BG', [into(t0)], t0 + 7 * DAY + 60_000)).toMatch(/within 7 days of the load into it being unloaded, and those ended on 2026-12-08/);
  });

  it('waits four days after the last load inside of a round before the next round — even after a new load into the country', () => {
    const lastInside = t0 + 5 * DAY;
    const loads = [into(t0), inside(t0 + DAY, t0 + DAY), inside(lastInside - DAY, lastInside), into(t0 + 6 * DAY)];
    expect(euCabotageRefusal('BG', loads, t0 + 6 * DAY + 3_600_000)).toMatch(/waits 4 days after its last load inside Bulgaria before another, until 2026-12-10/);
    expect(euCabotageRefusal('BG', loads, lastInside + 4 * DAY)).toBeUndefined();
  });

  it('counts only loads inside that country: a round in Romania is not one in Bulgaria', () => {
    // Three loads inside Romania after its load into Bulgaria was unloaded: none of them is a load inside Bulgaria.
    const ro: CabotageLoad = { pickupCountry: 'RO', destCountry: 'RO', status: 'delivered', startedAt: iso(t0 + 3_600_000), deliveredAt: iso(t0 + 7_200_000) };
    expect(euCabotageRefusal('BG', [into(t0), ro, ro, ro], t0 + DAY)).toBeUndefined();
  });

  it('is a rule only between two EU countries, and the border rule asks it with the vehicle’s own loads', () => {
    const borders = new BorderRuleService();
    expect(() => borders.set({ from: 'KE', to: 'TZ', cabotage: 'eu' }, 'Amina')).toThrow(/The EU count is for two EU countries: Kenya and Tanzania are not/);
    borders.set({ from: 'NL', to: 'BG', cabotage: 'eu' }, 'Amina');
    const load = { pickupCountry: 'BG', destCountry: 'BG', weightKg: 900 };
    expect(borders.refusalsFor(load, 'NL', () => [], t0)).toEqual([{ code: 'CABOTAGE_NOT_PERMITTED', message: expect.stringMatching(/has none/) }]);
    expect(borders.refusalsFor(load, 'NL', () => [into(t0)], t0 + DAY)).toEqual([]);
    // A Bulgarian vehicle at home is asked nothing; nor is a load across the border.
    expect(borders.refusalsFor(load, 'BG', () => [], t0)).toEqual([]);
    expect(borders.refusalsFor({ pickupCountry: 'NL', destCountry: 'BG', weightKg: 900 }, 'NL', () => [], t0)).toEqual([]);
    // The vehicle's loads are read only where the rule is the EU count.
    let read = 0;
    borders.set({ from: 'NL', to: 'BG', cabotage: 'allowed' }, 'Amina');
    expect(borders.refusalsFor(load, 'NL', () => (read++, []), t0)).toEqual([]);
    expect(read).toBe(0);
  });
});
