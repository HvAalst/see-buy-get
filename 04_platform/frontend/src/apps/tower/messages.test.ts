import { describe, expect, it } from 'vitest';
import { inCategory, messagesWaiting, waited, type SupportInbox } from './messages';

/* MESSAGES in the console: what waits is every open message; nothing is counted before it is read. */
const inbox = (items: Array<{ reference: string; category: SupportInbox['items'][number]['category'] }>): SupportInbox =>
  ({
    status: 'open',
    keptDays: 180,
    counts: (['sign-in', 'parcel', 'damage', 'money', 'joining', 'business', 'safety', 'privacy', 'other'] as const).map((category) => ({ category, open: items.filter((i) => i.category === category).length })),
    items: items.map((i) => ({ ...i, email: 'a@example.com', message: 'Help me please', at: '2026-10-22T10:00:00Z', status: 'open', urgent: i.category === 'safety', answers: [], others: 0 })),
  }) as SupportInbox;

describe('the console’s messages', () => {
  it('counts every open message as waiting — and nothing until they are read', () => {
    expect(messagesWaiting(null)).toBeNull();
    expect(messagesWaiting(inbox([]))).toBe(0);
    expect(messagesWaiting(inbox([{ reference: 'SBG-AAAAAA', category: 'parcel' }, { reference: 'SBG-BBBBBB', category: 'safety' }]))).toBe(2);
  });

  it('shows one category, or all of them, in the order the server sorted them', () => {
    const i = inbox([{ reference: 'SBG-AAAAAA', category: 'safety' }, { reference: 'SBG-BBBBBB', category: 'parcel' }, { reference: 'SBG-CCCCCC', category: 'parcel' }]);
    expect(inCategory(i, null).map((m) => m.reference)).toEqual(['SBG-AAAAAA', 'SBG-BBBBBB', 'SBG-CCCCCC']);
    expect(inCategory(i, 'parcel').map((m) => m.reference)).toEqual(['SBG-BBBBBB', 'SBG-CCCCCC']);
    expect(inCategory(null, 'parcel')).toEqual([]);
  });

  it('says how long a message has waited in minutes, hours or days', () => {
    const at = '2026-10-22T10:00:00Z';
    const t0 = Date.parse(at);
    expect(waited(at, t0 + 5 * 60_000)).toEqual({ n: 5, unit: 'minutes' });
    expect(waited(at, t0 + 3 * 3_600_000)).toEqual({ n: 3, unit: 'hours' });
    expect(waited(at, t0 + 2 * 86_400_000)).toEqual({ n: 2, unit: 'days' });
  });
});
