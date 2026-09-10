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
