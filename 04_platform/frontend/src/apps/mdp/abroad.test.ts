import { describe, expect, it } from 'vitest';
import { t } from '../../shared/i18n';
import { abroadGroups, abroadLine, heldAbroadLine, setAsideIds, type AbroadRow } from './abroad';
import type { ParcelRow } from './types';

/*
 * 2026-11-18 — PARCELS ABROAD AT A HUB (parcels across a border, step 2c): handed to the route's carrier where they leave, by
 * carrier; received and cleared where they arrive; held ones kept apart with what customs asks. Never offered to sort.
 */
const row = (parcelId: string, step: AbroadRow['step'], o: Partial<AbroadRow> = {}): AbroadRow => ({
  parcelId,
  step,
  from: 'KE',
  to: 'ET',
  toName: 'Ethiopia',
  carrier: 'Kilimanjaro Air Cargo',
  departure: 'NBO',
  arrival: 'ADD',
  seal: 'SL-1',
  contents: 'Shoes ×2',
  itemCount: 2,
  value: 45,
  valueCurrency: 'USD',
  ...o,
});

describe('parcels abroad at a hub', () => {
  it('hands over by carrier — one consignment each — and keeps the rest by what is to be done', () => {
    const g = abroadGroups([
      row('A', 'to_hand'),
      row('B', 'to_hand', { carrier: 'Addis Freight' }),
      row('C', 'to_hand'),
      row('D', 'coming', { reference: 'HAWB-1' }),
      row('E', 'customs'),
      row('F', 'held', { held: { amount: 1200.5, currency: 'ETB', reference: 'ET-CUS-0042' } }),
    ]);
    expect(g.toHand.map((x) => [x.carrier, x.rows.map((r) => r.parcelId)])).toEqual([
      ['Addis Freight', ['B']],
      ['Kilimanjaro Air Cargo', ['A', 'C']],
    ]);
    expect([g.coming, g.customs, g.held].map((l) => l.map((r) => r.parcelId))).toEqual([['D'], ['E'], ['F']]);
  });

  it('says each in one line, and a held one with what customs asks and its reference', () => {
    expect(abroadLine(row('PUD-1', 'to_hand'), t)).toBe('PUD-1 · to Ethiopia · NBO → ADD · seal SL-1');
    expect(heldAbroadLine(row('PUD-2', 'held', { held: { amount: 1200.5, currency: 'ETB', reference: 'ET-CUS-0042' } }), t)).toBe('1200.50 ETB to pay · customs reference ET-CUS-0042');
    expect(heldAbroadLine(row('PUD-3', 'customs'), t)).toBe('');
  });

  it('never offers to sort a parcel set aside for the route abroad, nor one held, on this floor', () => {
    const p = (parcelId: string, o: Partial<ParcelRow> = {}): ParcelRow => ({ parcelId, size: 'M', status: 'At_MDP', destZone: 'Z', atMdpId: 'mdp-1', ...o });
    const inbound = [p('plain'), p('carrier', { abroadAside: 'carrier' }), p('customs', { abroadAside: 'customs' }), p('elsewhere', { abroadAside: 'customs', atMdpId: 'mdp-2' })];
    expect([...setAsideIds(inbound, 'mdp-1')].sort()).toEqual(['carrier', 'customs']);
  });
});
