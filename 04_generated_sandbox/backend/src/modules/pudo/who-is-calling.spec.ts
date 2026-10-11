import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { IS_PUBLIC_KEY } from '../../foundation/auth/public.decorator';
import { MIN_TIER_KEY, ROLES_KEY, SCOPES_KEY, SIGNED_IN_KEY } from '../../foundation/auth/scopes.decorator';
import { SbgController } from './pudo.controller';

/**
 * WHO THE DOOR LETS IN.
 *
 * A route with no role written on it is open to ANY valid sign-in — a shop's, a driver's, a store's. Twenty-four of
 * those changed something and never asked who was calling, and twenty-two more read something the same way. Each now
 * has its readers or its trades written on the door; what a route does about WHICH shop, hub, fleet, store or driver
 * is calling is tested where the handlers are (pudo.service.spec.ts, "the routes that changed something without
 * asking who was calling" and "the reads that asked nobody who was calling").
 *
 * This reads the door itself, so that a role taken off one of these fails here rather than in production.
 */
const VERB: Record<number, string> = { [RequestMethod.GET]: 'GET', [RequestMethod.POST]: 'POST', [RequestMethod.PATCH]: 'PATCH', [RequestMethod.PUT]: 'PUT', [RequestMethod.DELETE]: 'DELETE' };

interface Door {
  route: string;
  open: boolean;
  roles?: string[];
  scopes?: string[];
  signedIn: boolean;
  labelled: boolean;
}

function doors(): Door[] {
  const proto = SbgController.prototype as unknown as Record<string, unknown>;
  const out: Door[] = [];
  for (const name of Object.getOwnPropertyNames(proto)) {
    const h = proto[name];
    if (typeof h !== 'function' || Reflect.getMetadata(METHOD_METADATA, h) === undefined) continue;
    const roles = Reflect.getMetadata(ROLES_KEY, h) as string[] | undefined;
    const scopes = Reflect.getMetadata(SCOPES_KEY, h) as string[] | undefined;
    const signedIn = Reflect.getMetadata(SIGNED_IN_KEY, h) === true;
    out.push({
      route: `${VERB[Reflect.getMetadata(METHOD_METADATA, h) as number]} sbg/${String(Reflect.getMetadata(PATH_METADATA, h))}`,
      open: Reflect.getMetadata(IS_PUBLIC_KEY, h) === true,
      roles,
      scopes,
      signedIn,
      labelled: Boolean(roles?.length || scopes?.length || Reflect.getMetadata(MIN_TIER_KEY, h) || signedIn),
    });
  }
  return out;
}

describe('who the door lets in', () => {
  const all = doors();
  const door = (route: string) => all.find((d) => d.route === route);

  it('read the doors: hundreds of them', () => {
    expect(all.length).toBeGreaterThan(400);
  });

  /** Made by network staff (and, on a laptop, the seeder) — never by whoever happens to be signed in. */
  it.each(['POST sbg/agents', 'POST sbg/mdps', 'POST sbg/fleet/managers', 'POST sbg/routing/assign-node', 'POST sbg/routing/plan-journey', 'POST sbg/dispatch/publish-ready'])('%s is for network staff', (route) => {
    expect(door(route)).toMatchObject({ open: false, roles: ['operator'] });
  });

  /** The hub's own: its price, its bags, what is dropped and sorted at it. */
  it.each(['PATCH sbg/mdps/:id/pricing', 'POST sbg/mdps/:id/totes', 'POST sbg/mdps/:id/drop-bag', 'POST sbg/mdps/:id/sort'])('%s is for a hub, and staff standing in', (route) => {
    expect(door(route)).toMatchObject({ open: false, roles: ['mdp', 'operator'] });
  });

  /** A bag in somebody's hands: the trades that handle bags. A store, a business, a fleet's office never hold one. */
  it.each(['POST sbg/totes/:code/assign', 'POST sbg/totes/:code/fill', 'POST sbg/totes/:code/release'])('%s is for a shop or a hub', (route) => {
    expect(door(route)).toMatchObject({ open: false, roles: ['agent', 'mdp', 'operator'] });
  });

  it('a bag is loaded by a shop, a hub or the driver taking it', () => {
    expect(door('POST sbg/totes/:code/load')).toMatchObject({ open: false, roles: ['agent', 'mdp', 'driver', 'operator'] });
  });

  /** A load on a van, and an offer made to one driver. */
  it.each(['POST sbg/dispatch/freight/:id/pickup', 'POST sbg/dispatch/freight/:id/deliver', 'POST sbg/dispatch/freight/:id/delivery-failed', 'POST sbg/dispatch/freight/:id/temperature', 'POST sbg/dispatch/offers/:id/claim', 'POST sbg/dispatch/offers/:id/ignore'])(
    '%s is for a driver, and staff standing in',
    (route) => {
      expect(door(route)).toMatchObject({ open: false, roles: ['driver', 'operator'] });
    },
  );

  it('a vehicle is registered by a fleet’s office or by staff; a parcel is rated at a shop’s counter; a store’s checkout by a store', () => {
    expect(door('POST sbg/vehicles')).toMatchObject({ open: false, roles: ['fleet_manager', 'operator'] });
    expect(door('POST sbg/parcels/:id/rate')).toMatchObject({ open: false, roles: ['agent', 'operator'] });
    expect(door('POST sbg/vendors/:id/checkout')).toMatchObject({ open: false, scopes: ['vendor:manage:self'] });
  });

  it('a sum that names nobody is for anybody signed in — and says so, where it used to say nothing', () => {
    expect(door('POST sbg/departures/:departureId/quote')).toMatchObject({ open: false, signedIn: true, labelled: true });
  });

  /** READS. Facts about the network that belong to no one party: for anybody signed in — written down, not left blank. */
  it.each(['GET sbg/module-info', 'GET sbg/presence', 'GET sbg/presence/:jurisdiction', 'GET sbg/border-rules', 'GET sbg/drivers', 'GET sbg/pricing/near', 'GET sbg/agents/:did/rating', 'GET sbg/departures', 'GET sbg/route-constraints', 'GET sbg/route-constraints/route'])(
    '%s is for anybody signed in, and says so',
    (route) => {
      expect(door(route)).toMatchObject({ open: false, signedIn: true, labelled: true });
      expect(door(route)?.roles).toBeUndefined();
    },
  );

  /** Every shop and every hub: anybody signed in is answered — with a card. The rest is kept for staff inside. */
  it.each(['GET sbg/agents', 'GET sbg/mdps'])('%s answers anybody signed in (what each is handed is decided inside)', (route) => {
    expect(door(route)).toMatchObject({ open: false, signedIn: true, labelled: true });
  });

  /** The network's own working lists. */
  it.each(['GET sbg/vendors', 'GET sbg/pricing', 'GET sbg/heatmap', 'GET sbg/dispatch/freight'])('%s is read by network staff', (route) => {
    expect(door(route)).toMatchObject({ open: false, roles: ['operator'] });
  });

  it('a parcel is looked up at a shop’s counter or by the support desk; a bag by the trades that handle bags; the bags at a hub by a hub', () => {
    expect(door('GET sbg/parcels/:id')).toMatchObject({ open: false, roles: ['agent', 'operator'] });
    expect(door('GET sbg/totes/:code')).toMatchObject({ open: false, roles: ['agent', 'mdp', 'driver', 'operator'] });
    expect(door('GET sbg/totes')).toMatchObject({ open: false, roles: ['mdp', 'operator'] });
  });

  it('a store’s record and the journey of its parcel are for a store; the shifts for a fleet’s office or staff', () => {
    expect(door('GET sbg/vendors/:id')).toMatchObject({ open: false, scopes: ['vendor:manage:self'] });
    expect(door('GET sbg/parcels/:id/route')).toMatchObject({ open: false, scopes: ['vendor:manage:self'] });
    expect(door('GET sbg/fleet/assignments')).toMatchObject({ open: false, roles: ['fleet_manager', 'operator'] });
  });

  /**
   * THE COUNT THAT IS LEFT. Every route here that changes something and still has no policy written on it — it was
   * 24 fewer than this before these were closed. The number may only go DOWN: a new route with nothing written on it
   * fails this, and so does taking a label off.
   */
  it('no more routes change something with nothing written on the door than when this was last counted', () => {
    const unwritten = all.filter((d) => !d.open && !d.labelled && !d.route.startsWith('GET ')).map((d) => d.route);
    expect(unwritten.length).toBeLessThanOrEqual(UNWRITTEN_CHANGES);
  });
  it('…nor read something', () => {
    const unwritten = all.filter((d) => !d.open && !d.labelled && d.route.startsWith('GET ')).map((d) => d.route);
    expect(unwritten.length).toBeLessThanOrEqual(UNWRITTEN_READS);
  });
});

/** Counted 2026-10-11 after the twenty-four, and then the twenty-two reads, were closed. Lower them as more are written; never raise them. */
const UNWRITTEN_CHANGES = 91;
const UNWRITTEN_READS = 45;
