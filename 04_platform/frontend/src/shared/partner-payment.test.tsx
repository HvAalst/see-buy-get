import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from './i18n';
import { PaymentAccountBody, paymentState, type HubPaymentRow, type PaymentAccountRead } from '../apps/tower/screens/PartnerPaymentFold';

/*
 * 2026-11-20 — THE PARTNER'S PAYMENT ACCOUNT, SEEN (the payments plan, step 4a). What is held to here: staff see which provider
 * the partner's money goes through and that it is test money; what the account holds, or that the provider did not say;
 * that its own provider comes later, with its keys and two staff to switch it live; a try, with how the stand-in answers; and
 * every payment with where it stands — waiting, paid, or not paid and why — by the phone's last digits only.
 */
const tt = t as never;
const row = (over: Partial<HubPaymentRow> = {}): HubPaymentRow => ({ paymentId: 'hp_1', kind: 'in', reference: 'try_abc', amount: 250, currency: 'ETB', phoneEnds: '123', state: 'asked', test: true, askedAt: '2026-11-20T09:00:00Z', askedBy: 'Amina Otieno', ...over });
const read = (over: Partial<PaymentAccountRead['account']> = {}, payments: HubPaymentRow[] = [row()]): PaymentAccountRead => ({ account: { provider: 'stand-in', test: true, currency: 'ETB', ready: ['stand-in'], balance: 0, ...over }, payments });

describe('where a payment stands, in words', () => {
  it('waiting, paid, or not paid — and why, where it is one the screens know', () => {
    expect(paymentState(row(), tt)).toBe('Waiting on the phone');
    expect(paymentState(row({ state: 'paid' }), tt)).toBe('Paid');
    expect(paymentState(row({ state: 'failed', why: 'declined' }), tt)).toBe('Not paid: declined on the phone');
    expect(paymentState(row({ state: 'failed', why: 'expired' }), tt)).toBe('Not paid: never answered');
    expect(paymentState(row({ state: 'failed' }), tt)).toBe('Not paid');
  });
});

describe('the fold, for our staff', () => {
  it('the stand-in, test money, what it holds — and that the partner’s own provider comes later, switched live by two', () => {
    // No payments: only the account itself can say it is test money.
    const html = renderToString(<PaymentAccountBody read={read({ balance: 1250 }, [])} t={tt} onTry={() => undefined} />);
    expect(html).toContain('Stand-in');
    expect(html).toContain('Test money');
    expect(html).toMatch(/Holds [^<]*1,250/);
    expect(html).toContain('two of our staff switch it live');
    expect(html).toContain('no real money moves');
  });

  it('a try: phone and amount, how the stand-in answers — and each payment by the phone’s last digits, never the number', () => {
    const html = renderToString(<PaymentAccountBody read={read({}, [row(), row({ paymentId: 'hp_2', reference: 'PUD-1', askedBy: undefined, state: 'failed', why: 'declined', phoneEnds: '000' })])} t={tt} onTry={() => undefined} />);
    expect(html).toContain('Try a payment');
    expect(html).toContain('declined for a number ending in 0000');
    expect(html).toContain('Phone, with its country code');
    expect(html).toContain('Amount (ETB)');
    expect(html).toContain('A try by Amina Otieno');
    expect(html).toContain('Paid in · PUD-1');
    expect(html).toContain('Not paid: declined on the phone');
    expect(html).toContain('phone ending 123');
    expect(html).toContain('2026-11-20 09:00');
  });

  it('what it holds unknown where the provider did not say; no payments said as that', () => {
    const html = renderToString(<PaymentAccountBody read={read({ balance: undefined }, [])} t={tt} onTry={() => undefined} />);
    expect(html).toContain('What it holds is not known: the provider did not answer.');
    expect(html).toContain('No payments yet.');
  });

  it('a live account offers no try, and says nothing of the stand-in', () => {
    const html = renderToString(<PaymentAccountBody read={read({ provider: 'telebirr', test: false })} t={tt} onTry={() => undefined} />);
    expect(html).toContain('telebirr');
    expect(html).not.toContain('Try a payment');
    expect(html).not.toContain('two of our staff switch it live');
  });

  it('sits on a partner’s own company record, its words in every language', () => {
    const screen = readFileSync(join('src', 'apps/tower/screens/CompanyRecordScreen.tsx'), 'utf8');
    expect(screen).toMatch(/kind === 'partner' && client && entityId \? <PartnerPaymentFold /);
    const api = readFileSync(join('src', 'lib/sbg/personas/operator.ts'), 'utf8');
    expect(api).toMatch(/partnerPaymentAccount: \(entityId: string\) => sbg\.request\(\(c\) => c\.GET\('\/v1\/sbg\/entities\/\{entityId\}\/payment-account'/);
    expect(api).toMatch(/tryPartnerPayment: \(entityId: string, phone: string, amount: number\) =>\s*sbg\.request\(\(c\) => c\.POST\('\/v1\/sbg\/entities\/\{entityId\}\/payment-account\/try'/);
    for (const locale of ['sw', 'nl', 'am']) {
      const words = readFileSync(join('src', `shared/i18n/words/${locale}/tower.ts`), 'utf8');
      expect(words).toContain('"tower.partner.pay.tryHint"');
    }
  });
});
