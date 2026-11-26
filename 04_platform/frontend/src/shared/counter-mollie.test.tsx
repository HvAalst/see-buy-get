import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from './i18n';
import { PaymentAccountBody, type PaymentAccountRead } from '../apps/tower/screens/PartnerPaymentFold';
import { CounterPaymentsSection } from '../apps/partner/screens/MoneyScreen';
import type { PartnerMollie } from '../apps/partner/api';
import { phonePayBlock } from '../apps/agent/logic';
import { PhonePayCard, phonePayWords } from '../apps/agent/screens/PhonePayCard';
import type { PhonePay, TakeInTerms } from '../apps/agent/types';

/*
 * 2026-11-26 — MONEY AT A PARTNER'S COUNTER INTO ITS OWN MOLLIE ACCOUNT (the weakness after route plan part 4b, fixed as recommended):
 * in a country of the European Union, a sender pays at the partner's shop from a QR code on the counter's screen, on a Mollie page,
 * into the partner's own account. Held to here: the Shop app shows the code and asks no phone; the Partner app connects the account
 * (its own people sign in to Mollie) and says where it stands; the console says it, and that the partner — never staff — connects it.
 */
const tt = t as never;
const noop = () => undefined;

describe('the Shop app’s counter, paid from a QR code', () => {
  const terms = (over: Partial<NonNullable<TakeInTerms['payByPhone']>> = {}): TakeInTerms & { payByPhone: NonNullable<TakeInTerms['payByPhone']> } =>
    ({ promise: 'theirs', jurisdiction: 'BG', level: 'partnered', coverLimit: 0, coverBasis: 'none', currency: 'EUR', cashAccepted: false, paidOut: false, payByPhone: { to: 'Sofia Partner OOD', price: 9.5, currency: 'EUR', qr: true, ...over } }) as never;
  const pay = (over: Partial<PhonePay> = {}): PhonePay => ({ parcelId: 'BG-1', paymentId: 'hp_q1', state: 'asked', phoneEnds: '', amount: 9.5, currency: 'EUR', test: true, askedAt: '2026-11-26T09:00:00Z', byQr: true, link: 'https://mollie.test/checkout/tr_1', qrSvg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>', ...over });
  const card = (p: PhonePay | null, q = true) => renderToString(<PhonePayCard pay={p} terms={terms({ qr: q })} parcelId="BG-1" senderPhone="" online onAsk={noop} />);

  it('asks no phone: what the sender pays, to whom, by scanning — and the button shows the code', () => {
    const html = card(null);
    expect(html).toContain(t('agent.accept.pay.toQr', { to: 'Sofia Partner OOD' }));
    expect(html).not.toContain(t('agent.accept.pay.phone'));
    expect(html).toContain(t('agent.accept.pay.askQr'));
    expect(html).not.toContain('disabled');
    // By a prompt, as before: the phone is asked.
    expect(card(null, false)).toContain(t('agent.accept.pay.phone'));
  });

  it('while it is open: the code, how to use it, and waiting on the sender’s phone — never a phone number; paid, the code is gone', () => {
    const open = card(pay());
    expect(open).toContain('data:image/svg+xml');
    expect(open).toContain(t('agent.accept.pay.scan'));
    expect(open).toContain(t('agent.accept.pay.waitingQr'));
    expect(open).not.toContain('ending');
    expect(phonePayWords(pay(), tt)).toEqual({ tone: 'info', text: t('agent.accept.pay.waitingQr') });
    expect(phonePayBlock(terms(), pay(), 'BG-1', true, tt)).toBe(t('agent.accept.pay.waitingQr'));
    const paid = card(pay({ state: 'paid', link: undefined, qrSvg: undefined }));
    expect(paid).not.toContain('data:image/svg+xml');
    expect(paid).not.toContain(t('agent.accept.pay.askQr'));
  });

  it('the counter asks no phone, and reads a page for as long as Mollie keeps it open', () => {
    const app = readFileSync(join('src', 'apps/agent/useAgentApp.ts'), 'utf8');
    expect(app).toContain('client.api.askPhonePayment(did, parcelId, byQr ? undefined : phone.trim())');
    expect(app).toContain('(pay.byQr ? 16 : 3) * 60_000');
  });
});

describe('the Partner app connects its own Mollie account', () => {
  const view = (over: Partial<PartnerMollie> = {}): PartnerMollie => ({ available: true, via: 'oauth', ...over });
  const section = (v: PartnerMollie | null, back: Parameters<typeof CounterPaymentsSection>[0]['back'] = null) =>
    renderToString(<CounterPaymentsSection view={v} back={back} busy={false} error={null} onConnect={noop} onDisconnect={noop} t={tt} />);

  it('not connected: what it does, and Connect Mollie', () => {
    const html = section(view());
    expect(html).toContain(t('partner.app.mollie.title'));
    expect(html).toContain(t('partner.app.mollie.body'));
    expect(html).toContain(t('partner.app.mollie.connect'));
  });

  it('connected: to which organization, test money said, Disconnect; Mollie still checking, or the access taken back', () => {
    const on = section(view({ connected: { via: 'oauth', organizationName: 'Sofia Partner OOD', testmode: true, connectedAt: '2026-11-26T09:00:00Z', canReceivePayments: true } }));
    expect(on).toContain(t('partner.app.mollie.connected', { name: 'Sofia Partner OOD' }));
    expect(on).toContain(t('partner.app.mollie.test'));
    expect(on).toContain(t('partner.app.mollie.disconnect'));
    expect(on).not.toContain(t('partner.app.mollie.connect'));
    expect(section(view({ connected: { via: 'oauth', testmode: false, connectedAt: '2026-11-26T09:00:00Z', canReceivePayments: false } }))).toContain(t('partner.app.mollie.checking'));
    const lost = section(view({ connected: { via: 'oauth', testmode: false, connectedAt: '2026-11-26T09:00:00Z', lostAt: '2026-11-27T09:00:00Z' } }));
    expect(lost).toContain(t('partner.app.mollie.lost'));
    expect(lost).toContain(t('partner.app.mollie.connect'));
  });

  it('back from Mollie’s sign-in, it says how it ended; where the counters pay another way, nothing at all', () => {
    expect(section(view(), { outcome: 'connected' })).toContain(t('account.mollie.backConnected'));
    expect(section(view(), { outcome: 'failed', why: 'denied' })).toContain(t('account.mollie.backDenied'));
    expect(section({ available: false, why: 'country' })).toBe('');
    expect(section({ available: false, why: 'off' })).toContain(t('partner.app.mollie.off'));
    expect(section(null)).toBe('');
  });

  it('on the Money screen, opening Mollie’s sign-in in the same tab, and back on Money', () => {
    const screen = readFileSync(join('src', 'apps/partner/screens/MoneyScreen.tsx'), 'utf8');
    expect(screen).toContain('<CounterPaymentsSection view={state.mollie}');
    const hook = readFileSync(join('src', 'apps/partner/usePartnerApp.ts'), 'utf8');
    expect(hook).toContain('if (r.data.url) return void location.assign(r.data.url);');
    expect(hook).toContain("section: back ? 'money' :");
  });
});

describe('the console says where the counters’ money goes', () => {
  const read = (over: Partial<PaymentAccountRead['account']> = {}): PaymentAccountRead => ({ account: { provider: 'stand-in', test: true, currency: 'EUR', ready: ['stand-in', 'revolut', 'mollie'], feeOwed: 0, ...over }, payments: [] });
  const body = (r: PaymentAccountRead) => renderToString(<PaymentAccountBody read={r} t={tt} />);

  it('not connected yet — the partner connects it in the Partner app; connected, to whom and by whom; checking; taken back', () => {
    expect(body(read({ collectProvider: 'mollie', collect: { connected: false } }))).toContain(t('tower.partner.pay.collectNone'));
    const on = body(read({ provider: 'mollie', collectProvider: 'mollie', collect: { connected: true, organizationName: 'Sofia Partner OOD', testmode: true, connectedBy: 'Elena Petrova', connectedAt: '2026-11-26T09:00:00Z', canReceivePayments: true } }));
    expect(on).toContain(t('tower.partner.pay.collectOn', { name: 'Sofia Partner OOD', by: 'Elena Petrova', at: '2026-11-26 09:00' }));
    expect(on).toContain(t('tower.partner.pay.provider.mollie'));
    expect(body(read({ collectProvider: 'mollie', collect: { connected: true, canReceivePayments: false } }))).toContain(t('tower.partner.pay.collectChecking'));
    expect(body(read({ collectProvider: 'mollie', collect: { connected: true, lostAt: '2026-11-27T09:00:00Z' } }))).toContain(t('tower.partner.pay.collectLost'));
    expect(body(read())).not.toContain(t('tower.partner.pay.collectTitle'));
  });
});
