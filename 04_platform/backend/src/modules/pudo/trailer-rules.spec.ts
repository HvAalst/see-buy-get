import { ownPlateRequired, payloadOf, towingRefusal, type TrailerSpec } from './trailer-rules';
import { withTrailer } from './fleet.service';
import type { Vehicle } from './fleet.types';

/**
 * 2026-11-13 — WHAT MAY BE TOWED, AND BY WHOM (the owner: "a trailer for VANs especially — movers use vans and trailers in cities";
 * plan D1–D5, "build as recommended"): what a trailer carries, when it shows its own registration, and the pairing each country's
 * licence allows — the Netherlands and Uganda as their rules say, elsewhere 750 kg on the ordinary licence until the law is confirmed.
 */
describe('a van towing a trailer', () => {
  const trailer = (over: Partial<TrailerSpec> = {}): TrailerSpec => ({ plate: 'WX-12-AB', maxKg: 750, emptyKg: 230, braked: false, closed: true, ramp: false, ...over });
  const van = (towLimits?: { brakedKg: number; unbrakedKg: number; grossKg?: number }) => ({ vehicleClass: 'van', plate: 'VAN-1', ...(towLimits ? { towLimits } : {}) });
  const refusal = (country: string, kinds: string[], v: ReturnType<typeof van>, t: TrailerSpec) => towingRefusal({ country, countryName: country, kinds, vehicle: v, trailer: t });

  it('carries its maximum less its own weight — never an assumed figure', () => {
    expect(payloadOf({ maxKg: 750, emptyKg: 380 })).toBe(370);
    expect(payloadOf({ maxKg: 2000, emptyKg: 650 })).toBe(1350);
  });

  it('shows its registration card where it has a plate of its own: the Netherlands above 750 kg, Kenya always', () => {
    expect(ownPlateRequired('NL', 750)).toBe(false);
    expect(ownPlateRequired('NL', 751)).toBe(true);
    expect(ownPlateRequired('KE', 500)).toBe(true);
    expect(ownPlateRequired('UG', 2000)).toBe(false);
  });

  it('only a car or a van tows; its own limits first; unbraked at most 750 kg; within what it may tow', () => {
    expect(towingRefusal({ country: 'NL', countryName: 'Netherlands', kinds: [], vehicle: { vehicleClass: 'bike', plate: 'B-1' }, trailer: trailer() })).toMatch(/towed by a car or a van/);
    expect(refusal('NL', [], van(), trailer())).toMatch(/Say what VAN-1 may tow first/);
    expect(refusal('NL', ['BE'], van({ brakedKg: 2500, unbrakedKg: 750 }), trailer({ maxKg: 900, braked: false }))).toMatch(/without brakes weighs at most 750 kg/);
    expect(refusal('NL', ['BE'], van({ brakedKg: 1500, unbrakedKg: 750 }), trailer({ maxKg: 2000, braked: true }))).toMatch(/VAN-1 may tow 1500 kg braked/);
    expect(refusal('NL', [], van({ brakedKg: 2500, unbrakedKg: 500 }), trailer({ maxKg: 600 }))).toMatch(/may tow 500 kg unbraked/);
  });

  it('the Netherlands: 750 kg on B; heavier while the pair stays at 3,500 kg; B96 to 4,250 kg; BE a trailer to 3,500 kg', () => {
    const limits = { brakedKg: 3500, unbrakedKg: 750 };
    expect(refusal('NL', [], van({ ...limits, grossKg: 3500 }), trailer({ maxKg: 750 }))).toBeUndefined();
    expect(refusal('NL', [], van({ ...limits, grossKg: 2500 }), trailer({ maxKg: 1000, braked: true }))).toBeUndefined();
    // A full-size van: 3,500 + 1,000 needs BE; B96 does not reach.
    expect(refusal('NL', ['B96'], van({ ...limits, grossKg: 3500 }), trailer({ maxKg: 1000, braked: true }))).toMatch(/needs BE on your licence$/);
    expect(refusal('NL', ['BE'], van({ ...limits, grossKg: 3500 }), trailer({ maxKg: 1000, braked: true }))).toBeUndefined();
    // A lighter van: 3,000 + 1,200 = 4,200 is B96's.
    expect(refusal('NL', [], van({ ...limits, grossKg: 3000 }), trailer({ maxKg: 1200, braked: true }))).toMatch(/needs BE, or B with code 96/);
    expect(refusal('NL', ['B96'], van({ ...limits, grossKg: 3000 }), trailer({ maxKg: 1200, braked: true }))).toBeUndefined();
    // Over 750 kg with the van's own weight unsaid: asked for.
    expect(refusal('NL', [], van(limits), trailer({ maxKg: 1000, braked: true }))).toMatch(/Say VAN-1's own maximum weight/);
  });

  it('Uganda: 750 kg on B, heavier on BE; Kenya and every other country: 750 kg, nothing heavier yet', () => {
    const limits = { brakedKg: 3500, unbrakedKg: 750 };
    expect(refusal('UG', [], van(limits), trailer({ maxKg: 750 }))).toBeUndefined();
    expect(refusal('UG', [], van(limits), trailer({ maxKg: 1500, braked: true }))).toMatch(/Uganda needs BE/);
    expect(refusal('UG', ['BE'], van(limits), trailer({ maxKg: 1500, braked: true }))).toBeUndefined();
    expect(refusal('KE', [], van(limits), trailer({ maxKg: 750 }))).toBeUndefined();
    expect(towingRefusal({ country: 'KE', countryName: 'Kenya', kinds: ['BE', 'E'], vehicle: van(limits), trailer: trailer({ maxKg: 1500, braked: true }) })).toMatch(/^In Kenya a car or van tows a trailer up to 750 kg on the ordinary licence/);
    expect(refusal('ET', ['E'], van(limits), trailer({ maxKg: 900, braked: true }))).toMatch(/up to 750 kg/);
  });

  it('with a trailer hitched the vehicle reads as the pair: what both carry and hold, its ramps, the rate while towing; its own record unchanged', () => {
    const v = { vehicleId: 'veh_1', vehicleClass: 'van', capacityKg: 900, volumeM3: 8, equipment: ['MAN'], pricePerKm: 40, pricePerKmWithTrailer: 55 } as unknown as Vehicle;
    const hitched = { ...trailer({ maxKg: 750, emptyKg: 380, volumeM3: 5.5, ramp: true }), payloadKg: 370, maxKmh: 90, hitchedAt: '2026-11-13T08:00:00Z' };
    expect(withTrailer(v, undefined)).toBe(v);
    expect(withTrailer(v, hitched)).toMatchObject({ capacityKg: 1270, volumeM3: 13.5, equipment: ['MAN', 'RMP'], pricePerKm: 55, towing: { maxKmh: 90, payloadKg: 370 } });
    expect(v).toMatchObject({ capacityKg: 900, volumeM3: 8, equipment: ['MAN'], pricePerKm: 40 });
    // A van whose load space is not known promises none with the trailer either; without a rate while towing, its own.
    const unknown = { ...v, volumeM3: undefined, pricePerKmWithTrailer: undefined } as unknown as Vehicle;
    expect(withTrailer(unknown, hitched).volumeM3).toBeUndefined();
    expect(withTrailer(unknown, hitched).pricePerKm).toBe(40);
  });
});
