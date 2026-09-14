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
    { requireFreightPublic: (id: string) => freights[id] ?? (() => { throw new Error('not found'); })() } as never,
    { get: (did: string) => ({ displayName: 'Amos K.', managerDid: did === 'did:drv:amos' ? 'did:fleet:kilima' : undefined, jurisdiction: 'KE' }) } as never,
    { get: () => ({ companyName: 'Kilima Logistics', depotAddress: '1 Depot Rd', jurisdiction: 'KE', did: 'did:fleet:kilima' }) } as never,
    { get: (did: string) => ({ shopName: did === 'did:shop:a1' ? 'Mama Sarah Shop' : 'Riverside Corner', landmark: 'Next to the market', country: 'KE', did }) } as never,
    { has: (id: string) => id === 'ven_1', get: () => ({ did: 'did:store', name: 'Nairobi Threads', address: 'Biashara St 12', country: 'KE' }) } as never,
    new EventBus(),
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

  it('is a CMR note when a border is crossed, and names a store’s buyer without a phone number', () => {
    freights.fr_1 = base({ pickupCountry: 'KE', destCountry: 'UG', shipperDid: 'ven_1', postedByDid: undefined, externalOrderId: 'SO-77', buyerPhoneHash: 'h' });
    const n = service.build(freights.fr_1);
    expect(n).toMatchObject({ kind: 'cmr', title: 'CMR — International consignment note' });
    expect(n.sender).toMatchObject({ name: 'Nairobi Threads', did: 'did:store' });
    expect(n.consignee).toMatchObject({ name: 'The buyer of order SO-77', address: 'Collects at Riverside Corner', country: 'Uganda' });
    expect(JSON.stringify(n)).not.toMatch(/\+254|buyerPhone/);
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
});
