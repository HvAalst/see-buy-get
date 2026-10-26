import { HubArrivalService } from './hub-arrival.service';
import type { AgentService } from './agent.service';
import type { HubContactService } from './hub-contact.service';
import type { MdpService } from './mdp.service';
import type { ParcelService } from './parcel.service';
import type { RoutingService } from './routing.service';
import type { VendorService } from './vendor.service';

/**
 * READING B ON THE HUB'S OWN CLOCK (D10). A hub in Nairobi keeps East Africa Time: at 22:30 in London on Monday it is
 * already 01:30 on Tuesday there. Every "today" an arrival is read against — booking from today, due today, late, said not
 * to have come once its day is over — is the hub's day, never the server's UTC one, and one `now` answers all of them.
 */
describe('a hub’s arrivals, on the hub’s own clock', () => {
  // Mon 26 Oct 2026, 22:30 UTC = Tue 27 Oct, 01:30 in Nairobi.
  const NOW = Date.parse('2026-10-26T22:30:00Z');
  const hub = { mdpId: 'mdp_1', did: 'did:hub:1', name: 'Nairobi Hub', zones: ['North'], location: { lat: -1.28, lng: 36.82 } };
  const parcels = new Map<string, Record<string, unknown>>();
  const parcel = (parcelId: string) => {
    const p = { parcelId, vendorId: 'v_1', status: 'Created', paidStatus: 'ParcelPaid', handInMdpId: 'mdp_1', destZone: 'South', destAgentDid: 'did:shop:south' };
    parcels.set(parcelId, p);
    return p;
  };
  const service = (contacts?: HubContactService) =>
    new HubArrivalService(
      { working: () => hub, require: () => hub, countryOf: () => 'KE' } as unknown as MdpService,
      {
        get: (id: string) => {
          const p = parcels.get(id);
          if (!p) throw new Error('No such parcel');
          return p;
        },
        list: () => [...parcels.values()],
      } as unknown as ParcelService,
      { get: () => ({ vendorId: 'v_1', name: 'Bulk Store', did: 'did:store:1' }) } as unknown as VendorService,
      {} as RoutingService,
      { get: () => ({ shopName: 'Riverside' }) } as unknown as AgentService,
      undefined,
      undefined,
      contacts,
    );
  const book = (svc: HubArrivalService, parcelId: string, expectedOn: string) =>
    svc.book('v_1', { mdpId: 'mdp_1', parcelIds: [parcelId], unitKind: 'pallet', units: 1, expectedOn }, 'Bulk Store', NOW);

  it('books from the hub’s today: its Tuesday, though the server’s day is still Monday', () => {
    const svc = service();
    svc.setBulk('mdp_1', { open: true }, 'Owner', NOW);
    parcel('PUD-A');
    expect(() => book(svc, 'PUD-A', '2026-10-26')).toThrow(/Choose today or a day ahead, on Nairobi Hub's clock/);
    expect(book(svc, 'PUD-A', '2026-10-27')).toMatchObject({ state: 'expected', today: true, late: false });
  });

  it('books only a day the hub receives — Saturday the last of its week, Sunday the first', () => {
    const svc = service();
    svc.setBulk('mdp_1', { open: true, hours: { sat: { open: '08:00', close: '12:00' } } }, 'Owner', NOW);
    parcel('PUD-SAT');
    // Sat 31 Oct and Sun 1 Nov 2026, on the hub's clock.
    expect(() => book(svc, 'PUD-SAT', '2026-11-01')).toThrow(/does not receive on a Sunday/);
    expect(book(svc, 'PUD-SAT', '2026-10-31')).toMatchObject({ state: 'expected', expectedOn: '2026-10-31' });
  });

  it('books, where the hub set no hours for bulk, only a day it is open — and keeps its bulk hours inside its opening hours', () => {
    const day = { open: '07:00', close: '18:00' };
    const opening = { sun: null, mon: day, tue: day, wed: day, thu: day, fri: day, sat: { open: '08:00', close: '12:00' } };
    const svc = service({ openingHoursOf: () => opening, atStop: () => undefined } as unknown as HubContactService);
    svc.setBulk('mdp_1', { open: true }, 'Owner', NOW);
    parcel('PUD-OPEN');
    // Sun 1 Nov 2026: the hub is closed. Sat 31 Oct: open.
    expect(() => book(svc, 'PUD-OPEN', '2026-11-01')).toThrow(/does not receive on a Sunday/);
    expect(book(svc, 'PUD-OPEN', '2026-10-31')).toMatchObject({ state: 'expected' });
    expect(() => svc.setBulk('mdp_1', { open: true, hours: { sat: { open: '08:00', close: '14:00' } } }, 'Owner', NOW)).toThrow(/The hub is not open then \(Saturday 08:00–14:00/);
  });

  it('reads due and late by the hub’s day, and says its clock with the hub’s word', () => {
    const svc = service();
    expect(svc.setBulk('mdp_1', { open: true }, 'Owner', NOW)).toMatchObject({ zone: 'Africa/Nairobi', zoneName: expect.stringMatching(/East Africa/) });
    parcel('PUD-B');
    const a = book(svc, 'PUD-B', '2026-10-27');
    // A day later on the hub's clock, nothing taken in at the door: late.
    expect(svc.forHub('mdp_1', NOW + 86_400_000).arrivals.find((x) => x.arrivalId === a.arrivalId)).toMatchObject({ today: false, late: true });
  });

  it('lets the hub say an arrival did not come only once its day is over there — not by the server’s day', () => {
    const svc = service();
    svc.setBulk('mdp_1', { open: true }, 'Owner', NOW);
    parcel('PUD-C');
    const a = book(svc, 'PUD-C', '2026-10-27');
    // Wed 28 Oct, 00:30 in Nairobi is still Tue 27 Oct, 21:30 UTC: its day is over at the hub.
    expect(svc.missed('mdp_1', a.arrivalId, 'Floor', Date.parse('2026-10-27T21:30:00Z'))).toMatchObject({ state: 'missed' });
    parcel('PUD-D');
    const b = book(svc, 'PUD-D', '2026-10-27');
    // Tue 27 Oct, 20:59 UTC is 23:59 on the 27th in Nairobi: still its day.
    expect(() => svc.missed('mdp_1', b.arrivalId, 'Floor', Date.parse('2026-10-27T20:59:00Z'))).toThrow(/It is due today/);
  });
});
