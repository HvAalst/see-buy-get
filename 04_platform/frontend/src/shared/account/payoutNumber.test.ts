import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import { hasPayoutNumber, payoutNumberSub, payoutSavedSays, payoutTitleKey } from './payoutNumber';

const when = (iso: string) => iso.slice(0, 16).replace('T', ' ');

describe('a payee’s own payout number, where a partner pays it (4c)', () => {
  it('says who pays to it, and asks for a number with its country code — never the M-Pesa words', () => {
    const sheet = readFileSync(join('src', 'shared/account/SettingsSheet.tsx'), 'utf8');
    expect(sheet).toContain("api.payout?.way === 'partner' ? t('account.payout.bodyPartner', { partner: api.payout.paidBy ?? '' }) : t('account.payout.body')");
    expect(sheet).toContain("api.payout?.way === 'partner' ? 'account.payout.numberLabelPartner' : 'account.payout.numberLabel'");
    expect(t('account.payout.bodyPartner', { partner: 'Addis Courier PLC' })).toBe('Addis Courier PLC pays you to this number, by phone, for your work for it. A code is texted to it, to show it is yours.');
    expect(t('account.payout.numberLabelPartner')).not.toMatch(/M-Pesa/);
  });
});

describe('a payee’s own payout number, in Settings', () => {
  it('is a row only for a payee whose country pays to a number of its own', () => {
    expect(hasPayoutNumber({ way: 'mpesa', country: 'KE' })).toBe(true);
    expect(hasPayoutNumber({ way: 'by_hand', country: 'ET' })).toBe(false);
    // 2026-11-20 — where a partner contracts and pays every hand by phone (4c): a row of its own, a shop's too.
    expect(hasPayoutNumber({ way: 'partner', country: 'ET', paidBy: 'Addis Courier PLC' })).toBe(true);
    expect(hasPayoutNumber({ way: 'partner', country: 'ET', notPayee: 'Your fleet is paid for your work' })).toBe(false);
    expect(hasPayoutNumber({ way: 'mpesa', country: 'KE', notPayee: 'Your fleet is paid for your work' })).toBe(false);
    expect(hasPayoutNumber(null)).toBe(false);
  });

  it('says under the row that nothing is paid until it is set, that a changed one is paused, or the number', () => {
    expect(payoutNumberSub({ way: 'mpesa', country: 'KE' }, t, when)).toBe(t('account.payout.subNone'));
    expect(payoutNumberSub({ way: 'mpesa', country: 'KE', masked: '254712***678', heldUntil: '2026-10-19T09:00:00Z' }, t, when)).toBe('254712***678 · paused until 2026-10-19 09:00');
    expect(payoutNumberSub({ way: 'mpesa', country: 'KE', masked: '254712***678' }, t, when)).toBe('254712***678');
  });

  it('says after a change when payouts resume, and what became of the text to the old number', () => {
    const first = payoutSavedSays({ way: 'mpesa', country: 'KE', masked: '254712***678' }, t, when);
    expect(first).toEqual({ title: 'Payouts go to 254712***678' });
    const changed = payoutSavedSays({ way: 'mpesa', country: 'KE', masked: '254110***222', heldUntil: '2026-10-19T09:00:00Z', oldNumber: 'not_sent' }, t, when);
    expect(changed.detail).toContain('2026-10-19 09:00');
    expect(changed.detail).toContain(t('account.payout.oldNotSent'));
  });
});

/* 2026-11-25 — route plan part 4: where the partner pays to bank accounts, Settings asks for one, under its own title. */
describe('a payout bank account, where the partner pays to one (route plan part 4)', () => {
  it('is titled as a bank account, and Settings shows the bank form for it — never the phone code', () => {
    expect(payoutTitleKey({ way: 'partner', paysTo: 'bank', country: 'BG' })).toBe('account.payout.titleBank');
    expect(payoutTitleKey({ way: 'partner', paysTo: 'phone', country: 'ET' })).toBe('account.payout.title');
    expect(payoutTitleKey({ way: 'mpesa', country: 'KE' })).toBe('account.payout.title');
    expect(hasPayoutNumber({ way: 'partner', paysTo: 'bank', country: 'BG' })).toBe(true);
    expect(payoutNumberSub({ way: 'partner', paysTo: 'bank', country: 'BG', masked: 'BG•• •••• 5678' }, t as never, when)).toBe('BG•• •••• 5678');
    const sheet = readFileSync(join('src', 'shared/account/SettingsSheet.tsx'), 'utf8');
    expect(sheet).toContain("view === 'payout' && api.payout?.paysTo === 'bank' ? <PayoutBankForm");
    expect(sheet).toContain("view === 'payout' && api.payout?.paysTo !== 'bank' ? <PayoutForm");
    expect(t('account.payout.bodyBank', { partner: 'Sofia Partner OOD' })).toContain('Sofia Partner OOD pays you to your own bank account');
  });
});
