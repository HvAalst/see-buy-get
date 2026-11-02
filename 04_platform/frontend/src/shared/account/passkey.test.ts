import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { allDeviceKeys, saveDeviceKey } from './pin';
import { hasUnlockHere, markUnlock } from './unlock';
import { forgetPasskeySupport, passkeyApi, passkeySupported, unlockCeremony } from './passkey';

/**
 * UNLOCK WITH FINGERPRINT OR FACE — what goes on the wire, and what this browser keeps (2026-11-02). The phone's own
 * prompt is the library's (@simplewebauthn/browser), replaced here: what is proved is what the app sends and keeps
 * around it — every device key to Settings, the note kept in step with the server, the phone told to forget a passkey
 * that was turned off, and a sign-in that falls back to the PIN where the server has no passkey for this device.
 */
const lib = vi.hoisted(() => ({
  startRegistration: vi.fn(async () => ({ id: 'cred-1', response: { attestationObject: 'x' } })),
  startAuthentication: vi.fn(async () => ({ id: 'cred-1', response: { signature: 'x' } })),
}));
vi.mock('@simplewebauthn/browser', () => lib);

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
const OTHER = '+254798765432';
const ok = <T,>(data: T) => ({ data, error: null }) as never;

beforeEach(() => {
  (globalThis as { localStorage?: Storage }).localStorage = mockStorage();
  lib.startRegistration.mockClear();
  lib.startAuthentication.mockClear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  forgetPasskeySupport();
});

describe('Settings: on, off, and which is on', () => {
  it('sends every device key this browser holds, and keeps the note in step with what the server says', async () => {
    saveDeviceKey(OTHER, 'dvc_another-number');
    saveDeviceKey(PHONE, 'dvc_mine');
    const sent: Array<{ path: string; body: Record<string, unknown> }> = [];
    let answer: unknown = { on: true, which: 1, id: 'cred-1' };
    const api = passkeyApi((async (path: string, body: Record<string, unknown>) => {
      sent.push({ path, body });
      return ok(answer);
    }) as never);

    await api.read();
    expect(sent[0]).toEqual({ path: '/v1/sbg/account/passkey', body: { devices: ['dvc_another-number', 'dvc_mine'] } });
    expect(hasUnlockHere(PHONE)).toBe(true);
    expect(hasUnlockHere(OTHER)).toBe(false);

    answer = { on: false, which: 1 };
    await api.read();
    expect(hasUnlockHere(PHONE)).toBe(false);
  });

  it('turning on: the PIN first; then the phone, named by the end of its number; then its answer, kept as the note', async () => {
    saveDeviceKey(PHONE, 'dvc_mine');
    const sent: Array<{ path: string; body: Record<string, unknown> }> = [];
    const api = passkeyApi((async (path: string, body: Record<string, unknown>) => {
      sent.push({ path, body });
      return path.endsWith('/options') ? ok({ options: { challenge: 'c', user: { id: 'u', name: 'SeeBuyGet' } }, which: 0 }) : ok({ on: true, which: 0, id: 'cred-1' });
    }) as never);

    const prepared = await api.prepare('48261');
    expect(sent[0]).toEqual({ path: '/v1/sbg/account/passkey/options', body: { devices: ['dvc_mine'], pin: '48261' } });
    const out = await api.create(prepared.data as never);
    expect(lib.startRegistration).toHaveBeenCalledWith({ optionsJSON: { challenge: 'c', user: { id: 'u', name: 'SeeBuyGet …5678', displayName: 'SeeBuyGet …5678' } } });
    expect(sent[1]).toEqual({ path: '/v1/sbg/account/passkey/on', body: { devices: ['dvc_mine'], response: { id: 'cred-1', response: { attestationObject: 'x' } } } });
    expect(out.here).toMatchObject({ on: true });
    expect(hasUnlockHere(PHONE)).toBe(true);
  });

  it('the phone said no: nothing is sent, nothing is kept', async () => {
    saveDeviceKey(PHONE, 'dvc_mine');
    const post = vi.fn(async () => ok({ on: true, which: 0, id: 'cred-1' }));
    lib.startRegistration.mockRejectedValueOnce(Object.assign(new Error('no'), { name: 'NotAllowedError' }));
    const out = await passkeyApi(post as never).create({ options: { challenge: 'c' }, which: 0 });
    expect(out).toEqual({ cancelled: true });
    expect(post).not.toHaveBeenCalled();
    expect(hasUnlockHere(PHONE)).toBe(false);
  });

  it('turning off: the note goes, and the phone is told to forget the passkey where the browser can say so', async () => {
    saveDeviceKey(PHONE, 'dvc_mine');
    markUnlock(allDeviceKeys()[0].slot, 'dvc_mine', 'cred-1');
    const signal = vi.fn(async () => undefined);
    vi.stubGlobal('PublicKeyCredential', { signalUnknownCredential: signal });
    const api = passkeyApi((async () => ok({ on: false, which: 0, dropped: 'cred-1', rpId: 'seebuyget.com' })) as never);
    const r = await api.turnOff();
    expect(r.data).toMatchObject({ on: false });
    expect(hasUnlockHere(PHONE)).toBe(false);
    expect(signal).toHaveBeenCalledWith({ rpId: 'seebuyget.com', credentialId: 'cred-1' });
  });

  it('is offered only where the browser says this phone can check a fingerprint or face itself', async () => {
    vi.stubGlobal('PublicKeyCredential', undefined);
    expect(await passkeySupported()).toBe(false);
    forgetPasskeySupport();
    vi.stubGlobal('PublicKeyCredential', { isUserVerifyingPlatformAuthenticatorAvailable: async () => false });
    expect(await passkeySupported()).toBe(false);
    forgetPasskeySupport();
    vi.stubGlobal('PublicKeyCredential', { isUserVerifyingPlatformAuthenticatorAvailable: async () => true });
    expect(await passkeySupported()).toBe(true);
  });
});

describe('a sign-in screen: the phone’s prompt, then a ticket', () => {
  const config = { baseUrl: 'https://api.example', clientId: 'test/1', timeoutMs: 5000 };
  let answers: Record<string, unknown>;
  let sent: Array<{ path: string; body: Record<string, unknown> }>;
  beforeEach(() => {
    sent = [];
    answers = {};
    vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
      const path = new URL(input).pathname;
      sent.push({ path, body: JSON.parse(String(init?.body ?? '{}')) });
      const a = answers[path] as { status?: number; body: unknown };
      return new Response(JSON.stringify(a.body), { status: a.status ?? 201, headers: { 'content-type': 'application/json' } });
    });
    saveDeviceKey(PHONE, 'dvc_mine');
    markUnlock(allDeviceKeys()[0].slot, 'dvc_mine', 'cred-1');
  });

  it('asks with the number and this device’s key, and brings back the ticket', async () => {
    answers['/v1/sbg/identity/unlock/options'] = { body: { challenge: 'c', allowCredentials: [{ id: 'cred-1', type: 'public-key' }] } };
    answers['/v1/sbg/identity/unlock'] = { body: { unlock: 'unl_ticket', expiresIn: 120 } };
    const ceremony = unlockCeremony(config);
    expect(await ceremony.prepare(PHONE)).toBe('ready');
    const out = await ceremony.unlock(PHONE);
    expect(out).toEqual({ ticket: 'unl_ticket' });
    expect(sent.map((s) => s.path)).toEqual(['/v1/sbg/identity/unlock/options', '/v1/sbg/identity/unlock']);
    expect(sent[0].body).toEqual({ phone: PHONE, device: 'dvc_mine' });
    expect(sent[1].body).toEqual({ phone: PHONE, device: 'dvc_mine', response: { id: 'cred-1', response: { signature: 'x' } } });
  });

  it('nothing offered for this device: the note goes, and the PIN is asked for', async () => {
    answers['/v1/sbg/identity/unlock/options'] = { body: { challenge: 'c', allowCredentials: [] } };
    expect(await unlockCeremony(config).prepare(PHONE)).toBe('off');
    expect(hasUnlockHere(PHONE)).toBe(false);
  });

  it('turned off elsewhere between the prompt and the answer: the note goes', async () => {
    answers['/v1/sbg/identity/unlock/options'] = { body: { challenge: 'c', allowCredentials: [{ id: 'cred-1', type: 'public-key' }] } };
    answers['/v1/sbg/identity/unlock'] = { status: 403, body: { code: 'UNLOCK_OFF', title: 'off', detail: 'off', status: 403 } };
    const out = await unlockCeremony(config).unlock(PHONE);
    expect(out.off).toBe(true);
    expect(hasUnlockHere(PHONE)).toBe(false);
  });

  it('the phone said no: nothing is sent after the prompt, and the note stays', async () => {
    answers['/v1/sbg/identity/unlock/options'] = { body: { challenge: 'c', allowCredentials: [{ id: 'cred-1', type: 'public-key' }] } };
    lib.startAuthentication.mockRejectedValueOnce(Object.assign(new Error('no'), { name: 'NotAllowedError' }));
    const out = await unlockCeremony(config).unlock(PHONE);
    expect(out).toEqual({ cancelled: true });
    expect(sent.map((s) => s.path)).toEqual(['/v1/sbg/identity/unlock/options']);
    expect(hasUnlockHere(PHONE)).toBe(true);
  });
});

