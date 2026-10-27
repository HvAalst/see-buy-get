import { HubArrivalService } from './hub-arrival.service';
import type { AgentService } from './agent.service';
import type { HubContactService } from './hub-contact.service';
import type { MdpService } from './mdp.service';
import type { ParcelService } from './parcel.service';
import type { RoutingService } from './routing.service';
import type { VendorService } from './vendor.service';
import type { WalletGateService } from './wallet-gate.service';

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

  it('books today only while the hub still receives, on its own clock — not once it has closed', () => {
    const svc = service();
    // Tue 27 Oct in Nairobi: receiving 01:00–02:00, and it is 01:30 there.
    svc.setBulk('mdp_1', { open: true, hours: { tue: { open: '01:00', close: '02:00' }, wed: { open: '01:00', close: '02:00' } } }, 'Owner', NOW);
    parcel('PUD-LATE');
    expect(book(svc, 'PUD-LATE', '2026-10-27')).toMatchObject({ state: 'expected', today: true });
    const later = new HubArrivalService(
      { working: () => hub, require: () => hub, countryOf: () => 'KE' } as unknown as MdpService,
      { get: (id: string) => parcels.get(id), list: () => [...parcels.values()] } as unknown as ParcelService,
      { get: () => ({ vendorId: 'v_1', name: 'Bulk Store', did: 'did:store:1' }) } as unknown as VendorService,
      {} as RoutingService,
      { get: () => ({ shopName: 'Riverside' }) } as unknown as AgentService,
    );
    // Half an hour later it is 02:00 there: it has stopped receiving for today. Tomorrow is still open to book.
    const AFTER = NOW + 30 * 60_000;
    later.setBulk('mdp_1', { open: true, hours: { tue: { open: '01:00', close: '02:00' }, wed: { open: '01:00', close: '02:00' } } }, 'Owner', AFTER);
    parcel('PUD-LATER');
    expect(() => later.book('v_1', { mdpId: 'mdp_1', parcelIds: ['PUD-LATER'], unitKind: 'pallet', units: 1, expectedOn: '2026-10-27' }, 'Bulk Store', AFTER)).toThrow(/Nairobi Hub stopped receiving at 02:00 today, on its clock: choose a day ahead/);
    expect(later.book('v_1', { mdpId: 'mdp_1', parcelIds: ['PUD-LATER'], unitKind: 'pallet', units: 1, expectedOn: '2026-10-28' }, 'Bulk Store', AFTER)).toMatchObject({ state: 'expected', today: false });
  });

  it('counts the store’s empties out at the door, to whoever brought them: once they came, once, and no more than came (D11; the user, 2026-10-26)', () => {
    const svc = service();
    svc.setBulk('mdp_1', { open: true }, 'Owner', NOW);
    parcel('PUD-E');
    const a = book(svc, 'PUD-E', '2026-10-27');
    expect(() => svc.emptiesBack('mdp_1', a.arrivalId, 1, 'Floor', NOW)).toThrow(/Take it in at the door first/);
    svc.receive('mdp_1', a.arrivalId, { units: 2 }, 'Floor', NOW);
    expect(() => svc.emptiesBack('mdp_1', a.arrivalId, 3, 'Floor', NOW)).toThrow(/from none to the 2 that came/);
    expect(svc.emptiesBack('mdp_1', a.arrivalId, 2, 'Floor', NOW).emptiesBack).toEqual({ units: 2, at: new Date(NOW).toISOString(), by: 'Floor' });
    expect(() => svc.emptiesBack('mdp_1', a.arrivalId, 1, 'Floor', NOW)).toThrow(/Counted out already: 2 pallets went back with whoever brought them/);
    // The store reads it on its arrival.
    expect(svc.forStore('v_1', NOW).arrivals.find((x) => x.arrivalId === a.arrivalId)?.emptiesBack).toMatchObject({ units: 2, by: 'Floor' });
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

  /**
   * THE RECEIVING FEE (D12; the user, 2026-10-26: "Its own fee"): locked when booked, so a fee changed afterwards is the next
   * booking's; refused before anything is written where the store's balance cannot carry it; the hub paid its own fee for
   * what it counted, at its door.
   */
  describe('the hub’s fee per handling unit', () => {
    const billed: unknown[][] = [];
    const given: unknown[][] = [];
    const paid: unknown[][] = [];
    let funds = 1000;
    const withFee = () =>
      new HubArrivalService(
        { working: () => hub, require: () => hub, countryOf: () => 'KE', currencyOf: () => 'KES', entityIdOrNone: () => 'ke' } as unknown as MdpService,
        { get: (id: string) => parcels.get(id), list: () => [...parcels.values()] } as unknown as ParcelService,
        {
          get: () => ({ vendorId: 'v_1', name: 'Bulk Store', did: 'did:store:1', country: 'KE' }),
          entityIdOf: () => 'ke',
          entityIdOrNone: () => 'ke',
          balanceOf: () => funds,
          billShipment: (...args: unknown[]) => {
            billed.push(args);
            funds -= args[2] as number;
            return { paid: true, balance: funds };
          },
          rebate: (...args: unknown[]) => {
            given.push(args);
            funds += args[2] as number;
          },
        } as unknown as VendorService,
        // One unit as the store pays: the hub's fee and a fifth on top, of which 0.16 of the fee is tax.
        { receivingUnit: (perUnit: number) => ({ currency: 'KES', gross: perUnit * 1.2, tax: perUnit * 0.16, buffer: 0, provision: 0 }) } as unknown as RoutingService,
        { get: () => ({ shopName: 'Riverside' }) } as unknown as AgentService,
        undefined,
        undefined,
        undefined,
        { receivingLabour: (...args: unknown[]) => paid.push(args) } as unknown as WalletGateService,
      );

    it('locks the fee at booking: the hub raising it afterwards is the next booking’s, and the hub is paid the one it was booked at', () => {
      const svc = withFee();
      svc.setBulk('mdp_1', { open: true, fees: { pallet: 100 } }, 'Owner', NOW);
      parcel('PUD-FEE-1');
      const a = book(svc, 'PUD-FEE-1', '2026-10-27');
      expect(a.fee).toMatchObject({ perUnit: 100, unitGross: 120, charged: 120, chargedUnits: 1 });
      expect(billed[0]).toEqual(['v_1', a.arrivalId, 120, 0, 16, 0, { kind: 'hub-receiving', note: 'receiving at Nairobi Hub: 1 pallet' }]);
      svc.setBulk('mdp_1', { open: true, fees: { pallet: 250 } }, 'Owner', NOW);
      // Two counted against one booked: the second charged at the fee it was booked at; the hub paid 100 for each.
      const door = svc.receive('mdp_1', a.arrivalId, { units: 2 }, 'Floor', NOW);
      expect(billed[1]?.slice(2, 5)).toEqual([120, 0, 16]);
      expect(paid[0]).toEqual(['mdp_1', 200, a.arrivalId, 'ke', 'ke']);
      expect(door.fee).toEqual({ perUnit: 100, currency: 'KES', paid: 200, paidUnits: 2 });
    });

    it('refuses a booking its balance cannot carry before anything is written — and writes nothing where the kind is free', () => {
      const svc = withFee();
      svc.setBulk('mdp_1', { open: true, fees: { pallet: 100 } }, 'Owner', NOW);
      funds = 50;
      const charges = billed.length;
      parcel('PUD-FEE-2');
      expect(() => book(svc, 'PUD-FEE-2', '2026-10-27')).toThrow(/Top up first — taking in 1 pallet at Nairobi Hub costs KES 120.00, and your balance is KES 50.00/);
      expect(billed).toHaveLength(charges);
      expect(svc.forStore('v_1', NOW).arrivals.filter((x) => x.parcels.some((p) => p.parcelId === 'PUD-FEE-2'))).toHaveLength(0);
      // Cartons cost nothing at this hub: booked with no charge, and no fee on the arrival.
      const free = svc.book('v_1', { mdpId: 'mdp_1', parcelIds: ['PUD-FEE-2'], unitKind: 'carton', units: 3, expectedOn: '2026-10-27' }, 'Bulk Store', NOW);
      expect(free.fee).toBeUndefined();
      expect(billed).toHaveLength(charges);
      funds = 1000;
    });

    it('gives back booked units not counted at the door, and all of it where nothing came or it was withdrawn — tax and all', () => {
      const svc = withFee();
      svc.setBulk('mdp_1', { open: true, fees: { pallet: 100 } }, 'Owner', NOW);
      parcel('PUD-FEE-3');
      parcel('PUD-FEE-4');
      const three = svc.book('v_1', { mdpId: 'mdp_1', parcelIds: ['PUD-FEE-3'], unitKind: 'pallet', units: 3, expectedOn: '2026-10-27' }, 'Bulk Store', NOW);
      const before = given.length;
      svc.receive('mdp_1', three.arrivalId, { units: 1 }, 'Floor', NOW);
      expect(given[before]?.slice(0, 3)).toEqual(['v_1', three.arrivalId, 240]);
      expect(given[before]?.slice(4)).toEqual([32, 0]);
      const gone = book(svc, 'PUD-FEE-4', '2026-10-27');
      expect(svc.withdraw('v_1', gone.arrivalId, 'Bulk Store', NOW).fee).toMatchObject({ refunded: 120, refundedUnits: 1 });
    });

    it('takes only known kinds of unit, a sum of money each; 0 or null leaves a kind free', () => {
      const svc = withFee();
      expect(() => svc.setBulk('mdp_1', { open: true, fees: { crate: 5 } }, 'Owner', NOW)).toThrow(/crate is not a kind of unit/);
      expect(() => svc.setBulk('mdp_1', { open: true, fees: { pallet: -1 } }, 'Owner', NOW)).toThrow(/A fee is a sum of money/);
      expect(svc.setBulk('mdp_1', { open: true, fees: { pallet: 12.345, carton: 0, sack: null } }, 'Owner', NOW)).toMatchObject({ fees: { pallet: 12.35 }, feeCurrency: 'KES' });
      expect(svc.setBulk('mdp_1', { open: true, fees: null }, 'Owner', NOW)?.fees).toBeUndefined();
    });
  });
});
