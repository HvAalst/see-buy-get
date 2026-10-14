import { filterVendorParcels, rateImpactOf, vendorOrderRowOf, vendorOrderStatsOf, vendorOrdersToCsv } from './parcel.service';
import type { Parcel } from './pudo.types';

/** A minimal Parcel carrying only the register-relevant fields. */
function parcel(over: Partial<Parcel>): Parcel {
  return {
    parcelId: 'PCL-1',
    receiverMobile: '+254700000000',
    destZone: 'Z1',
    size: 'M',
    status: 'At_PUDO',
    acceptedAt: '2026-08-01T10:00:00Z',
    scans: [],
    ...over,
  } as Parcel;
}

const rows: Parcel[] = [
  parcel({ parcelId: 'A', did: 'did:shipment:aaa', externalOrderId: 'SO-1', receiverMobile: '+254700111111', buyerEmail: 'amina@example.com', items: [{ name: 'Ankara shirt', qty: 2 }], destZone: 'Westlands', destAgentDid: 'did:agent:1', status: 'At_PUDO', paidStatus: 'ParcelPaid', shipmentCost: 12, acceptedAt: '2026-08-03T10:00:00Z' }),
  parcel({ parcelId: 'B', did: 'did:shipment:bbb', externalOrderId: 'SO-2', receiverMobile: '+254700222222', items: [{ name: 'Kitenge scarf', qty: 1 }], destZone: 'Karen', destAgentDid: 'did:agent:2', status: 'Delivered', paidStatus: 'unpaid', shipmentCost: 30, acceptedAt: '2026-08-01T10:00:00Z' }),
  parcel({ parcelId: 'C', did: 'did:shipment:ccc', externalOrderId: 'SO-3', receiverMobile: '+254700333333', items: [{ name: 'Denim jacket', qty: 1 }], destZone: 'Westlands', destAgentDid: 'did:agent:1', status: 'At_PUDO', paidStatus: 'ParcelPaid', shipmentCost: 20, acceptedAt: '2026-08-05T10:00:00Z' }),
];

describe('rate impact — what a margin change did', () => {
  const KE = 'sbg-ke';
  const priced = (over: Partial<Parcel>): Parcel =>
    ({ parcelId: 'P', originAgentDid: 'a', originZone: 'Z', destZone: 'Z', senderMobile: '+1', receiverMobile: '+2', size: 'M', status: 'Delivered', collectingEntityId: KE, scans: [], ...over }) as unknown as Parcel;

  it('splits contiguous SPELLS so a rate raised and lowered again reads as two periods', () => {
    const rows: Parcel[] = [
      priced({ parcelId: 'A', acceptedAt: '2026-01-01T00:00:00Z', platformFeePct: 0.02, shipmentCost: 10, platformFee: 0.2 }),
      priced({ parcelId: 'B', acceptedAt: '2026-01-02T00:00:00Z', platformFeePct: 0.02, shipmentCost: 10, platformFee: 0.2 }),
      priced({ parcelId: 'C', acceptedAt: '2026-02-01T00:00:00Z', platformFeePct: 0.05, shipmentCost: 10, platformFee: 0.5 }),
      priced({ parcelId: 'D', acceptedAt: '2026-03-01T00:00:00Z', platformFeePct: 0.02, shipmentCost: 10, platformFee: 0.2 }),
    ];
    const { spells, unpriced } = rateImpactOf(rows, KE, KE);

    // Three spells, not two rates: merging the 2% periods would hide the very comparison this is for.
    expect(spells.map((s) => s.feePct)).toEqual([0.02, 0.05, 0.02]);
    expect(spells.map((s) => s.shipments)).toEqual([2, 1, 1]);
    expect(spells[0]).toMatchObject({ gross: 20, margin: 0.4, avgMargin: 0.2, from: '2026-01-01T00:00:00Z', to: '2026-01-02T00:00:00Z' });
    expect(spells[1].avgMargin).toBe(0.5); // more per parcel…
    expect(spells[1].shipments).toBeLessThan(spells[0].shipments); // …and this is the half you can only observe
    expect(unpriced).toBe(0);
  });

  it('counts walk-ups separately rather than diluting rates they were never sold at', () => {
    const rows: Parcel[] = [
      priced({ parcelId: 'A', acceptedAt: '2026-01-01T00:00:00Z', platformFeePct: 0.02, shipmentCost: 10, platformFee: 0.2 }),
      priced({ parcelId: 'W', acceptedAt: '2026-01-02T00:00:00Z' }), // cash walk-up: no quote, no margin
    ];
    const { spells, unpriced } = rateImpactOf(rows, KE, KE);
    expect(spells).toHaveLength(1);
    expect(spells[0].shipments).toBe(1);
    expect(unpriced).toBe(1); // visible, not hidden
  });

  it('scopes to one sister, and attributes a pre-entity parcel to the home sister', () => {
    const rows: Parcel[] = [
      priced({ parcelId: 'A', acceptedAt: '2026-01-01T00:00:00Z', platformFeePct: 0.02, shipmentCost: 10, platformFee: 0.2 }),
      priced({ parcelId: 'N', acceptedAt: '2026-01-02T00:00:00Z', collectingEntityId: 'sbg-nl', platformFeePct: 0.02, shipmentCost: 10, platformFee: 0.2 }),
      priced({ parcelId: 'O', acceptedAt: '2026-01-03T00:00:00Z', collectingEntityId: undefined, platformFeePct: 0.02, shipmentCost: 10, platformFee: 0.2 }),
    ];
    expect(rateImpactOf(rows, KE, KE).spells[0].shipments).toBe(2); // A + the pre-entity one
    expect(rateImpactOf(rows, KE, 'sbg-nl').spells[0].shipments).toBe(1);
  });
});

describe('vendor shipment register (R0)', () => {
  describe('filterVendorParcels', () => {
    it('defaults to newest-first (by acceptedAt)', () => {
      expect(filterVendorParcels(rows, {}).map((p) => p.parcelId)).toEqual(['C', 'A', 'B']);
      expect(filterVendorParcels(rows, { sort: 'oldest' }).map((p) => p.parcelId)).toEqual(['B', 'A', 'C']);
      expect(filterVendorParcels(rows, { sort: 'cost_desc' }).map((p) => p.parcelId)).toEqual(['B', 'C', 'A']);
    });

    it('searches order-ref / DID / buyer / product name (case-insensitive)', () => {
      expect(filterVendorParcels(rows, { q: 'kitenge' }).map((p) => p.parcelId)).toEqual(['B']); // product
      expect(filterVendorParcels(rows, { q: 'SO-1' }).map((p) => p.parcelId)).toEqual(['A']); // order ref
      expect(filterVendorParcels(rows, { q: 'ccc' }).map((p) => p.parcelId)).toEqual(['C']); // DID
      expect(filterVendorParcels(rows, { q: '222222' }).map((p) => p.parcelId)).toEqual(['B']); // buyer mobile
      expect(filterVendorParcels(rows, { q: 'amina' }).map((p) => p.parcelId)).toEqual(['A']); // buyer email
      expect(filterVendorParcels(rows, { q: 'nope' })).toHaveLength(0);
    });

    it('filters by status, PUDO, paid and date range', () => {
      expect(filterVendorParcels(rows, { status: 'At_PUDO' }).map((p) => p.parcelId).sort()).toEqual(['A', 'C']);
      expect(filterVendorParcels(rows, { pudo: 'did:agent:2' }).map((p) => p.parcelId)).toEqual(['B']);
      expect(filterVendorParcels(rows, { paid: 'unpaid' }).map((p) => p.parcelId)).toEqual(['B']);
      expect(filterVendorParcels(rows, { paid: 'paid' }).map((p) => p.parcelId).sort()).toEqual(['A', 'C']);
      expect(filterVendorParcels(rows, { from: '2026-08-02', to: '2026-08-04' }).map((p) => p.parcelId)).toEqual(['A']);
    });

    it('combines filters (Westlands + paid → A, C newest-first)', () => {
      expect(filterVendorParcels(rows, { q: 'westlands', paid: 'paid' }).map((p) => p.parcelId)).toEqual(['C', 'A']);
    });
  });

  describe('vendorOrderRowOf', () => {
    it('surfaces the DID, buyer and product names the raw list lacked', () => {
      const row = vendorOrderRowOf(rows[0]);
      expect(row).toMatchObject({ parcelId: 'A', did: 'did:shipment:aaa', buyer: '+254700111111', products: 'Ankara shirt ×2', destZone: 'Westlands', createdAt: '2026-08-03T10:00:00Z' });
    });
  });

  describe('vendorOrdersToCsv', () => {
    it('exports a header + one row per matched parcel', () => {
      const csv = vendorOrdersToCsv(filterVendorParcels(rows, { status: 'At_PUDO', sort: 'oldest' }));
      const lines = csv.split('\r\n');
      expect(lines[0]).toBe('Order,Shipment DID,Buyer,Products,Status,Paid,Destination,Shipping cost,Buyer charge,Currency,Created');
      expect(lines).toHaveLength(3); // header + A + C
      expect(lines[1]).toContain('SO-1');
      expect(lines[1]).toContain('Ankara shirt');
    });
  });

  describe('vendorOrderStatsOf', () => {
    it('counts the WHOLE store (never a page): total, unpaid, and still-moving', () => {
      // rows: A At_PUDO/paid, B Delivered/unpaid, C At_PUDO/paid
      expect(vendorOrderStatsOf(rows)).toEqual({ total: 3, unpaid: 1, active: 2 });
    });

    it('excludes both Delivered and Voided from active, and counts every non-ParcelPaid as unpaid', () => {
      const withVoided = [...rows, parcel({ parcelId: 'D', status: 'Voided', paidStatus: 'unpaid' })];
      // active = A, C (B Delivered and D Voided are out); unpaid = B, D
      expect(vendorOrderStatsOf(withVoided)).toEqual({ total: 4, unpaid: 2, active: 2 });
    });

    it('is all-zero for a store with no shipments', () => {
      expect(vendorOrderStatsOf([])).toEqual({ total: 0, unpaid: 0, active: 0 });
    });
  });
});
