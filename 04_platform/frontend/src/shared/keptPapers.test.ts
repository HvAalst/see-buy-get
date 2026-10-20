import { describe, expect, it } from 'vitest';
import { forgetPapers, KEEP_AGAIN_MS, keepPaper, keptPaper, needsKeeping } from './keptPapers';

/** A phone's storage, as the browser gives it. */
function fakeStore() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
    m,
  };
}

describe('the papers kept on the phone', () => {
  it('keeps a load’s note with when it was kept, per driver, and reads it back', () => {
    const s = fakeStore();
    keepPaper('did:d1', 'frt_1', '<html>note</html>', 'in_transit', Date.parse('2026-10-20T10:00:00Z'), s);
    expect(keptPaper('did:d1', 'frt_1', s)).toEqual({ html: '<html>note</html>', keptAt: '2026-10-20T10:00:00.000Z', status: 'in_transit' });
    expect(keptPaper('did:d2', 'frt_1', s)).toBeNull(); // another driver on the same phone reads nothing of it
    s.setItem('sbg-paper:did:d1:frt_2', 'not json');
    expect(keptPaper('did:d1', 'frt_2', s)).toBeNull();
  });

  it('fetches again when none is kept, when the load changed, or after a while', () => {
    const at = Date.parse('2026-10-20T10:00:00Z');
    const kept = { html: 'x', keptAt: new Date(at).toISOString(), status: 'claimed' };
    expect(needsKeeping(null, 'claimed', at)).toBe(true);
    expect(needsKeeping(kept, 'claimed', at + 60_000)).toBe(false);
    expect(needsKeeping(kept, 'in_transit', at + 60_000)).toBe(true);
    expect(needsKeeping(kept, 'claimed', at + KEEP_AGAIN_MS + 1)).toBe(true);
  });

  it('forgets every note of loads no longer the driver’s, and only theirs', () => {
    const s = fakeStore();
    for (const ref of ['frt_1', 'frt_2', 'frt_3']) keepPaper('did:d1', ref, `<html>${ref}</html>`, 'claimed', Date.now(), s);
    keepPaper('did:d2', 'frt_9', '<html>other</html>', 'claimed', Date.now(), s);
    s.setItem('sbg-token:did:d1', 'not a paper');
    expect(forgetPapers('did:d1', ['frt_2'], s)).toBe(2);
    expect([...s.m.keys()].sort()).toEqual(['sbg-paper:did:d1:frt_2', 'sbg-paper:did:d2:frt_9', 'sbg-token:did:d1']);
    expect(forgetPapers('did:d1', [], s)).toBe(1); // at sign-out: all of theirs
  });

  it('never throws where storage is blocked or full', () => {
    const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('full'); }, removeItem: () => undefined, key: () => null, length: 0 };
    expect(() => keepPaper('did:d1', 'frt_1', 'x', 'claimed', Date.now(), blocked)).not.toThrow();
    expect(keptPaper('did:d1', 'frt_1', blocked)).toBeNull();
  });
});
