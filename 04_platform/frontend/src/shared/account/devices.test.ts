import { beforeEach, describe, expect, it } from 'vitest';
import { t } from '../i18n';
import type { Result, SbgError } from '../../lib/sbg';
import { canForgetOthers, deviceLine, devicesLede, pinDevicesApi, type PinDevices } from './devices';
import { allDeviceKeys, dropDeviceKey, readDeviceKey, saveDeviceKey } from './pin';

/*
 * THE PHONES AND BROWSERS A PIN WORKS ON, in Settings. What is held to here: the browser sends every device key it
 * holds and nothing else of the browser's; forgetting THIS one drops this browser's copy of that key and no other
 * number's; and the words say what is so — how many, which one this is, and what each button costs before it is pressed.
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
const ok = <T,>(data: T) => ({ data, error: null }) as unknown as Result<T>;
const refused = (code: string) => ({ data: null, error: { code, status: 403, title: code, detail: '', retryable: false } as SbgError }) as unknown as Result<never>;
const day = (iso: string) => iso.slice(0, 10);
const seen = (over: Partial<PinDevices> = {}): PinDevices => ({ count: 2, here: true, unusedDays: 90, devices: [{ addedAt: '2026-10-02T08:00:00.000Z', usedAt: '2026-10-11T07:00:00.000Z', here: true }, { addedAt: '2026-09-01T08:00:00.000Z', here: false }], ...over });

beforeEach(() => {
  (globalThis as { localStorage?: Storage }).localStorage = mockStorage();
});

describe('the keys a browser holds', () => {
  it('are every number’s that signed in on it — and nothing else that is kept in the browser', () => {
    saveDeviceKey('+254712345678', 'dvc_njeri');
    saveDeviceKey('0700 000 001', 'dvc_office');
    localStorage.setItem('sbg-token', 'a-session');
    localStorage.setItem('glos-vendor-email', 'orders@duka.example');
    localStorage.setItem('not-sbg-device:1', 'dvc_lookalike');
    expect(allDeviceKeys()).toEqual([
      { slot: 'sbg-device:712345678', key: 'dvc_njeri' },
      { slot: 'sbg-device:700000001', key: 'dvc_office' },
    ]);
  });

  it('are none where there is no storage, and at most twenty', () => {
    for (let i = 0; i < 30; i++) saveDeviceKey(`+2547000000${String(i).padStart(2, '0')}`, `dvc_${i}`);
    expect(allDeviceKeys()).toHaveLength(20);
    (globalThis as { localStorage?: Storage }).localStorage = undefined;
    expect(allDeviceKeys()).toEqual([]);
    expect(() => dropDeviceKey('sbg-device:712345678')).not.toThrow();
  });

  it('drops one device key by where it is kept, and never anything that is not one', () => {
    saveDeviceKey('+254712345678', 'dvc_njeri');
    saveDeviceKey('+254700000001', 'dvc_office');
    localStorage.setItem('sbg-token', 'a-session');
    dropDeviceKey('sbg-token');
    dropDeviceKey(undefined);
    dropDeviceKey('');
    expect([localStorage.getItem('sbg-token'), allDeviceKeys().length]).toEqual(['a-session', 2]);
    dropDeviceKey('sbg-device:712345678');
    expect([readDeviceKey('+254712345678'), readDeviceKey('+254700000001')]).toEqual([undefined, 'dvc_office']);
  });
});

describe('what Settings asks the server', () => {
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  const api = (answer: (path: string) => Result<unknown>) =>
    pinDevicesApi((async (path: string, body: unknown) => {
      calls.push({ path, body: body as Record<string, unknown> });
      return answer(path);
    }) as never);
  beforeEach(() => {
    calls.length = 0;
    saveDeviceKey('+254700000001', 'dvc_office');
    saveDeviceKey('+254712345678', 'dvc_njeri');
  });

  it('reads with every key this browser holds, in the body', async () => {
    const r = await api(() => ok(seen())).read();
    expect(r.data?.count).toBe(2);
    expect(calls).toEqual([{ path: '/v1/sbg/account/pin-devices', body: { devices: ['dvc_office', 'dvc_njeri'] } }]);
  });

  it('forgets the others with the PIN and the same keys — and drops none of this browser’s', async () => {
    await api(() => ok({ forgotten: 2, kept: true })).forgetOthers('48261');
    expect(calls).toEqual([{ path: '/v1/sbg/account/pin-devices/forget-others', body: { pin: '48261', devices: ['dvc_office', 'dvc_njeri'] } }]);
    expect(allDeviceKeys()).toHaveLength(2);
  });

  it('forgets this one: the key the server names is dropped here, and the other number’s stays', async () => {
    const r = await api(() => ok({ forgotten: true, which: 1 })).forgetThis();
    expect(r.data).toEqual({ forgotten: true, which: 1 });
    expect(calls).toEqual([{ path: '/v1/sbg/account/pin-devices/forget-this', body: { devices: ['dvc_office', 'dvc_njeri'] } }]);
    expect([readDeviceKey('+254712345678'), readDeviceKey('+254700000001')]).toEqual([undefined, 'dvc_office']);
  });

  it('drops nothing when the server forgot nothing, or refused', async () => {
    await api(() => ok({ forgotten: false, which: -1 })).forgetThis();
    expect(allDeviceKeys()).toHaveLength(2);
    // A place it names without having forgotten anything is not acted on.
    await api(() => ok({ forgotten: false, which: 0 })).forgetThis();
    expect(allDeviceKeys()).toHaveLength(2);
    const r = await api(() => refused('UNAUTHORIZED')).forgetThis();
    expect(r.error?.code).toBe('UNAUTHORIZED');
    expect(allDeviceKeys()).toHaveLength(2);
  });
});

describe('how it is said', () => {
  it('says how many, how each came to be one, and when one stops being one', () => {
    expect(devicesLede(seen(), t as never)).toBe('Your PIN works on 2 phones and browsers. Each was confirmed once, by a code sent to your number and typed on it. One that is not used for 90 days stops working until it is confirmed again.');
    expect(devicesLede(seen({ count: 1, devices: [seen().devices[0]] }), t as never)).toMatch(/^Your PIN works on one phone or browser\. Each was confirmed once/);
    // A shop's own phones say whose they are: the shop's sign-in, confirmed by a code to the shop's number.
    expect(devicesLede(seen(), t as never, 'shop')).toBe('The shop’s sign-in works on 2 phones and browsers. Each was confirmed once, by a code sent to the shop’s number and typed on it. One that is not used for 90 days stops working until it is confirmed again.');
    // None: said as what happens next, and nothing about how "each" was confirmed.
    expect(devicesLede(seen({ count: 0, here: false, devices: [] }), t as never)).toBe('Your PIN does not work on any phone or browser at the moment. The next sign-in asks for a code to your number first.');
    // The number of days is the server's, not a word in the app.
    expect(devicesLede(seen({ unusedDays: 30 }), t as never)).toContain('not used for 30 days');
  });

  it('names a device by the one thing known of it: whether it is this one — with when it was confirmed and last used', () => {
    const [here, other] = seen().devices;
    expect(deviceLine(here, t as never, day)).toEqual({ title: 'This one', sub: 'Confirmed 2026-10-02 · last used 2026-10-11' });
    expect(deviceLine(other, t as never, day)).toEqual({ title: 'Another phone or browser', sub: 'Confirmed 2026-09-01 · not used since' });
  });

  it('offers to forget the others only when there is another', () => {
    expect(canForgetOthers(seen())).toBe(true);
    expect(canForgetOthers(seen({ count: 1, devices: [seen().devices[0]] }))).toBe(false);
    // Asked from a device that is not one of them: every one of them is "another".
    expect(canForgetOthers(seen({ here: false, devices: [seen().devices[1]] }))).toBe(true);
    expect(canForgetOthers(seen({ count: 0, devices: [] }))).toBe(false);
    expect(canForgetOthers(null)).toBe(false);
  });

  it('says what each of the two costs before it is done: both end signed out, and only one touches the other phones', () => {
    const others = t('account.devices.forgetOthersBody' as never);
    expect(others).toMatch(/signed out everywhere, here too/);
    expect(others).toMatch(/code to your number/);
    const here = t('account.devices.forgetThisBody' as never);
    expect(here).toMatch(/signed out here/);
    expect(here).toMatch(/Your other phones stay as they are/);
  });
});
