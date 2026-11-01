import { SLOT_MAX_H, palletVehicleRefusal, slotOf, slotWords, truckFlightOf, truckFlightWords, volumeRefusal } from './air-terminal.types';

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

  it('takes a truck run as a flight with its waybill checked, and says it is carried under road law, the waybill a reference only (2026-11-01)', () => {
    const t = truckFlightOf({ awb: '706 1234 5675', flight: ' kq9301 ' });
    expect(t).toEqual({ awb: '706-12345675', flight: 'KQ9301', airline: 'Kenya Airways' });
    expect(truckFlightWords(t)).toBe('Moved for Kenya Airways under air waybill 706-12345675, flight KQ9301: carried as a road load under the law of the road. The air waybill is a reference only, and nobody on SeeBuyGet acts for the airline.');
    expect(() => truckFlightOf({ awb: '706-12345676', flight: 'KQ 9301' })).toThrow(/last digit does not check/);
    expect(() => truckFlightOf({ awb: '706-1234', flight: 'KQ 9301' })).toThrow(/eleven digits/);
    expect(() => truckFlightOf({ awb: '999-12345675', flight: 'XX 1' })).toThrow(/say which airline it is/);
    expect(truckFlightOf({ awb: '999-12345675', flight: 'xx 1', airline: ' Lake Air ' })).toEqual({ awb: '999-12345675', flight: 'XX 1', airline: 'Lake Air' });
    expect(() => truckFlightOf({ awb: '706-12345675', flight: 'by road' })).toThrow(/two-character code and its number/);
  });

  it('puts built-up airline pallets only on a truck with a roller floor (2026-11-01)', () => {
    expect(palletVehicleRefusal(undefined, { vehicleClass: 'truck' })).toBeUndefined();
    expect(palletVehicleRefusal(2, { vehicleClass: 'truck', equipment: ['ROL', 'TLT'] })).toBeUndefined();
    expect(palletVehicleRefusal(2, { vehicleClass: 'van', equipment: ['ROL'] })).toMatch(/^2 built-up airline pallets ride on a truck with a roller floor/);
    expect(palletVehicleRefusal(1, { vehicleClass: 'truck', equipment: ['FLT'] })).toBe('1 built-up airline pallet rides on a truck with a roller floor, which rolls it on and off at the terminal’s dock without breaking it down.');
  });

  it('refuses a load bigger than a declared load space — and says nothing where either figure is unknown (2026-11-01)', () => {
    expect(volumeRefusal(24, { volumeM3: 18 })).toBe('The load takes 24 m³ — 6 m³ more than your vehicle’s load space of 18 m³');
    expect(volumeRefusal(18, { volumeM3: 18 })).toBeUndefined();
    expect(volumeRefusal(24, {})).toBeUndefined();
    expect(volumeRefusal(undefined, { volumeM3: 10 })).toBeUndefined();
  });
});
