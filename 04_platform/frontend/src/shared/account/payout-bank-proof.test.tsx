import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from '../i18n';
import { firstView, PayoutBankForm } from './SettingsSheet';
import type { AccountApi } from './useAccount';

/*
 * 2026-11-26 — A PAYOUT BANK ACCOUNT KEPT ONLY WITH THE SIGN-IN ASKED AGAIN (the weakness after route plan part 4b, fixed as
 * recommended): the PIN in the Driver and Fleet apps, the shop's or hub's password in theirs — an open app is not proof of who holds
 * the phone. And a page of Settings a link asks for (`?settings=payout|mollie`) opens there, where the account has that page.
 */
const api = (over: Partial<AccountApi> = {}) => ({ payout: { way: 'partner', paysTo: 'bank', country: 'BG', paidBy: 'Sofia Partner OOD' }, mollie: null, savePayoutBank: async () => ({}), ...over }) as unknown as AccountApi;
const noop = () => undefined;

describe('the bank account form asks the sign-in again', () => {
  it('a person signed in: the PIN, in boxes', () => {
    const html = renderToString(<PayoutBankForm api={api()} party={null} onDone={noop} />);
    expect(html).toContain(t('account.settings.pinToConfirm'));
    expect(html).toContain('acct-payout-pin');
    expect(html).not.toContain('acct-payout-password');
  });

  it('a shop or a hub: its password', () => {
    const html = renderToString(<PayoutBankForm api={api()} party="hub" onDone={noop} />);
    expect(html).toContain(t('account.shopDevices.passwordToConfirm', { party: 'hub' }));
    expect(html).toContain('acct-payout-password');
    expect(html).not.toContain('acct-payout-pin');
  });

  it('sends the PIN or the password with the account, never both', () => {
    const form = readFileSync(join('src/shared/account', 'SettingsSheet.tsx'), 'utf8');
    expect(form).toContain('...(party ? { password: secret } : { pin: secret })');
    const hook = readFileSync(join('src/shared/account', 'useAccount.ts'), 'utf8');
    expect(hook).toContain("...(input.pin ? { pin: input.pin } : {}), ...(input.password ? { password: input.password } : {})");
  });
});

describe('the page Settings opens on', () => {
  it('back from Mollie first; then a page a link asked for, where this account has it; else the list', () => {
    const mollie = { available: true, via: 'oauth' } as never;
    expect(firstView(api({ mollie }), { outcome: 'connected' }, 'payout')).toBe('mollie');
    expect(firstView(api(), null, 'payout')).toBe('payout');
    expect(firstView(api({ mollie }), null, 'mollie')).toBe('mollie');
    expect(firstView(api({ mollie: null }), null, 'mollie')).toBe('list');
    expect(firstView(api({ payout: { way: 'by_hand', country: 'ET' } as never }), null, 'payout')).toBe('list');
    expect(firstView(api(), null, null)).toBe('list');
  });

  it('the account menu opens Settings on the page a link asks for, and forgets it once closed', () => {
    const menu = readFileSync(join('src/shared/account', 'AccountMenu.tsx'), 'utf8');
    expect(menu).toContain("onLaunch('settings', (page) => { setStartAt(page); setSheet('settings'); })");
    expect(menu).toContain('setStartAt(null); }}');
    expect(menu).toContain('startAt={startAt}');
  });
});
