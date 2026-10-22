import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import { CLOSE_OPEN_KINDS } from './useAccount';

/*
 * WHAT KEEPS AN ACCOUNT FROM CLOSING, SAID (2026-10-22). The server names each thing still open by kind; Settings says
 * each in the reader's words, counted where there is a count. A kind with no sentence would show its key.
 */
describe('closing an account: every open thing has its words', () => {
  it('has a sentence for each kind, counted where it counts', () => {
    expect(CLOSE_OPEN_KINDS.length).toBe(14);
    for (const kind of CLOSE_OPEN_KINDS) {
      const one = t(`account.close.open.${kind}` as never, { n: 1 });
      const two = t(`account.close.open.${kind}` as never, { n: 2 });
      expect(one, kind).not.toMatch(/^account\./);
      expect(one, kind).not.toMatch(/\{|\}/);
      expect(two, kind).not.toMatch(/\{|\}/);
    }
    expect(t('account.close.open.loads' as never, { n: 1 })).toBe('1 load is still aboard with you.');
    expect(t('account.close.open.loads' as never, { n: 3 })).toBe('3 loads are still aboard with you.');
  });
});
