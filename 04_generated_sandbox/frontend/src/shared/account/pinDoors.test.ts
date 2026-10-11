import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readDeviceKey, saveDeviceKey } from './pin';
import * as send from '../../apps/genesis/api';
import * as driver from '../../apps/driver/api';
import * as fleet from '../../apps/fleet/api';
import * as business from '../../apps/business/api';

/**
 * EVERY APP THAT SIGNS IN WITH A PIN SENDS THE DEVICE'S KEY WITH IT, AND KEEPS THE KEY IT IS HANDED.
 *
 * The server looks at a PIN only when the key of a device that person confirmed comes with it. Four apps sign in
 * with a PIN, each through its own calls; an app that forgot to send the key would ask its people for a code at
 * every sign-in, and one that forgot to keep it would ask every new person twice. This reads what each call
 * actually puts on the wire.
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
const PHONE = '+254712345678';
const PIN = '48261';
let sent: Array<{ path: string; body: Record<string, unknown> }> = [];
/** Answer every call with `answer`, and remember what was sent. */
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
  (globalThis as { sessionStorage?: Storage }).sessionStorage = mockStorage();
  vi.unstubAllGlobals();
});

describe('a PIN goes to the server with the key of the device it is typed on', () => {
  const doors: Array<[string, string, () => Promise<unknown>]> = [
    ['Send: signing in', '/v1/sbg/identity/login', () => send.pinLogin(PHONE, PIN)],
    ['Send: changing the PIN', '/v1/sbg/identity/pin/change', () => send.changePinWithCurrent(PHONE, PIN, '73914')],
    ['Driver: signing in', '/v1/sbg/drivers/session', () => driver.driverSession(PHONE, PIN)],
    ['Fleet: signing in with the company code', '/v1/sbg/fleet/managers/session', () => fleet.managerSession('FM-1A2B3C', PHONE, PIN)],
    ['Fleet: which fleets are mine', '/v1/sbg/fleet/managers/mine', () => fleet.managerChoices(PHONE, PIN)],
    ['Fleet: signing in to a fleet from that list', '/v1/sbg/fleet/managers/session', () => fleet.managerSessionByFleet('did:glos:fleet', PHONE, PIN)],
    ['Fleet: changing the PIN', '/v1/sbg/identity/pin/change', () => fleet.changeManagerPin(PHONE, PIN, '73914')],
    ['Business: signing in', '/v1/sbg/identity/login', () => business.pinLogin(PHONE, PIN)],
  ];

  it.each(doors)('%s', async (_name, path, call) => {
    saveDeviceKey(PHONE, 'dvc_this-phone');
    serve({ token: { access_token: 't', expires_in: 60 } });
    await call();
    expect(last().path).toBe(path);
    expect(last().body).toMatchObject({ phone: PHONE, pin: PIN, device: 'dvc_this-phone' });
  });

  it.each(doors)('%s — on a device with no key, sends none, and the server answers with the code step', async (_name, _path, call) => {
    serve({ code: 'DEVICE_NOT_KNOWN' });
    await call();
    expect(last().body.device).toBeUndefined();
    expect(last().body.pin).toBe(PIN);
  });

  it('the key is the NUMBER’s: another number typed on the same tablet sends its own, or none', async () => {
    saveDeviceKey(PHONE, 'dvc_this-phone');
    serve({});
    await driver.driverSession('+254798765432', PIN);
    expect(last().body.device).toBeUndefined();
    await driver.driverSession('0712 345 678', PIN);
    expect(last().body.device).toBe('dvc_this-phone');
  });
});

describe('the code was typed here: the key the server hands back is kept', () => {
  const enrolments: Array<[string, () => Promise<unknown>]> = [
    ['Send: a new account, or a forgotten PIN', () => send.enroll(PHONE, PIN)],
    ['Driver: first time, or a forgotten PIN', () => driver.choosePin(PHONE, PIN)],
    ['Business: a new person, or a forgotten PIN', () => business.enroll(PHONE, PIN)],
  ];

  it.each(enrolments)('%s', async (_name, enrol) => {
    serve({ personId: 'did:glos:p', token: { access_token: 't', expires_in: 60 }, device: 'dvc_handed-here' });
    await enrol();
    expect(last().path).toBe('/v1/sbg/identity/enroll');
    expect(readDeviceKey(PHONE)).toBe('dvc_handed-here');
    // …and it is what the very next PIN sign-in on this device carries.
    await send.pinLogin(PHONE, PIN);
    expect(last().body.device).toBe('dvc_handed-here');
  });

  it.each(enrolments)('%s — a newer key replaces the one before it (a PIN replaced by a code forgot the old one)', async (_name, enrol) => {
    saveDeviceKey(PHONE, 'dvc_from-before');
    serve({ token: { access_token: 't' }, device: 'dvc_after-the-code' });
    await enrol();
    expect(readDeviceKey(PHONE)).toBe('dvc_after-the-code');
  });
});
