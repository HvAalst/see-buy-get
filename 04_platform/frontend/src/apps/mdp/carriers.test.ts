import { describe, expect, it } from 'vitest';
import { t } from '../../shared/i18n';
import { carrierForm, carrierHoldsLine, carrierInput, carrierSizeLine, listWith, type HubCarrierView } from './carriers';

const pallet: HubCarrierView = { carrierId: 'hc_1', kind: 'pallet', name: 'Euro pallet', lengthCm: 120, widthCm: 80, heightCm: 150, maxKg: 1000, holds: 36.5, bags: 3, boundBy: 'space', saidAt: '2026-10-27T08:00:00Z', saidBy: 'Grace' };
const crate: HubCarrierView = { ...pallet, carrierId: 'hc_2', kind: 'crate', name: 'Bread crate', lengthCm: 60, widthCm: 40, heightCm: 40, maxKg: 15, holds: 2.4, bags: 0 };

describe('a hub’s carriers, as its screens say them (D11)', () => {
  it('says each kind’s size and what it holds — worked out by the server, said in whole parcels', () => {
    expect(carrierSizeLine(pallet, t)).toBe('Pallet · 120 × 80 cm, loaded to 150 cm · carries up to 1,000 kg');
    expect(carrierHoldsLine(pallet, t)).toBe('Holds about 36 parcels of size M: 3 full bags. Its space decides.');
    expect(carrierHoldsLine(crate, t)).toBe('Holds about 2 parcels of size M: less than a full bag. Its space decides.');
    expect(carrierHoldsLine({ ...pallet, holds: 10, bags: 1, boundBy: 'weight' }, t)).toBe('Holds about 10 parcels of size M: 1 full bag. What it may carry decides.');
  });

  it('checks a form’s shape before it is sent — and sends what the server takes', () => {
    expect(carrierInput({ ...carrierForm(), name: ' ' })).toEqual({ error: 'mdp.carriers.err.name' });
    expect(carrierInput({ ...carrierForm(), name: 'Cage', lengthCm: '80', widthCm: '70', heightCm: '17.5', maxKg: '500' })).toEqual({ error: 'mdp.carriers.err.cm' });
    expect(carrierInput({ ...carrierForm(), name: 'Cage', lengthCm: '80', widthCm: '70', heightCm: '170', maxKg: '5' })).toEqual({ error: 'mdp.carriers.err.kg' });
    expect(carrierInput({ ...carrierForm(), kind: 'cage', name: ' Roll cage ', lengthCm: '80', widthCm: '70', heightCm: '170', maxKg: '500' })).toEqual({
      input: { kind: 'cage', name: 'Roll cage', lengthCm: 80, widthCm: 70, heightCm: 170, maxKg: 500 },
    });
    // A kind on the list keeps its id when it is changed.
    expect(carrierInput({ ...carrierForm(pallet), heightCm: '160' })).toEqual({ input: { carrierId: 'hc_1', kind: 'pallet', name: 'Euro pallet', lengthCm: 120, widthCm: 80, heightCm: 160, maxKg: 1000 } });
  });

  it('sends the list back whole: one kind changed, added or taken off, the rest as they were', () => {
    const both = [pallet, crate];
    const asSent = (c: HubCarrierView) => ({ carrierId: c.carrierId, kind: c.kind, name: c.name, lengthCm: c.lengthCm, widthCm: c.widthCm, heightCm: c.heightCm, maxKg: c.maxKg });
    expect(listWith(both, { put: { ...asSent(crate), heightCm: 30 } })).toEqual([asSent(pallet), { ...asSent(crate), heightCm: 30 }]);
    expect(listWith(both, { put: { kind: 'cage', name: 'Roll cage', lengthCm: 80, widthCm: 70, heightCm: 170, maxKg: 500 } })).toHaveLength(3);
    expect(listWith(both, { drop: 'hc_1' })).toEqual([asSent(crate)]);
  });
});
