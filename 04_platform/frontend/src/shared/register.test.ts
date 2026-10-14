import { describe, expect, it } from 'vitest';
import { hasNextPage, hasPrevPage, pageLabel, toggleAll, toggleId } from './register';

describe('register helpers (R1)', () => {
  describe('pageLabel', () => {
    it('formats the 1-indexed human range', () => {
      expect(pageLabel(0, 20, 143)).toBe('1–20 of 143');
      expect(pageLabel(20, 20, 143)).toBe('21–40 of 143');
      expect(pageLabel(140, 20, 143)).toBe('141–143 of 143'); // last partial page
      expect(pageLabel(0, 20, 5)).toBe('1–5 of 5'); // single short page
    });
    it('handles empty + past-the-end', () => {
      expect(pageLabel(0, 20, 0)).toBe('None');
      expect(pageLabel(200, 20, 143)).toBe('143–143 of 143'); // offset past the end clamps to the last item
    });
  });

  describe('paging predicates', () => {
    it('prev/next', () => {
      expect(hasPrevPage(0)).toBe(false);
      expect(hasPrevPage(20)).toBe(true);
      expect(hasNextPage(0, 20, 143)).toBe(true);
      expect(hasNextPage(140, 20, 143)).toBe(false);
      expect(hasNextPage(0, 20, 20)).toBe(false); // exactly one full page
    });
  });

  describe('selection', () => {
    it('toggleId adds/removes immutably', () => {
      const a = toggleId(new Set(), 'x');
      expect([...a]).toEqual(['x']);
      const b = toggleId(a, 'x');
      expect([...b]).toEqual([]);
      expect([...a]).toEqual(['x']); // original untouched
    });
    it('toggleAll selects all visible, then clears them', () => {
      const visible = ['a', 'b', 'c'];
      const all = toggleAll(new Set(['z']), visible);
      expect([...all].sort()).toEqual(['a', 'b', 'c', 'z']); // adds visible, keeps others
      const cleared = toggleAll(all, visible);
      expect([...cleared]).toEqual(['z']); // removes visible, keeps others
    });
  });
});
