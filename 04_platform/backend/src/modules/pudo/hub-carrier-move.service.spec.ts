import { HubCarrierMoveService } from './hub-carrier-move.service';
import { HubCarrierService } from './hub-carrier.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import type { MdpService } from './mdp.service';
import type { FleetService } from './fleet.service';
import type { DispatchService } from './dispatch.service';
import type { EventBus } from '../../foundation/events/event-bus.service';
import type { DriverService } from './driver.service';
import type { NotificationService } from './notification.service';

/**
 * A HUB'S CARRIERS ON A MOVE BETWEEN HUBS (the user, 2026-10-27, D11): "Back with the driver, or abandoned or select separate
 * return trip"; the return trip "Post it as a job". The owner says the way back as they go; the other hub does it and says so;
 * a return job delivered at the owner brings them home.
 */
describe('a hub’s carriers between hubs', () => {
  const HUBS: Record<string, { mdpId: string; did: string; name: string; location: { lat: number; lng: number } }> = {
    mdp_a: { mdpId: 'mdp_a', did: 'did:hub:a', name: 'Ghala A', location: { lat: -1.3, lng: 36.8 } },
    mdp_b: { mdpId: 'mdp_b', did: 'did:hub:b', name: 'Ghala B', location: { lat: -0.1, lng: 34.75 } },
  };
  const make = () => {
    const mdps = {
      require: (id: string) => {
        if (!HUBS[id]) throw new Error('not found');
        return HUBS[id];
      },
      countryOf: () => 'KE',
    } as unknown as MdpService;
    const carriers = new HubCarrierService(mdps);
    carriers.set('mdp_a', [{ kind: 'cage', name: 'Blue roll cage', lengthCm: 80, widthCm: 70, heightCm: 170, maxKg: 500, emptyKg: 35 }], 'Grace');
    const cageId = carriers.of('mdp_a')[0].carrierId;
    const fleet = { resolveBadge: (b: string) => (b === 'PASS-1' ? { driverDid: 'did:drv:kamau' } : undefined) } as unknown as FleetService;
    const posted: Array<Record<string, unknown>> = [];
    const dispatch = {
      registerFreight: (input: Record<string, unknown>) => {
        posted.push(input);
        return { freightId: 'frt_job', code: 'FRT-0101' };
      },
      requireFreightPublic: () => ({ status: 'available' }),
    } as unknown as DispatchService;
    const handlers: Record<string, (e: { payload: Record<string, unknown> }) => void> = {};
    const events = { subscribe: (type: string, fn: (e: { payload: Record<string, unknown> }) => void) => (handlers[type] = fn) } as unknown as EventBus;
    const drivers = { get: () => ({ displayName: 'Kamau' }) } as unknown as DriverService;
    const told: Array<{ did: string; title: string; body: string }> = [];
    const notifications = { notify: async (did: string, p: { title: string; body: string }) => told.push({ did, title: p.title, body: p.body }) } as unknown as NotificationService;
    const service = new HubCarrierMoveService(carriers, mdps, fleet, dispatch, events, drivers, notifications);
    service.onModuleInit();
    return { service, cageId, posted, handlers, told };
  };
  const T0 = Date.parse('2026-10-27T08:00:00Z');

  it('sends them with a driver to another hub, with the way back said — every check before anything is written', () => {
    const { service, cageId, told } = make();
    const go = (over: Record<string, unknown>) => service.send('mdp_a', { carrierId: cageId, count: 2, toMdpId: 'mdp_b', driverBadgeId: 'PASS-1', wayBack: 'with_driver', ...over } as never, 'Grace', T0);
    expect(() => go({ carrierId: 'hc_none' })).toThrow(/not on your list/);
    expect(() => go({ count: 0 })).toThrow(/from 1 to 50/);
    expect(() => go({ toMdpId: 'mdp_a' })).toThrow(/another hub/);
    expect(() => go({ toMdpId: 'mdp_x' })).toThrow(/That hub is not known/);
    expect(() => go({ driverBadgeId: 'PASS-9' })).toThrow(/a driver on shift/);
    expect(() => go({ wayBack: 'swap' })).toThrow(/how they come back/);
    expect(service.viewOf('mdp_a').away).toEqual([]);
    const m = go({});
    expect(m).toMatchObject({ ownerName: 'Ghala A', toName: 'Ghala B', carrierName: 'Blue roll cage', count: 2, driverName: 'Kamau', wayBack: 'with_driver', state: 'on_the_way' });
    // The other hub is told what comes and what it is to do with it.
    expect(told).toEqual([expect.objectContaining({ did: 'did:hub:b', body: 'Ghala A sends 2 × Blue roll cage with Kamau: they go back with the driver who brings them.' })]);
    expect(service.viewOf('mdp_b').here.map((x) => x.moveId)).toEqual([m.moveId]);
  });

  it('back with the driver: the other hub counts them out — never more than came, once — and the owner hears of any short', () => {
    const { service, cageId, told } = make();
    const m = service.send('mdp_a', { carrierId: cageId, count: 2, toMdpId: 'mdp_b', driverBadgeId: 'PASS-1', wayBack: 'with_driver' }, 'Grace', T0);
    expect(() => service.done('mdp_a', m.moveId, 2, 'Amos', T0)).toThrow(/did not come to this hub/);
    expect(() => service.done('mdp_b', m.moveId, 3, 'Amos', T0)).toThrow(/from none to the 2 that came/);
    const done = service.done('mdp_b', m.moveId, 1, 'Amos', T0 + 3_600_000);
    expect(done).toMatchObject({ state: 'with_driver', doneCount: 1, doneAt: '2026-10-27T09:00:00.000Z' });
    expect(() => service.done('mdp_b', m.moveId, 1, 'Amos', T0)).toThrow(/Said already/);
    expect(told.at(-1)).toMatchObject({ did: 'did:hub:a', body: 'Ghala B counted 1 of 2 × Blue roll cage back out to Kamau.' });
    expect(service.viewOf('mdp_b').here).toEqual([]);
  });

  it('left: the other hub takes them in, and nothing comes back', () => {
    const { service, cageId } = make();
    const m = service.send('mdp_a', { carrierId: cageId, count: 3, toMdpId: 'mdp_b', driverBadgeId: 'PASS-1', wayBack: 'left' }, 'Grace', T0);
    expect(service.done('mdp_b', m.moveId, undefined, 'Amos', T0)).toMatchObject({ state: 'left', doneCount: 3 });
    expect(() => service.postReturnJob('mdp_a', m.moveId, 100, 'Grace', T0)).toThrow(/do not come back on a return job/);
  });

  it('a return job: kept aside there, posted by the owner as a load back to itself — between the two of them — and home when delivered', () => {
    const { service, cageId, posted, handlers, told } = make();
    const m = service.send('mdp_a', { carrierId: cageId, count: 4, toMdpId: 'mdp_b', driverBadgeId: 'PASS-1', wayBack: 'return_job' }, 'Grace', T0);
    expect(() => service.postReturnJob('mdp_a', m.moveId, 140, 'Grace', T0)).toThrow(/has not said yet/);
    const kept = service.done('mdp_b', m.moveId, undefined, 'Amos', T0);
    expect(kept).toMatchObject({ state: 'kept', emptyKg: 35 });
    expect(told.at(-1)).toMatchObject({ did: 'did:hub:a', title: 'Your carriers wait for their return job' });
    expect(() => service.postReturnJob('mdp_b', m.moveId, 140, 'Amos', T0)).toThrow(/not your carriers/);
    const returning = service.postReturnJob('mdp_a', m.moveId, 140, 'Grace', T0);
    expect(returning).toMatchObject({ state: 'returning', job: { code: 'FRT-0101', status: 'available' } });
    expect(posted).toEqual([expect.objectContaining({ pickupLabel: 'Ghala B', destLabel: 'Ghala A', destLocation: HUBS.mdp_a.location, weightKg: 140, packages: 4, postedByDid: 'did:hub:a', betweenParties: true })]);
    expect(() => service.postReturnJob('mdp_a', m.moveId, 140, 'Grace', T0)).toThrow(/posted already: FRT-0101/);
    // Delivered at the owner: home.
    handlers[GlosEvent.Pudo.FreightDelivered]({ payload: { freightId: 'frt_job' } });
    expect(service.viewOf('mdp_a').away[0]).toMatchObject({ state: 'home' });
    expect(told.at(-1)).toMatchObject({ did: 'did:hub:a', title: 'Your carriers are home' });
    expect(service.viewOf('mdp_b').here).toEqual([]);
  });
});
