import { bringsOf, cannotDo, cleanWork, extrasOf, gapAt, gapsOf, marksOf, workLines } from './load-work';
import type { LoadWork } from './load-work.types';

/**
 * 2026-11-13 — UNUSUAL LOADS (plan U1–U4 as the owner revised them): the gap at each end is what the driver brings, and only a
 * gap limits who may take a load; any extra work is named, for one negotiated price.
 */
describe('what it takes to move a load', () => {
  const sofa: LoadWork = { needs: 'two', pickup: { hands: 'none', floor: 3 }, delivery: { hands: 'one' } };

  it('leaves the driver what an end does not offer: the driver is one of the people it takes', () => {
    expect(gapAt('two', { hands: 'none' })).toEqual({ helpers: 1, tailLift: false, palletJack: false });
    expect(gapAt('two', { hands: 'one' })).toEqual({ helpers: 0, tailLift: false, palletJack: false });
    expect(gapAt('three', { hands: 'none' }).helpers).toBe(2);
    expect(gapAt('three', { hands: 'two' }).helpers).toBe(0);
    expect(gapAt('one', { hands: 'none' }).helpers).toBe(0);
    // "Sender loads": nothing to bring there, whatever it needs.
    expect(gapAt('three', { hands: 'none', theyDoIt: true })).toEqual({ helpers: 0, tailLift: false, palletJack: false });
  });

  it('a machine load: a forklift or crane does it; a dock wants a pallet jack; the ground wants a tail-lift', () => {
    expect(gapAt('machine', { hands: 'none', equipment: ['FLT'] })).toEqual({ helpers: 0, tailLift: false, palletJack: false });
    expect(gapAt('machine', { hands: 'none', equipment: ['CRN'] }).tailLift).toBe(false);
    expect(gapAt('machine', { hands: 'none', equipment: ['DOCK'] })).toEqual({ helpers: 0, tailLift: false, palletJack: true });
    expect(gapAt('machine', { hands: 'none', equipment: ['DOCK', 'PLT'] })).toEqual({ helpers: 0, tailLift: false, palletJack: false });
    expect(gapAt('machine', { hands: 'two', equipment: ['PLT'] })).toEqual({ helpers: 0, tailLift: true, palletJack: false });
    expect(gapAt('machine', { hands: 'two' })).toEqual({ helpers: 0, tailLift: true, palletJack: true });
  });

  it('names the extra work end by end: what to bring, floors without a lift, a long carry, waiting', () => {
    const work: LoadWork = { needs: 'two', pickup: { hands: 'none', floor: 3, carryM: 40, waitMin: 20 }, delivery: { hands: 'one', floor: 2, lift: true, carryM: 10 } };
    expect(extrasOf(work)).toEqual([
      { end: 'pickup', kind: 'helper', n: 1 },
      { end: 'pickup', kind: 'floors', n: 3 },
      { end: 'pickup', kind: 'carry', n: 40 },
      { end: 'pickup', kind: 'wait', n: 20 },
    ]);
    // The receiver unloads: no carrying there for the driver — a wait is still theirs.
    expect(extrasOf({ needs: 'two', pickup: { hands: 'one' }, delivery: { hands: 'none', theyDoIt: true, floor: 4, waitMin: 15 } })).toEqual([{ end: 'delivery', kind: 'wait', n: 15 }]);
    // An ordinary load names nothing: it stays as it was.
    expect(extrasOf({ needs: 'one', pickup: { hands: 'none' }, delivery: { hands: 'none' } })).toEqual([]);
  });

  it('only a gap limits who may do it: helpers, a tail-lift, a pallet jack — said in words', () => {
    expect(cannotDo(sofa, bringsOf(0, ['MAN']))).toMatch(/needs a helper with you/);
    expect(cannotDo(sofa, bringsOf(1, ['MAN']))).toBeUndefined();
    expect(cannotDo({ needs: 'three', pickup: { hands: 'none' }, delivery: { hands: 'none' } }, bringsOf(1, []))).toMatch(/needs 2 helpers with you, and you have said you bring 1/);
    const pallet: LoadWork = { needs: 'machine', pickup: { hands: 'none', equipment: ['FLT'] }, delivery: { hands: 'one' } };
    expect(cannotDo(pallet, bringsOf(0, ['PLT']))).toMatch(/tail-lift/);
    expect(cannotDo(pallet, bringsOf(0, ['TLT']))).toMatch(/pallet jack/);
    expect(cannotDo(pallet, bringsOf(0, ['TLT', 'PLT']))).toBeUndefined();
    // A long item and a load space that is too short, where the space is known; unknown, nothing is guessed.
    expect(cannotDo(undefined, bringsOf(0, []), 320, 3)).toMatch(/3.2 m and your load space is 3 m long/);
    expect(cannotDo(undefined, bringsOf(0, []), 320, undefined)).toBeUndefined();
    expect(cannotDo(undefined, bringsOf(0, []), 280, 3)).toBeUndefined();
  });

  it('marks a long item from its measurements', () => {
    expect(marksOf({ ...sofa, marks: ['upright'] }, [260, 90, 80])).toEqual(['upright', 'long']);
    expect(marksOf(undefined, [120, 80, 80])).toEqual([]);
  });

  it('keeps only what the words allow, and refuses the rest in words', () => {
    expect(cleanWork({ needs: 'two', pickup: { hands: 'none', equipment: ['PLT', 'PLT', 'FLT'], floor: 0, lift: true }, delivery: { hands: 'one', theyDoIt: false }, marks: ['securing', 'upright'] })).toEqual({
      needs: 'two',
      pickup: { hands: 'none', equipment: ['FLT', 'PLT'] },
      delivery: { hands: 'one' },
      marks: ['upright', 'securing'],
    });
    expect(cleanWork(undefined)).toBeUndefined();
    expect(() => cleanWork({ needs: 'four', pickup: { hands: 'none' }, delivery: { hands: 'none' } })).toThrow(/one person, two, three or more, or a machine/);
    expect(() => cleanWork({ needs: 'one', pickup: { hands: 'many' }, delivery: { hands: 'none' } })).toThrow(/who is there to help at the pickup/);
    expect(() => cleanWork({ needs: 'one', pickup: { hands: 'none' }, delivery: { hands: 'none', floor: 2.5 } })).toThrow(/floor at the delivery/);
    expect(() => cleanWork({ needs: 'one', pickup: { hands: 'none', equipment: ['ladder'] }, delivery: { hands: 'none' } })).toThrow(/forklift, pallet jack, loading dock, crane/);
    expect(() => cleanWork({ needs: 'one', pickup: { hands: 'none' }, delivery: { hands: 'none' }, marks: ['heavy'] })).toThrow(/keep upright/);
  });

  it('writes the work on the note in plain words', () => {
    expect(workLines({ needs: 'two', pickup: { hands: 'none', floor: 3, carryM: 30 }, delivery: { hands: 'none', theyDoIt: true }, marks: ['upright'] }, [260, 90, 90])).toEqual([
      'Keep upright',
      'Long item (over 2.5 m)',
      'At pickup: floor 3, no lift; carried 30 m; the driver brings a helper',
      'At delivery: the receiver unloads',
    ]);
    expect(gapsOf(sofa).delivery.helpers).toBe(0);
  });
});
