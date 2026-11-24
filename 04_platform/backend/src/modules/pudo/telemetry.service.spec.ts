import { GlosEvent } from '../../foundation/events/glos-events';
import { insideRomania, kmFromRomania } from './romania-border';
import { TelemetryService } from './telemetry.service';

/*
 * 2026-11-24 — THE GPS WATCH OF RO e-TRANSPORT (the owner's brief, feature 4; the owner: "Watch, carrier transmits"): a run with
 * a UIT, or crossing countries, is watched; in Romania a silence of 15 minutes alerts; three readings outside end it.
 */
const T0 = Date.parse('2026-11-24T08:00:00Z');
const MIN = 60_000;
const BUCHAREST = { lat: 44.4268, lng: 26.1025 };
const ARAD = { lat: 46.1866, lng: 21.3123 };
const SZEGED = { lat: 46.253, lng: 20.1414 };
const RUSE = { lat: 43.8356, lng: 25.9657 };
const UTRECHT = { lat: 52.09, lng: 5.12 };

describe('Romania’s border', () => {
  it('tells towns in Romania from towns across its borders, the coast too', () => {
    for (const p of [BUCHAREST, ARAD, { lat: 43.9037, lng: 25.9699 }, { lat: 44.1598, lng: 28.6348 }, { lat: 44.25, lng: 28.62 }]) expect(insideRomania(p)).toBe(true);
    for (const p of [RUSE, SZEGED, { lat: 43.9962, lng: 22.8679 }, { lat: 47.0105, lng: 28.8638 }, UTRECHT]) expect(insideRomania(p)).toBe(false);
    expect(kmFromRomania(BUCHAREST)).toBe(0);
    expect(kmFromRomania(SZEGED)).toBeGreaterThan(10); // about 16 km, near the tripoint with Serbia
  });
});

function world() {
  const loads: Array<Record<string, unknown>> = [];
  const bags: Array<{ code: string; from?: string; to?: string }> = [];
  let onShift = true;
  const published: Array<[string, Record<string, unknown>]> = [];
  const dispatch = {
    loadsOnVehicle: () => loads.map((f) => ({ freightId: f.freightId, code: f.code, state: 'aboard', weightKg: 100 })),
    requireFreightPublic: (id: string) => loads.find((f) => f.freightId === id),
    bagsWith: () => bags.map((b) => ({ code: b.code, status: 'in_transit', weightKg: 5 })),
    bagFacts: (code: string) => {
      const b = bags.find((x) => x.code === code);
      return b ? { from: b.from, to: b.to, parcels: 1, weightKg: 5 } : undefined;
    },
  };
  const shift = { driverDid: 'did:drv', vehicleId: 'veh_1', startedAt: '2026-11-24T06:00:00.000Z', status: 'active' };
  const fleet = {
    activeForDriver: () => (onShift ? shift : undefined),
    vehicleForDriver: () => (onShift ? { vehicleId: 'veh_1', plate: 'NL-12-AB', managerDid: 'did:fleet', towing: { plate: 'WT-99-ZZ' } } : undefined),
    list: () => (onShift ? [shift] : []),
  };
  const vehicles = { list: (f: { managerDid?: string }) => (f.managerDid === 'did:fleet' ? [{ vehicleId: 'veh_1', plate: 'NL-12-AB', managerDid: 'did:fleet' }] : []) };
  const events = { publish: (topic: string, payload: Record<string, unknown>) => (published.push([topic, payload]), Promise.resolve()) };
  // 2026-11-24 — a hub's handover tells the watch (slice 4): the hook it registers, kept to call as a hub would.
  const released: Array<(driverDid: string) => void> = [];
  const transfers = { onRelease: (fn: (driverDid: string) => void) => released.push(fn) };
  const svc = new TelemetryService(dispatch as never, fleet as never, vehicles as never, events as never, transfers as never);
  return { svc, loads, bags, published, endShift: () => (onShift = false), topics: () => published.map(([t]) => t), release: (did: string) => released.forEach((fn) => fn(did)) };
}
const uitLoad = (over: Record<string, unknown> = {}) => ({ freightId: 'frt_1', code: 'FRT-1', pickupCountry: 'RO', destCountry: 'NL', fiscalCodes: [{ country: 'RO', kind: 'UIT', code: 'RO1234567890', validThrough: '2026-11-27' }], ...over });

describe('the GPS watch of a run', () => {
  it('watches nothing a vehicle carries inside one country, without a UIT', () => {
    const w = world();
    w.loads.push({ freightId: 'frt_9', code: 'FRT-9', pickupCountry: 'NL', destCountry: 'NL' });
    expect(w.svc.ping('did:drv', UTRECHT, 'DRIVER_APP_GPS', T0)).toBeUndefined();
    expect(w.svc.openFor('did:drv')).toBeUndefined();
  });

  it('opens a watch for a load with a UIT, keeps its codes and tells the fleet’s system', () => {
    const w = world();
    w.loads.push(uitLoad());
    const s = w.svc.ensure('did:drv', T0)!;
    expect(s).toMatchObject({ plate: 'NL-12-AB', trailerPlate: 'WT-99-ZZ', fleetDid: 'did:fleet', provider: 'DRIVER_APP_GPS', roStatus: 'PENDING_BORDER', uitCodes: [{ code: 'RO1234567890', freightId: 'frt_1', freightCode: 'FRT-1', validThrough: '2026-11-27' }] });
    expect(w.topics()).toEqual([GlosEvent.Pudo.TelematicsUitChanged]);
    // A second load with its own UIT taken on: the codes change and the fleet's system is told again; nothing changed, nothing told.
    w.loads.push(uitLoad({ freightId: 'frt_2', code: 'FRT-2', fiscalCodes: [{ country: 'RO', kind: 'UIT', code: 'RO5550001112', validThrough: '2026-11-28' }] }));
    expect(w.svc.ensure('did:drv', T0 + MIN)?.uitCodes.map((c) => c.code)).toEqual(['RO1234567890', 'RO5550001112']);
    w.svc.ensure('did:drv', T0 + 2 * MIN);
    expect(w.topics()).toEqual([GlosEvent.Pudo.TelematicsUitChanged, GlosEvent.Pudo.TelematicsUitChanged]);
    // …and a bag going between two countries is watched too: it may cross Romania.
    const b = world();
    b.bags.push({ code: 'BAG-1', from: 'NL', to: 'BG' });
    expect(b.svc.ensure('did:drv', T0)?.roStatus).toBe('PENDING_BORDER');
  });

  it('enters Romania on the first reading inside it; outside before, it waits at the border', () => {
    const w = world();
    w.loads.push(uitLoad({ pickupCountry: 'NL', destCountry: 'RO' }));
    expect(w.svc.ping('did:drv', SZEGED, 'DRIVER_APP_GPS', T0)?.roStatus).toBe('PENDING_BORDER');
    const s = w.svc.ping('did:drv', ARAD, 'DRIVER_APP_GPS', T0 + 30 * MIN)!;
    expect(s).toMatchObject({ roStatus: 'ACTIVE_IN_RO', enteredRoAt: new Date(T0 + 30 * MIN).toISOString(), lastCountry: 'RO', pings: 2 });
  });

  it('a silence of 15 minutes in Romania alerts once; the next reading ends it, kept as a gap', () => {
    const w = world();
    w.loads.push(uitLoad({ pickupCountry: 'NL', destCountry: 'RO' }));
    w.svc.ping('did:drv', ARAD, 'DRIVER_APP_GPS', T0);
    expect(w.svc.sweep(T0 + 14 * MIN).silent).toBe(0);
    expect(w.svc.sweep(T0 + 16 * MIN).silent).toBe(1);
    expect(w.svc.openFor('did:drv')).toMatchObject({ roStatus: 'SIGNAL_LOST', gaps: [{ from: new Date(T0).toISOString() }] });
    const lost = w.published.find(([t]) => t === GlosEvent.Pudo.TelematicsSignalLost)!;
    expect(lost[1]).toMatchObject({ minutes: 16, lastPoint: ARAD });
    expect(w.svc.sweep(T0 + 18 * MIN).silent).toBe(0);
    const back = w.svc.ping('did:drv', BUCHAREST, 'DRIVER_APP_GPS', T0 + 20 * MIN)!;
    expect(back).toMatchObject({ roStatus: 'ACTIVE_IN_RO', longestGapMin: 20, gaps: [{ from: new Date(T0).toISOString(), to: new Date(T0 + 20 * MIN).toISOString(), minutes: 20 }] });
    expect(w.topics()).toContain(GlosEvent.Pudo.TelematicsSignalBack);
    // Heard again just across the border (Ruse), a Romanian delivery still aboard: the silence is over there too.
    const r = world();
    r.loads.push(uitLoad({ pickupCountry: 'NL', destCountry: 'RO' }));
    r.svc.ping('did:drv', ARAD, 'DRIVER_APP_GPS', T0);
    r.svc.sweep(T0 + 16 * MIN);
    expect(r.svc.ping('did:drv', RUSE, 'DRIVER_APP_GPS', T0 + 20 * MIN)).toMatchObject({ roStatus: 'ACTIVE_IN_RO', outsideStreak: 1 });
    // Still on the way to Romania (Szeged), a silence is not RO e-Transport's: nothing rings.
    const h = world();
    h.loads.push(uitLoad({ pickupCountry: 'NL', destCountry: 'RO' }));
    h.svc.ping('did:drv', SZEGED, 'DRIVER_APP_GPS', T0);
    expect(h.svc.sweep(T0 + 40 * MIN).silent).toBe(0);
    expect(h.topics()).not.toContain(GlosEvent.Pudo.TelematicsSignalLost);
  });

  it('keeps a silence over ANAF’s 2 minutes as a gap, even one too short to alert', () => {
    const w = world();
    w.loads.push(uitLoad({ pickupCountry: 'NL', destCountry: 'RO' }));
    w.svc.ping('did:drv', ARAD, 'DRIVER_APP_GPS', T0);
    w.svc.ping('did:drv', ARAD, 'DRIVER_APP_GPS', T0 + MIN);
    const s = w.svc.ping('did:drv', ARAD, 'DRIVER_APP_GPS', T0 + 6 * MIN)!;
    expect(s.gaps).toEqual([{ from: new Date(T0 + MIN).toISOString(), to: new Date(T0 + 6 * MIN).toISOString(), minutes: 5 }]);
  });

  it('leaves Romania after three readings outside, with nothing left to deliver there; with a delivery in Romania aboard, not', () => {
    const w = world();
    w.loads.push(uitLoad());
    w.svc.ping('did:drv', BUCHAREST, 'DRIVER_APP_GPS', T0);
    w.svc.ping('did:drv', RUSE, 'DRIVER_APP_GPS', T0 + MIN);
    expect(w.svc.ping('did:drv', RUSE, 'DRIVER_APP_GPS', T0 + 2 * MIN)?.roStatus).toBe('ACTIVE_IN_RO');
    const out = w.svc.ping('did:drv', RUSE, 'DRIVER_APP_GPS', T0 + 3 * MIN)!;
    expect(out).toMatchObject({ roStatus: 'COMPLETED', closedBy: 'left_romania', leftRoAt: new Date(T0 + 3 * MIN).toISOString() });
    expect(w.topics()).toContain(GlosEvent.Pudo.TelematicsSessionClosed);
    const stay = world();
    stay.loads.push(uitLoad({ pickupCountry: 'NL', destCountry: 'RO' }));
    stay.svc.ping('did:drv', BUCHAREST, 'DRIVER_APP_GPS', T0);
    for (let i = 1; i <= 4; i++) stay.svc.ping('did:drv', RUSE, 'DRIVER_APP_GPS', T0 + i * MIN);
    expect(stay.svc.openFor('did:drv')?.roStatus).toBe('ACTIVE_IN_RO');
  });

  it('closes on a bag handed over at a hub across a border, once nothing aboard asks for it; with more aboard, not', () => {
    const w = world();
    w.bags.push({ code: 'BAG-1', from: 'NL', to: 'BG' }, { code: 'BAG-2', from: 'NL', to: 'BG' });
    w.svc.ping('did:drv', ARAD, 'DRIVER_APP_GPS', T0);
    w.bags.splice(0, 1);
    w.release('did:drv');
    expect(w.svc.openFor('did:drv')?.roStatus).toBe('ACTIVE_IN_RO');
    w.bags.splice(0, 1);
    w.release('did:drv');
    expect(w.svc.openFor('did:drv')).toBeUndefined();
    expect(w.published.filter(([t]) => t === GlosEvent.Pudo.TelematicsSessionClosed).map(([, p]) => (p.session as { closedBy?: string }).closedBy)).toEqual(['handed_over']);
  });

  it('closes when the shift ends, or when the cargo it watched is gone', () => {
    const w = world();
    w.loads.push(uitLoad());
    w.svc.ensure('did:drv', T0);
    w.endShift();
    expect(w.svc.sweep(T0 + MIN).closed).toBe(1);
    expect(w.svc.openFor('did:drv')).toBeUndefined();
    const d = world();
    d.loads.push(uitLoad({ pickupCountry: 'NL', destCountry: 'RO' }));
    d.svc.ping('did:drv', ARAD, 'DRIVER_APP_GPS', T0);
    d.loads.length = 0;
    d.svc.sweep(T0 + MIN);
    expect(d.svc.positions('did:drv').session).toMatchObject({ closedBy: 'delivered' });
  });

  it('the fleet’s system pulls the UIT codes of its own vehicle by plate, and pushes positions; nobody else does', () => {
    const w = world();
    w.loads.push(uitLoad({ pickupCountry: 'NL', destCountry: 'RO' }));
    expect(w.svc.activeUit('did:fleet', 'nl 12-ab', T0)).toMatchObject({ plate: 'NL-12-AB', roStatus: 'PENDING_BORDER', uitCodes: [{ code: 'RO1234567890' }] });
    expect(() => w.svc.activeUit('did:other', 'NL-12-AB', T0)).toThrow(/No vehicle of yours has the plate/);
    w.svc.setProvider('did:fleet', 'TRIMBLE');
    const r = w.svc.pushPings('did:fleet', { plate: 'NL-12-AB', pings: [{ ...ARAD, recordedAt: new Date(T0 + 2 * MIN).toISOString(), speedKmh: 72, heading: 95 }, { ...SZEGED, recordedAt: new Date(T0).toISOString() }] }, T0 + 3 * MIN);
    expect(r).toMatchObject({ kept: 2, roStatus: 'ACTIVE_IN_RO' });
    const out = w.svc.positions('did:drv');
    expect(out.positions.map((p) => [p.source, p.country, p.speedKmh])).toEqual([['TRIMBLE', undefined, undefined], ['TRIMBLE', 'RO', 72]]);
    expect(out.positions[1]).toMatchObject({ plate: 'NL-12-AB', trailerPlate: 'WT-99-ZZ', uitCodes: ['RO1234567890'] });
    expect(out.format).toBe('sbg-telemetry-1');
    expect(() => w.svc.pushPings('did:other', { sessionId: r.sessionId, pings: [ARAD] }, T0)).toThrow(/No watch of yours/);
    expect(() => w.svc.pushPings('did:fleet', { pings: [ARAD] }, T0)).toThrow(/Say which vehicle/);
    expect(() => w.svc.setProvider('did:fleet', 'NAVMAN')).toThrow(/one of DRIVER_APP_GPS/);
  });

  it('refuses a position from the future, or more than a day old, and one off the map', () => {
    const w = world();
    w.loads.push(uitLoad());
    expect(() => w.svc.ping('did:drv', { ...ARAD, recordedAt: new Date(T0 + 10 * MIN).toISOString() }, 'DRIVER_APP_GPS', T0)).toThrow(/in the future/);
    expect(() => w.svc.ping('did:drv', { ...ARAD, recordedAt: new Date(T0 - 2 * 24 * 60 * MIN).toISOString() }, 'DRIVER_APP_GPS', T0)).toThrow(/older than a day/);
    expect(() => w.svc.ping('did:drv', { lat: 95, lng: 0 }, 'DRIVER_APP_GPS', T0)).toThrow(/latitude between -90 and 90/);
  });

  it('tells the Driver app to send every minute in Romania or near it, and every few minutes far from it', () => {
    const w = world();
    w.loads.push(uitLoad({ pickupCountry: 'NL', destCountry: 'RO' }));
    w.svc.ensure('did:drv', T0);
    expect(w.svc.driverView('did:drv', UTRECHT)?.everyMinute).toBe(false);
    expect(w.svc.driverView('did:drv', SZEGED)?.everyMinute).toBe(true);
    w.svc.ping('did:drv', ARAD, 'DRIVER_APP_GPS', T0);
    expect(w.svc.driverView('did:drv', UTRECHT)).toMatchObject({ roStatus: 'ACTIVE_IN_RO', everyMinute: true });
  });

  it('deletes a closed watch’s positions after 90 days, keeping the watch itself', () => {
    const w = world();
    w.loads.push(uitLoad());
    w.svc.ping('did:drv', BUCHAREST, 'DRIVER_APP_GPS', T0);
    w.endShift();
    w.svc.sweep(T0 + MIN);
    expect(w.svc.sweep(T0 + 89 * 24 * 60 * MIN).deleted).toBe(0);
    expect(w.svc.sweep(T0 + 91 * 24 * 60 * MIN).deleted).toBe(1);
    expect(w.svc.positions('did:drv').positions).toEqual([]);
  });
});
