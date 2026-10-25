import { exceptionViewsOf, exceptionsInWords, stillExpectedOf } from './receiving';

/**
 * D9 — what the receiver found at the handover, said one way everywhere it is said; and what of it stays expected.
 */
describe('what the receiver found at the handover (D9)', () => {
  it('says it one way, in the order it is kept, a package or packages', () => {
    expect(exceptionsInWords([{ kind: 'short', count: 1 }, { kind: 'over', count: 2 }, { kind: 'damaged', count: 1 }, { kind: 'wrong', count: 3 }])).toBe(
      '1 package short, 2 packages more than the note says, 1 package damaged, 3 packages not the goods the note describes',
    );
    expect(exceptionsInWords([])).toBe('');
    expect(exceptionsInWords(undefined)).toBe('');
  });

  it('keeps expected what did not come and what came and is not the goods — never the damaged, never the extra', () => {
    expect(stillExpectedOf([{ kind: 'short', count: 3 }, { kind: 'wrong', count: 2 }, { kind: 'damaged', count: 5 }, { kind: 'over', count: 1 }])).toBe(5);
    expect(stillExpectedOf([{ kind: 'damaged', count: 5 }, { kind: 'over', count: 2 }])).toBe(0);
    expect(stillExpectedOf(undefined)).toBe(0);
  });

  it('shows a party to the load how many photographs there are, never their references', () => {
    const views = exceptionViewsOf({ proofOfDelivery: { receiverName: 'Peter', at: '2026-10-26T09:00:00Z', exceptions: [{ kind: 'damaged', count: 2, photoRefs: ['med_a', 'med_b'] }, { kind: 'short', count: 1 }] } });
    expect(views).toEqual([
      { kind: 'damaged', count: 2, photos: 2 },
      { kind: 'short', count: 1, photos: 0 },
    ]);
    expect(JSON.stringify(views)).not.toContain('med_');
    expect(exceptionViewsOf({})).toEqual([]);
  });
});
