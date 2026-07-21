import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Session } from './session';

function mockStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    length: 0,
  } as Storage;
}

describe('Session', () => {
  beforeEach(() => {
    (globalThis as { sessionStorage?: Storage }).sessionStorage = mockStorage();
  });

  it('mints once, then serves the cached token without re-minting', async () => {
    const mint = vi.fn().mockResolvedValue({ access_token: 'tok-1', expires_in: 3600 });
    const s = new Session('sbg:test', mint);
    expect(await s.getToken()).toBe('tok-1');
    expect(await s.getToken()).toBe('tok-1');
    expect(mint).toHaveBeenCalledTimes(1);
  });

  it('persists the token across navigations (a fresh Session re-hydrates it, no mint)', async () => {
    const mint = vi.fn().mockResolvedValue({ access_token: 'tok-A', expires_in: 3600 });
    await new Session('sbg:test', mint).getToken(); // page 1 mints + saves
    const mint2 = vi.fn();
    const s2 = new Session('sbg:test', mint2); // page 2 (after location.href)
    expect(await s2.getToken()).toBe('tok-A');
    expect(mint2).not.toHaveBeenCalled(); // fixed the `let token = null` navigation bug
  });

  it('re-mints past the soft monotonic deadline (never trusts the device wall clock)', async () => {
    const mint = vi.fn().mockResolvedValueOnce({ access_token: 'tok-1', expires_in: 1 }).mockResolvedValueOnce({ access_token: 'tok-2', expires_in: 3600 });
    const now = vi.spyOn(performance, 'now');
    now.mockReturnValue(0);
    const s = new Session('sbg:test', mint);
    expect(await s.getToken()).toBe('tok-1'); // soft deadline = 0 + 900ms
    now.mockReturnValue(2000); // past the 90%-of-1s deadline
    expect(await s.getToken()).toBe('tok-2');
    expect(mint).toHaveBeenCalledTimes(2);
    now.mockRestore();
  });

  it('clear() drops the token and forces a fresh mint', async () => {
    const mint = vi.fn().mockResolvedValueOnce({ access_token: 'tok-1', expires_in: 3600 }).mockResolvedValueOnce({ access_token: 'tok-2', expires_in: 3600 });
    const s = new Session('sbg:test', mint);
    await s.getToken();
    s.clear();
    expect(await s.getToken()).toBe('tok-2');
  });
});
