import { EventBus } from '../../foundation/events/event-bus.service';
import { ConsignmentNoteService } from './consignment-note.service';
import type { Freight } from './dispatch.types';

/**
 * FP2 — the consignment note: every box from a recorded fact, the right parties reading it, and the CMR title only
 * where a border is crossed.
 */
describe('the consignment note', () => {
  const freights: Record<string, Freight> = {};
  const base = (over: Partial<Freight>): Freight =>
    ({
      freightId: 'fr_1',
      code: 'FRT-010',
      description: 'Maize, 20 sacks',
      pickupLocation: { lat: -0.3, lng: 36.1 },
      pickupLabel: 'Mama Sarah Shop',
      destLabel: 'Riverside Corner',
      weightKg: 800,
      dimensionsCm: [200, 100, 100],
      cargoClass: 'P4',
      natureCode: 'GEN',
      requiredCapabilities: [],
      requiredEquipment: [],
      status: 'claimed',
      postedByDid: 'did:shop:a1',
      shipperDid: 'did:shop:a1',
      claimedBy: 'did:drv:amos',
      claimedAt: '2026-09-14T08:00:00Z',
      createdAt: '2026-09-14T07:30:00Z',
      lockedPrice: 350,
      pickupCountry: 'KE',
      destCountry: 'KE',
      ...over,
    }) as Freight;

  const service = new ConsignmentNoteService(
    // Nothing said on the road yet (round 14): no border, no hub.
    { requireFreightPublic: (id: string) => freights[id] ?? (() => { throw new Error('not found'); })(), passageFacts: () => ({}) } as never,
    { get: (did: string) => ({ displayName: 'Amos K.', managerDid: did === 'did:drv:amos' ? 'did:fleet:kilima' : undefined, jurisdiction: 'KE', ...(did === 'did:drv:stage' ? { carrierPlace: { station: { lat: -1.28333, lng: 36.81667, label: 'Kencom stage' }, at: '2026-10-28T10:00:00Z' } } : {}) }) } as never,
    { get: (did: string) => (did === 'did:fleet:jenga' ? { companyName: 'Jenga Freight', depotAddress: 'Enterprise Rd 4', jurisdiction: 'KE', did } : { companyName: 'Kilima Logistics', depotAddress: '1 Depot Rd', jurisdiction: 'KE', did: 'did:fleet:kilima' }) } as never,
    { get: (did: string) => ({ shopName: did === 'did:shop:a1' ? 'Mama Sarah Shop' : 'Riverside Corner', landmark: 'Next to the market', country: 'KE', did }) } as never,
    { has: (id: string) => id === 'ven_1', get: () => ({ did: 'did:store', name: 'Nairobi Threads', address: 'Biashara St 12', country: 'KE' }) } as never,
    new EventBus(),
    // The clearance pack for box 5. Named here so the note spec stays a note spec and does not have to
    // stand up a container to assert what a driver reads at a roadside.
    {
      papersOnNote: (code: string) => (code === 'IMP-001' ? ['Bill of lading — BL for IMP-001 (ab12cd34)'] : []),
      // Only a code the import register knows is a container. Everything else is a shop order, and the
      // note-s buyer reading is right for those.
      noteParties: (code: string) => (code === 'IMP-001' ? { sender: { name: 'Yukel Imports', country: 'KE' }, consignee: { name: 'Yukel Imports', country: 'KE' } } : null),
    } as never,
  );

  it('fills every box it can from the record, and says so where it cannot', () => {
    freights.fr_1 = base({});
    const n = service.build(freights.fr_1);
    expect(n).toMatchObject({ number: 'CMR-FRT-010', kind: 'national', title: 'Consignment note (CMR layout)' });
    expect(n.sender).toMatchObject({ name: 'Mama Sarah Shop', country: 'Kenya', did: 'did:shop:a1' });
    // Nobody named: the place, said as a place — never dressed up as an address (the CMR check, 2026-10-28).
    expect(n.consignee).toMatchObject({ name: 'Riverside Corner', address: 'The place of delivery the sender named; who receives there was not given' });
    expect(n.carrier).toMatchObject({ name: 'Kilima Logistics', driverName: 'Amos K.', country: 'Kenya' });
    expect(n.carrier?.plate).toBeUndefined(); // not taken over yet: no vehicle on the note
    expect(n.goods).toMatchObject({ grossKg: 800, volumeM3: 2, packages: null, dangerous: false });
    expect(n.carriage).toMatchObject({ amount: 350, paidBy: 'sender' });
    expect(n.confirmations.carrier).toBeUndefined();
    expect(n.takingOver.at).toBeUndefined();
  });

  it('carries the vehicle and the carrier’s confirmation once the goods are taken over, and the receiver’s gap once delivered', () => {
    freights.fr_1 = base({ status: 'delivered', pickedUpAt: '2026-09-14T09:00:00Z', deliveredAt: '2026-09-14T12:00:00Z', carriage: { vehicleId: 'v1', plate: 'KLM 001V', vehicleClass: 'van', driverDid: 'did:drv:amos', managerDid: 'did:fleet:kilima', at: '2026-09-14T09:00:00Z' }, loadSafety: { confirmed: ['a'], securementPhotoRef: 'med_1', at: '2026-09-14T09:00:00Z' } as never, unloadReport: { confirmed: ['x', 'y'], at: '2026-09-14T12:00:00Z' } });
    const n = service.build(freights.fr_1);
    expect(n.carrier).toMatchObject({ plate: 'KLM 001V', vehicleClass: 'van' });
    expect(n.confirmations.carrier).toMatchObject({ by: 'Amos K.', at: '2026-09-14T09:00:00Z' });
    expect(n.confirmations.consignee?.by).toMatch(/not recorded/);
    expect(n.documents).toEqual(['Photo of the secured load (med_1)', 'Unload report, 2 item(s) confirmed']);
  });

  it('FP7: box 13 carries what the sender wrote after what the load implies, and every subsequent instruction dated', () => {
    const note = service.build(base({ instructions: { text: 'Gate on the north side', contactName: 'Joseph', contactPhone: '+254700999888', deliveryWindow: 'before 10:00', at: '2026-09-14T07:30:00Z' }, instructionAmendments: [{ text: 'Leave it with the guard', at: '2026-09-14T10:00:00Z' }] }));
    expect(note.instructions).toEqual(['Deliver: before 10:00', 'Contact at delivery: Joseph, +254700999888', 'Gate on the north side', expect.stringMatching(/^Subsequent instruction, .*: Leave it with the guard$/)]);
    expect(service.build(base({})).instructions).toEqual([]);
  });

  it('FP3: the carrier’s reservations fill box 18, the proof of delivery fills box 24, and a cancelled load says so', () => {
    freights.fr_1 = base({ status: 'delivered', pickedUpAt: '2026-09-14T09:00:00Z', deliveredAt: '2026-09-14T12:00:00Z', reservations: { note: 'Two sacks torn', at: '2026-09-14T09:00:00Z', by: 'did:drv:amos' }, proofOfDelivery: { receiverName: 'Joseph Mwangi', photoRef: 'med_pod', remarks: 'One sack short', at: '2026-09-14T12:00:00Z', by: 'did:drv:amos' } });
    const n = service.build(freights.fr_1);
    // CMR Art. 8(2): not answered by the sender, so it does not bind the sender — said beside it.
    expect(n.reservations).toEqual(['At taking over: Two sacks torn — not agreed by the sender, so it does not bind the sender']);
    const answered = (answer: object) => service.build({ ...freights.fr_1, reservations: { ...freights.fr_1.reservations!, answer } } as never).reservations[0];
    expect(answered({ agreed: true, by: 'Hans', at: '2026-09-14T10:00:00Z' })).toBe('At taking over: Two sacks torn — agreed by the sender 14 Sep 2026, 10:00 UTC');
    expect(answered({ agreed: false, note: 'They were whole at loading: see the photo', by: 'Hans', at: '2026-09-14T10:00:00Z' })).toBe('At taking over: Two sacks torn — disputed by the sender 14 Sep 2026, 10:00 UTC: They were whole at loading: see the photo');
    expect(n.confirmations.consignee).toMatchObject({ by: 'Joseph Mwangi', at: '2026-09-14T12:00:00Z', remarks: 'Receiver’s remarks: One sack short' });
    expect(n.documents).toContain('Photo of the goods as delivered (med_pod)');
    const html = service.htmlFor(n);
    expect(html).toContain('Joseph Mwangi');
    expect(html).toContain('One sack short');
    freights.fr_1 = base({ status: 'cancelled', cancelledAt: '2026-09-14T08:30:00Z', cancellation: { by: 'did:shop:a1', role: 'shipper', reason: 'Customer changed their mind', at: '2026-09-14T08:30:00Z' } });
    const c = service.build(freights.fr_1);
    expect(c.cancelled).toMatchObject({ by: 'sender', reason: 'Customer changed their mind' });
    const chtml = service.htmlFor(c);
    expect(chtml).toContain('Never taken over — the load was cancelled');
    expect(chtml).toContain('Cancelled by the sender');
    expect(chtml).not.toContain('Not yet delivered');
  });

  it('refused by the consignee: box 24 says when and why, and what the sender decided — or that the 48 hours did (the user, 2026-10-27)', () => {
    const refusal = { at: '2026-10-27T08:00:00Z', by: 'did:drv:amos', note: 'Wrong colour', decideBy: '2026-10-29T08:00:00Z' };
    freights.fr_1 = base({ status: 'refused', pickedUpAt: '2026-10-27T06:00:00Z', deliveryAttempts: [{ outcome: 'refused', note: 'Wrong colour', at: '2026-10-27T08:00:00Z', by: 'did:drv:amos' }], refusal: { ...refusal, decision: { choice: 'back', at: '2026-10-27T10:00:00Z', by: 'did:shop:a1', destLabel: 'Depot', returnLeg: { freightId: 'fr_2', code: 'FRT-0002' } } } });
    const n = service.build(freights.fr_1);
    expect(n.refused?.line).toBe('Refused by the consignee 27 Oct 2026, 08:00 UTC — Wrong colour. The sender had the goods taken back to Depot as load FRT-0002, 27 Oct 2026, 10:00 UTC.');
    const html = service.htmlFor(n);
    expect(html).toContain('as load FRT-0002');
    expect(html).not.toContain('Not yet delivered');
    freights.fr_1 = base({ status: 'refused', refusal: { ...refusal, decision: { choice: 'back', at: '2026-10-29T08:00:00Z', byDeadline: true, destLabel: 'Depot', returnLeg: { freightId: 'fr_2', code: 'FRT-0002' } } } });
    expect(service.build(freights.fr_1).refused?.line).toContain('With no answer from the sender within 48 hours, the goods were taken back to Depot as load FRT-0002');
    freights.fr_1 = base({ status: 'refused', refusal: { ...refusal, decision: { choice: 'give_up', at: '2026-10-27T10:00:00Z', by: 'did:shop:a1' } } });
    expect(service.build(freights.fr_1).refused?.line).toContain('The sender gave the goods up');
    // …and the load they went on says, in box 18, where it came from.
    freights.fr_2 = base({ freightId: 'fr_2', status: 'in_transit', pickupLabel: 'Riverside Corner', pickedUpAt: '2026-10-27T10:00:00Z', returnOf: { freightId: 'fr_1', code: 'FRT-0001' } });
    expect(service.build(freights.fr_2).reservations).toContain('Carried on from load FRT-0001, refused by its consignee at Riverside Corner: taken over 27 Oct 2026, 10:00 UTC without leaving the vehicle');
  });

  it('FP3b: failed attempts and the claim show in box 24', () => {
    freights.fr_1 = base({ status: 'in_transit', pickedUpAt: '2026-09-14T09:00:00Z', deliveryAttempts: [{ outcome: 'absent', note: 'Gate locked', at: '2026-09-14T11:00:00Z', by: 'did:drv:amos' }] });
    const n = service.build(freights.fr_1);
    expect(n.attempts).toEqual(['Delivery attempted 14 Sep 2026, 11:00 UTC: nobody to receive the goods — Gate locked']);
    const html = service.htmlFor(n);
    expect(n.reservations).toContain(n.attempts[0]); // box 18 keeps it after delivery too
    expect(html).toContain('Gate locked');
    expect(html).toContain('Not yet delivered — 1 attempt(s), see box 18');
    freights.fr_1 = base({ status: 'delivered', pickedUpAt: '2026-09-14T09:00:00Z', deliveredAt: '2026-09-14T12:00:00Z', proofOfDelivery: { receiverName: 'Joseph Mwangi', photoRef: 'med_pod', at: '2026-09-14T12:00:00Z' }, claim: { state: 'resolved', kind: 'damaged', description: 'Three bags split', raisedBy: 'did:shop:a1', raisedAt: '2026-09-15T08:00:00Z', decision: 'upheld', award: 0, note: 'Settle it with the carrier', decidedAt: '2026-09-15T10:00:00Z', paidTo: { kind: 'between_parties' } } });
    const c = service.build(freights.fr_1);
    expect(c.claim).toEqual({ line: 'Claim by the sender 15 Sep 2026, 08:00 UTC — goods damaged: Three bags split', decision: 'Decided 15 Sep 2026, 10:00 UTC: upheld, to be settled between sender and carrier — Settle it with the carrier' });
    const chtml = service.htmlFor(c);
    expect(chtml).toContain('Joseph Mwangi');
    expect(chtml).toContain('goods damaged: Three bags split');
    expect(chtml).toContain('to be settled between sender and carrier');
  });

  it('across a border it names the law of the lane, and a store’s buyer without a phone number', () => {
    // Kenya to Uganda: no CMR country at either end — the Northern Corridor's road protocol (the user, 2026-10-28).
    freights.fr_1 = base({ pickupCountry: 'KE', destCountry: 'UG', shipperDid: 'ven_1', postedByDid: undefined, externalOrderId: 'SO-77', buyerPhoneHash: 'h' });
    const n = service.build(freights.fr_1);
    expect(n).toMatchObject({ kind: 'northern_corridor', title: 'International road consignment note — Northern Corridor' });
    const html = service.htmlFor(n);
    expect(html).toContain('subject, notwithstanding any clause to the contrary, to the provisions of Protocol No. 6 (road transport) of the Northern Corridor Transit and Transport Agreement');
    expect(html).not.toContain('(CMR)');
    expect(n.sender).toMatchObject({ name: 'Nairobi Threads', did: 'did:store' });
    expect(n.consignee).toMatchObject({ name: 'The buyer of order SO-77', address: 'Collects at Riverside Corner', country: 'Uganda' });
    expect(JSON.stringify(n)).not.toMatch(/\+254|buyerPhone/);
  });

  it('says the CMR only where it applies, the e-CMR only where it is in force, and no convention where none joins the two', () => {
    const cmr = service.build(base({ pickupCountry: 'NL', destCountry: 'DE' }));
    expect(cmr).toMatchObject({ kind: 'cmr', electronic: true, title: 'CMR — International consignment note' });
    const cmrPage = service.htmlFor(cmr);
    expect(cmrPage).toContain('This carriage is subject, notwithstanding any clause to the contrary, to the Convention on the Contract for the International Carriage of Goods by Road (CMR).');
    expect(cmrPage).toContain('Made out electronically under the Additional Protocol to the CMR concerning the electronic consignment note (e-CMR, 2008)');
    // Belgium signed the e-CMR and never ratified it: the CMR, on paper where paper is asked for.
    const paper = service.build(base({ pickupCountry: 'BE', destCountry: 'NL' }));
    expect(paper).toMatchObject({ kind: 'cmr' });
    expect(paper.electronic).toBeUndefined();
    expect(service.htmlFor(paper)).toContain('The e-CMR Protocol is not in force between Belgium and Netherlands');
    // Kenya to Tanzania: neither in the CMR, Tanzania not in the Northern Corridor.
    const none = service.build(base({ pickupCountry: 'KE', destCountry: 'TZ' }));
    expect(none).toMatchObject({ kind: 'contract', title: 'International road consignment note' });
    const nonePage = service.htmlFor(none);
    expect(nonePage).toContain('No international convention on the carriage of goods by road applies between Kenya and Tanzania');
    expect(nonePage).not.toContain('(CMR).');
    // Every note says where its procedures are (e-CMR Art. 5(2)), and has a line for a signature on paper.
    for (const page of [cmrPage, nonePage, service.htmlFor(service.build(base({})))]) {
      expect(page).toContain('/help/electronic-note/');
      expect((page.match(/Signed on paper:/g) ?? []).length).toBe(3);
    }
  });

  it('carries what the sender named: the consignee, dangerous goods by their recognised description, customs instructions', () => {
    const n = service.build(
      base({
        pickupCountry: 'KE',
        destCountry: 'UG',
        natureCode: 'HAZ-CHEM',
        consignee: { name: 'Kampala Build Co', address: 'Plot 4, Industrial Area, Kampala' },
        dangerousGoods: { unNumber: 'UN1263', properShippingName: 'Paint', hazardClass: '3', packingGroup: 'III' },
        customsInstructions: 'Cleared at Malaba by Pwani Clearing',
        bonded: true,
        bondCountry: 'KE',
        packaging: 'drummed',
      } as never),
    );
    expect(n.consignee).toEqual({ name: 'Kampala Build Co', address: 'Plot 4, Industrial Area, Kampala', country: 'Uganda' });
    expect(n.goods).toMatchObject({ natureWords: 'Chemicals', dangerous: true, dangerousGoods: { unNumber: 'UN1263', properShippingName: 'Paint', hazardClass: '3', packingGroup: 'III' } });
    expect(n.instructions.slice(0, 2)).toEqual(['For customs: Cleared at Malaba by Pwani Clearing', 'Uncleared goods, carried in bond: the carrier needs a transit licence of Kenya']);
    const html = service.htmlFor(n);
    expect(html).toContain('Dangerous goods: UN1263 Paint, class 3, packing group III');
    expect(html).toContain('<td>Chemicals</td>');
    expect(html).not.toContain('HAZ-CHEM ·');
    // Dangerous, and nothing declared: the note says what is missing rather than "dangerous" alone.
    const bare = service.htmlFor(service.build(base({ natureCode: 'HAZ-FLAM', requiredCapabilities: ['hazmat'] } as never)));
    expect(bare).toContain('UN number, proper shipping name, class and packing group not given by the sender');
    // Packages: loose goods are in bulk; otherwise a number the sender did not give is said so.
    expect(service.htmlFor(service.build(base({ packaging: 'loose', packages: undefined } as never)))).toContain('<td>In bulk</td>');
    expect(service.htmlFor(service.build(base({ packaging: 'bagged', packages: undefined } as never)))).toContain('Not stated by the sender');
    // The seals box has no number of its own: box 6 is the marks.
    expect(html).not.toMatch(/<span class="no">6<\/span>Seals/);
  });

  it('carries CMR’s particulars where applicable: a declared value, a special interest, no transhipment, an agreed time-limit', () => {
    const contract = { contractId: 'ctr_1', fleetDid: 'did:fleet:kilima', fleetName: 'Kilima Logistics', shipperName: 'Thika Avocados', reference: 'KL-07' };
    const n = service.build(
      base({
        declaredValue: { amount: 12500, currency: 'USD' },
        specialInterest: { amount: 800, currency: 'USD' },
        noTranshipment: true,
        contract,
        deliverOn: '2026-10-30',
        reloads: [{ at: '2026-09-14T10:00:00Z', fromPlate: 'KDA 123A', toPlate: 'KDB 456B', toDriverName: 'Juma', proof: 'pass', by: 'Juma', aboard: true }],
      } as never),
    );
    expect(n.agreements).toEqual([
      'Value of the goods declared by the sender: 12,500 USD',
      'Special interest in delivery declared by the sender: 800 USD',
      'Agreed time-limit: delivered on or before 2026-10-30, under contract KL-07 with Kilima Logistics',
    ]);
    expect(n.instructions).toContain('Transhipment is not allowed: the goods stay on the vehicle that took them over');
    expect(n.reservations.find((r) => r.startsWith('Reloaded'))).toMatch(/although the sender had said transhipment is not allowed$/);
    const html = service.htmlFor(n);
    expect(html).toContain('Value of the goods declared by the sender: 12,500 USD');
    // Without any: box 19 says none, as before.
    expect(service.build(base({ pickupCountry: 'KE', destCountry: 'TZ' })).agreements).toBeUndefined();
  });

  it('says an address is not recorded where the network holds none (CMR Art. 6(1)(b), (c), (e))', () => {
    // An owner-driver, with no fleet and no depot: the carrier box says so rather than looking filled.
    const n = service.build(base({ claimedBy: 'did:drv:solo', carrierDid: undefined } as never));
    expect(n.carrier).toMatchObject({ name: 'Amos K.', did: 'did:drv:solo' });
    expect(n.carrier?.address).toBeUndefined();
    expect(service.htmlFor(n)).toContain('<span class="empty">Address not recorded</span>');
    // Riding for themselves with no address but a pinned station: the station is the carrier's address (2026-10-28).
    expect(service.build(base({ claimedBy: 'did:drv:stage', carrierDid: undefined } as never)).carrier?.address).toBe('Station Kencom stage at -1.28333, 36.81667');
    // A fleet with its depot: its address, and nothing said of a gap.
    const fleet = service.build(base({}));
    expect(fleet.carrier?.address).toBe('1 Depot Rd');
  });

  it('names the fleet the sender contracted with in box 16, and the partner that carried it in box 17', () => {
    // Ordered from Jenga under contract, handed on to its partner Kilima, whose driver took the goods over.
    const contract = { contractId: 'ctr_1', fleetDid: 'did:fleet:jenga', fleetName: 'Jenga Freight', shipperName: 'Thika Avocados' };
    freights.fr_9 = base({ freightId: 'fr_9', contract, handOn: { state: 'partner', at: '2026-09-14T07:40:00Z', by: 'Wanjiru', partner: { fleetDid: 'did:fleet:kilima', fleetName: 'Kilima Logistics' }, via: { fleetDid: 'did:fleet:pwani', fleetName: 'Pwani Haulage' } }, pickedUpAt: '2026-09-14T09:00:00Z', carriage: { vehicleId: 'v1', plate: 'KDA 123A', vehicleClass: 'truck', driverDid: 'did:drv:amos' }, carrierDid: 'did:fleet:kilima' } as never);
    const n = service.build(freights.fr_9);
    expect(n.carrier).toEqual({ name: 'Jenga Freight', address: 'Enterprise Rd 4', country: 'Kenya', did: 'did:fleet:jenga' });
    expect(n.successive).toEqual([expect.objectContaining({ name: 'Kilima Logistics', did: 'did:fleet:kilima', driverName: 'Amos K.', plate: 'KDA 123A', takenOverAt: '2026-09-14T09:00:00Z', via: 'Pwani Haulage' })]);
    // Box 23 is signed by the driver who took the goods over.
    expect(n.confirmations.carrier?.by).toBe('Amos K.');
    const html = service.htmlFor(n);
    expect(html).toContain('Contracted with the sender; carried by the carrier in box 17');
    expect(html).toContain('Took the goods over 14 Sep 2026, 09:00 UTC');
    expect(html).toContain('Passed on by Pwani Haulage');
    // The contracted fleet answers for the order: it reads the note, and is among the parties the archive keeps.
    expect(service.isParty(freights.fr_9, 'did:fleet:jenga')).toBe(true);
    expect(service.partiesOf(freights.fr_9)).toContain('did:fleet:jenga');
    // Carried by the fleet it was ordered from: box 16 only, box 17 none.
    const own = service.build(base({ contract: { ...contract, fleetDid: 'did:fleet:kilima', fleetName: 'Kilima Logistics' } } as never));
    expect(own.carrier).toMatchObject({ name: 'Kilima Logistics', driverName: 'Amos K.' });
    expect(own.successive).toBeUndefined();
  });

  it('FP6: the tracking view shows the journey and the carrier at the door, and nothing a stranger with the link should not see', () => {
    const view = service.trackView(
      base({
        status: 'delivered',
        pickedUpAt: '2026-09-14T09:00:00Z',
        deliveredAt: '2026-09-14T12:04:00Z',
        carriage: { vehicleId: 'v1', plate: 'KLM 002B', vehicleClass: 'bike', driverDid: 'did:drv:amos', at: '2026-09-14T09:00:00Z' },
        deliveryAttempts: [{ outcome: 'absent', note: 'Gate locked, rang twice', at: '2026-09-14T11:00:00Z', by: 'did:drv:amos' }],
        proofOfDelivery: { receiverName: 'Joseph Mwangi', at: '2026-09-14T12:04:00Z', remarks: 'One sack torn' },
        buyerPhoneHash: 'ph_secret',
        trackingKey: 'T-ABC',
      }),
    );
    expect(view).toMatchObject({ kind: 'freight', ref: 'FRT-010', status: 'delivered', carrier: { name: 'Kilima Logistics', driverName: 'Amos K.', plate: 'KLM 002B' }, receiverName: 'Joseph Mwangi' });
    expect(view.steps.map((s) => s.status)).toEqual(['available', 'claimed', 'in_transit', 'delivered']);
    expect(view.attempts).toEqual([{ outcome: 'absent', at: '2026-09-14T11:00:00Z' }]);
    const text = JSON.stringify(view);
    for (const secret of ['ph_secret', 'Gate locked', 'One sack torn', 'T-ABC', '350', 'did:']) expect(text).not.toContain(secret);
    // FP7 — the sender's instructions, contact phone first of all, stay off the public page entirely.
    const instructed = service.trackView(base({ instructions: { text: 'North gate', contactName: 'Joseph', contactPhone: '+254700999888', deliveryWindow: 'before 10:00', at: '2026-09-14T07:30:00Z' }, instructionAmendments: [{ text: 'Leave with the guard', at: '2026-09-14T10:00:00Z' }] }));
    for (const secret of ['North gate', 'Joseph', '+254700999888', 'before 10:00', 'guard']) expect(JSON.stringify(instructed)).not.toContain(secret);
    // Withdrawn: when and by whom, never why.
    const gone = service.trackView(base({ status: 'cancelled', cancellation: { by: 'did:shop:a1', role: 'shipper', reason: 'Customer changed their mind', at: '2026-09-14T08:30:00Z' } }));
    expect(gone.cancelled).toEqual({ at: '2026-09-14T08:30:00Z', by: 'sender' });
    expect(JSON.stringify(gone)).not.toContain('changed their mind');
  });

  it('lets the sender, the driver, the driver’s fleet and staff read it — and tells a stranger it does not exist', () => {
    freights.fr_1 = base({});
    const read = (actor: object) => service.requireReader('fr_1', actor as never).code;
    expect(read({ role: 'agent', did: 'did:shop:a1' })).toBe('FRT-010');
    expect(read({ role: 'driver', did: 'did:drv:amos' })).toBe('FRT-010');
    expect(read({ role: 'fleet_manager', did: 'did:fleet:kilima' })).toBe('FRT-010');
    expect(read({ role: 'operator' })).toBe('FRT-010');
    expect(() => read({ role: 'agent', did: 'did:shop:other' })).toThrow('Freight not found');
  });

  it('renders a page with the number, every box, the tracking QR, and nothing unescaped', () => {
    freights.fr_1 = base({ description: '<b>Maize</b> & sacks', trackingKey: 'T-1234' });
    const html = service.htmlFor(service.build(freights.fr_1));
    expect(html).toContain('CMR-FRT-010');
    expect(html).toContain('&lt;b&gt;Maize&lt;/b&gt; &amp; sacks');
    expect(html).not.toContain('<b>Maize</b>');
    for (const no of ['>1<', '>2<', '>16<', '>20<', '>24<']) expect(html).toContain(`<span class="no">${no.replace(/[<>]/g, '')}</span>`);
    expect(html).toContain('<svg viewBox="0 0 120 120"');
    expect(html).toContain('T-1234');
  });
  it('names the IMPORTER on a container-s leg, and invents no buyer for it', () => {
    /*
     * Both found by reading the note a drive produced rather than by a unit test.
     *
     * Box 1 said "Sender" — the placeholder — because a container leg carries no shipper DID: an
     * importer is a COMPANY, and the freight machinery names parties by DID. Box 2 was worse: the note
     * reads externalOrderId as a shop order and printed "The buyer of order IMP-001", inventing a buyer
     * for a container nobody had sold.
     */
    const note = service.build(base({ externalOrderId: 'IMP-001', postedByDid: undefined, shipperDid: undefined }));
    expect(note.sender.name).toBe('Yukel Imports');
    expect(note.consignee.name).toBe('Yukel Imports');
    expect(note.consignee.name).not.toContain('buyer');
    // Sending your own goods to your own yard is an ordinary CMR; the CARRIER is the third party.
    expect(note.consignee.address).toBe('Riverside Corner');
    // The box itself, by its number, is the first of the marks: the seals on its door are recorded against it (ISO 17712).
    expect(note.goods.marks).toBeUndefined();
    expect(service.build(base({ externalOrderId: 'IMP-001', containerNo: 'MSKU1234565', postedByDid: undefined, shipperDid: undefined })).goods.marks).toEqual(['Container MSKU1234565']);
  });

  it('lists the clearance pack in box 5, which is what travels WITH the goods', () => {
    /*
     * A CMR box 5 is the documents attached. For an imported container that is the pack the agent asked
     * for and accepted, and until now the note listed only the photographs the driver took — so the one
     * page a roadside officer reads said nothing about the papers in the cab.
     */
    const note = service.build(base({ externalOrderId: 'IMP-001' }));
    expect(note.documents[0]).toContain('Bill of lading');
    // A container the note knows nothing about adds nothing, rather than an empty line.
    expect(service.build(base({ externalOrderId: 'IMP-404' })).documents).not.toContain(undefined);
  });

  it('D9: what the receiver found at the handover is written in box 24 beside their name, with its photographs in box 5', () => {
    const delivered = { status: 'delivered' as const, pickedUpAt: '2026-09-14T09:00:00Z', deliveredAt: '2026-09-14T12:00:00Z', packages: 400 };
    const pod = { receiverName: 'Peter Otieno', photoRef: 'med_pod', at: '2026-09-14T12:00:00Z', by: 'did:drv:amos' };
    // Nothing found: box 24 is the signature as it always was, with no reservations line.
    const clean = service.build(base({ ...delivered, proofOfDelivery: pod }));
    expect(clean.confirmations.consignee?.reservations).toBeUndefined();
    const n = service.build(
      base({
        ...delivered,
        proofOfDelivery: { ...pod, remarks: 'Bags split at the seam', exceptions: [{ kind: 'short', count: 3 }, { kind: 'damaged', count: 2, photoRefs: ['med_d1', 'med_d2'] }, { kind: 'wrong', count: 1, photoRefs: ['med_w1'] }] },
      }),
    );
    expect(n.confirmations.consignee).toMatchObject({ by: 'Peter Otieno', reservations: 'Received with reservations: 3 packages short, 2 packages damaged, 1 package not the goods the note describes', remarks: 'Receiver’s remarks: Bags split at the seam' });
    expect(n.documents).toEqual(expect.arrayContaining(['Photos of the goods found damaged at delivery (med_d1, med_d2)', 'Photo of the goods found wrong at delivery (med_w1)']));
    // Printed in box 24, after the signature.
    const html = service.htmlFor(n);
    const box24 = html.slice(html.indexOf('Goods received — signature and stamp of the consignee'));
    expect(box24).toContain('Received with reservations: 3 packages short, 2 packages damaged, 1 package not the goods the note describes');
  });

  it('a part refused at the handover (2026-10-27): box 24 has the reservation with the signature — and, once decided, what became of those packages', () => {
    const at = '2026-09-14T12:00:00Z';
    const delivered = { status: 'delivered' as const, pickedUpAt: '2026-09-14T09:00:00Z', deliveredAt: at, packages: 40, proofOfDelivery: { receiverName: 'Grace Wanjiru', at, exceptions: [{ kind: 'refused' as const, count: 2 }] } };
    const waiting = service.build(base({ ...delivered, refusal: { at, decideBy: '2026-09-16T12:00:00Z', part: { packages: 2, of: 40 } } }));
    expect(waiting.confirmations.consignee?.reservations).toBe('Received with reservations: 2 packages refused');
    expect(waiting.refused).toBeUndefined();
    const decided = service.build(base({ ...delivered, refusal: { at, decideBy: '2026-09-16T12:00:00Z', part: { packages: 2, of: 40 }, decision: { choice: 'back' as const, at: '2026-09-14T14:00:00Z', by: 'did:biz', destLabel: 'Athi River works', returnLeg: { freightId: 'frt_9', code: 'FRT-009' } } } }));
    const html = service.htmlFor(decided);
    const box24 = html.slice(html.indexOf('Goods received — signature and stamp of the consignee'));
    expect(box24).toContain('Received with reservations: 2 packages refused');
    expect(box24).toContain('2 of the 40 packages refused by the consignee');
    expect(box24).toContain('The sender had the goods taken back to Athi River works as load FRT-009');
  });

  it('the receiver’s copy (the user, 2026-10-26: “Its copy, no carriage price”): no price on it — unless the term makes the carriage the receiver’s to pay', () => {
    const at = '2026-09-14T12:00:00Z';
    const sent = { status: 'delivered' as const, lockedPrice: 41000, pickedUpAt: '2026-09-14T09:00:00Z', deliveredAt: at, proofOfDelivery: { receiverName: 'Grace', at }, receiver: { entityId: 'ent_jenga', siteId: 'site_1', name: 'Jenga Builders', siteName: 'Mombasa Road yard' } };
    const full = service.build(base(sent));
    expect(full.carriage.amount).toBe(41000);
    expect(full.copy).toBeUndefined();
    const copy = service.build(base(sent), { consignee: true });
    expect(copy).toMatchObject({ copy: 'consignee', title: 'Consignment note (CMR layout) — the receiver’s copy' });
    expect(copy.carriage.amount).toBeUndefined();
    expect(copy.carriage.note).toMatch(/^The carriage price is between the sender and the carrier/);
    expect(service.htmlFor(copy)).not.toContain('41000');
    // FCA: the risk passed at the origin and the carriage is the receiver's to pay — so is knowing its price.
    expect(service.build(base({ ...sent, incoterm: 'FCA', namedPlace: 'Athi River' }), { consignee: true }).carriage.amount).toBe(41000);
    // A decision's money stays off the receiver's copy; that it was decided does not.
    const decided = { ...sent, claim: { state: 'resolved' as const, kind: 'damaged' as const, description: 'Two bags split', raisedBy: 'did:shop:a1', raisedAt: at, decision: 'upheld' as const, award: 500, decidedAt: at } };
    expect(service.build(base(decided)).claim?.decision).toMatch(/500 KES awarded/);
    expect(service.build(base(decided), { consignee: true }).claim?.decision).toMatch(/^Decided .*: upheld$/);
  });

  it('inbound, reading A: a load sent to a receiving point names its business and place in box 2, by its code — not as the sender named it', () => {
    const n = service.build(base({ destLabel: 'Jenga Builders — Mombasa Road yard', receiver: { entityId: 'ent_jenga', siteId: 'site_1', name: 'Jenga Builders', siteName: 'Mombasa Road yard' }, receiverRef: 'PO-7781' }));
    expect(n.consignee).toEqual({ name: 'Jenga Builders', address: 'Mombasa Road yard, by its receiving code — their order PO-7781', country: 'Kenya' });
  });
});