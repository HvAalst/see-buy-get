import { beforeEach, describe, expect, it } from 'vitest';
import { APP_OF, myAppsApi, readHandOver } from './myApps';
import { saveShopDeviceKey } from './shopDevice';

/*
 * "YOUR SEEBUYGET APPS" (the owner, 2026-11-03: "From within that account you should be able to switch to other sbg apps").
 * The menu of one kind opens another under the same email by a one-time hand-over: asked with this phone's key for the
 * kind asking, and the key it holds for the other kind; taken by the other app out of #handover=.
 */
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

describe('the hand-over in an address', () => {
  it('is read from #handover=, and nothing else is taken for one', () => {
    expect(readHandOver('#handover=ho_abc')).toBe('ho_abc');
    expect(readHandOver('#lang=sw&handover=ho_abc')).toBe('ho_abc');
    expect(readHandOver('#link=abc')).toBeUndefined();
    expect(readHandOver('')).toBeUndefined();
    expect(readHandOver(undefined)).toBeUndefined();
  });
});

describe('opening another kind of account from the menu', () => {
  beforeEach(() => {
    (globalThis as { localStorage?: Storage }).localStorage = mockStorage();
  });

  it('asks the hand-over with this phone’s key for the shop, and the key it holds for the hub, and goes to the Hub app', async () => {
    saveShopDeviceKey('amani@example.com', 'dvc_shop', 'shop');
    saveShopDeviceKey('amani@example.com', 'dvc_hub', 'hub');
    const sent: Array<[string, unknown]> = [];
    const api = myAppsApi(
      (async () => ({ data: { apps: [] }, error: null, status: 200 })) as never,
      (async (path: string, body: unknown) => {
        sent.push([path, body]);
        return { data: { code: 'ho_one-time' }, error: null, status: 201 };
      }) as never,
      () => 'amani@example.com',
      'shop',
    );
    const r = await api.open('mdp');
    expect(sent).toEqual([['/v1/sbg/account/my-apps/hand-over', { role: 'mdp', device: 'dvc_shop', targetDevice: 'dvc_hub' }]]);
    expect(r.data?.href).toMatch(/mdp\/#handover=ho_one-time$/);
  });

  it('says why when the server hands nothing over', async () => {
    const refused = { code: 'NOT_FOUND', status: 404, title: 'Not found', detail: 'No hub signs in with this email yet', retryable: false };
    const api = myAppsApi((async () => ({ data: null, error: refused, status: 404 })) as never, (async () => ({ data: null, error: refused, status: 404 })) as never, () => 'amani@example.com', 'store');
    expect((await api.open('mdp')).error).toEqual(refused);
  });

  it('knows each kind’s app and the kind its phone keys are kept under', () => {
    expect(APP_OF).toEqual({ pudo: { path: 'agent/', party: 'shop' }, mdp: { path: 'mdp/', party: 'hub' }, vendor: { path: 'vendor/', party: 'store' } });
  });
});
