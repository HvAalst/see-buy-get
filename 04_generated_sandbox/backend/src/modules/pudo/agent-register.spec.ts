import { agentParcelRole, agentParcelRowOf, agentParcelsToCsv, filterAgentParcels } from './parcel.service';
import { agentLedgerRowOf, agentLedgerSummaryOf, agentLedgerToCsv, filterAgentLedger } from './wallet-gate.service';
import type { Parcel, PudoLedgerEntry } from './pudo.types';

const A = 'did:agent:A';

function parcel(over: Partial<Parcel>): Parcel {
  return { parcelId: 'P', originAgentDid: A, originZone: 'Z-A', destZone: 'Z-B', destAgentDid: 'did:agent:B', senderMobile: '+254701', receiverMobile: '+254700', size: 'M', status: 'At_PUDO', acceptedAt: '2026-08-01T10:00:00Z', scans: [] } as unknown as Parcel;
}

// P1 dropped off here (origin), P2 collected here (dest), P3 dropped off here (origin).
const parcels: Parcel[] = [
  { ...parcel({}), parcelId: 'P1', did: 'did:s:1', trackingKey: 'T-1', originAgentDid: A, destAgentDid: 'did:agent:B', status: 'At_PUDO', acceptedAt: '2026-08-03T10:00:00Z' },
  { ...parcel({}), parcelId: 'P2', did: 'did:s:2', trackingKey: 'T-2', originAgentDid: 'did:agent:C', destAgentDid: A, originZone: 'Z-C', destZone: 'Z-A', status: 'Delivered', acceptedAt: '2026-08-01T10:00:00Z' },
  { ...parcel({}), parcelId: 'P3', did: 'did:s:3', trackingKey: 'T-3', originAgentDid: A, destAgentDid: 'did:agent:B', status: 'On_Bus', acceptedAt: '2026-08-05T10:00:00Z' },
];

describe('agent parcel-history register (R4)', () => {
  it('sees parcels where the shop is origin OR dest; role is origin=drop-off, dest=collection', () => {
    expect(agentParcelRole(parcels[0], A)).toBe('origin');
    expect(agentParcelRole(parcels[1], A)).toBe('dest');
  });

  it('defaults to newest-first and filters by role / status / date / search', () => {
    expect(filterAgentParcels(parcels, A, {}).map((p) => p.parcelId)).toEqual(['P3', 'P1', 'P2']);
    expect(filterAgentParcels(parcels, A, { sort: 'oldest' }).map((p) => p.parcelId)).toEqual(['P2', 'P1', 'P3']);
    expect(filterAgentParcels(parcels, A, { role: 'origin' }).map((p) => p.parcelId)).toEqual(['P3', 'P1']);
    expect(filterAgentParcels(parcels, A, { role: 'dest' }).map((p) => p.parcelId)).toEqual(['P2']);
    expect(filterAgentParcels(parcels, A, { status: 'On_Bus' }).map((p) => p.parcelId)).toEqual(['P3']);
    expect(filterAgentParcels(parcels, A, { q: 'T-2' }).map((p) => p.parcelId)).toEqual(['P2']); // tracking
    expect(filterAgentParcels(parcels, A, { q: 'z-c' }).map((p) => p.parcelId)).toEqual(['P2']); // origin zone
    expect(filterAgentParcels(parcels, A, { from: '2026-08-04' }).map((p) => p.parcelId)).toEqual(['P3']);
  });

  it('projects a row without buyer PII or a collection code, and exports the same columns', () => {
    expect(agentParcelRowOf(parcels[1], A)).toEqual({ parcelId: 'P2', did: 'did:s:2', status: 'Delivered', role: 'dest', originZone: 'Z-C', destZone: 'Z-A', size: 'M', trackingKey: 'T-2', createdAt: '2026-08-01T10:00:00Z' });
    const csv = agentParcelsToCsv(filterAgentParcels(parcels, A, { role: 'origin', sort: 'oldest' }), A);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('Parcel,Shipment DID,Role,Status,From,To,Size,Tracking,Date');
    expect(lines[1]).toBe('P1,did:s:1,origin,At_PUDO,Z-A,Z-B,M,T-1,2026-08-03T10:00:00Z');
    expect(lines).toHaveLength(3); // header + P1 + P3
    expect(csv).not.toContain('+254700'); // no receiver phone leaked
  });
});

function entry(over: Partial<PudoLedgerEntry>): PudoLedgerEntry {
  return { id: 'L', type: 'LABOR_PAYOUT', sign: '+', amount: 5, did: A, reference: 'P1', refType: 'parcel', at: '2026-08-01T10:00:00Z', ...over } as PudoLedgerEntry;
}

const ledger: PudoLedgerEntry[] = [
  entry({ id: 'E1', type: 'TOP_UP', sign: '+', amount: 60, reference: 'cash', refType: 'bank', at: '2026-08-01T10:00:00Z' }),
  entry({ id: 'E2', type: 'LABOR_PAYOUT', sign: '+', amount: 5, reference: 'P1', refType: 'parcel', at: '2026-08-03T10:00:00Z' }),
  entry({ id: 'E3', type: 'FEE', sign: '-', amount: 12, reference: 'P2', refType: 'parcel', at: '2026-08-05T10:00:00Z' }),
  entry({ id: 'E4', type: 'REFUND', sign: '+', amount: 3, reference: 'P1', refType: 'parcel', at: '2026-08-04T10:00:00Z' }),
];

describe('agent earnings-ledger register (R4)', () => {
  it('defaults to newest-first and filters by type / direction / search / date', () => {
    expect(filterAgentLedger(ledger, {}).map((e) => e.id)).toEqual(['E3', 'E4', 'E2', 'E1']);
    expect(filterAgentLedger(ledger, { sort: 'amount_desc' }).map((e) => e.id)).toEqual(['E1', 'E3', 'E2', 'E4']);
    expect(filterAgentLedger(ledger, { type: 'FEE' }).map((e) => e.id)).toEqual(['E3']);
    expect(filterAgentLedger(ledger, { direction: 'out' }).map((e) => e.id)).toEqual(['E3']);
    expect(filterAgentLedger(ledger, { direction: 'in' }).map((e) => e.id).sort()).toEqual(['E1', 'E2', 'E4']);
    expect(filterAgentLedger(ledger, { q: 'P1' }).map((e) => e.id).sort()).toEqual(['E2', 'E4']); // reference
    expect(filterAgentLedger(ledger, { q: 'handling pay' }).map((e) => e.id)).toEqual(['E2']); // type word
    expect(filterAgentLedger(ledger, { from: '2026-08-04' }).map((e) => e.id)).toEqual(['E3', 'E4']);
  });

  it('summarises money in (top-ups/pay/refunds), out (fees), and the net', () => {
    expect(agentLedgerSummaryOf(ledger)).toEqual({ in: 68, out: 12, net: 56, count: 4 });
    expect(agentLedgerSummaryOf(filterAgentLedger(ledger, { direction: 'out' }))).toEqual({ in: 0, out: 12, net: -12, count: 1 });
    expect(agentLedgerSummaryOf([])).toEqual({ in: 0, out: 0, net: 0, count: 0 });
  });

  it('exports a signed numeric amount + direction, and drops the internal did', () => {
    expect(agentLedgerRowOf(ledger[2])).toEqual({ id: 'E3', type: 'FEE', sign: '-', amount: 12, reference: 'P2', refType: 'parcel', at: '2026-08-05T10:00:00Z' });
    const csv = agentLedgerToCsv(filterAgentLedger(ledger, { type: 'FEE' }));
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('Date,Type,Direction,Amount,Reference');
    expect(lines[1]).toBe('2026-08-05T10:00:00Z,Shipping fee,out,-12,P2');
  });
});
