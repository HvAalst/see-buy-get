import { JourneyPlanService } from './journey-plan.service';
import { planVsActual } from './parcel.service';
import type { JourneyPlan, Parcel } from './pudo.types';

/**
 * PLAN VERSUS ACTUAL WAS SILENT: a quote predicted a chain of custody and a time to collect, and nothing ever held the
 * parcel against it — the plan on the tracking page was even worked out again at every read. The plan is now kept as
 * the parcel is taken in, and read against what happened.
 */
const plan = (from: string, to: string, readyBy: string, via?: string): JourneyPlan => ({
  hops: [
    { type: 'pudo', id: `shop:${from}`, label: `${from} Shop`, zone: from },
    ...(via ? [{ type: 'mdp' as const, id: `hub:${via}`, label: `${via} Hub`, zone: via }] : []),
    { type: 'pudo', id: `shop:${to}`, label: `${to} Shop`, zone: to },
  ],
  mdpRouted: Boolean(via),
  pickupReadyAt: readyBy,
  plannedAt: '2026-10-14T08:00:00.000Z',
});
const held = (...ids: string[]) =>
  ids.map((id) => ({ holderId: id, holderKind: id.startsWith('hub:') ? ('hub' as const) : id.startsWith('drv:') ? ('driver' as const) : ('shop' as const), from: '2026-10-14T08:00:00.000Z' }));

describe('a parcel held against its promise', () => {
  it('says whether it was ready by the time promised, and how late if not — to the tenth of an hour', () => {
    const p = { plan: plan('CBD', 'Westlands', '2026-10-14T12:00:00.000Z'), custody: held('shop:CBD', 'drv:amos', 'shop:Westlands') };
    expect(planVsActual({ ...p, readyAt: '2026-10-14T11:00:00.000Z' })).toMatchObject({ onTime: true, lateHours: 0, routeKept: true });
    expect(planVsActual({ ...p, readyAt: '2026-10-14T12:00:00.000Z' })).toMatchObject({ onTime: true, lateHours: 0 });
    expect(planVsActual({ ...p, readyAt: '2026-10-14T14:30:00.000Z' })).toMatchObject({ onTime: false, lateHours: 2.5, promisedAt: '2026-10-14T12:00:00.000Z' });
  });

  it('says whether it went through the shops and hubs planned — drivers between them do not count, and a rescan is one place', () => {
    const planned = plan('CBD', 'Westlands', '2026-10-14T12:00:00.000Z', 'Industrial');
    const readyAt = '2026-10-14T11:00:00.000Z';
    expect(planVsActual({ plan: planned, readyAt, custody: held('shop:CBD', 'drv:a', 'hub:Industrial', 'hub:Industrial', 'drv:b', 'shop:Westlands') })!.routeKept).toBe(true);
    // Went straight past the hub it was planned through.
    expect(planVsActual({ plan: planned, readyAt, custody: held('shop:CBD', 'drv:a', 'shop:Westlands') })!.routeKept).toBe(false);
    // An older parcel with no custody recorded says nothing about its route rather than something untrue.
    expect(planVsActual({ plan: planned, readyAt })).not.toHaveProperty('routeKept');
  });

  it('says nothing for a parcel with no kept plan, or one not ready to collect yet', () => {
    expect(planVsActual({ readyAt: '2026-10-14T11:00:00.000Z' })).toBeUndefined();
    expect(planVsActual({ plan: plan('CBD', 'Westlands', '2026-10-14T12:00:00.000Z') })).toBeUndefined();
  });
});

describe('the lanes, as they went', () => {
  const now = Date.parse('2026-10-20T00:00:00.000Z');
  const parcel = (id: string, from: string, to: string, readyBy: string, readyAt: string, custody = held(`shop:${from}`, `shop:${to}`)): Parcel =>
    ({ parcelId: id, plan: plan(from, to, readyBy), readyAt, custody }) as unknown as Parcel;
  const list = [
    parcel('ON-1', 'CBD', 'Westlands', '2026-10-15T12:00:00.000Z', '2026-10-15T10:00:00.000Z'),
    parcel('ON-2', 'CBD', 'Westlands', '2026-10-16T12:00:00.000Z', '2026-10-16T12:00:00.000Z'),
    parcel('LATE-1', 'CBD', 'Kisumu', '2026-10-15T12:00:00.000Z', '2026-10-15T15:00:00.000Z'),
    parcel('LATE-2', 'CBD', 'Kisumu', '2026-10-16T12:00:00.000Z', '2026-10-16T22:00:00.000Z', held('shop:CBD', 'shop:Elsewhere', 'shop:Kisumu')),
    parcel('ON-3', 'CBD', 'Kisumu', '2026-10-17T12:00:00.000Z', '2026-10-17T11:00:00.000Z'),
    // Ready long before the window: not read.
    parcel('OLD', 'CBD', 'Kisumu', '2026-08-01T12:00:00.000Z', '2026-08-02T12:00:00.000Z'),
    // A busier lane, never late: after the late one however busy it is.
    ...['T-1', 'T-2', 'T-3', 'T-4'].map((id) => parcel(id, 'CBD', 'Thika', '2026-10-18T12:00:00.000Z', '2026-10-18T09:00:00.000Z')),
    // Not arrived yet: not read.
    { parcelId: 'MOVING', plan: plan('CBD', 'Kisumu', '2026-10-21T12:00:00.000Z'), custody: held('shop:CBD') } as unknown as Parcel,
  ];
  const service = new JourneyPlanService({ subscribe: () => undefined } as never, { list: () => list } as never, {} as never);

  it('puts the lanes most often late first, with how late they usually are and the latest of them to open', () => {
    expect(service.lanes(30, now).map((l) => l.to)).toEqual(['Kisumu', 'Thika', 'Westlands']);
    const [kisumu, , westlands] = service.lanes(30, now);
    expect(kisumu).toEqual({ from: 'CBD', to: 'Kisumu', arrived: 3, onTime: 1, late: 2, typicalLateHours: 6.5, routeKnown: 3, routeKept: 2, worst: { parcelId: 'LATE-2', lateHours: 10 } });
    expect(westlands).toEqual({ from: 'CBD', to: 'Westlands', arrived: 2, onTime: 2, late: 0, typicalLateHours: 0, routeKnown: 2, routeKept: 2 });
  });

  it('reads only the parcels ready within the window asked for', () => {
    expect(service.lanes(400, now).find((l) => l.to === 'Kisumu')!.arrived).toBe(4);
    expect(service.lanes(1, now)).toEqual([]);
  });
});

describe('the plan is kept as the parcel is taken in — once', () => {
  it('plans the journey when it enters custody, keeps it, and never rewrites it', () => {
    const parcels = new Map<string, Partial<Parcel>>([['P-1', { parcelId: 'P-1', originAgentDid: 'shop:CBD', destAgentDid: 'shop:Westlands' }]]);
    const kept: string[] = [];
    const parcelService = {
      get: (id: string) => {
        const p = parcels.get(id);
        if (!p) throw new Error('not found');
        return p;
      },
      keepPlan: (id: string, plan: JourneyPlan) => {
        const p = parcels.get(id)!;
        if (p.plan) return false;
        p.plan = plan;
        kept.push(id);
        return true;
      },
    };
    let calls = 0;
    const routing = {
      planJourney: () => {
        calls += 1;
        return { hops: [{ type: 'pudo', id: 'shop:CBD', label: 'CBD Shop', zone: 'CBD', country: 'KE' }, { type: 'pudo', id: 'shop:Westlands', label: 'Westlands Shop', zone: 'Westlands', country: 'KE' }], mdpRouted: false, pickupReadyAt: `2026-10-14T1${calls}:00:00.000Z` };
      },
    };
    let handler: ((e: { payload: { parcelId: string } }) => void) | undefined;
    const service = new JourneyPlanService({ subscribe: (_: string, fn: typeof handler) => (handler = fn) } as never, parcelService as never, routing as never);
    service.onModuleInit();
    // Taken in at the counter: the event every way in publishes.
    handler!({ payload: { parcelId: 'P-1' } });
    expect(parcels.get('P-1')!.plan).toMatchObject({ pickupReadyAt: '2026-10-14T11:00:00.000Z', hops: [{ id: 'shop:CBD' }, { id: 'shop:Westlands' }] });
    // Taken in again (a second scan): the promise stands as it was made.
    handler!({ payload: { parcelId: 'P-1' } });
    expect(parcels.get('P-1')!.plan!.pickupReadyAt).toBe('2026-10-14T11:00:00.000Z');
    expect(kept).toEqual(['P-1']);
    // Not even planned again: the promise is not re-estimated and then thrown away.
    expect(calls).toBe(1);
    // Nothing to plan towards, or nothing there at all: no plan, and no refusal.
    parcels.set('P-2', { parcelId: 'P-2', originAgentDid: 'shop:CBD' });
    expect(service.freeze('P-2')).toBeUndefined();
    expect(service.freeze('NOPE')).toBeUndefined();
  });
});
