import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from '../i18n';
import { CodeWayChoice, OtherWays } from './CodeWays';

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
