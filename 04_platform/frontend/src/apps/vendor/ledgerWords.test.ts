import { describe, expect, it } from 'vitest';
import { t } from '../../shared/i18n';
import { LEDGER_CSV_HEADERS, ledgerRowsToCsv, ledgerTypeWord } from './logic';
import type { SettlementRow } from './types';

const row = (type: SettlementRow['type'], parcelId: string, extra: Partial<SettlementRow> = {}): SettlementRow => ({ id: `led_${parcelId}`, type, sign: '-', amount: 10, currency: 'KES', parcelId, at: '2026-10-26T10:00:00.000Z', ...extra });

describe('the store’s register names every line for what it is', () => {
  it('says a hub’s receiving charge apart from a shipment, and a top-up’s fee and a damage claim by their own words', () => {
    expect(ledgerTypeWord('BILLING', t, 'PUD-1')).toBe('Shipment');
    expect(ledgerTypeWord('BILLING', t, 'arr_1a2b3c')).toBe('Receiving at a hub');
    expect(ledgerTypeWord('TOP_UP_FEE', t)).toBe('Top-up fee');
    expect(ledgerTypeWord('CLAIM', t)).toBe('Damage claim');
    expect(ledgerTypeWord('REBATE', t, 'arr_1a2b3c')).toBe('Rebate');
  });

  it('exports the same columns and words as the server’s export — the money of each line among them', () => {
    expect(LEDGER_CSV_HEADERS.join(',')).toBe('Date,Type,Direction,Amount,Currency,Parcel,Note');
    const csv = ledgerRowsToCsv([row('BILLING', 'arr_1a2b3c', { note: 'receiving at Ghala Hub: 2 pallets' }), row('TOP_UP_FEE', 'MPX1', { sign: '-' }), row('CLAIM', 'PUD-9', { sign: '+' })]);
    const lines = csv.trim().split(/\r?\n/);
    expect(lines[1]).toBe('2026-10-26T10:00:00.000Z,Receiving at a hub,out,-10,KES,arr_1a2b3c,receiving at Ghala Hub: 2 pallets');
    expect(lines[2]).toContain(',Top-up fee,out,-10,KES,');
    expect(lines[3]).toContain(',Damage claim,in,10,KES,');
  });
});
