import { filterVendorLedger, ledgerRowOf, vendorLedgerSummaryOf, vendorLedgerToCsv, type VendorSettlement } from './vendor.service';

/** A minimal ledger entry carrying only the register-relevant fields. */
function entry(over: Partial<VendorSettlement>): VendorSettlement {
  return { id: 'vs_x', vendorId: 'ven_1', country: 'KE', type: 'BILLING', sign: '-', amount: 10, at: '2026-08-01T10:00:00Z', ...over } as VendorSettlement;
}

const rows: VendorSettlement[] = [
  entry({ id: 'A', type: 'TOP_UP', sign: '+', amount: 100, note: 'prepay', at: '2026-08-01T10:00:00Z' }),
  entry({ id: 'B', type: 'BILLING', sign: '-', amount: 12, parcelId: 'PUD-1', note: 'shipment', at: '2026-08-03T10:00:00Z' }),
  entry({ id: 'C', type: 'BILLING', sign: '-', amount: 20, parcelId: 'PUD-2', note: 'shipment', at: '2026-08-05T10:00:00Z' }),
  entry({ id: 'D', type: 'REBATE', sign: '+', amount: 5, parcelId: 'PUD-1', note: 'flexible-route rebate', at: '2026-08-04T10:00:00Z' }),
];

describe('vendor bookkeeping register (R3)', () => {
  describe('filterVendorLedger', () => {
    it('defaults to newest-first (by date), and sorts by date/amount', () => {
      expect(filterVendorLedger(rows, {}).map((s) => s.id)).toEqual(['C', 'D', 'B', 'A']);
      expect(filterVendorLedger(rows, { sort: 'oldest' }).map((s) => s.id)).toEqual(['A', 'B', 'D', 'C']);
      expect(filterVendorLedger(rows, { sort: 'amount_desc' }).map((s) => s.id)).toEqual(['A', 'C', 'B', 'D']);
      expect(filterVendorLedger(rows, { sort: 'amount_asc' }).map((s) => s.id)).toEqual(['D', 'B', 'C', 'A']);
    });

    it('filters by type and by direction (in = received, out = spent)', () => {
      expect(filterVendorLedger(rows, { type: 'BILLING' }).map((s) => s.id).sort()).toEqual(['B', 'C']);
      expect(filterVendorLedger(rows, { direction: 'in' }).map((s) => s.id).sort()).toEqual(['A', 'D']);
      expect(filterVendorLedger(rows, { direction: 'out' }).map((s) => s.id).sort()).toEqual(['B', 'C']);
    });

    it('searches parcel id / note / type word, and filters by date range', () => {
      expect(filterVendorLedger(rows, { q: 'PUD-2' }).map((s) => s.id)).toEqual(['C']); // parcel id
      expect(filterVendorLedger(rows, { q: 'rebate' }).map((s) => s.id)).toEqual(['D']); // type word
      expect(filterVendorLedger(rows, { q: 'top-up' }).map((s) => s.id)).toEqual(['A']); // type word
      expect(filterVendorLedger(rows, { from: '2026-08-04', to: '2026-08-05' }).map((s) => s.id)).toEqual(['C', 'D']);
    });
  });

  describe('vendorLedgerSummaryOf', () => {
    it('sums money in (top-ups + rebates), out (shipments) and the net — and says what in', () => {
      // A total with no currency is not a figure. These rows are a Kenyan vendor's, hence KES.
      expect(vendorLedgerSummaryOf(rows)).toEqual({ in: 105, out: 32, net: 73, count: 4, currency: 'KES' });
    });

    it('reflects the FILTERED view (out only → net is negative)', () => {
      expect(vendorLedgerSummaryOf(filterVendorLedger(rows, { direction: 'out' }))).toEqual({ in: 0, out: 32, net: -32, count: 2, currency: 'KES' });
    });

    it('is all-zero for an empty book, and still names a currency', () => {
      expect(vendorLedgerSummaryOf([])).toEqual({ in: 0, out: 0, net: 0, count: 0, currency: 'KES' });
    });
  });

  describe('vendorLedgerToCsv', () => {
    it('exports a SIGNED numeric amount (a real negative for money out) + a direction column', () => {
      const csv = vendorLedgerToCsv(filterVendorLedger(rows, { type: 'BILLING', sort: 'oldest' }));
      const lines = csv.split('\r\n');
      expect(lines[0]).toBe('Date,Type,Direction,Amount,Currency,Parcel,Note');
      expect(lines[1]).toBe('2026-08-03T10:00:00Z,Shipment,out,-12,KES,PUD-1,shipment');
      expect(lines[2]).toContain(',out,-20,KES,PUD-2,');
      expect(lines).toHaveLength(3); // header + B + C
    });
  });

  describe('ledgerRowOf', () => {
    it('drops the internal vendorId/country, keeping the register fields', () => {
      expect(ledgerRowOf(rows[1])).toEqual({ id: 'B', type: 'BILLING', sign: '-', amount: 12, currency: 'KES', parcelId: 'PUD-1', note: 'shipment', at: '2026-08-03T10:00:00Z' });
    });

    it('resolves the currency of a row written before the field existed, from its country', () => {
      // These fixtures carry no `currency` — exactly like every row already on disk. The country was
      // always there, so the answer is derivable; it was simply never stated.
      expect(rows[1].currency).toBeUndefined();
      expect(ledgerRowOf(rows[1]).currency).toBe('KES');
      expect(ledgerRowOf({ ...rows[1], country: 'NL' }).currency).toBe('EUR');
    });
  });
});
