import { CorridorService } from './corridor.service';
import { SbgController } from './pudo.controller';
import { ROLES_KEY } from '../../foundation/auth/scopes.decorator';
import { IS_PUBLIC_KEY } from '../../foundation/auth/public.decorator';

/**
 * WHO MAY DRAW A ROUTE ACROSS THE NETWORK.
 *
 * A corridor is not one fleet manager's route. It is the promise that a bus runs between two zones, and
 * the whole network reads it: a shop may only take in a cross-zone parcel some corridor serves, and the
 * counter handover's manifest is built from the corridor's destination. So adding one changes what shops
 * in that zone may accept, and BLOCKING one stops parcels being taken in by people who never heard of it.
 *
 * All three writes were unlabelled, which under the guard's pre-migration default means any valid token —
 * a driver's, a shopkeeper's — could draw a route or close one. These tests hold that line.
 */
describe('corridors are network geography', () => {
  it('lets only an operator draw one, close one, or add a badge to the whitelist', () => {
    expect(Reflect.getMetadata(ROLES_KEY, SbgController.prototype.addCorridor)).toEqual(['operator']);
    expect(Reflect.getMetadata(ROLES_KEY, SbgController.prototype.setCorridorStatus)).toEqual(['operator']);
    // The whitelist is the stronger case of the two: it says who may be handed other people's goods.
    expect(Reflect.getMetadata(ROLES_KEY, SbgController.prototype.addDriver)).toEqual(['operator']);
  });

  it('keeps READING them open to everyone who has to work with them', () => {
    // The fleet app offers corridors when a manager starts a shift; the agent app checks them. A list
    // only operators may read is a list the people using it cannot see.
    expect(Reflect.getMetadata(ROLES_KEY, SbgController.prototype.listCorridors)).toBeUndefined();
    expect(Reflect.getMetadata(ROLES_KEY, SbgController.prototype.listDrivers)).toBeUndefined();
    // …but never anonymously.
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, SbgController.prototype.listCorridors)).toBeUndefined();
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, SbgController.prototype.listDrivers)).toBeUndefined();
  });
});

describe('what blocking one does', () => {
  const service = () => new CorridorService();

  it('takes the zone pair out of service without deleting the corridor', () => {
    // Blocked is a state, not a deletion: the corridor is still there to be reopened, and still listed,
    // and simply stops being found for the pair it serves.
    const s = service();
    const c = s.addCorridor({ name: 'A → B', originZone: 'Z-A', destZone: 'Z-B' });
    expect(s.forZones('Z-A', 'Z-B')?.corridorId).toBe(c.corridorId);

    s.setStatus(c.corridorId, 'blocked');
    expect(s.forZones('Z-A', 'Z-B')).toBeUndefined();
    expect(s.listCorridors().map((x) => x.status)).toEqual(['blocked']);

    s.setStatus(c.corridorId, 'active');
    expect(s.forZones('Z-A', 'Z-B')?.corridorId).toBe(c.corridorId);
  });

  it('is one direction only, because a bus that runs there does not thereby run back', () => {
    const s = service();
    s.addCorridor({ name: 'A → B', originZone: 'Z-A', destZone: 'Z-B' });
    expect(s.forZones('Z-B', 'Z-A')).toBeUndefined();
  });
});

describe('F1/F2 — a fleet’s own line: proposed by the fleet, published by the network', () => {
  const service = () => new CorridorService();
  const propose = (s: CorridorService, managerDid = 'did:fleet:a', company = 'Alpha Haulage') =>
    s.proposeLine({ managerDid, company, originZone: 'Z-A', destZone: 'Z-B', note: 'we run this road daily' });

  it('lets only a fleet propose one, and only an operator publish it', () => {
    expect(Reflect.getMetadata(ROLES_KEY, SbgController.prototype.proposeLine)).toEqual(['fleet_manager']);
    expect(Reflect.getMetadata(ROLES_KEY, SbgController.prototype.publishCorridor)).toEqual(['operator']);
  });

  it('routes NOTHING on a proposal until the network publishes it', () => {
    const s = service();
    const line = propose(s);
    expect(line).toMatchObject({ status: 'proposed', owner: { kind: 'fleet', managerDid: 'did:fleet:a', company: 'Alpha Haulage' } });
    expect(s.forZones('Z-A', 'Z-B')).toBeUndefined();

    s.publish(line.corridorId, 'ops@glos');
    expect(s.forZones('Z-A', 'Z-B')?.corridorId).toBe(line.corridorId);
    expect(s.requireCorridor(line.corridorId).publishedBy).toBe('ops@glos');
  });

  it('never opens a proposal through the close/reopen switch — publishing is its own decision', () => {
    const s = service();
    const line = propose(s);
    expect(() => s.setStatus(line.corridorId, 'active')).toThrow(/publish it/);
  });

  it('refuses a second line on a pair already run or waiting — the lookup only ever finds the first', () => {
    const s = service();
    propose(s);
    expect(() => propose(s, 'did:fleet:b', 'Beta')).toThrow(/waits to run/);
    const fresh = service();
    const line = propose(fresh);
    fresh.addCorridor({ name: 'Network A → B', originZone: 'Z-A', destZone: 'Z-B' }); // drawn after the proposal
    expect(() => fresh.publish(line.corridorId)).toThrow(/already runs/);
  });

  it('carries only its own fleet’s drivers, and hides the proposal from everybody else', () => {
    const s = service();
    const line = propose(s);
    const network = s.addCorridor({ name: 'B → C', originZone: 'Z-B', destZone: 'Z-C' });

    expect(() => s.requireUsableBy(line.corridorId, 'did:fleet:a')).toThrow(/not been published/);
    s.publish(line.corridorId);
    expect(s.requireUsableBy(line.corridorId, 'did:fleet:a').corridorId).toBe(line.corridorId);
    expect(() => s.requireUsableBy(line.corridorId, 'did:fleet:b')).toThrow(/Alpha Haulage’s line/);
    expect(() => s.requireUsableBy(line.corridorId, undefined)).toThrow(/only its own drivers/);
    expect(s.requireUsableBy(network.corridorId, 'did:fleet:b').corridorId).toBe(network.corridorId);

    const other = service();
    const plan = propose(other);
    expect(other.visibleTo('did:fleet:b', false).map((c) => c.corridorId)).not.toContain(plan.corridorId);
    expect(other.visibleTo('did:fleet:a', false).map((c) => c.corridorId)).toContain(plan.corridorId);
    expect(other.visibleTo(undefined, true).map((c) => c.corridorId)).toContain(plan.corridorId);
  });

  it('checks that a fleet moves only its own drivers', () => {
    // The couple / uncouple / assign routes carried no label and no owner check before this.
    const controller = Object.create(SbgController.prototype) as { assertDriverInFleet: (did: string, actor: unknown) => void; drivers: unknown };
    controller.drivers = { get: (did: string) => ({ did, managerDid: 'did:fleet:a' }) };
    expect(() => controller.assertDriverInFleet('did:drv', { role: 'fleet_manager', tenant: 'did:fleet:b' })).toThrow(/not in your fleet/);
    expect(() => controller.assertDriverInFleet('did:drv', { role: 'fleet_manager', tenant: 'did:fleet:a' })).not.toThrow();
    expect(() => controller.assertDriverInFleet('did:drv', { role: 'operator' })).not.toThrow();
    expect(() => controller.assertDriverInFleet('did:drv', { role: 'driver', did: 'did:drv' })).not.toThrow();
  });
});
