import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sbgLogin } from '../../lib/sbg';
import { vendorSession } from '../../apps/vendor/api';
import { allShopDeviceKeys, saveShopDeviceKey, shopDeviceKey, shopDevicesApi } from './shopDevice';
import { counterPlaces } from '../../apps/agent/staff';
import { dropAccountUnlockMark, hasAccountUnlockHere, markAccountUnlock, secretBody } from './unlock';

/**
 * UNLOCK WITH FINGERPRINT OR FACE IN PLACE OF A SHOP'S, A HUB'S OR A STORE'S OWN PASSWORD (the owner, 2026-11-02: "ok go
 * ahead with the fingerprint") — what the browser keeps, and what goes on the wire. The note sits beside the key this
 * phone holds for the account's address, and names it; the ticket goes to the account's own door as `unlock`, never as
 * the password; and forgetting this phone from Settings takes the note with the key.
 */
function mockStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  } as Storage;
}
const SHOP = 'kona@shop.example';
const TICKET = `unl_${'a'.repeat(64)}`;
const config = { baseUrl: 'https://api.example', clientId: 'test/1', timeoutMs: 5000 };
let sent: Array<{ path: string; body: Record<string, unknown> }> = [];
const serve = (answer: unknown) => {
  sent = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(input as string, init);
    sent.push({ path: new URL(req.url).pathname, body: (await req.clone().json().catch(() => ({}))) as Record<string, unknown> });
    return new Response(JSON.stringify(answer), { status: 201, headers: { 'content-type': 'application/json' } });
  });
};
const last = () => sent[sent.length - 1];

beforeEach(() => {
  (globalThis as { localStorage?: Storage }).localStorage = mockStorage();
});
afterEach(() => vi.unstubAllGlobals());

describe('where the fingerprint or face is offered for an account', () => {
  it('for the address it was turned on for, however it is written, on the key it was made under', () => {
    saveShopDeviceKey(SHOP, 'dvc_shop-phone');
    markAccountUnlock(SHOP, 'dvc_shop-phone', 'cred-1');
    expect(hasAccountUnlockHere(' Kona@Shop.example ', shopDeviceKey(SHOP))).toBe(true);
    expect(hasAccountUnlockHere('other@shop.example', shopDeviceKey('other@shop.example'))).toBe(false);
    // The phone was confirmed again, or forgotten: another key, or none — and the note goes quiet.
    expect(hasAccountUnlockHere(SHOP, 'dvc_after-the-code')).toBe(false);
    expect(hasAccountUnlockHere(SHOP, undefined)).toBe(false);
    dropAccountUnlockMark(SHOP);
    expect(hasAccountUnlockHere(SHOP, 'dvc_shop-phone')).toBe(false);
  });

  it('a person’s note and an account’s never answer for each other', () => {
    markAccountUnlock(SHOP, 'dvc_shop-phone', 'cred-1');
    expect(globalThis.localStorage.key(0)).toBe(`sbg-shop-unlock:${SHOP}`);
  });
});

describe('the ticket goes to the account’s own door as `unlock`, in the password’s place', () => {
  it('a password goes as the password; a ticket as `unlock`', () => {
    expect(secretBody('duka-la-kona', 'password')).toEqual({ password: 'duka-la-kona' });
    expect(secretBody(TICKET, 'password')).toEqual({ unlock: TICKET });
  });

  it('the Shop and Hub apps’ sign-in', async () => {
    serve({ token: { access_token: 't' } });
    await sbgLogin(config, SHOP, TICKET, undefined, 'dvc_shop-phone');
    expect(last()).toEqual({ path: '/v1/sbg/auth/login', body: { email: SHOP, unlock: TICKET, device: 'dvc_shop-phone' } });
    await sbgLogin(config, SHOP, 'duka-la-kona', undefined, 'dvc_shop-phone');
    expect(last().body).toEqual({ email: SHOP, password: 'duka-la-kona', device: 'dvc_shop-phone' });
  });

  it('the Store app’s sign-in', async () => {
    serve({ token: { access_token: 't' } });
    await vendorSession('soko@store.example', TICKET, 'dvc_store-phone');
    expect(last()).toEqual({ path: '/v1/sbg/vendors/session', body: { email: 'soko@store.example', unlock: TICKET, device: 'dvc_store-phone' } });
  });
});

/**
 * 2026-11-02 (the owner: "a 1 person shop could use fingerprint to unlock as you said") — a colleague opening a session
 * at a counter says which phone it is on: the keys this browser holds for the shops' and hubs' own sign-ins, and no other.
 */
describe('a colleague’s session at a counter carries this phone’s shop and hub keys', () => {
  it('sends every shop and hub key this browser holds — and no person’s key', async () => {
    saveShopDeviceKey(SHOP, 'dvc_shop-phone');
    saveShopDeviceKey('sort@hub.example', 'dvc_hub-phone');
    globalThis.localStorage.setItem('sbg-device:712345678', 'dvc_a-persons-key');
    expect(allShopDeviceKeys().sort()).toEqual(['dvc_hub-phone', 'dvc_shop-phone']);
    serve({ shopDid: 'did:glos:shop', shopName: 'Kona', name: 'Wanjiru', memberId: 'm1', token: { access_token: 't' } });
    await counterPlaces(config, { personId: 'did:glos:p', token: { access_token: 'person' } }).open('did:glos:shop');
    expect(last().path).toBe('/v1/sbg/shops/did%3Aglos%3Ashop/staff-session');
    expect((last().body.devices as string[]).sort()).toEqual(['dvc_hub-phone', 'dvc_shop-phone']);
    await counterPlaces(config, { personId: 'did:glos:p', token: { access_token: 'person' } }).open('did:glos:hub', 'hub');
    expect(last().path).toBe('/v1/sbg/hubs/did%3Aglos%3Ahub/staff-session');
  });
});

describe('Settings, on the account’s own phones', () => {
  it('offers it beside the phones, asks with the password and this phone’s key — and forgetting the phone takes the note', async () => {
    saveShopDeviceKey(SHOP, 'dvc_shop-phone');
    const posted: Array<{ path: string; body: Record<string, unknown> }> = [];
    let answer: unknown = { on: true, which: 0, id: 'cred-1' };
    const api = shopDevicesApi((async (path: string, body: Record<string, unknown>) => {
      posted.push({ path, body });
      return { data: answer, error: null };
    }) as never, () => SHOP, 'hub');
    expect(api.passkey).toMatchObject({ secret: 'password', party: 'hub' });

    await api.passkey!.read();
    expect(posted[0]).toEqual({ path: '/v1/sbg/account/shop-passkey', body: { device: 'dvc_shop-phone' } });
    expect(hasAccountUnlockHere(SHOP, 'dvc_shop-phone')).toBe(true);
    await api.passkey!.prepare('duka-la-kona');
    expect(posted[1]).toEqual({ path: '/v1/sbg/account/shop-passkey/options', body: { device: 'dvc_shop-phone', password: 'duka-la-kona' } });

    answer = { forgotten: true, which: 0 };
    await api.forgetThis();
    expect(shopDeviceKey(SHOP)).toBeUndefined();
    expect(hasAccountUnlockHere(SHOP, 'dvc_shop-phone')).toBe(false);
  });
});
