import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { IS_PUBLIC_KEY } from '../../foundation/auth/public.decorator';
import { MIN_TIER_KEY, ROLES_KEY, SCOPES_KEY, SIGNED_IN_KEY } from '../../foundation/auth/scopes.decorator';
import { AccountMoveController } from './account-move.controller';
import { AccountController } from './account.controller';
import { ConversationController } from './conversation.controller';
import { DocumentLinkController } from './document-link.controller';
import { IdDisputeController } from './id-dispute.controller';
import { MediaController } from './media.controller';
import { SbgController } from './pudo.controller';
import { QuoteController } from './quote.controller';

/**
 * WHO THE DOOR LETS IN.
 *
 * A route with no role written on it is open to ANY valid sign-in — a shop's, a driver's, a store's. Twenty-four of
 * those changed something and never asked who was calling, and twenty-two more read something the same way. Each now
 * has its readers or its trades written on the door; what a route does about WHICH shop, hub, fleet, store or driver
 * is calling is tested where the handlers are (pudo.service.spec.ts, "the routes that changed something without
 * asking who was calling" and "the reads that asked nobody who was calling").
 *
 * Then the routes that DO ask whose it is, inside: a shop's own, a fleet's own, a driver's own. The trade that check
 * admits is written on the door as well, so that the check is the second thing in the way and not the only one.
 *
 * This reads the door itself — of every controller the product has — so that a role taken off one of these fails
 * here rather than in production.
 */
const CONTROLLERS = [SbgController, QuoteController, DocumentLinkController, ConversationController, AccountController, MediaController, AccountMoveController, IdDisputeController];
const VERB: Record<number, string> = { [RequestMethod.GET]: 'GET', [RequestMethod.POST]: 'POST', [RequestMethod.PATCH]: 'PATCH', [RequestMethod.PUT]: 'PUT', [RequestMethod.DELETE]: 'DELETE' };

interface Door {
  route: string;
  open: boolean;
  roles?: string[];
  scopes?: string[];
  signedIn: boolean;
  labelled: boolean;
}

function doorsOf(controller: (typeof CONTROLLERS)[number]): Door[] {
  const proto = controller.prototype as unknown as Record<string, unknown>;
  const base = String(Reflect.getMetadata(PATH_METADATA, controller));
  const out: Door[] = [];
  for (const name of Object.getOwnPropertyNames(proto)) {
    const h = proto[name];
    if (typeof h !== 'function' || Reflect.getMetadata(METHOD_METADATA, h) === undefined) continue;
    const roles = Reflect.getMetadata(ROLES_KEY, h) as string[] | undefined;
    const scopes = Reflect.getMetadata(SCOPES_KEY, h) as string[] | undefined;
    const signedIn = Reflect.getMetadata(SIGNED_IN_KEY, h) === true;
    // A route with no path of its own (`@Get()`) is the controller's path, with nothing after it.
    const path = [base, String(Reflect.getMetadata(PATH_METADATA, h))].filter((part) => part && part !== '/').join('/');
    out.push({
      route: `${VERB[Reflect.getMetadata(METHOD_METADATA, h) as number]} ${path}`,
      open: Reflect.getMetadata(IS_PUBLIC_KEY, h) === true,
      roles,
      scopes,
      signedIn,
      labelled: Boolean(roles?.length || scopes?.length || Reflect.getMetadata(MIN_TIER_KEY, h) || signedIn),
    });
  }
  return out;
}

const doors = (): Door[] => CONTROLLERS.flatMap(doorsOf);

describe('who the door lets in', () => {
  const all = doors();
  const door = (route: string) => all.find((d) => d.route === route);

  it('read the doors: hundreds of them, and some from every controller', () => {
    expect(all.length).toBeGreaterThan(440);
    for (const controller of CONTROLLERS) expect(doorsOf(controller).length).toBeGreaterThan(0);
    // No route is named twice: a second controller answering the same line would hide behind the first here.
    expect(new Set(all.map((d) => d.route)).size).toBe(all.length);
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
   * THE ROUTES THAT ASK WHOSE IT IS, INSIDE. Each already refuses everybody but the owner (and staff standing in). The
   * trade written here is the one that check admits: a mistake in the check is then a shop reaching another shop's
   * route, never a store or a shopper reaching it.
   */
  const OWN: Array<[string, Partial<Door>, string[]]> = [
    [
      'a shop’s own: the shop, or staff standing in',
      { roles: ['agent', 'operator'] },
      [
        'POST sbg/agents/:did/submit-kyc',
        'POST sbg/agents/:did/ping',
        'POST sbg/agents/:did/availability',
        'POST sbg/agents/:did/hours',
        'POST sbg/agents/:did/shelf',
        'POST sbg/agents/:did/location',
        'POST sbg/agents/:did/shopfront',
        'GET sbg/agents/:did/shelf',
        'GET sbg/agents/:did',
        'GET sbg/agents/:did/can-transact',
        'POST sbg/agents/:did/top-up',
        'GET sbg/agents/:did/funding',
        'POST sbg/agents/:did/receive-bag',
        'PATCH sbg/agents/:did/pricing',
        'POST sbg/agents/:did/totes',
        'POST sbg/consignments/:code/deposit',
        'GET sbg/consignments',
      ],
    ],
    [
      'a store’s own: the store',
      { scopes: ['vendor:manage:self'] },
      [
        'POST sbg/vendors/:id/secret/rotate',
      ],
    ],
    [
      'a fleet’s own: its office, or staff standing in',
      { roles: ['fleet_manager', 'operator'] },
      [
        'GET sbg/fleet/managers/:did/dispatch',
        'POST sbg/fleet/managers/:did/dispatch',
        'POST sbg/fleet/managers/:did/submit-kyc',
        'POST sbg/vehicles/:id/documents',
        'POST sbg/vehicles/:id/ground',
        'POST sbg/vehicles/:id/retire',
        'POST sbg/fleet/managers/:did/offers',
        'GET sbg/fleet/managers/:did/offers',
        'POST sbg/fleet/managers/:did/offers/:offerId/withdraw',
        'POST sbg/fleet/managers/:did/drivers/:driverDid/remove',
        'GET sbg/fleet/managers/:did/papers',
        'POST sbg/fleet/managers/:did/departures',
        'GET sbg/fleet/managers/:did/departures',
        'POST sbg/fleet/managers/:did/departures/:departureId/own-loads',
        'POST sbg/fleet/managers/:did/departures/:departureId/vehicle',
        'POST sbg/fleet/managers/:did/departures/:departureId/status',
        'POST sbg/fleet/managers/:did/departures/:departureId/driver',
        'POST sbg/fleet/managers/:did/departures/:departureId/bookings/:bookingId/claim/answer',
        'POST sbg/fleet/managers/:did/departures/:departureId/bookings/:bookingId/waive-waiting',
      ],
    ],
    [
      'a driver’s own: the driver, or staff standing in',
      { roles: ['driver', 'operator'] },
      [
        'GET sbg/drivers/:did/fleet-offers',
        'POST sbg/fleet/drivers/:did/rest/tell-me',
        'POST sbg/fleet/drivers/:did/ping',
        'POST sbg/fleet/drivers/:did/start-session',
        'POST sbg/fleet/drivers/:did/leg',
        'POST sbg/fleet/drivers/:did/derived-leg',
        'POST sbg/fleet/drivers/:did/area',
        'POST sbg/fleet/drivers/:did/snooze',
        'POST sbg/fleet/drivers/:did/resume',
        'POST sbg/fleet/drivers/:did/suggest-nearby',
        'POST sbg/fleet/drivers/:did/end-session',
        'POST sbg/fleet/drivers/:did/min-earn',
        'POST sbg/fleet/drivers/:did/suggest-work',
        'POST sbg/fleet/drivers/:did/locate',
      ],
    ],
    [
      'a driver’s own answer: the driver',
      { roles: ['driver'] },
      [
        'POST sbg/drivers/:did/fleet-offers/:offerId/accept',
        'POST sbg/drivers/:did/fleet-offers/:offerId/decline',
      ],
    ],
    [
      'a driver’s record and shift: the driver, their fleet’s office, or staff',
      { roles: ['driver', 'fleet_manager', 'operator'] },
      [
        'GET sbg/fleet/drivers/:did',
        'GET sbg/fleet/drivers/:did/hours',
        'GET sbg/fleet/drivers/:did/departures',
        'POST sbg/fleet/drivers/:did/submit-kyc',
        'POST sbg/fleet/drivers/:did/uncouple',
        'GET sbg/fleet/drivers/:did/vehicles',
        'GET sbg/fleet/drivers/:did/legs',
        'GET sbg/fleet/drivers/:did/session',
        'POST sbg/fleet/drivers/:did/assign-corridor',
        'GET sbg/fleet/drivers/:did/offers',
        'GET sbg/fleet/drivers/:did/claims',
      ],
    ],
    [
      'a party’s own, and parties are of several trades: anybody signed in, and the route asks whose it is',
      { signedIn: true, labelled: true },
      [
        'POST sbg/account/move-requests/stop',
        'GET sbg/account/me',
        'PATCH sbg/account/profile',
        'POST sbg/account/pin/change',
        'POST sbg/account/pin-devices',
        'POST sbg/account/pin-devices/forget-others',
        'POST sbg/account/pin-devices/forget-this',
        'POST sbg/account/email',
        'POST sbg/account/phone/change',
        'POST sbg/account/phone/old/block',
        'GET sbg/conversations',
        'POST sbg/conversations',
        'POST sbg/conversations/:id/voice',
        'GET sbg/conversations/:id/voice/:voiceId',
        'POST sbg/conversations/:id/share',
        'POST sbg/conversations/:id/dispute-reports',
        'GET sbg/conversations/:id/messages',
        'POST sbg/conversations/:id/messages',
        'POST sbg/conversations/:id/proposals',
        'POST sbg/conversations/:id/proposals/:proposalId/accept',
        'POST sbg/conversations/:id/proposals/:proposalId/decline',
        'POST sbg/conversations/:id/settlements',
        'POST sbg/conversations/:id/messages/:seq/agree',
        'POST sbg/conversations/:id/read',
        'POST sbg/conversations/:id/block',
        'POST sbg/conversations/:id/unblock',
        'POST sbg/conversations/:id/messages/:seq/report',
        'GET sbg/consignment-notes/:docId/links',
        'POST sbg/consignment-notes/:docId/links',
        'POST sbg/consignment-notes/:docId/links/:linkId/cancel',
        'POST sbg/account/id-disputes/own-id',
        'POST sbg/media',
        'GET sbg/media',
        'GET sbg/media/:id',
        'DELETE sbg/media/:id',
        'PATCH sbg/dispatch/freight/:id/instructions',
        'POST sbg/dispatch/freight/:id/rate',
        'GET sbg/departures/:departureId/bookings/:bookingId/consignment-note',
        'GET sbg/departures/:departureId/bookings/:bookingId/consignment-note.html',
        'GET sbg/dispatch/freight/:id/proposals',
        'POST sbg/dispatch/proposals/:id/accept',
        'POST sbg/dispatch/proposals/:id/decline',
        'POST sbg/dispatch/freight/:id/cancel',
        'POST sbg/dispatch/freight/:id/claim',
        'GET sbg/dispatch/freight/:id/consignment-note',
        'GET sbg/dispatch/freight/:id/consignment-note.html',
        'GET sbg/consignment-notes/:docId/bundle.zip',
        'GET sbg/consignment-notes/:docId',
        'GET sbg/consignment-notes/:docId/copies/:seq',
        'GET sbg/consignment-notes/:docId/copies/:seq/print.html',
        'GET sbg/quotes/:quoteId',
        'POST sbg/quotes/:quoteId/status',
        'POST sbg/quotes/:quoteId/agree',
        'POST sbg/quotes/:quoteId/proforma',
        'GET sbg/quotes/:quoteId/proforma',
        'GET sbg/dispatch/freight/:id/quote',
        'POST sbg/dispatch/freight/:id/quote',
        'GET sbg/departures/:departureId/bookings/:bookingId/quote',
        'POST sbg/departures/:departureId/bookings/:bookingId/quote',
      ],
    ],
  ];
  it.each(OWN.flatMap(([whose, label, routes]) => routes.map((route) => [route, whose, label] as const)))('%s — %s', (route, _whose, label) => {
    expect(door(route)).toMatchObject({ open: false, ...label });
  });

  it('…and that is 123 of them, none listed twice', () => {
    const listed = OWN.flatMap(([, , routes]) => routes);
    expect(listed).toHaveLength(123);
    expect(new Set(listed).size).toBe(listed.length);
  });

  /**
   * THE COUNT THAT IS LEFT, over every controller above. Every route that changes something and still has no policy
   * written on it — held exactly, not as a ceiling: a count of "no more than" passes on the day this stops reading
   * the doors and finds none. So writing a label on one more means lowering the number below, in the same change. The number may only go DOWN: a new route with nothing written on it
   * fails this, and so does taking a label off.
   */
  it('exactly as many routes change something with nothing written on the door as when this was last counted', () => {
    const unwritten = all.filter((d) => !d.open && !d.labelled && !d.route.startsWith('GET ')).map((d) => d.route);
    expect(unwritten.length).toBe(UNWRITTEN_CHANGES);
  });
  it('…nor read something', () => {
    const unwritten = all.filter((d) => !d.open && !d.labelled && d.route.startsWith('GET ')).map((d) => d.route);
    expect(unwritten.length).toBe(UNWRITTEN_READS);
  });
});

/**
 * Counted 2026-10-11, over all eight controllers: after the twenty-four, the twenty-two reads, and the 123 that ask
 * whose it is. Lower them as more are written; never raise them.
 */
const UNWRITTEN_CHANGES = 39;
const UNWRITTEN_READS = 18;
