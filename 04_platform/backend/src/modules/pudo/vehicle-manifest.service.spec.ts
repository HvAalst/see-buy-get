import { VehicleManifestService, loadsAboard } from './vehicle-manifest.service';

/*
 * 2026-11-24 — THE MASTER MANIFEST (the owner's brief, feature 3): everything aboard one vehicle on a shift, its totals and
 * crossings, and what wants a look; for the driver, the office and the fleet's own system, as JSON or CSV.
 */
const NOW = Date.parse('2026-11-24T12:00:00Z');
const roLoad = {
  freightId: 'frt_1', code: 'FRT-1', pickupLabel: 'Bucharest yard', destLabel: 'Venlo depot', pickupCountry: 'RO', destCountry: 'NL', weightKg: 800, packages: 4,
  declaredValue: { amount: 3_000, currency: 'EUR' },
  fiscalCodes: [{ country: 'RO', kind: 'UIT', code: 'RO1234567890', from: '2026-11-20', validThrough: '2026-11-24', saidAt: '2026-11-20T08:00:00.000Z' }],
};
const bgLoad = { freightId: 'frt_2', code: 'FRT-2', pickupLabel: 'Utrecht', destLabel: 'Sofia', pickupCountry: 'NL', destCountry: 'BG', weightKg: 120 };
const deLoad = { freightId: 'frt_3', code: 'FRT-3', pickupLabel: 'Utrecht', destLabel: 'Köln', pickupCountry: 'NL', destCountry: 'DE', weightKg: 900, declaredValue: { amount: 50_000, currency: 'EUR' } };
const oddLoad = { freightId: 'frt_4', code: 'FRT-4', pickupLabel: 'Utrecht', destLabel: 'Köln', pickupCountry: 'NL', destCountry: 'DE', weightKg: 10, declaredValue: { amount: 100, currency: 'XYZ' } };
const freights: Record<string, unknown> = { frt_1: roLoad, frt_2: bgLoad, frt_3: deLoad, frt_4: oddLoad };
function service(over: { onShift?: boolean; loads?: string[] } = {}) {
  const dispatch = {
    loadsOnVehicle: () => (over.loads ? over.loads.map((id) => ({ freightId: id, code: (freights[id] as { code: string }).code, state: 'aboard', weightKg: (freights[id] as { weightKg: number }).weightKg })) : [{ freightId: 'frt_1', code: 'FRT-1', state: 'aboard', weightKg: 800 }, { freightId: 'frt_2', code: 'FRT-2', state: 'to_collect', weightKg: 120 }]),
    bagsWith: () => [{ code: 'BAG-7', status: 'in_transit', weightKg: 12.34 }],
    requireFreightPublic: (id: string) => freights[id],
    bagFacts: () => ({ fromLabel: 'Grachten Winkel', from: 'NL', toLabel: 'Sofia Central Hub', to: 'BG', parcels: 3, weightKg: 12.34 }),
  };
  const shift = { startedAt: '2026-11-24T06:00:00.000Z', vehicleId: 'veh_1', driverDid: 'did:drv' };
  const fleet = {
    activeForDriver: () => (over.onShift === false ? undefined : shift),
    vehicleForDriver: () => ({ vehicleId: 'veh_1', plate: 'NL-12-AB', managerDid: 'did:fleet', towing: { plate: 'WT-99-ZZ' } }),
    list: () => (over.onShift === false ? [] : [shift]),
  };
  const drivers = { get: () => ({ displayName: 'Piet', badgeId: 'badge_1' }) };
  const departures = { bookingsAboard: () => [{ departureId: 'dep_1', bookingId: 'bk_1', lineName: 'Venlo – Sofia', description: 'Tiles, 2 pallets', weightKg: 900 }] };
  const vehicles = { list: (f: { managerDid?: string }) => (f.managerDid === 'did:fleet' ? [{ vehicleId: 'veh_1', plate: 'NL-12-AB', managerDid: 'did:fleet' }] : []) };
  const passages = { of: (id: string) => (id === 'frt_1' ? [{ kind: 'at_border', post: 'Nădlac', from: 'HU', to: 'RO', at: '2026-11-24T10:00:00.000Z' }] : []) };
  const fx = {
    convert: (amount: number, from: string) => {
      if (from === 'XYZ') throw new Error('no rate');
      return amount * 5;
    },
  };
  return new VehicleManifestService(dispatch as never, fleet as never, drivers as never, departures as never, vehicles as never, undefined, passages as never, fx as never);
}

describe('the master manifest of a vehicle on a shift', () => {
  it('lists everything aboard or to collect, with its plates, driver and shift', () => {
    const m = service().forDriver('did:drv', NOW);
    expect(m).toMatchObject({ manifestId: 'man_veh_1_20261124060000', vehicleId: 'veh_1', truckPlate: 'NL-12-AB', trailerPlate: 'WT-99-ZZ', driverDid: 'did:drv', driverName: 'Piet', fleetDid: 'did:fleet', shiftStartedAt: '2026-11-24T06:00:00.000Z' });
    expect(m.items.map((i) => [i.kind, i.label, i.state])).toEqual([
      ['freight', 'FRT-1', 'aboard'],
      ['freight', 'FRT-2', 'to_collect'],
      ['booking', 'Tiles, 2 pallets', 'aboard'],
      ['bag', 'BAG-7', 'aboard'],
    ]);
    expect(m.items[3]).toMatchObject({ from: 'Grachten Winkel', to: 'Sofia Central Hub', pickupCountry: 'NL', destCountry: 'BG', parcels: 3, weightKg: 12.3 });
  });

  it('adds up the weight and the declared value, in its own money and in lei', () => {
    const m = service().forDriver('did:drv', NOW);
    expect(m.totalWeightKg).toBe(1832.3);
    expect(m.totalValue).toEqual([{ amount: 3_000, currency: 'EUR' }]);
    expect(m.totalValueRon).toBe(15_000);
    expect(m.items[0]).toMatchObject({ declaredValue: { amount: 3_000, currency: 'EUR' }, valueRon: 15_000 });
  });

  it('flags what wants a look: Romania’s 500 kg and RON 10,000, a code running out, a code missing', () => {
    const m = service().forDriver('did:drv', NOW);
    expect(m.items[0].flags).toEqual(['over_500kg', 'over_ron_10000', 'code_expiring']);
    expect(m.items[0].fiscalCodes).toEqual([expect.objectContaining({ code: 'RO1234567890', status: 'expiring_soon' })]);
    expect(m.items[1].flags).toEqual(['missing_code']);
    expect(m.flagged).toBe(2);
    // A code past its end.
    expect(service().forDriver('did:drv', Date.parse('2026-11-26T12:00:00Z')).items[0].flags).toContain('code_expired');
  });

  it('flags Romania’s 500 kg and RON 10,000 only on a load taken over or delivered in Romania', () => {
    const m = service({ loads: ['frt_3'] }).forDriver('did:drv', NOW);
    expect(m.items[0]).toMatchObject({ label: 'FRT-3', weightKg: 900, valueRon: 250_000, flags: [] });
  });

  it('leaves the total in lei out where a value has no rate, and keeps each currency’s own total', () => {
    const m = service({ loads: ['frt_3', 'frt_4'] }).forDriver('did:drv', NOW);
    expect(m.totalValue).toEqual([{ amount: 50_000, currency: 'EUR' }, { amount: 100, currency: 'XYZ' }]);
    expect(m.totalValueRon).toBeUndefined();
    expect(m.items[1].valueRon).toBeUndefined();
  });

  it('lists the crossings its loads passed, as their drivers said them', () => {
    expect(service().forDriver('did:drv', NOW).crossings).toEqual([{ freightCode: 'FRT-1', kind: 'at_border', post: 'Nădlac', from: 'HU', to: 'RO', at: '2026-11-24T10:00:00.000Z' }]);
  });

  it('is the office’s by its vehicle and its system’s by plate, never another fleet’s; a vehicle on no shift has none', () => {
    expect(service().forVehicle('did:fleet', 'veh_1', NOW).truckPlate).toBe('NL-12-AB');
    expect(service().forPlate('did:fleet', 'nl 12-ab', NOW).vehicleId).toBe('veh_1');
    expect(() => service().forVehicle('did:other', 'veh_1', NOW)).toThrow(/Vehicle not found/);
    expect(() => service().forPlate('did:other', 'NL-12-AB', NOW)).toThrow(/No vehicle of yours has the plate NL-12-AB/);
    expect(() => service({ onShift: false }).forPlate('did:fleet', 'NL-12-AB', NOW)).toThrow(/NL-12-AB is on no shift now/);
    expect(() => service({ onShift: false }).forDriver('did:drv', NOW)).toThrow(/on no vehicle now/);
  });

  it('as CSV: one row a thing aboard, each with the plates, its codes, its flags and its crossings', () => {
    const svc = service();
    const lines = svc.csv(svc.forDriver('did:drv', NOW)).trim().split(/\r?\n/);
    expect(lines[0]).toBe('manifest_id,truck_plate,trailer_plate,driver,kind,ref,label,state,from,to,pickup_country,dest_country,weight_kg,declared_value,currency,value_ron,ro_uit,ro_uit_valid_through,ro_exempt,bg_utn,bg_utn_valid_through,bg_exempt,flags,border_crossings');
    expect(lines).toHaveLength(5);
    expect(lines[1]).toContain('man_veh_1_20261124060000,NL-12-AB,WT-99-ZZ,Piet,freight,frt_1,FRT-1,aboard');
    expect(lines[1]).toContain('RO1234567890,2026-11-24');
    expect(lines[1]).toContain('over_500kg over_ron_10000 code_expiring');
    expect(lines[1]).toContain('at_border Nădlac 2026-11-24T10:00:00.000Z');
  });

  it('reads the vehicle as the breakdown take-over does: one list for both', () => {
    const aboard = loadsAboard({ dispatch: { loadsOnVehicle: () => [], bagsWith: () => [] } as never, departures: { bookingsAboard: () => [] } as never, parcels: { onBusWith: () => [{ parcelId: 'PUD-1', weightKg: 2 }] } as never, drivers: { get: () => ({ badgeId: 'b' }) } as never }, { vehicleId: 'veh_1' }, 'did:drv');
    expect(aboard).toEqual([{ kind: 'parcel', id: 'PUD-1', label: 'PUD-1', state: 'aboard', weightKg: 2 }]);
  });
});
