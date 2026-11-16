import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToString } from 'preact-render-to-string';
import { t } from '../i18n';
import { CodeWayChoice, DeviceCodeAgain, OtherWays } from './CodeWays';
import { deviceAskOf } from './shopDevice';

/*
 * 2026-11-16 — HOW A CODE COMES (the plan "Sign-in codes beyond Twilio SMS", D2 to D4): by text, or by WhatsApp or Telegram
 * where offered — the person's own choice; after a minute, another way. Where no app is offered nothing shows, so the screens
 * stay as they were.
 */
const config = { baseUrl: 'https://seebuyget.com', timeoutMs: 1000 } as never;
const noop = () => undefined;

describe('choosing how the code comes', () => {
  it('nothing where no app is offered for the number', () => {
    expect(renderToString(<CodeWayChoice config={config} phone="+254712345678" value="sms" onChange={noop} ways={[]} />)).toBe('');
  });

  it('a text, and each offered app in the server’s order; text first and chosen unless the person chose otherwise', () => {
    const html = renderToString(<CodeWayChoice config={config} phone="+254712345678" value="sms" onChange={noop} ways={['whatsapp', 'telegram']} />);
    expect(html).toContain(t('account.ways.how'));
    expect(html.indexOf(t('account.ways.sms'))).toBeLessThan(html.indexOf('WhatsApp'));
    expect(html.indexOf('WhatsApp')).toBeLessThan(html.indexOf('Telegram'));
    expect(html).not.toContain(t('account.ways.appHint', { app: 'WhatsApp' }));
    const chosen = renderToString(<CodeWayChoice config={config} phone="+254712345678" value="whatsapp" onChange={noop} ways={['whatsapp', 'telegram']} />);
    expect(chosen).toContain(t('account.ways.appHint', { app: 'WhatsApp' }));
  });

  it('an app chosen before but not offered here falls back to a text', () => {
    const html = renderToString(<CodeWayChoice config={config} phone="+251911234567" value="whatsapp" onChange={noop} ways={['telegram']} />);
    expect(html).not.toContain('WhatsApp');
    expect(html).not.toContain(t('account.ways.appHint', { app: 'WhatsApp' }));
  });
});

describe('another way, after a code was sent', () => {
  it('nothing where it went by text and no app is offered: the screen’s own new-code stays the way', () => {
    expect(renderToString(<OtherWays config={config} phone="+254712345678" sentAt={Date.now()} sentVia="sms" onSend={noop} ways={[]} />)).toBe('');
  });

  it('waits a minute, then offers the apps not used yet and a text; never asks for the code', () => {
    const waiting = renderToString(<OtherWays config={config} phone="+254712345678" sentAt={Date.now()} sentVia="sms" onSend={noop} ways={['whatsapp', 'telegram']} />);
    expect(waiting).toMatch(/Didn.t get it\? In \d+ seconds/);
    expect(waiting).toMatch(/<button[^>]*disabled[^>]*><span>By WhatsApp/);
    expect(waiting).toContain(t('account.ways.never'));
    const ready = renderToString(<OtherWays config={config} phone="+254712345678" sentAt={Date.now() - 61_000} sentVia="sms" onSend={noop} ways={['whatsapp', 'telegram']} />);
    expect(ready).toContain(t('account.ways.ready'));
    expect(ready).toContain(t('account.ways.byApp', { app: 'Telegram' }));
    expect(ready).toContain(t('account.ways.byTextAgain'));
    expect(ready).not.toMatch(/<button[^>]*disabled[^>]*><span>By WhatsApp/);
  });

  it('a code sent by an app says so, and offers a text instead — in the console’s look too', () => {
    const html = renderToString(<OtherWays look="console" config={config} phone="+254712345678" sentAt={Date.now() - 61_000} sentVia="whatsapp" onSend={noop} ways={['whatsapp', 'telegram']} />);
    expect(html).toContain(t('account.ways.sentBy', { app: 'WhatsApp' }));
    expect(html).toContain(t('account.ways.byTextInstead'));
    expect(html).not.toContain(t('account.ways.byApp', { app: 'WhatsApp' }));
    expect(html).toContain('cbtn cbtn--ghost');
  });
});

/*
 * 2026-11-16 — EVERY CODE SCREEN GETS THE SAME CHOICE (the owner: “they should be given the same choice”), a shop’s, hub’s or
 * store’s new phone too: it sees only the end of its number, so the apps offered come with the server’s answer.
 */
describe('a new phone’s code, another way', () => {
  it('reads the ways offered and the way it went from the server’s answer', () => {
    const ask = deviceAskOf({ code: 'DEVICE_NOT_KNOWN', status: 403, title: '', params: { challenge: 'dc_1', sentTo: '•••678', via: 'whatsapp', ways: ['whatsapp', 'telegram', 'pigeon'] } } as never);
    expect(ask).toMatchObject({ challenge: 'dc_1', via: 'whatsapp', ways: ['whatsapp', 'telegram'] });
    expect(deviceAskOf({ code: 'DEVICE_NOT_KNOWN', status: 403, title: '', params: { challenge: 'dc_2', sentTo: '•••678' } } as never)).not.toHaveProperty('ways');
  });

  it('shows nothing where no app is offered and it went by text; otherwise the other ways, after a minute', () => {
    expect(renderToString(<DeviceCodeAgain config={config} challenge="dc_1" ways={[]} via="sms" />)).toBe('');
    const html = renderToString(<DeviceCodeAgain config={config} challenge="dc_1" ways={['whatsapp', 'telegram']} via="whatsapp" />);
    expect(html).toContain(t('account.ways.sentBy', { app: 'WhatsApp' }));
    expect(html).toContain(t('account.ways.byApp', { app: 'Telegram' }));
    expect(html).toMatch(/<button[^>]*disabled[^>]*><span>By Telegram/);
  });
});

describe('every screen that sends a code offers the other ways', () => {
  it('each of them — sign-up, sign-in, a new phone, a forgotten PIN, a new number, a payout number, counter staff', () => {
    const screens = [
      'shared/account/PhoneVerify.tsx', 'shared/account/NewDeviceSheet.tsx', 'shared/account/ChoosePinSheet.tsx', 'shared/account/IdDisputeOpen.tsx',
      'shared/account/TroubleSheet.tsx', 'shared/account/SettingsSheet.tsx', 'shared/account/ConfirmDevice.tsx',
      'apps/genesis/screens/AuthScreen.tsx', 'apps/home/screens/JoinScreen.tsx', 'apps/driver/screens/SignInScreen.tsx', 'apps/business/screens/SignInScreen.tsx',
      'apps/agent/screens/StaffSignIn.tsx', 'apps/agent/screens/SignInScreen.tsx',
    ];
    for (const screen of screens) {
      const src = readFileSync(join('src', screen), 'utf8');
      expect({ screen, offers: src.includes('<OtherWays') || src.includes('<DeviceCodeAgain') }).toEqual({ screen, offers: true });
    }
  });
});
