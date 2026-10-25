import 'reflect-metadata';
import { CallHandler, Controller, ExecutionContext, Get, Post } from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { STAFF_AREAS } from '../../foundation/auth/staff-areas.table';
import type { IntrospectionResult } from '../../foundation/auth/auth.types';
import { LIVE_GAP_MS, LiveListener, LiveService, LiveTopic } from './live.service';
import { LiveInterceptor, QUIET_WRITES } from './live.interceptor';
import { listenerOf } from './live.controller';
import { FleetHookService } from './fleet-hooks.service';
import { NotificationService } from './notification.service';
import { OutboxPushSender } from './push-sender';
import type { DepartureService } from './departure.service';
import type { DispatchService } from './dispatch.service';
import type { DriverService } from './driver.service';
import type { FleetManagerService } from './fleet-manager.service';
import type { FleetPlanService } from './fleet-plan.service';
import type { FleetService } from './fleet.service';
import type { VehicleBreakdownService } from './vehicle-breakdown.service';
import type { VehicleService } from './vehicle.service';

/**
 * ONE LIVE VIEW (the user, 2026-10-25: "Console and fleet offices"). The console and a fleet office are told the moment
 * something they show may have changed — by name only, each fleet only of its own, at most once every LIVE_GAP_MS.
 */

function heard(live: LiveService, who: LiveListener): { got: LiveTopic[][]; close: () => void } {
  const got: LiveTopic[][] = [];
  const close = live.open(who, (topics) => got.push(topics));
  return { got, close };
}

const CONSOLE: LiveListener = { kind: 'console' };
const fleet = (fleetDid: string): LiveListener => ({ kind: 'fleet', fleetDid });

describe('the live view: who is told what', () => {
  it('tells the console of a change, and each fleet office only of its own', () => {
    const live = new LiveService();
    const desk = heard(live, CONSOLE);
    const kilima = heard(live, fleet('did:glos:kilima'));
    const pwani = heard(live, fleet('did:glos:pwani'));

    live.toConsole('changed');
    expect(desk.got).toEqual([['changed']]);
    expect(kilima.got).toEqual([]);
    expect(pwani.got).toEqual([]);

    live.toFleet('did:glos:kilima', 'orders');
    expect(kilima.got).toEqual([['orders']]);
    expect(pwani.got).toEqual([]);
    expect(desk.got).toHaveLength(1);

    // A notice in a fleet's bell is kept under the fleet's own did: that office hears it.
    live.toOwner('did:glos:pwani');
    expect(pwani.got).toEqual([['bell']]);
    expect(kilima.got).toHaveLength(1);

    // Nobody named, nobody told.
    live.toFleet(undefined, 'orders');
    live.toOwner(undefined);
    expect([desk.got.length, kilima.got.length, pwani.got.length]).toEqual([1, 1, 1]);
    expect(live.count()).toEqual({ console: 1, fleets: 2 });
  });

  it('says at once what changes after a quiet while, and gathers what changes in between into one message', () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(1_000_000);
      const live = new LiveService();
      const office = heard(live, fleet('did:glos:kilima'));

      live.toFleet('did:glos:kilima', 'orders');
      expect(office.got).toEqual([['orders']]); // the first goes at once

      live.toFleet('did:glos:kilima', 'map');
      live.toFleet('did:glos:kilima', 'plan');
      live.toFleet('did:glos:kilima', 'map');
      expect(office.got).toHaveLength(1); // inside the gap: waiting
      jest.advanceTimersByTime(LIVE_GAP_MS - 1);
      expect(office.got).toHaveLength(1);
      jest.advanceTimersByTime(1);
      expect(office.got).toEqual([['orders'], ['map', 'plan']]); // one message, each name once

      // After a quiet while the next goes at once again.
      jest.advanceTimersByTime(5 * LIVE_GAP_MS);
      live.toOwner('did:glos:kilima');
      expect(office.got).toEqual([['orders'], ['map', 'plan'], ['bell']]);
    } finally {
      jest.useRealTimers();
    }
  });

  it('stops telling a screen that closed — even one with a message due — and one that fails holds up nobody', () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(2_000_000);
      const live = new LiveService();
      const gone = heard(live, CONSOLE);
      live.toConsole('changed');
      live.toConsole('changed'); // due after the gap
      gone.close();
      jest.advanceTimersByTime(LIVE_GAP_MS * 2);
      expect(gone.got).toEqual([['changed']]);

      live.open(CONSOLE, () => {
        throw new Error('the connection went away mid-message');
      });
      const still = heard(live, CONSOLE);
      live.toConsole('changed');
      expect(still.got).toEqual([['changed']]);
      expect(live.count()).toEqual({ console: 2, fleets: 0 });
    } finally {
      jest.useRealTimers();
    }
  });

  it('hears every event the network publishes — except a phone saying where it is — until it stops', async () => {
    const bus = new EventBus();
    const live = new LiveService(bus);
    live.onModuleInit();
    const desk = heard(live, CONSOLE);
    await bus.publish(GlosEvent.Pudo.DriverMoved, { driverDid: 'did:glos:amos', location: { lat: -1.28, lng: 36.82 } });
    expect(desk.got).toEqual([]);
    await bus.publish(GlosEvent.Pudo.OrderPlaced, { freightId: 'frt_1' });
    expect(desk.got).toEqual([['changed']]);
    live.onModuleDestroy();
    const after = heard(live, CONSOLE);
    await bus.publish(GlosEvent.Pudo.OrderPlaced, { freightId: 'frt_2' });
    expect(after.got).toEqual([]);
  });

  it('listens as the console for staff and our companies’ administrators, as its own fleet for a fleet office, and for nobody else', () => {
    expect(listenerOf({ active: true, role: 'operator' })).toEqual({ kind: 'console' });
    expect(listenerOf({ active: true, role: 'entity_admin', tenant: 'ent_ke' })).toEqual({ kind: 'console' });
    expect(listenerOf({ active: true, role: 'fleet_manager', did: 'did:glos:kilima', tenant: 'did:glos:kilima' })).toEqual({ kind: 'fleet', fleetDid: 'did:glos:kilima' });
    for (const actor of [
      { active: true, role: 'fleet_manager' }, // no fleet on the sign-in
      { active: true, role: 'driver', tenant: 'did:glos:kilima' }, // its driver: a phone, on push
      { active: true, role: 'business', tenant: 'ent_biz' },
      { active: true, role: 'agent' },
      undefined,
    ] as Array<IntrospectionResult | undefined>) {
      expect(() => listenerOf(actor)).toThrow(/console and fleet offices/);
    }
  });
});

/* A few doors as the application has them, for the interceptor to read the route of. */
@Controller('sbg')
class Doors {
  @Post('fleet/managers/:did/roster')
  roster(): void {}

  @Post('fleet/drivers/:did/locate')
  locate(): void {}

  @Get('fleet/managers/:did/roster')
  read(): void {}
}

function contextOf(method: string, handler: (...args: never[]) => unknown, auth?: Partial<IntrospectionResult>): ExecutionContext {
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => ({ method, auth: auth ? { active: true, ...auth } : undefined }) }),
    getHandler: () => handler,
    getClass: () => Doors,
  } as unknown as ExecutionContext;
}

describe('the live view: a write anybody makes', () => {
  const answered: CallHandler = { handle: () => of({ ok: true }) };
  const refused: CallHandler = { handle: () => throwError(() => new Error('refused')) };

  function setUp() {
    const live = new LiveService();
    return { live, interceptor: new LiveInterceptor(live), desk: heard(live, CONSOLE), kilima: heard(live, fleet('did:glos:kilima')), pwani: heard(live, fleet('did:glos:pwani')) };
  }

  it('once answered, tells the console — and the fleet office of whoever acts for that fleet', async () => {
    const byDriver = setUp();
    await lastValueFrom(byDriver.interceptor.intercept(contextOf('POST', Doors.prototype.roster, { role: 'driver', did: 'did:glos:amos', tenant: 'did:glos:kilima' }), answered));
    expect(byDriver.desk.got).toEqual([['changed']]);
    expect(byDriver.kilima.got).toEqual([['changed']]);
    expect(byDriver.pwani.got).toEqual([]);

    const byOffice = setUp();
    await lastValueFrom(byOffice.interceptor.intercept(contextOf('POST', Doors.prototype.roster, { role: 'fleet_manager', did: 'did:glos:pwani', tenant: 'did:glos:pwani' }), answered));
    expect(byOffice.pwani.got).toEqual([['changed']]);
    expect(byOffice.kilima.got).toEqual([]);

    // Staff, a business, a company's administrator, a courier in no fleet: the console hears; no fleet office does —
    // not even one whose did their sign-in's tenant happens to read: only a fleet's own people act for a fleet.
    for (const auth of [{ role: 'operator' as const }, { role: 'business' as const, tenant: 'did:glos:kilima' }, { role: 'entity_admin' as const, tenant: 'did:glos:pwani' }, { role: 'driver' as const, did: 'did:glos:courier' }, undefined]) {
      const other = setUp();
      await lastValueFrom(other.interceptor.intercept(contextOf('POST', Doors.prototype.roster, auth), answered));
      expect(other.desk.got).toEqual([['changed']]);
      expect([other.kilima.got, other.pwani.got]).toEqual([[], []]);
    }
  });

  it('says nothing for a read, a refused write, or a phone saying where it is', async () => {
    const s = setUp();
    const driver = { role: 'driver' as const, did: 'did:glos:amos', tenant: 'did:glos:kilima' };
    await lastValueFrom(s.interceptor.intercept(contextOf('GET', Doors.prototype.read, driver), answered));
    await lastValueFrom(s.interceptor.intercept(contextOf('POST', Doors.prototype.locate, driver), answered));
    await expect(lastValueFrom(s.interceptor.intercept(contextOf('POST', Doors.prototype.roster, driver), refused))).rejects.toThrow('refused');
    expect([s.desk.got, s.kilima.got]).toEqual([[], []]);
  });

  it('names its quiet writes as routes the application has', () => {
    expect(QUIET_WRITES.length).toBeGreaterThan(0);
    for (const key of QUIET_WRITES) expect(STAFF_AREAS[key]).toBeDefined();
  });
});

describe('the live view: a fleet office’s bell', () => {
  it('moves when a notice arrives and when one is read, and not when there was nothing to read', async () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(3_000_000);
      const live = new LiveService();
      const bells = new NotificationService(new OutboxPushSender(), undefined, live);
      const kilima = heard(live, fleet('did:glos:kilima-bell'));
      const pwani = heard(live, fleet('did:glos:pwani-bell'));

      const notice = await bells.notify('did:glos:kilima-bell', { kind: 'order_late', title: 'An order running late', body: 'Jenga Ltd, bricks' });
      expect(kilima.got).toEqual([['bell']]);
      jest.advanceTimersByTime(LIVE_GAP_MS);
      bells.markRead('did:glos:kilima-bell', notice.id, 'Amina');
      jest.advanceTimersByTime(LIVE_GAP_MS);
      expect(kilima.got).toEqual([['bell'], ['bell']]);
      bells.markAllRead('did:glos:kilima-bell', 'Amina'); // nothing left unread
      bells.markRead('did:glos:pwani-bell', notice.id, 'Pwani'); // not theirs: nothing happens
      jest.advanceTimersByTime(LIVE_GAP_MS);
      expect(kilima.got).toHaveLength(2);
      expect(pwani.got).toEqual([]);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('the live view: what a fleet’s own screens show', () => {
  const KILIMA = 'did:glos:kilima-hooks';
  const PWANI = 'did:glos:pwani-hooks';

  /** A fleet hook service with NO address set for anybody: its screens hear it all the same. */
  function setUp(stubs: { onShift?: boolean } = {}) {
    const live = new LiveService();
    const events = { subscribe: jest.fn() } as unknown as EventBus;
    const load = { freightId: 'frt_7', code: 'FRT-7', contract: { fleetDid: KILIMA }, status: 'in_transit' };
    const dispatch = { requireFreightPublic: () => load, carrierOf: () => KILIMA, ordersForFleet: () => [] } as unknown as DispatchService;
    const drivers = { get: () => ({ displayName: 'Amos', managerDid: KILIMA }) } as unknown as DriverService;
    const managers = { get: () => ({ companyName: 'Kilima' }) } as unknown as FleetManagerService;
    const fleetService = { activeForDriver: () => (stubs.onShift ? { vehicleId: 'veh_1' } : undefined) } as unknown as FleetService;
    const vehicles = { get: () => ({ plate: 'KDA 1', managerDid: KILIMA }) } as unknown as VehicleService;
    const breakdowns = { viewOf: () => ({ breakdownId: 'bd_1', vehicleId: 'veh_1' }) } as unknown as VehicleBreakdownService;
    const departures = { forFleet: (did: string) => (did === KILIMA ? [{ departureId: 'dep_1', bookings: [] }] : []) } as unknown as DepartureService;
    // A plan is read only to be SENT: with no address, nothing may ask for it.
    const plans = { state: () => { throw new Error('no address: the plan is not read'); } } as unknown as FleetPlanService;
    const hooks = new FleetHookService(events, dispatch, drivers, managers, fleetService, vehicles, breakdowns, departures, plans, undefined, undefined, undefined, live);
    return { hooks, kilima: heard(live, fleet(KILIMA)), pwani: heard(live, fleet(PWANI)) };
  }

  it('tells its office of each step its own screens show, with no address set, and sends nothing anywhere', () => {
    const steps: Array<[(h: FleetHookService) => void, LiveTopic]> = [
      [(h) => h.relayPlan(KILIMA, '2026-10-26'), 'plan'],
      [(h) => h.relayRun('run.booked', KILIMA, 'dep_1'), 'runs'],
      [(h) => h.relayBreakdown('vehicle.broke_down', KILIMA, 'bd_1'), 'vehicles'],
      [(h) => h.relayLoad('load.picked_up', 'frt_7'), 'loads'],
      [(h) => h.syncOrders(['frt_7']), 'orders'],
    ];
    for (const [step, topic] of steps) {
      const s = setUp();
      step(s.hooks);
      expect(s.kilima.got).toEqual([[topic]]);
      expect(s.pwani.got).toEqual([]);
      expect(s.hooks.view(KILIMA).messages).toEqual([]);
    }
  });

  it('never tells an office of another fleet’s run or vehicle', () => {
    const s = setUp();
    s.hooks.relayRun('run.booked', PWANI, 'dep_1'); // not a run of Pwani's
    s.hooks.relayBreakdown('vehicle.broke_down', PWANI, 'bd_1'); // the vehicle is Kilima's
    expect([s.kilima.got, s.pwani.got]).toEqual([[], []]);
  });

  it('moves its map with a vehicle on a shift, and not with a phone off one', () => {
    const on = setUp({ onShift: true });
    on.hooks.queuePosition('did:glos:amos', { lat: -1.28, lng: 36.82 });
    expect(on.kilima.got).toEqual([['map']]);
    const off = setUp({ onShift: false });
    off.hooks.queuePosition('did:glos:amos', { lat: -1.28, lng: 36.82 });
    expect(off.kilima.got).toEqual([]);
  });
});
