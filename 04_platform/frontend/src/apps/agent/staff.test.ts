import { beforeEach, describe, expect, it } from 'vitest';
import { makeConfig } from '../../lib/sbg';
import { saveDeviceKey } from '../../shared/account/pin';
import { clearStaff, counterPlaces, ownerOnlyScreen, placesInOrder, readStaff, saveStaff, staffDoors, type CounterPlace } from './staff';

/** No browser here: a Storage of our own, as the other account tests keep. */
function mockStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  } as Storage;
}

/** A fetch that answers every request with `answer`, and keeps what was asked. */
function fakeFetch(answer: (url: string, init: RequestInit) => unknown) {
  const asked: Array<{ url: string; method: string; body: unknown; auth: string | null }> = [];
  // Called with a Request by the signed-in client, with a URL and its init by the doors before sign-in.
  const fetch = (async (input: Request | string, init: RequestInit = {}) => {
    const req = typeof input === 'string' ? new Request(input, init) : input;
    const text = await req.text();
    asked.push({ url: req.url, method: req.method, body: text ? JSON.parse(text) : undefined, auth: req.headers.get('authorization') });
    return new Response(JSON.stringify(answer(req.url, init)), { status: 201, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, asked };
}

describe('the people at the counter, signing in', () => {
  beforeEach(() => {
    (globalThis as { localStorage?: Storage }).localStorage = mockStorage();
    (globalThis as { sessionStorage?: Storage }).sessionStorage = mockStorage();
  });

  it('remembers who is at the counter for this shop only, and forgets them on the way out', () => {
    saveStaff({ shopDid: 'did:shop:a', shopName: 'Kaunta', name: 'Wanjiru', memberId: 'ssm_1' });
    expect(readStaff('did:shop:a')).toEqual({ shopDid: 'did:shop:a', shopName: 'Kaunta', name: 'Wanjiru', memberId: 'ssm_1' });
    // Another shop signed in on the same phone is that shop's own sign-in, not Wanjiru's.
    expect(readStaff('did:shop:b')).toBeNull();
    expect(readStaff(null)).toBeNull();
    clearStaff();
    expect(readStaff('did:shop:a')).toBeNull();
  });

  it('shows the shops to work first, then the ones still asking, each by name', () => {
    const p = (shopName: string, state: CounterPlace['state']): CounterPlace => ({ memberId: shopName, shopDid: shopName, shopName, name: 'W', state, invitedAt: '' });
    expect(placesInOrder([p('Zawadi', 'invited'), p('Baraka', 'working'), p('Amani', 'invited'), p('Tumaini', 'working')]).map((x) => x.shopName)).toEqual(['Baraka', 'Tumaini', 'Amani', 'Zawadi']);
  });

  it('keeps the owner’s screens from the counter: money, prices, freight, the shelf’s layout, the books', () => {
    expect((['records', 'rates', 'freight', 'shelf'] as const).every(ownerOnlyScreen)).toBe(true);
    expect((['home', 'accept', 'release', 'handover', 'bag', 'receivebag', 'void', 'consignments', 'collect'] as const).some(ownerOnlyScreen)).toBe(false);
  });

  it('signs in with the PIN and this phone’s key for that number — the PIN alone opens nothing', async () => {
    const { fetch, asked } = fakeFetch(() => ({ personId: 'did:person:w', token: { access_token: 't' } }));
    const realFetch = globalThis.fetch;
    globalThis.fetch = fetch;
    try {
      saveDeviceKey('+254712000111', 'dvc_w');
      await staffDoors(makeConfig('agent', '1.0.0')).login(' 0712000111 ', '48261');
      expect(asked[0]).toMatchObject({ method: 'POST', body: { phone: '0712000111', pin: '48261', device: 'dvc_w' } });
      expect(asked[0].url).toMatch(/\/v1\/sbg\/identity\/login$/);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('asks for the person’s shops with their own sign-in, and drops it once a session at a counter is open', async () => {
    const { fetch, asked } = fakeFetch((url) => (url.endsWith('/staff-session') ? { shopDid: 'did:shop:a', shopName: 'Kaunta', name: 'Wanjiru', token: { access_token: 'staff' } } : []));
    const realFetch = globalThis.fetch;
    globalThis.fetch = fetch;
    try {
      const places = counterPlaces(makeConfig('agent', '1.0.0'), { personId: 'did:person:w', token: { access_token: 'own', expires_in: 600 } });
      await places.list();
      const opened = await places.open('did:shop:a');
      expect(opened.data?.name).toBe('Wanjiru');
      expect(asked.map((a) => [a.method, a.url.replace(/^.*\/v1/, '/v1'), a.auth])).toEqual([
        ['GET', '/v1/sbg/shop-invitations', 'Bearer own'],
        ['POST', '/v1/sbg/shops/did%3Ashop%3Aa/staff-session', 'Bearer own'],
      ]);
      // The person's own token is not kept on the shop's phone, and once a counter is open it is not used again.
      expect([sessionStorage.length, localStorage.length]).toEqual([0, 0]);
      expect((await places.list()).error?.status).toBe(401);
      expect(asked).toHaveLength(2);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
