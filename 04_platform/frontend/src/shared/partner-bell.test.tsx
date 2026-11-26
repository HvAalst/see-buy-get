import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from './i18n';
import { CounterPaymentsSection } from '../apps/partner/screens/MoneyScreen';
import { when } from '../apps/partner/screens/HomeScreen';
import { PaymentAccountBody, type PaymentAccountRead } from '../apps/tower/screens/PartnerPaymentFold';

/*
 * 2026-11-26 — THE PARTNER APP'S BELL (the owner: "wire in the notification bell as well"). Held to here: the bell is in the Partner
 * app's mast, reading the partner company's own inbox through the session that reads for it — a shared inbox, said as the company's,
 * with no device controls; its notices open Money on one tap (?go=money, the app's own screens); Money says who connected the
 * counters' Mollie account; and both Money and the console say that real money waits for the company's registration number.
 */
const tt = t as never;
const noop = () => undefined;
const read = (p: string) => readFileSync(join('src', p), 'utf8');

describe('the bell in the Partner app', () => {
  it('in its mast, the company’s inbox through the session that reads for it, shared by its people', () => {
    const app = read('apps/partner/app.tsx');
    expect(app).toContain("<NotificationBell api={bell} shared={{ canMark: true, whose: 'partner' }} />");
    expect(app).toContain('createNotificationsApi(client.client.sbg)');
    // Its notices open Money, the app's own screen, on one tap: ?go= is read for the Partner app's screens.
    expect(app).toMatch(/useScreenNav<Section>\(\{[^)]*launch: SECTIONS/);
    expect(read('apps/partner/app.tsx')).toContain('money: true');
  });

  it('says it is the company’s inbox, in the reader’s language, and offers no device controls', () => {
    const bell = read('shared/ui/NotificationBell.tsx');
    expect(bell).toContain("shared?.whose === 'partner' ? (\n          <p class=\"hint nlist__shared\">{t('notify.sharedPartner')}</p>");
    expect(bell).toContain("partner_money: 'wallet',");
    expect(t('notify.sharedPartner')).toMatch(/your company’s inbox/);
  });
});

describe('Money and the console', () => {
  const section = (over: Record<string, unknown>) =>
    renderToString(<CounterPaymentsSection view={{ available: true, via: 'oauth', connected: { via: 'oauth', organizationName: 'Sofia Partner OOD', testmode: false, connectedAt: '2026-11-26T09:00:00Z', canReceivePayments: true }, ...over }} back={null} busy={false} error={null} onConnect={noop} onDisconnect={noop} t={tt} />);

  it('Money says who connected it, and that real money waits for the company’s registration number', () => {
    expect(section({ connectedBy: 'Elena Petrova' })).toContain(t('partner.app.mollie.connectedBy', { name: 'Elena Petrova', at: when('2026-11-26T09:00:00Z') }));
    expect(section({ needsRegistration: true })).toContain(t('partner.app.mollie.needsRegistration'));
    expect(section({})).not.toContain(t('partner.app.mollie.needsRegistration'));
  });

  it('the console says the same, beside the account', () => {
    const r: PaymentAccountRead = { account: { provider: 'stand-in', test: true, currency: 'EUR', ready: ['stand-in', 'mollie'], feeOwed: 0, collectProvider: 'mollie', collect: { connected: true, organizationName: 'Sofia Partner OOD', testmode: false, registrationNumber: '204567890', sameCompany: 'unknown', needsRegistration: true } }, payments: [] };
    expect(renderToString(<PaymentAccountBody read={r} t={tt} />)).toContain(t('tower.partner.pay.collectNeedsReg'));
    const recorded = { ...r, account: { ...r.account, collect: { ...r.account.collect!, needsRegistration: undefined, sameCompany: 'yes' as const } } };
    expect(renderToString(<PaymentAccountBody read={recorded} t={tt} />)).not.toContain(t('tower.partner.pay.collectNeedsReg'));
  });
});
