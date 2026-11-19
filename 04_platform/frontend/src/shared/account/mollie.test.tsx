import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from '../i18n';
import { MollieForm } from './MollieSettings';
import { mollieBackOf, mollieBackSays, mollieSub, showsMollie, withoutMollieBack, type MollieView } from './mollie';
import type { AccountApi } from './useAccount';

/*
 * 2026-11-19 — A CARRIER CONNECTS ITS OWN MOLLIE ACCOUNT, IN SETTINGS (the payments plan, part 2; the owner: "Netherlands:
 * Mollie"). What is held to here: the row is there for a carrier Mollie is for, and for a fleet driver only to say its
 * office connects it; the line under it says connected to whom, test money, still checked by Mollie, or lost; the form says
 * what it does and the fee before the button; and back from Mollie's sign-in, Settings opens on Mollie saying how it ended.
 */
const tt = t as never;
const connected = (over: Partial<NonNullable<MollieView['connected']>> = {}): MollieView => ({ available: true, via: 'oauth', connected: { via: 'oauth', organizationName: 'Van Dijk Transport', profileName: 'Van Dijk', testmode: false, connectedAt: '2026-11-20T09:00:00Z', canReceivePayments: true, ...over } });

describe('the line under Mollie in Settings', () => {
  it('says whose account, test money, Mollie still checking it, lost, or not connected', () => {
    expect(mollieSub(connected(), tt)).toBe('Van Dijk Transport');
    expect(mollieSub(connected({ testmode: true }), tt)).toBe('Van Dijk Transport · test payments');
    expect(mollieSub(connected({ canReceivePayments: false }), tt)).toBe('Van Dijk Transport · Mollie is still checking the account');
    expect(mollieSub(connected({ lostAt: '2026-11-21T09:00:00Z' }), tt)).toBe('Connect it again');
    expect(mollieSub({ available: true, via: 'test_key', connected: { via: 'test_key', testmode: true, connectedAt: '2026-11-20T09:00:00Z' } }, tt)).toBe('Connected for testing: no real money');
    expect(mollieSub({ available: true, via: 'oauth' }, tt)).toBe('Not connected');
    expect(mollieSub({ available: false, why: 'fleet' }, tt)).toBe('The company you drive for is paid for your work: its office connects Mollie.');
  });

  it('is shown to a carrier Mollie is for, and to a fleet driver to say its office connects it — not elsewhere, not before it is set up', () => {
    expect(showsMollie(connected())).toBe(true);
    expect(showsMollie({ available: false, why: 'fleet' })).toBe(true);
    expect(showsMollie({ available: false, why: 'country' })).toBe(false);
    expect(showsMollie({ available: false, why: 'off' })).toBe(false);
    expect(showsMollie(null)).toBe(false);
  });
});

describe('back from Mollie’s sign-in', () => {
  it('reads how it ended off the address, and takes those words off it', () => {
    expect(mollieBackOf('?mollie=connected')).toEqual({ outcome: 'connected' });
    expect(mollieBackOf('?mollie=failed&why=denied')).toEqual({ outcome: 'failed', why: 'denied' });
    expect(mollieBackOf('?mollie=failed&why=<script>')).toEqual({ outcome: 'failed', why: 'failed' });
    expect(mollieBackOf('?tab=loads')).toBeNull();
    expect(withoutMollieBack('https://seebuyget.com/driver/?mollie=failed&why=expired#loads')).toBe('/driver/#loads');
    expect(withoutMollieBack('https://seebuyget.com/fleet/?tab=2&mollie=connected')).toBe('/fleet/?tab=2');
  });

  it('says it in a sentence, in the carrier’s own words, never Mollie’s', () => {
    expect(mollieBackSays({ outcome: 'connected' }, tt)).toEqual({ tone: 'ok', title: 'Mollie is connected.' });
    expect(mollieBackSays({ outcome: 'failed', why: 'no_profile' }, tt).title).toContain('no profile to take payments with');
    expect(mollieBackSays({ outcome: 'failed', why: 'expired' }, tt).tone).toBe('warn');
  });
});

describe('the Mollie form', () => {
  const api = (mollie: MollieView | null): AccountApi => ({ mollie, connectMollie: async () => ({ data: null, error: null }), disconnectMollie: async () => ({ data: null, error: null }) }) as unknown as AccountApi;
  const form = (mollie: MollieView | null, back: Parameters<typeof MollieForm>[0]['back'] = null) => renderToString(<MollieForm api={api(mollie)} back={back} />);

  it('not connected: what it does and the fee, before the button', () => {
    const html = form({ available: true, via: 'oauth' });
    expect(html).toContain('never through SeeBuyGet');
    expect(html).toContain('small fee for server costs');
    expect(html).toContain('Connect Mollie');
    expect(html).not.toContain('Disconnect Mollie');
  });

  it('connected: whose account, and the way to disconnect; still checked by Mollie, where to finish', () => {
    expect(form(connected())).toContain('Connected: Van Dijk Transport');
    expect(form(connected())).toContain('Disconnect Mollie');
    const checking = form(connected({ canReceivePayments: false, dashboardUrl: 'https://my.mollie.com/dashboard/org_1' }));
    expect(checking).toContain('Mollie is still checking your account');
    expect(checking).toContain('href="https://my.mollie.com/dashboard/org_1"');
    expect(form(connected({ testmode: true }))).toContain('For now these are test payments');
  });

  it('lost: how to connect again; the test key: test money only; a fleet driver: its office connects it', () => {
    const lost = form(connected({ lostAt: '2026-11-21T09:00:00Z' }));
    expect(lost).toContain('Mollie took back the access');
    expect(lost).toContain('Connect Mollie');
    expect(form({ available: true, via: 'test_key' })).toContain('For testing only');
    expect(form({ available: false, why: 'fleet' })).toContain('its office connects Mollie');
    expect(form({ available: false, why: 'fleet' })).not.toContain('Connect Mollie');
  });

  it('back from Mollie, how it ended comes first', () => {
    const html = form(connected(), { outcome: 'connected' });
    expect(html.indexOf('Mollie is connected.')).toBeLessThan(html.indexOf('Connected: Van Dijk Transport'));
  });
});

describe('wired', () => {
  const read = (...p: string[]) => readFileSync(join('src', ...p), 'utf8');

  it('Settings has the row and opens on Mollie when coming back from it', () => {
    const sheet = read('shared', 'account', 'SettingsSheet.tsx');
    expect(sheet).toMatch(/showsMollie\(api\.mollie\) \? <Row icon="wallet" label=\{t\('account\.mollie\.title'\)\} sub=\{mollieSub\(api\.mollie, t as never\)\} onClick=\{\(\) => setView\('mollie'\)\} \/>/);
    expect(sheet).toMatch(/hasPayoutNumber\(api\.payout\) \|\| showsMollie\(api\.mollie\)\)/);
    expect(sheet).toMatch(/setView\(mollieBack \? 'mollie' : 'list'\)/);
    const menu = read('shared', 'account', 'AccountMenu.tsx');
    expect(menu).toMatch(/mollieBackOf\(location\.search\)/);
    expect(menu).toMatch(/history\.replaceState\(history\.state, '', withoutMollieBack\(location\.href\)\)/);
    expect(menu).toMatch(/mollieBack=\{mollieBack\}/);
  });

  it('only a courier’s and a fleet office’s app ask for it', () => {
    expect(read('apps', 'driver', 'app.tsx')).toMatch(/useAccount\(sbg, state\.phase === 'ready', \{ mollie: true \}\)/);
    expect(read('apps', 'fleet', 'app.tsx')).toMatch(/useAccount\(sbg, state\.phase === 'ready', \{ mollie: true \}\)/);
    const hook = read('shared', 'account', 'useAccount.ts');
    expect(hook).toMatch(/if \(enabled && client && wantsMollie\) void loadMollie\(\);/);
    expect(hook).toMatch(/if \(!r\.error && r\.data\?\.url\) globalThis\.location\?\.assign\(r\.data\.url\);/);
  });

  it('every word in Kiswahili, Dutch and Amharic too', () => {
    const en = read('shared', 'i18n', 'catalogs', 'en.ts');
    const keys = [...en.matchAll(/'(account\.mollie\.[a-zA-Z]+)'/g)].map((m) => m[1]);
    expect(keys.length).toBe(25);
    for (const locale of ['sw', 'nl', 'am']) {
      const words = read('shared', 'i18n', 'words', locale, 'base.ts');
      expect(keys.filter((k) => !words.includes(`"${k}":`))).toEqual([]);
    }
  });
});
