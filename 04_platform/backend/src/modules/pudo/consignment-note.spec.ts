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
    { get: (did: string) => ({ displayName: 'Amos K.', managerDid: did === 'did:drv:amos' ? 'did:fleet:kilima' : undefined, jurisdiction: 'KE' }) } as never,
    { get: () => ({ companyName: 'Kilima Logistics', depotAddress: '1 Depot Rd', jurisdiction: 'KE', did: 'did:fleet:kilima' }) } as never,
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
    expect(n.consignee).toMatchObject({ name: 'Riverside Corner', address: 'As named by the sender' });
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
    expect(n.reservations).toEqual(['At taking over: Two sacks torn']);
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