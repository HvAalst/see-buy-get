import { describe, expect, it } from 'vitest';
import { LIVE_STAYS, readsAgainLive } from './live';

describe('the console’s live view: which screens read themselves again', () => {
  it('reads the queues and lists again, and leaves a record somebody opened by its name as they opened it', () => {
    for (const screen of ['network', 'approvals', 'cases', 'messages', 'claims', 'businesses', 'papers', 'risks'] as const) expect(readsAgainLive(screen)).toBe(true);
    // Read again by itself, each of these would count as opened again in what staff opened.
    for (const screen of ['support', 'rates', 'money', 'pictures', 'companies'] as const) expect(readsAgainLive(screen)).toBe(false);
    expect(LIVE_STAYS.size).toBe(5);
  });
});
