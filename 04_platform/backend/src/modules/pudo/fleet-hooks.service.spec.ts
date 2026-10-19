import { FleetHookService } from './fleet-hooks.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import type { EventBus } from '../../foundation/events/event-bus.service';
import type { DepartureService } from './departure.service';
import type { Departure } from './departure.types';
import type { DispatchService } from './dispatch.service';
import type { DriverService } from './driver.service';
import type { FleetManagerService } from './fleet-manager.service';
import type { FleetPlanService } from './fleet-plan.service';
import type { FleetService } from './fleet.service';
import type { VehicleBreakdownService } from './vehicle-breakdown.service';
import type { VehicleService } from './vehicle.service';

/**
 * A FLEET'S RUNS, TOLD TO ITS OWN SYSTEM WITHOUT THE MONEY (round 11). A run is the fleet's own price, settled between it
 * and the shipper; we never hold that money, so no message about a run carries a price — not the rate, not how it is
 * settled, not what a booking costs. Everything else its Runs screen reads about the run and the booking goes.
 */
describe('a fleet’s runs, told to its own system', () => {
  const fleetDid = 'did:glos:fleet-runs';
  const run = {
    departureId: 'dep_1',
    corridorId: 'cor_1',
    lineName: 'Mombasa – Nairobi',
    managerDid: fleetDid,
    company: 'Coast Lines',
    originZone: 'Mombasa',
    destZone: 'Nairobi',
    leavesAt: '2026-10-21T05:00:00.000Z',
    vehicleId: 'veh_1',
    plate: 'KDA 123T',
    vehicleClass: 'truck',
    capacityKg: 10_000,
    rate: { basis: 'per_kg', amount: 4.5, currency: 'KES' },
    settle: { method: 'mobile_money', when: 'on_delivery' },
    driverName: 'Otieno',
    status: 'open',
    createdAt: '2026-10-19T08:00:00.000Z',
    bookings: [
      { bookingId: 'bk_1', kind: 'sold', shipperDid: 'did:glos:shipper', bookedByName: 'Wanjiku', description: 'Tea, 40 cartons', weightKg: 800, nature: 'general', binds: 'weight', price: 3600, units: 800, at: '2026-10-19T09:00:00.000Z', status: 'booked', waiting: [] },
      { bookingId: 'bk_2', kind: 'sold', shipperDid: 'did:glos:other', description: 'Cement', weightKg: 2000, nature: 'general', binds: 'weight', price: 9000, units: 2000, at: '2026-10-19T09:30:00.000Z', status: 'cancelled', cancellation: { by: 'shipper', at: '2026-10-19T10:00:00.000Z' }, waiting: [] },
    ],
  } as unknown as Departure;

  function service(): FleetHookService {
    const events = { subscribe: jest.fn() } as unknown as EventBus;
    const departures = { forFleet: (did: string) => (did === fleetDid ? [run] : []) } as unknown as DepartureService;
    const managers = { get: () => ({ companyName: 'Coast Lines' }) } as unknown as FleetManagerService;
    return new FleetHookService(events, {} as DispatchService, {} as DriverService, managers, {} as FleetService, {} as VehicleService, {} as VehicleBreakdownService, departures, {} as FleetPlanService);
  }

  it('carries the run and the booking as the fleet reads them, and never a price', () => {
    const hooks = service();
    hooks.setAddress({ fleetDid, name: 'Amina Manager' }, 'https://tms.example.com/hooks');
    hooks.relayRun('run.booked', fleetDid, 'dep_1', 'bk_1');
    const [message] = hooks.view(fleetDid).messages;
    expect(message.event).toBe('run.booked');
    const data = (JSON.parse(message.body) as { data: { run: Record<string, unknown>; booking: Record<string, unknown> } }).data;
    expect(data.run).toMatchObject({ departureId: 'dep_1', lineName: 'Mombasa – Nairobi', plate: 'KDA 123T', capacityKg: 10_000, bookedKg: 800, status: 'open', driverName: 'Otieno' });
    expect(data.booking).toMatchObject({ bookingId: 'bk_1', description: 'Tea, 40 cartons', weightKg: 800, bookedByName: 'Wanjiku', status: 'booked' });
    for (const money of ['rate', 'settle', 'price', 'minCharge', 'waiting', 'cover']) {
      expect(data.run).not.toHaveProperty(money);
      expect(data.booking).not.toHaveProperty(money);
    }
    // The other shipper on the run is not named, and its goods are not described.
    expect(message.body).not.toContain('did:glos:other');
    expect(message.body).not.toContain('Cement');
    expect(message.body).not.toContain('did:glos:shipper');
  });

  it('tells nobody of a run that is not the fleet’s, nor a fleet that gave no address', () => {
    const hooks = service();
    hooks.relayRun('run.cancelled', fleetDid, 'dep_1');
    expect(hooks.view(fleetDid).messages).toEqual([]);
    hooks.setAddress({ fleetDid: 'did:glos:someone-else', name: 'X' }, 'https://x.example.com');
    hooks.relayRun('run.cancelled', 'did:glos:someone-else', 'dep_1');
    expect(hooks.view('did:glos:someone-else').messages).toEqual([]);
  });

  it('records which manager gave the address, made the secret and turned on positions', () => {
    const hooks = service();
    const first = hooks.setAddress({ fleetDid, name: 'Amina Manager' }, 'https://tms.example.com/hooks');
    expect(first).toMatchObject({ setBy: 'Amina Manager', secretTurnedBy: 'Amina Manager', secret: expect.stringMatching(/^whsec_/) });
    const changed = hooks.setAddress({ fleetDid, name: 'Baraka Manager' }, 'https://tms.example.com/v2');
    expect(changed).toMatchObject({ setBy: 'Baraka Manager', secretTurnedBy: 'Amina Manager' });
    expect(changed.secret).toBeUndefined();
    expect(hooks.turnSecret({ fleetDid, name: 'Chebet Manager' })).toMatchObject({ secretTurnedBy: 'Chebet Manager', setBy: 'Baraka Manager' });
    expect(hooks.setPositions({ fleetDid, name: 'Baraka Manager' }, 5).positions).toMatchObject({ everyMin: 5, setBy: 'Baraka Manager' });
    // Stopping the messages stops the positions with them.
    expect(hooks.setAddress({ fleetDid, name: 'Amina Manager' }, '').positions).toBeUndefined();
  });

  it('round 14 — tells the fleet’s system its driver said the load is at a border, with the step and never where the phone was', () => {
    const subscribed = new Map<string, (e: { payload: unknown }) => void>();
    const events = { subscribe: (topic: string, fn: (e: { payload: unknown }) => void) => subscribed.set(topic, fn) } as unknown as EventBus;
    const load = { freightId: 'frt_9', code: 'FRT-9', description: 'Bricks', claimedBy: 'did:glos:driver-1', status: 'in_transit', weightKg: 1200, pickupLabel: 'Jenga yard', destLabel: 'Kampala depot', createdAt: '2026-10-19T06:00:00.000Z' };
    const dispatch = { requireFreightPublic: () => load, carrierOf: () => fleetDid, ordersForFleet: () => [] } as unknown as DispatchService;
    const drivers = { get: () => ({ displayName: 'Otieno' }) } as unknown as DriverService;
    const managers = { get: () => ({ companyName: 'Coast Lines' }) } as unknown as FleetManagerService;
    const hooks = new FleetHookService(events, dispatch, drivers, managers, {} as FleetService, {} as VehicleService, {} as VehicleBreakdownService, { forFleet: () => [] } as unknown as DepartureService, {} as FleetPlanService);
    hooks.setAddress({ fleetDid, name: 'Amina Manager' }, 'https://tms.example.com/hooks');
    hooks.onModuleInit();
    hooks.onModuleDestroy();
    const passage = { kind: 'at_border', post: 'Malaba', at: '2026-10-19T13:40:00.000Z' };
    subscribed.get(GlosEvent.Pudo.FreightPassed)!({ payload: { freightId: 'frt_9', driverDid: 'did:glos:driver-1', passage } });
    const [message] = hooks.view(fleetDid).messages;
    expect(message.event).toBe('load.at_border');
    const data = (JSON.parse(message.body) as { data: { passage: unknown; load: Record<string, unknown> } }).data;
    expect(data.passage).toEqual(passage);
    expect(data.load).toMatchObject({ freightId: 'frt_9' });
    // Cleared and at a hub are their own events.
    subscribed.get(GlosEvent.Pudo.FreightPassed)!({ payload: { freightId: 'frt_9', passage: { kind: 'cleared_border', post: 'Malaba', at: '2026-10-19T16:40:00.000Z', waitedMin: 180 } } });
    subscribed.get(GlosEvent.Pudo.FreightPassed)!({ payload: { freightId: 'frt_9', passage: { kind: 'at_hub', hub: 'Kampala ICD', at: '2026-10-19T19:00:00.000Z' } } });
    expect(hooks.view(fleetDid).messages.map((m) => m.event).sort()).toEqual(['load.at_border', 'load.at_hub', 'load.border_cleared']);
  });
});
