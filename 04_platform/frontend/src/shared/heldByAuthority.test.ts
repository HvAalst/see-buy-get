import { describe, expect, it } from 'vitest';
import { EMPTY_HELD, heldBody, heldByLine, heldByWords, heldReady } from './heldByAuthority';
import { t } from './i18n';

const when = (iso: string) => iso.slice(11, 16);

describe('a load held by the police or customs', () => {
  it('says who holds it and where, in the driver’s words, and since when — and, let go, until when', () => {
    expect(heldByWords('police', t)).toBe('the police');
    expect(heldByWords('customs', t)).toBe('customs');
    expect(heldByWords('other', t)).toBe('an authority');
    const held = { by: 'police' as const, who: 'Traffic police, Athi River', since: '2026-10-20T10:42:00.000Z' };
    expect(heldByLine(held, t, when)).toBe('Held by the police (Traffic police, Athi River) since 10:42');
    expect(heldByLine({ by: 'customs', since: '2026-10-20T10:42:00.000Z', letGoAt: '2026-10-20T12:05:00.000Z' }, t, when)).toBe('Was held by customs from 10:42 until 12:05');
  });

  it('is ready once who holds it is chosen, and sends only what was said', () => {
    expect(heldReady(EMPTY_HELD)).toBe(false);
    expect(heldReady({ ...EMPTY_HELD, by: 'other' })).toBe(true);
    expect(heldBody({ by: 'police', who: '  Athi River ', note: '' })).toEqual({ by: 'police', who: 'Athi River' });
  });
});
