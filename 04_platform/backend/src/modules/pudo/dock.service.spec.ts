import type { EventBus } from '../../foundation/events/event-bus.service';
import { DockService } from './dock.service';
import type { BagClosureService } from './bag-closure.service';
import type { MdpService } from './mdp.service';
import type { ParcelService } from './parcel.service';
import type { ToteService } from './tote.service';
import type { VendorService } from './vendor.service';

/**
 * A STORE'S OWN DOCK takes only the parcels that leave from it: paid, still with the store, and booked to start nowhere
 * else — not at a shop's counter, and not (reading B) at a hub the store hands its parcels in at in bulk. Such a parcel
 * is neither waiting on the dock, demanded by its seal gate, nor bagged there.
 */
describe('a store’s dock and the parcels it hands in elsewhere', () => {
  const base = { vendorId: 'v_1', status: 'Created', paidStatus: 'ParcelPaid', destZone: 'South' };
  const parcels = [
    { ...base, parcelId: 'PUD-DOCK' },
    { ...base, parcelId: 'PUD-SHOP', originAgentDid: 'did:shop:1' },
    { ...base, parcelId: 'PUD-HUB', handInMdpId: 'mdp_1' },
    { ...base, parcelId: 'PUD-UNPAID', paidStatus: 'Pending' },
  ];
  const dock = () => {
    const vendors = { get: () => ({ vendorId: 'v_1', did: 'did:store:1' }) } as unknown as VendorService;
    const parcelSvc = {
      list: () => parcels,
      get: (id: string) => parcels.find((p) => p.parcelId === id),
    } as unknown as ParcelService;
    const totes = {
      requireByCode: () => ({ code: 'BAG-1', locationId: 'did:store:1', status: 'filling', destinationNodeId: 'South', destinationLabel: 'South', parcels: [] }),
      atLocation: () => [],
    } as unknown as ToteService;
    const mdps = { fillTote: () => ({ tote: {}, fillPct: 10 }) } as unknown as MdpService;
    return new DockService(vendors, parcelSvc, totes, mdps, {} as EventBus, {} as BagClosureService);
  };

  it('waits on the dock only with what leaves from it: never a parcel for a shop’s counter or a hub', () => {
    expect(dock().waiting('v_1').map((p) => p.parcelId)).toEqual(['PUD-DOCK']);
  });

  it('bags none of them on the dock: a parcel for a hub is refused in words that say where it goes', () => {
    expect(() => dock().fillBag('BAG-1', 'v_1', 'PUD-HUB')).toThrow(/booked to be handed in at a hub/);
    expect(() => dock().fillBag('BAG-1', 'v_1', 'PUD-SHOP')).toThrow(/booked for drop-off at a shop/);
    expect(dock().fillBag('BAG-1', 'v_1', 'PUD-DOCK')).toEqual({ tote: {}, fillPct: 10 });
  });
});
