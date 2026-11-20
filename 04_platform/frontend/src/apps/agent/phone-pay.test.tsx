import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from '../../shared/i18n';
import { phonePayBlock } from './logic';
import { PhonePayCard, phonePayWords } from './screens/PhonePayCard';
import type { PhonePay, TakeInTerms } from './types';

/*
 * 2026-11-20 — PAID BY PHONE, BEFORE THE LABEL, AT THE COUNTER (the payments plan, 4b; P3-c "payment by phone only" in a
 * partner's country). What is held to here: the counter is told what the sender pays, to whom, and that no cash is taken; the
 * take-in waits until the payment for the parcel on the sticker is paid — saying so, and that it needs a signal; a payment
 * for another sticker does not count; and every state is said in words: waiting on which phone, paid, not paid and why.
 */
const tt = t as never;
const terms = (over: Partial<TakeInTerms> = {}): TakeInTerms => ({ promise: 'theirs', jurisdiction: 'ET', level: 'partnered', coverLimit: 0, coverBasis: 'none', currency: 'ETB', cashAccepted: false, paidOut: false, payByPhone: { to: 'Addis Courier PLC', price: 250, currency: 'ETB' }, ...over });
const pay = (over: Partial<PhonePay> = {}): PhonePay => ({ parcelId: 'PUD-1', paymentId: 'hp_abcdef123', state: 'asked', phoneEnds: '123', amount: 250, currency: 'ETB', test: true, askedAt: '2026-11-20T09:00:00Z', ...over });

describe('the take-in waits for the payment', () => {
  it('nothing in the way where the counter takes no payment by phone', () => {
    expect(phonePayBlock(terms({ payByPhone: undefined }), null, 'PUD-1', true, tt)).toBeNull();
    expect(phonePayBlock(null, null, 'PUD-1', true, tt)).toBeNull();
  });

  it('first the payment, then waiting on the phone, then nothing — only for the parcel on the sticker', () => {
    expect(phonePayBlock(terms(), null, 'PUD-1', true, tt)).toBe('The sender pays by phone first.');
    expect(phonePayBlock(terms(), pay(), 'pud-1', true, tt)).toBe('Waiting on the phone ending 123…');
    expect(phonePayBlock(terms(), pay({ state: 'paid' }), 'PUD-1', true, tt)).toBeNull();
    // Paid for another sticker: this one is not paid.
    expect(phonePayBlock(terms(), pay({ state: 'paid' }), 'PUD-2', true, tt)).toBe('The sender pays by phone first.');
    expect(phonePayBlock(terms(), pay({ state: 'failed', why: 'declined' }), 'PUD-1', true, tt)).toBe('The sender pays by phone first.');
    expect(phonePayBlock(terms(), null, 'PUD-1', false, tt)).toBe('Needs a signal: the sender pays by phone.');
  });

  it('every state in words', () => {
    expect(phonePayWords(null, tt)).toBeNull();
    expect(phonePayWords(pay(), tt)).toEqual({ tone: 'info', text: 'Waiting on the phone ending 123…' });
    expect(phonePayWords(pay({ state: 'paid' }), tt)?.text).toMatch(/^Paid: .*250/);
    expect(phonePayWords(pay({ state: 'failed', why: 'declined' }), tt)).toEqual({ tone: 'warn', text: 'Not paid: declined on the phone' });
    expect(phonePayWords(pay({ state: 'failed', why: 'expired' }), tt)?.text).toBe('Not paid: never answered');
  });
});

describe('the card at the counter', () => {
  const card = (p: PhonePay | null, online = true) =>
    renderToString(<PhonePayCard pay={p} terms={terms() as TakeInTerms & { payByPhone: NonNullable<TakeInTerms['payByPhone']> }} parcelId="PUD-1" senderPhone="+251911000123" online={online} onAsk={() => undefined} />);

  it('what the sender pays, to whom, by a prompt — no cash — and the phone that pays, the sender’s by default', () => {
    const html = card(null);
    expect(html).toContain('Paid by phone');
    expect(html).toContain('The sender pays');
    expect(html).toMatch(/250/);
    expect(html).toContain('to Addis Courier PLC, by a prompt on their phone. No cash here.');
    expect(html).toContain('Phone that pays');
    expect(html).toContain('Ask for the payment');
    expect(html).toContain('once the payment is paid');
  });

  it('waiting, then paid — test money said — and declined, asked again; no signal said', () => {
    expect(card(pay())).toContain('Waiting on the phone ending 123…');
    const paid = card(pay({ state: 'paid' }));
    expect(paid).toMatch(/Paid: [^<]*250/);
    expect(paid).toContain('Test money: nothing real is paid.');
    expect(paid).not.toContain('Ask for the payment');
    expect(card(pay({ state: 'failed', why: 'declined' }))).toContain('Ask again');
    expect(card(null, false)).toContain('Needs a signal: the sender pays by phone.');
  });

  it('is on the take-in screen, and the take-in carries the payment', () => {
    const screen = readFileSync(join('src', 'apps/agent/screens/AcceptScreen.tsx'), 'utf8');
    expect(screen).toMatch(/terms\?\.payByPhone \? \(\s*<PhonePayCard /);
    expect(screen).toContain('phonePayBlock(');
    const app = readFileSync(join('src', 'apps/agent/useAgentApp.ts'), 'utf8');
    expect(app).toContain("paymentId: stateRef.current.phonePay.paymentId");
    for (const locale of ['sw', 'nl', 'am']) expect(readFileSync(join('src', `shared/i18n/words/${locale}/agent.ts`), 'utf8')).toContain('"agent.accept.pay.first"');
  });
});
