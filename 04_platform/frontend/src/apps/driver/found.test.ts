import { describe, expect, it } from 'vitest';
import { t } from '../../shared/i18n';
import { countOf, FOUND_KEYS, FOUND_KINDS, foundBody, foundProblem, noneFound, unloadItemsAfter, type FoundForm } from './found';

/**
 * D9 — WHAT THE RECEIVER FOUND, on the Driver app: the server's own rules said before the tap (a whole count; a damaged line
 * with its photo; never all of them short, which is a door and not a delivery; nothing damaged or wrong that did not come),
 * and what the delivery sends — each kind with a count, in the note's order, with its photograph.
 */
describe('what the receiver found, at the door (D9)', () => {
  const form = (counts: Partial<FoundForm['counts']>, photos: FoundForm['photos'] = {}): FoundForm => ({ counts: { ...noneFound().counts, ...counts }, photos });

  it('reads a count as a whole number; empty and 0 are none', () => {
    expect([countOf(''), countOf(' '), countOf('0'), countOf('3'), countOf(' 12 ')]).toEqual([undefined, undefined, undefined, 3, 12]);
    for (const bad of ['1.5', '-2', 'three', '2e3']) expect(countOf(bad)).toBeNaN();
  });

  it('nothing found sends nothing, and stands in the way of nothing', () => {
    expect(foundProblem(noneFound(), 40)).toBeNull();
    expect(foundBody(noneFound())).toBeUndefined();
    expect(foundBody(form({ short: '0' }))).toBeUndefined();
  });

  it('says what is wrong before the tap, in the order the server would', () => {
    expect(foundProblem(form({ short: '1.5' }), 40)).toEqual({ kind: 'count', what: 'short' });
    expect(foundProblem(form({ damaged: '2' }), 40)).toEqual({ kind: 'photo' });
    expect(foundProblem(form({ short: '40' }), 40)).toEqual({ kind: 'none_came', packages: 40 });
    expect(foundProblem(form({ short: '38', wrong: '3' }), 40)).toEqual({ kind: 'more_than_came', what: 'wrong', came: 2 });
    expect(foundProblem(form({ short: '38', damaged: '3' }, { damaged: 'med_1' }), 40)).toEqual({ kind: 'more_than_came', what: 'damaged', came: 2 });
    // More than the note says came, so more can be damaged.
    expect(foundProblem(form({ short: '38', over: '1', damaged: '3' }, { damaged: 'med_1' }), 40)).toBeNull();
    // With no count on the note there is nothing to count against.
    expect(foundProblem(form({ short: '400' }))).toBeNull();
  });

  it('sends each kind with a count in the note’s order, the photo of the damaged and of the wrong — never a photo on a count', () => {
    expect(foundBody(form({ wrong: '1', short: '3', damaged: '2', over: '' }, { damaged: 'med_d', wrong: 'med_w', short: 'med_stray' }))).toEqual([
      { kind: 'short', count: 3 },
      { kind: 'damaged', count: 2, photoRefs: ['med_d'] },
      { kind: 'wrong', count: 1, photoRefs: ['med_w'] },
    ]);
  });

  it('takes "Cargo intact" off the unload check once packages are written down as damaged — and only then', () => {
    const items = [{ key: 'correct_site' }, { key: 'intact' }, { key: 'handed_over' }, { key: 'gear_safe' }];
    const keys = (list: Array<{ key: string }>) => list.map((i) => i.key);
    expect(keys(unloadItemsAfter(items, form({ damaged: '2' }, { damaged: 'med_1' }), true))).toEqual(['correct_site', 'handed_over', 'gear_safe']);
    expect(keys(unloadItemsAfter(items, form({ short: '3' }), true))).toEqual(keys(items));
    expect(keys(unloadItemsAfter(items, form({ damaged: '0' }), true))).toEqual(keys(items));
    // Written, then the section closed: nothing found is sent, so "intact" is asked again.
    expect(keys(unloadItemsAfter(items, form({ damaged: '2' }), false))).toEqual(keys(items));
  });

  it('has words for every kind and every photo', () => {
    for (const k of FOUND_KINDS) {
      expect(t(FOUND_KEYS[k].label)).not.toBe(FOUND_KEYS[k].label);
      if (FOUND_KEYS[k].photo) expect(t(FOUND_KEYS[k].photo!)).not.toBe(FOUND_KEYS[k].photo);
    }
    expect(t('driver.found.problem.moreThanCame', { came: 1 })).toBe('Only 1 package came: count only what came.');
    expect(t('driver.found.against', { n: 40 })).toMatch(/^The note says 40 packages\./);
  });
});
