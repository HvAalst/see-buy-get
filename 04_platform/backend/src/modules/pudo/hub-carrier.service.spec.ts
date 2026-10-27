import { HubCarrierService, carrierHolds } from './hub-carrier.service';
import type { HubCarrierInput } from './hub-carrier.types';
import type { MdpService } from './mdp.service';

/**
 * A HUB SAYS WHAT IT MOVES BAGS ON; WHAT EACH HOLDS IS WORKED OUT (D11; the user, 2026-09-03 and 2026-10-27). The list is the
 * hub's own word, written whole; the number of parcels a carrier holds is never typed by anybody.
 */
describe('a hub’s carriers', () => {
  const HUB = 'mdp_carriers_1';
  const mdps = { require: (id: string) => (id === HUB ? { mdpId: HUB } : (() => { throw new Error('not found'); })()) } as unknown as MdpService;
  const make = () => new HubCarrierService(mdps);
  const pallet: HubCarrierInput = { kind: 'pallet', name: 'Euro pallet', lengthCm: 120, widthCm: 80, heightCm: 150, maxKg: 1000 };
  const cage: HubCarrierInput = { kind: 'cage', name: 'Roll cage', lengthCm: 80, widthCm: 70, heightCm: 170, maxKg: 500 };

  it('works out what a carrier holds from its size and rating — its space decides for what we carry', () => {
    // 120 × 80 × 150 cm is 1.44 m³: 36.5 parcels of size M by space, 200 by what it may carry.
    expect(carrierHolds(pallet)).toEqual({ holds: 36.5, bags: 3, boundBy: 'space' });
    // A small crate: less than a bag, its space deciding still.
    expect(carrierHolds({ lengthCm: 60, widthCm: 40, heightCm: 40, maxKg: 15 })).toEqual({ holds: 2.4, bags: 0, boundBy: 'space' });
    // A big carrier rated for little: what it may carry decides — 25 parcels' room, 10 parcels' weight.
    expect(carrierHolds({ lengthCm: 100, widthCm: 100, heightCm: 100, maxKg: 50 })).toEqual({ holds: 10, bags: 1, boundBy: 'weight' });
  });

  it('keeps the list as the hub wrote it, whole — a kind kept by its id, a new one given one, one left out taken off', () => {
    const s = make();
    const first = s.set(HUB, [pallet, cage], 'Grace', Date.parse('2026-10-27T08:00:00Z'));
    expect(first.carriers.map((c) => c.name)).toEqual(['Euro pallet', 'Roll cage']);
    expect(first.carriers[1]).toMatchObject({ holds: 24.1, bags: 2, boundBy: 'space', saidBy: 'Grace' });
    const [p, c] = first.carriers;

    // The cage changed, the pallet sent back as it was, a crate added.
    const later = s.set(HUB, [{ ...pallet, carrierId: p.carrierId }, { ...cage, carrierId: c.carrierId, heightCm: 180 }, { kind: 'crate', name: 'Bread crate', lengthCm: 60, widthCm: 40, heightCm: 30, maxKg: 20 }], 'Amos', Date.parse('2026-10-28T08:00:00Z'));
    expect(later.carriers.map((x) => x.carrierId).slice(0, 2)).toEqual([p.carrierId, c.carrierId]);
    expect(later.carriers[0]).toMatchObject({ saidBy: 'Grace', saidAt: '2026-10-27T08:00:00.000Z' }); // unchanged keeps who said it
    expect(later.carriers[1]).toMatchObject({ heightCm: 180, saidBy: 'Amos' });
    expect(later.carriers[2].carrierId).toMatch(/^hc_/);

    // The pallet left out: off the list.
    expect(s.set(HUB, [{ ...cage, carrierId: c.carrierId, heightCm: 180 }], 'Amos').carriers.map((x) => x.name)).toEqual(['Roll cage']);
    expect(s.set(HUB, [], 'Amos').carriers).toEqual([]);
  });

  it('refuses a list it cannot keep, before anything is written — and says which kind and why', () => {
    const s = make();
    s.set(HUB, [pallet], 'Grace');
    expect(() => s.set(HUB, [pallet, { ...cage, name: ' ' }], 'Grace')).toThrow(/Give each kind a name/);
    expect(() => s.set(HUB, [pallet, { ...cage, name: 'euro PALLET' }], 'Grace')).toThrow(/Two kinds are called/);
    expect(() => s.set(HUB, [{ ...cage, heightCm: 5 }], 'Grace')).toThrow(/Roll cage’s loaded height in whole centimetres, from 20 to 300/);
    expect(() => s.set(HUB, [{ ...cage, maxKg: 4000 }], 'Grace')).toThrow(/what Roll cage may carry in whole kilograms/);
    expect(() => s.set(HUB, [{ kind: 'crate', name: 'Egg tray', lengthCm: 30, widthCm: 30, heightCm: 20, maxKg: 10 }], 'Grace')).toThrow(/less than one parcel of size M/);
    expect(() => s.set(HUB, [{ ...cage, carrierId: 'hc_gone' }], 'Grace')).toThrow(/not on your list any more/);
    expect(() => s.set(HUB, Array.from({ length: 7 }, (_, i) => ({ ...cage, name: `Cage ${i}` })), 'Grace')).toThrow(/at most 6 kinds/);
    // Nothing of a refused list was written.
    expect(s.viewOf(HUB).carriers.map((c) => c.name)).toEqual(['Euro pallet']);
  });
});
