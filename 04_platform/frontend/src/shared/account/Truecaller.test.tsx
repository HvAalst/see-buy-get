import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToString } from 'preact-render-to-string';
import { t } from '../i18n';
import { OtherWays, noteTruecallerMiss, offeredWaysOf, truecallerMissFor } from './CodeWays';
import { TruecallerOffer, confirmByTruecaller, truecallerUsable, type TruecallerDeps, type TruecallerDoors } from './Truecaller';
import { phoneMoveReady } from './SettingsSheet';

/*
 * 2026-11-17 — A NUMBER CONFIRMED BY TRUECALLER, NO CODE (the owner, of the BRICS nations' own apps: "as recommended … build
 * it"). Only from an Android phone's browser, only where offered; anything but a confirmation and a code goes by text.
 */
const config = { baseUrl: 'https://api.example', timeoutMs: 1000 } as never;
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; SM-A146B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36';

/** The server, as the flow sees it: the start, then each status asked in turn. */
function serverAnswers(start: { status: number; body: unknown }, states: string[]) {
  const calls: Array<{ url: string; body?: unknown }> = [];
  let i = 0;
  vi.stubGlobal('fetch', async (url: string, init?: { body?: string }) => {
    calls.push({ url, body: init?.body ? JSON.parse(init.body) : undefined });
    if (url.endsWith('/auth/truecaller/start')) return new Response(JSON.stringify(start.body), { status: start.status });
    const state = states[Math.min(i++, states.length - 1)];
    return new Response(JSON.stringify({ state }), { status: 200 });
  });
  return calls;
}

/** A clock that moves only when the flow waits, and a phone where Truecaller's sheet took the focus (or did not). */
function phone(focused: boolean) {
  let now = 0;
  const opened: string[] = [];
  const deps: TruecallerDeps = { open: (l) => void opened.push(l), focused: () => focused, wait: async (ms) => void (now += ms), now: () => now };
  return { deps, opened };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('where Truecaller can be offered', () => {
  it('an Android phone’s browser — the driver app too, Chrome underneath — and nowhere else', () => {
    expect(truecallerUsable(ANDROID)).toBe(true);
    expect(truecallerUsable('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1')).toBe(false);
    expect(truecallerUsable('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/129.0 Safari/537.36')).toBe(false);
    // An app's own built-in browser cannot open Truecaller.
    expect(truecallerUsable('Mozilla/5.0 (Linux; Android 14; SM-A146B; wv) AppleWebKit/537.36 Chrome/129.0 Mobile Safari/537.36')).toBe(false);
  });

  it('shows nothing until the server says it is offered for the number', () => {
    expect(renderToString(<TruecallerOffer config={config} phone="+254712345678" onConfirmed={() => undefined} onFallback={() => undefined} />)).toBe('');
  });
});

describe('one try with Truecaller', () => {
  it('opens Truecaller with the server’s link, then asks until it is confirmed', async () => {
    const calls = serverAnswers({ status: 201, body: { nonce: 'n-123456789', link: 'truecallersdk://truesdk/web_verify?requestNonce=n-123456789' } }, ['waiting', 'opened', 'confirmed']);
    const { deps, opened } = phone(false);
    expect(await confirmByTruecaller(config, '+254712345678', { stopped: false }, deps)).toBe('confirmed');
    expect(opened).toEqual(['truecallersdk://truesdk/web_verify?requestNonce=n-123456789']);
    expect(calls[0]).toMatchObject({ url: 'https://api.example/v1/sbg/auth/truecaller/start', body: { phone: '+254712345678', lang: 'en' } });
    expect(calls.slice(1).map((c) => c.url)).toEqual(Array(3).fill('https://api.example/v1/sbg/auth/truecaller/n-123456789'));
  });

  it('Truecaller not on the phone: this page kept the focus, and nothing more is asked', async () => {
    const calls = serverAnswers({ status: 201, body: { nonce: 'n-123456789', link: 'truecallersdk://x' } }, ['confirmed']);
    const { deps } = phone(true);
    expect(await confirmByTruecaller(config, '+254712345678', { stopped: false }, deps)).toBe('not_installed');
    expect(calls).toHaveLength(1);
  });

  it('refused by the server (not offered, not set up): Truecaller is never opened', async () => {
    serverAnswers({ status: 400, body: { code: 'INVALID_STATE', detail: 'Truecaller is not offered' } }, []);
    const { deps, opened } = phone(false);
    expect(await confirmByTruecaller(config, '+254712345678', { stopped: false }, deps)).toBe('refused');
    expect(opened).toEqual([]);
  });

  it('declined, another number, or nothing in two minutes: not confirmed', async () => {
    const link = { status: 201, body: { nonce: 'n-123456789', link: 'truecallersdk://x' } };
    serverAnswers(link, ['opened', 'rejected']);
    expect(await confirmByTruecaller(config, '+254712345678', { stopped: false }, phone(false).deps)).toBe('rejected');
    serverAnswers(link, ['other_number']);
    expect(await confirmByTruecaller(config, '+254712345678', { stopped: false }, phone(false).deps)).toBe('other_number');
    const calls = serverAnswers(link, ['waiting']);
    expect(await confirmByTruecaller(config, '+254712345678', { stopped: false }, phone(false).deps)).toBe('expired');
    expect(calls.length).toBeLessThanOrEqual(1 + 120_000 / 1500 + 1);
  });

  it('given up on this page ("by text instead"): stops asking', async () => {
    const calls = serverAnswers({ status: 201, body: { nonce: 'n-123456789', link: 'truecallersdk://x' } }, ['waiting']);
    const stop = { stopped: false };
    const { deps } = phone(false);
    const wait = deps.wait;
    let waited = 0;
    deps.wait = async (ms) => {
      if (++waited === 3) stop.stopped = true;
      await wait(ms);
    };
    expect(await confirmByTruecaller(config, '+254712345678', stop, deps)).toBe('cancelled');
    expect(calls.length).toBeLessThan(4);
  });
});

describe('why the code came by text', () => {
  it('said on the code step, for the number Truecaller was tried for — even where no app is offered', () => {
    noteTruecallerMiss('+254 712 345 678', 'not_installed');
    expect(truecallerMissFor('+254712345678')).toBe('not_installed');
    const html = renderToString(<OtherWays config={config} phone="+254712345678" sentAt={Date.now()} sentVia="sms" onSend={() => undefined} ways={[]} />);
    expect(html).toContain(t('account.truecaller.notInstalled'));
    expect(renderToString(<OtherWays config={config} phone="+254799999999" sentAt={Date.now()} sentVia="sms" onSend={() => undefined} ways={[]} />)).toBe('');
    noteTruecallerMiss('+254712345678', 'confirmed');
    expect(truecallerMissFor('+254712345678')).toBeNull();
    noteTruecallerMiss('+254712345678', 'other_number', 0);
    expect(truecallerMissFor('+254712345678', 11 * 60_000)).toBeNull();
  });
});

describe('every screen that proves a person’s own number by a code offers Truecaller where it can', () => {
  it('sign-up and sign-in in the Send, Home, Driver and Business apps, a number in a form, Trouble signing in, a new number in Settings', () => {
    // 2026-11-17 — Trouble signing in and a new number in Settings joined (the owner: "Ok fix that weakness").
    const screens: Array<[string, number]> = [
      ['apps/genesis/screens/AuthScreen.tsx', 1], ['apps/home/screens/JoinScreen.tsx', 1], ['apps/driver/screens/SignInScreen.tsx', 1], ['apps/business/screens/SignInScreen.tsx', 1],
      ['shared/account/PhoneVerify.tsx', 1],
      // The number gone with the PIN forgotten, and asking staff to move the account: both prove a new number.
      ['shared/account/TroubleSheet.tsx', 2],
      ['shared/account/SettingsSheet.tsx', 1],
    ];
    for (const [screen, times] of screens) {
      const src = readFileSync(join('src', screen), 'utf8');
      expect({ screen, offers: src.split('<TruecallerOffer').length - 1 }).toEqual({ screen, offers: times });
    }
  });

  it('a new number in Settings is saved once proven by a code or by Truecaller, with the PIN', () => {
    expect(phoneMoveReady({ sent: false, verified: true, code: '', pin: '13579' })).toBe(true);
    expect(phoneMoveReady({ sent: true, verified: false, code: '123456', pin: '13579' })).toBe(true);
    expect(phoneMoveReady({ sent: true, verified: false, code: '123', pin: '13579' })).toBe(false);
    expect(phoneMoveReady({ sent: false, verified: false, code: '', pin: '13579' })).toBe(false);
    expect(phoneMoveReady({ sent: false, verified: true, code: '', pin: '13' })).toBe(false);
  });
});

describe('a try through a signed-in client (a new number in Settings)', () => {
  it('the ways a server names keep Truecaller, for the public door and a signed-in one alike', () => {
    expect(offeredWaysOf(['whatsapp', 'truecaller', 'pigeon', 'telegram'])).toEqual(['whatsapp', 'truecaller', 'telegram']);
    expect(offeredWaysOf(undefined)).toEqual([]);
  });

  it('goes through the doors it is given, and asks no public door', async () => {
    const fetched: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      fetched.push(url);
      return new Response('{}', { status: 500 });
    });
    const asked: string[] = [];
    const doors: TruecallerDoors = {
      ways: async () => ['truecaller'],
      start: async (phone, lang) => (asked.push(`start ${phone} ${lang}`), { data: { nonce: 'n-signed-in-1', link: 'truecallersdk://x' }, error: null, status: 201 }),
      status: async (nonce) => (asked.push(`status ${nonce}`), { data: { state: 'confirmed' }, error: null, status: 200 }),
    };
    expect(await confirmByTruecaller(doors, '+254712345678', { stopped: false }, phone(false).deps)).toBe('confirmed');
    expect(asked).toEqual(['start +254712345678 en', 'status n-signed-in-1']);
    expect(fetched).toEqual([]);
  });
});
