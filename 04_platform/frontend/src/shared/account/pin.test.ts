import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SbgError } from '../../lib/sbg';
import { PIN_LENGTH, isNewDevice, pinGuessable, pinReady, readDeviceKey, saveDeviceKey } from './pin';
import { pinChangeBlocker } from './password';
import { recoveryApi } from './recovery';

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
const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const refusal = (code: string): SbgError => ({ code, status: 403, title: code, detail: '', retryable: false }) as unknown as SbgError;

beforeEach(() => {
  (globalThis as { localStorage?: Storage }).localStorage = mockStorage();
  vi.unstubAllGlobals();
});

/*
 * TOO EASY TO GUESS, SAID ON THE PHONE (2026-10-25). The server refuses these PINs when one is chosen
 * (person.service.ts isGuessablePin); the apps now say so before sending. The lists below are the server test's own
 * ("refuses the PINs a colleague tries first", pudo.service.spec.ts) — change one, change both.
 */
describe('a PIN too easy to guess', () => {
  it('is the server’s list, refused on the phone before anything is sent', () => {
    for (const easy of ['00000', '77777', '12121', '11222', '55005', '12345', '98765', '78901', '13579', '24680', '97531', '12312', '45645', '02580', '25800', '08520', '70852']) {
      expect([easy, pinGuessable(easy)]).toEqual([easy, true]);
    }
    for (const fine of ['13570', '24689', '48261', '90417']) expect([fine, pinGuessable(fine)]).toEqual([fine, false]);
    // A PIN not yet typed in full is not judged — the boxes are still filling.
    expect(pinGuessable('1234')).toBe(false);
  });

  it('holds a PIN change too, in the same words', () => {
    expect(pinChangeBlocker({ current: '48261', next: '12345' })).toBe('account.pin.guessable');
    expect(pinChangeBlocker({ current: '48261', next: '90417' })).toBeNull();
  });
});

describe('a PIN', () => {
  it('is five digits — every app counts its boxes from the one number', () => {
    expect(PIN_LENGTH).toBe(5);
    expect(pinReady('48261')).toBe(true);
    // Four was the length of a PIN, and is the length of a mobile-money PIN: not this one.
    for (const not of ['4826', '482619', '4826a', ' 4826', '', '4826 ']) expect([not, pinReady(not)]).toEqual([not, false]);
  });
});

describe('the key a device is handed when a code to the phone is typed on it', () => {
  it('is kept for the NUMBER, however that number is typed the next time', () => {
    saveDeviceKey('+254 712 345 678', 'dvc_one');
    for (const typed of ['+254712345678', '0712345678', '0712 345 678', '254712345678']) expect([typed, readDeviceKey(typed)]).toEqual([typed, 'dvc_one']);
    // Another number on the same tablet has its own, or none.
    expect(readDeviceKey('0798765432')).toBeUndefined();
    saveDeviceKey('0798765432', 'dvc_two');
    expect(readDeviceKey('+254798765432')).toBe('dvc_two');
    expect(readDeviceKey('0712345678')).toBe('dvc_one');
  });

  it('is not overwritten by an answer that carried none', () => {
    saveDeviceKey('0712345678', 'dvc_one');
    saveDeviceKey('0712345678', undefined);
    expect(readDeviceKey('0712345678')).toBe('dvc_one');
  });

  it('is simply absent where a browser keeps nothing: the next PIN sign-in asks for the code', () => {
    (globalThis as { localStorage?: Storage }).localStorage = undefined;
    expect(() => saveDeviceKey('0712345678', 'dvc_one')).not.toThrow();
    expect(readDeviceKey('0712345678')).toBeUndefined();
  });

  it('a device that is new is a step to take, and nothing else is', () => {
    expect(isNewDevice(refusal('DEVICE_NOT_KNOWN'))).toBe(true);
    for (const other of ['AUTH_FAILED', 'PIN_LOCKED', 'PIN_WRONG', 'RATE_LIMITED']) expect([other, isNewDevice(refusal(other))]).toEqual([other, false]);
    expect(isNewDevice(null)).toBe(false);
    expect(isNewDevice(undefined)).toBe(false);
  });
});

describe('the doors that hand a device its key keep it', () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  const serve = (answer: (url: string) => Response) => {
    calls.length = 0;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(input as string, init);
      calls.push({ url: req.url, body: await req.clone().json().catch(() => null) });
      return answer(req.url);
    });
  };
  const api = () => recoveryApi({ baseUrl: 'https://api.example', client: 'test' } as never);

  it('confirming this device: the key that comes back is kept for that number', async () => {
    serve(() => jsonResponse({ device: 'dvc_confirmed' }, 201));
    const r = await api().confirmDevice('0712345678');
    expect(r.error).toBeFalsy();
    expect(calls[0].url).toContain('/v1/sbg/identity/device');
    expect(calls[0].body).toEqual({ phone: '0712345678' });
    expect(readDeviceKey('+254712345678')).toBe('dvc_confirmed');
  });

  it('choosing a PIN: the one door that chooses one, saying which device it is on — and the key that comes back is kept', async () => {
    saveDeviceKey('+254712345678', 'dvc_before');
    serve(() => jsonResponse({ hasPin: true, device: 'dvc_after' }, 201));
    const r = await api().choosePin('+254712345678', '48261');
    expect(r.error).toBeFalsy();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('/v1/sbg/identity/enroll');
    expect(calls[0].body).toEqual({ phone: '+254712345678', pin: '48261', device: 'dvc_before' });
    expect(readDeviceKey('0712 345 678')).toBe('dvc_after');
  });

  it('choosing a PIN: the email and its code go only on the second try, and a refusal keeps nothing', async () => {
    serve(() => jsonResponse({ code: 'FIELD_REQUIRED', status: 400, title: 'x', detail: 'x', params: { field: 'email', why: 'pin-reset' } }, 400));
    const first = await api().choosePin('+254712345678', '48261');
    expect(first.error?.code).toBe('FIELD_REQUIRED');
    expect(calls[0].body).toEqual({ phone: '+254712345678', pin: '48261' });
    expect(readDeviceKey('+254712345678')).toBeUndefined();
    serve(() => jsonResponse({ hasPin: true, device: 'dvc_new' }, 201));
    await api().choosePin('+254712345678', '48261', { email: 'njeri@example.com', code: '482615' });
    expect(calls[0].body).toEqual({ phone: '+254712345678', pin: '48261', email: 'njeri@example.com', emailCode: '482615' });
    expect(readDeviceKey('+254712345678')).toBe('dvc_new');
  });

  it('a refusal keeps nothing', async () => {
    serve(() => jsonResponse({ code: 'PHONE_NOT_VERIFIED', status: 400, title: 'Verify', detail: 'Verify your phone number first' }, 400));
    const r = await api().confirmDevice('0712345678');
    expect(r.error?.code).toBe('PHONE_NOT_VERIFIED');
    expect(readDeviceKey('0712345678')).toBeUndefined();
  });

  it('getting back in on a new number: the key is kept for the NEW number', async () => {
    serve(() => jsonResponse({ recovered: true, device: 'dvc_recovered' }, 201));
    await api().recover({ email: 'a@example.com', code: '123456', newPhone: '0798765432', pin: '48261' });
    expect(readDeviceKey('0798765432')).toBe('dvc_recovered');
    expect(readDeviceKey('0712345678')).toBeUndefined();
  });
});
