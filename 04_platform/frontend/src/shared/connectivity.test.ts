import { beforeEach, describe, expect, it } from 'vitest';
import { connectivity, isOfflineNow, markOffline, markOnline, onConnectivityChange, resetConnectivity } from './connectivity';

/** One store for "do we have a signal", and the memory of the last spell without one. */
describe('connectivity', () => {
  beforeEach(() => resetConnectivity());

  it('goes dark on a failed request and comes back on a real answer, dating what we last knew', () => {
    const t0 = Date.parse('2026-09-14T14:10:00Z');
    expect(connectivity().online).toBe(true);
    markOffline(t0);
    expect(connectivity()).toMatchObject({ online: false, offlineSince: '2026-09-14T14:10:00.000Z' });
    expect(isOfflineNow()).toBe(true);
    markOnline(t0 + 25 * 60_000);
    expect(connectivity()).toMatchObject({ online: true, offlineSince: null, lastAnswerAt: '2026-09-14T14:35:00.000Z' });
  });

  it('remembers the last spell out of reach, from first failure to first answer', () => {
    const t0 = Date.parse('2026-09-14T14:10:00Z');
    markOffline(t0);
    markOffline(t0 + 60_000); // a second failure does not move the start
    markOnline(t0 + 25 * 60_000);
    expect(connectivity().lastDarkSpell).toEqual({ from: '2026-09-14T14:10:00.000Z', to: '2026-09-14T14:35:00.000Z' });
    markOnline(t0 + 26 * 60_000); // an answer while online is not a new spell
    expect(connectivity().lastDarkSpell?.to).toBe('2026-09-14T14:35:00.000Z');
  });

  it('tells listeners when the signal comes or goes, and not otherwise', () => {
    let calls = 0;
    const off = onConnectivityChange(() => calls++);
    markOnline(); // already online: nothing changed
    expect(calls).toBe(0);
    markOffline();
    markOffline();
    expect(calls).toBe(1);
    markOnline();
    expect(calls).toBe(2);
    off();
  });
});
