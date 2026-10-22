import { beforeEach, describe, expect, it } from 'vitest';
import { deviceAskOf, dropShopDeviceKey, saveShopDeviceKey, shopDeviceKey, shopDevicesApi } from './shopDevice';

/** No browser here: a Storage of our own, as devices.test.ts keeps. */
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

describe('a shop’s own phones', () => {
  beforeEach(() => {
    (globalThis as { localStorage?: Storage }).localStorage = mockStorage();
  });

  it('keeps this phone’s key per shop address, whatever its case, and drops it', () => {
    saveShopDeviceKey('Kona@Shop.example ', 'dvc_1');
    expect(shopDeviceKey('kona@shop.example')).toBe('dvc_1');
    expect(shopDeviceKey('other@shop.example')).toBeUndefined();
    dropShopDeviceKey('KONA@shop.example');
    expect(shopDeviceKey('kona@shop.example')).toBeUndefined();
  });

  it('reads the sign-in’s "this phone is new" — and nothing else — as a code to ask for', () => {
    expect(deviceAskOf({ code: 'DEVICE_NOT_KNOWN', status: 403, title: '', detail: '', retryable: false, params: { challenge: 'dc_1', sentTo: '•••678', code: '123456' } })).toEqual({ challenge: 'dc_1', sentTo: '•••678', code: '123456' });
    expect(deviceAskOf({ code: 'DEVICE_NOT_KNOWN', status: 403, title: '', detail: 'no number to send a code to', retryable: false })).toBeNull();
    expect(deviceAskOf({ code: 'AUTH_FAILED', status: 401, title: '', detail: '', retryable: false, params: { challenge: 'dc_1' } })).toBeNull();
  });

  it('round 40 — a hub or a store with no number yet is asked for one first, and only when the server says so', () => {
    expect(deviceAskOf({ code: 'DEVICE_NOT_KNOWN', status: 403, title: '', detail: '', retryable: false, params: { challenge: 'dp_1', needsPhone: true } })).toEqual({ challenge: 'dp_1', sentTo: '', needsPhone: true });
    // Anything but a plain true is no ask for a number: the code went to the number the account has.
    expect(deviceAskOf({ code: 'DEVICE_NOT_KNOWN', status: 403, title: '', detail: '', retryable: false, params: { challenge: 'dc_2', sentTo: '•••678', needsPhone: 'yes' } })).toEqual({ challenge: 'dc_2', sentTo: '•••678' });
  });

  it('round 40 — the list says whose phones they are: a shop’s unless told a hub’s or a store’s', () => {
    const post = (async () => ({ data: null, error: null })) as never;
    expect(shopDevicesApi(post, () => null).party).toBe('shop');
    expect(shopDevicesApi(post, () => null, 'hub').party).toBe('hub');
    expect(shopDevicesApi(post, () => null, 'store').party).toBe('store');
  });

  it('asks the server with this phone’s key, by password, and forgets this phone’s key once the server has', async () => {
    saveShopDeviceKey('kona@shop.example', 'dvc_here');
    const sent: Array<[string, unknown]> = [];
    const post = (async (path: string, body: unknown) => {
      sent.push([path, body]);
      return { data: { forgotten: true, which: 0 }, error: null };
    }) as never;
    const api = shopDevicesApi(post, () => 'kona@shop.example');
    expect(api.secret).toBe('password');
    await api.forgetOthers('duka-la-kona');
    await api.forgetThis();
    expect(sent).toEqual([
      ['/v1/sbg/account/shop-devices/forget-others', { password: 'duka-la-kona', device: 'dvc_here' }],
      ['/v1/sbg/account/shop-devices/forget-this', { device: 'dvc_here' }],
    ]);
    expect(shopDeviceKey('kona@shop.example')).toBeUndefined();
  });
});
