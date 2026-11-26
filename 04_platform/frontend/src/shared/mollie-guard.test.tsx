import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from './i18n';
import { PaymentAccountBody, paymentState, type HubPaymentRow, type PaymentAccountRead } from '../apps/tower/screens/PartnerPaymentFold';
import { flagWhy, PartnerChecksBody, type PartnerFlagRow } from '../apps/tower/screens/PartnerChecksFold';
import { CounterPaymentsSection } from '../apps/partner/screens/MoneyScreen';

/*
 * 2026-11-26 — THE COUNTERS' MOLLIE ACCOUNT, GUARDED (the owner: "Go ahead"). Held to here: the Partner app says plainly when the
 * account connected is another company's (and so not used); the console says whose registration it is — the partner's own, another
 * company's (not used), or one to check against the contract; staff's check on the partner's page says it in a sentence, without a
 * payee's kind (the partner is no payee); and a try of the account is a page paid from a QR code, with no phone asked.
 */
const tt = t as never;
const noop = () => undefined;

describe('the Partner app says when the account is not the company’s own', () => {
  it('with both registration numbers, and that the counters take test money meanwhile', () => {
    const html = renderToString(
      <CounterPaymentsSection
        view={{ available: true, via: 'oauth', connected: { via: 'oauth', organizationName: 'Elena Petrova EOOD', testmode: false, connectedAt: '2026-11-26T09:00:00Z', canReceivePayments: true }, notYours: { organizationName: 'Elena Petrova EOOD', registrationNumber: '999999999', expected: '204567890' } }}
        back={null}
        busy={false}
        error={null}
        onConnect={noop}
        onDisconnect={noop}
        t={tt}
      />,
    );
    expect(html).toContain(t('partner.app.mollie.notYours', { name: 'Elena Petrova EOOD', reg: '999999999', expected: '204567890' }));
    expect(html).toContain(t('partner.app.mollie.disconnect'));
  });
});

describe('the console says whose company the counters’ account is', () => {
  const read = (collect: NonNullable<PaymentAccountRead['account']['collect']>, over: Partial<PaymentAccountRead['account']> = {}, payments: HubPaymentRow[] = []): PaymentAccountRead => ({ account: { provider: 'stand-in', test: true, currency: 'EUR', ready: ['stand-in', 'mollie'], feeOwed: 0, collectProvider: 'mollie', collect, ...over }, payments });
  const body = (r: PaymentAccountRead, onTry?: (phone: string, amount: number) => void) => renderToString(<PaymentAccountBody read={r} t={tt} onTry={onTry} />);
  const on = { connected: true, organizationName: 'Sofia Partner OOD', connectedBy: 'Elena Petrova', connectedAt: '2026-11-26T09:00:00Z', canReceivePayments: true };

  it('the partner’s own; another company’s — not used; none on record, or none from Mollie — to check against the contract', () => {
    expect(body(read({ ...on, registrationNumber: '204567890', sameCompany: 'yes', expectedRegistration: '204567890' }))).toContain(t('tower.partner.pay.collectRegOwn', { reg: '204567890' }));
    const other = body(read({ ...on, organizationName: 'Elena Petrova EOOD', registrationNumber: '999999999', sameCompany: 'no', expectedRegistration: '204567890' }));
    expect(other).toContain(t('tower.partner.pay.collectNotUsed', { name: 'Elena Petrova EOOD', reg: '999999999', expected: '204567890' }));
    expect(other).not.toContain(t('tower.partner.pay.collectOn', { name: 'Elena Petrova EOOD', by: 'Elena Petrova', at: '2026-11-26 09:00' }));
    expect(body(read({ ...on, registrationNumber: '204567890', sameCompany: 'unknown' }))).toContain(t('tower.partner.pay.collectCheckReg', { reg: '204567890' }));
    expect(body(read({ ...on, sameCompany: 'unknown' }))).toContain(t('tower.partner.pay.collectNoReg'));
  });

  it('a try on the partner’s Mollie account asks no phone; its page shows as a code to scan while it waits', () => {
    const tryRow: HubPaymentRow = { paymentId: 'hp_t', kind: 'in', reference: 'try_x', amount: 1, currency: 'EUR', phoneEnds: '', state: 'asked', test: true, askedAt: '2026-11-26T09:00:00Z', askedBy: 'Amina Otieno', byQr: true, link: 'https://mollie.test/checkout/tr_t', qrSvg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' };
    const html = body(read({ ...on, sameCompany: 'yes' }, { provider: 'mollie' }, [tryRow]), noop);
    expect(html).toContain(t('tower.partner.pay.tryHintQr'));
    expect(html).not.toContain(`placeholder="${t('tower.partner.pay.phone')}"`);
    expect(html).toContain('data:image/svg+xml');
    expect(html).toContain(t('tower.partner.pay.tryScan'));
    expect(html).toContain(t('tower.partner.pay.byQr'));
    expect(paymentState(tryRow, tt)).toBe(t('tower.partner.pay.state.askedQr'));
    // By the stand-in, as before: the phone is asked.
    expect(body(read({ connected: false }), noop)).toContain(`placeholder="${t('tower.partner.pay.phone')}"`);
    const op = readFileSync(join('src', 'lib/sbg/personas/operator.ts'), 'utf8');
    expect(op).toContain('body: { ...(phone ? { phone } : {}), amount }');
  });
});

describe('our staff’s check on the partner’s page', () => {
  const flag = (same: 'yes' | 'no' | 'unknown', reg?: string): PartnerFlagRow => ({ flagId: 'pf_1', rule: 'mollie_account', payeeId: 'partner-bg', payeeKind: 'shop', lineIds: [], facts: { organizationName: 'Elena Petrova EOOD', ...(reg ? { registrationNumber: reg } : {}), connectedBy: 'Elena Petrova', day: '2026-11-26', same }, severity: same === 'no' ? 'urgent' : 'look', foundAt: '2026-11-26T09:00:00Z' });

  it('says who connected whose account, and whether it is the partner’s own', () => {
    expect(flagWhy(flag('yes', '204567890'), tt)).toBe(t('tower.partner.checks.say.mollieYes', { by: 'Elena Petrova', name: 'Elena Petrova EOOD', reg: '204567890', day: '2026-11-26' }));
    expect(flagWhy(flag('no', '999999999'), tt)).toBe(t('tower.partner.checks.say.mollieNo', { by: 'Elena Petrova', name: 'Elena Petrova EOOD', reg: '999999999', day: '2026-11-26' }));
    expect(flagWhy(flag('unknown'), tt)).toBe(t('tower.partner.checks.say.mollieUnknown', { by: 'Elena Petrova', name: 'Elena Petrova EOOD', reg: t('tower.partner.checks.noReg'), day: '2026-11-26' }));
  });

  it('named as the counters’ Mollie account, without a payee’s kind', () => {
    const html = renderToString(<PartnerChecksBody view={{ open: [flag('no', '999999999')], looked: [], aiReady: false }} t={tt} />);
    expect(html).toContain(t('tower.partner.checks.rule.mollie_account'));
    expect(html).not.toContain(`>${t('tower.partner.kind.shop')}<`);
  });
});
