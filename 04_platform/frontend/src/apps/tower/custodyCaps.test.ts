import { describe, expect, it } from 'vitest';
import { custodyCapsBody } from './custodyCaps';

const empty = { shopStart: '', shopLift: '', riderStart: '', riderLift: '' };

describe('the custody cap as typed on Rates & tax (round 38)', () => {
  it('sends a kind only when both its boxes are filled; both empty caps nobody', () => {
    expect(custodyCapsBody(empty)).toEqual({ value: {} });
    expect(custodyCapsBody({ ...empty, shopStart: ' 20 ', shopLift: '200' })).toEqual({ value: { shop: { start: 20, liftedAfter: 200 } } });
    expect(custodyCapsBody({ shopStart: '20', shopLift: '200', riderStart: '3', riderLift: '50' })).toEqual({ value: { shop: { start: 20, liftedAfter: 200 }, rider: { start: 3, liftedAfter: 50 } } });
  });

  it('says what is wrong before anything is sent: half filled, not whole, below one, or lifted sooner than it starts', () => {
    for (const bad of [{ shopStart: '20' }, { riderLift: '5' }, { shopStart: '2.5', shopLift: '10' }, { shopStart: '0', shopLift: '10' }, { riderStart: '10', riderLift: '5' }, { shopStart: 'ten', shopLift: '20' }]) {
      expect(custodyCapsBody({ ...empty, ...bad })).toEqual({ error: 'tower.custodyCaps.bad' });
    }
  });
});
