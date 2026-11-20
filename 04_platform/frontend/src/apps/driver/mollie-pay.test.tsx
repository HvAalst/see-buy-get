import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from '../../shared/i18n';
import { paidDirectLine, shipperPaidLine } from '../../shared/paidDirect';
import { MolliePayCard, isPaidByMollie, isWaiting, type DirectPayView } from './screens/MolliePay';
import { AMOUNT_HINT, AMOUNT_LABEL, AMOUNT_ORDER, DIRECT_PAY_AMOUNTS } from '../tower/money';

/*
 * 2026-11-19 — PAID AT THE HANDOVER, BY MOLLIE (the payments plan, part 2b; the owner: "Netherlands: Mollie", "a small fee for
 * server costs"). What is held to here: the fee is said before the button; the payment's page shows as a QR code with what
 * to do and that it waits; paid, it says so — confirmed by Mollie, not anybody's word — and the driver's own tick is no longer
 * asked; not connected, one line says how; and the console sets our fee under a heading of its own.
 */
const tt = t as never;
const card = (view: DirectPayView | null) => renderToString(<MolliePayCard view={view} busy={false} onAsk={() => undefined} t={tt} />);
const QR = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240"><path d="M4 4h1v1h-1z"/></svg>';
const open = (over: Partial<NonNullable<DirectPayView['payment']>> = {}): DirectPayView => ({
  available: true,
  amount: 180,
  currency: 'EUR',
  fee: 0.5,
  testmode: false,
  payment: { paymentId: 'tr_1', status: 'open', amount: 180, currency: 'EUR', fee: 0.5, testmode: false, checkoutUrl: 'https://www.mollie.com/checkout/tr_1', qrSvg: QR, ...over },
});

describe('the Mollie card at the handover', () => {
  it('before asking: our fee, then the button with the price agreed', () => {
    const html = card({ available: true, amount: 180, currency: 'EUR', fee: 0.5, testmode: false });
    expect(html).toContain('Mollie takes SeeBuyGet’s fee for server costs from it:');
    expect(html).toContain('Ask for payment by Mollie:');
    expect(html.indexOf('fee for server costs')).toBeLessThan(html.indexOf('Ask for payment by Mollie'));
    expect(card({ available: true, amount: 180, currency: 'EUR', testmode: true })).toContain('Test payment: no real money moves.');
  });

  it('asked: the QR code to scan, what to do, that it waits, and the link to send', () => {
    const html = card(open());
    expect(isWaiting(open())).toBe(true);
    expect(html).toContain(`src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(QR)}"`);
    expect(html).toContain('they scan it with their phone and pay');
    expect(html).toContain('Waiting for the payment…');
    expect(html).toContain('Send the payment link');
    expect(html).not.toContain('Ask for payment by Mollie');
  });

  it('paid: said, confirmed by Mollie; lapsed or failed: a new one can be made', () => {
    const paid = open({ status: 'paid', checkoutUrl: undefined, qrSvg: undefined });
    expect(isPaidByMollie({ ...paid, available: false, why: 'paid' })).toBe(true);
    expect(card({ ...paid, available: false, why: 'paid' })).toContain('confirmed by Mollie');
    const lapsed = card(open({ status: 'expired', checkoutUrl: undefined, qrSvg: undefined }));
    expect(lapsed).toContain('The last QR code expired or was not paid: make a new one.');
    expect(lapsed).toContain('Ask for payment by Mollie');
  });

  it('not connected: one line says how; elsewhere, nothing at all', () => {
    expect(card({ available: false, why: 'not_connected' })).toContain('Connect Mollie in Settings');
    expect(card({ available: false, why: 'office_connects' })).toContain('Once the company you drive for connects Mollie');
    expect(card({ available: false, why: 'not_mollie' })).toBe('');
    expect(card({ available: false, why: 'not_direct' })).toBe('');
    expect(card(null)).toBe('');
  });
});

describe('the load says who confirmed it', () => {
  it('to the carrier and to the shipper: confirmed by Mollie', () => {
    const p = { at: '2026-11-20T10:03:00Z', amount: 180, currency: 'EUR', by: 'mollie' as const, reference: 'tr_1' };
    expect(paidDirectLine(p, tt)).toMatch(/^Paid .*180.*, confirmed by Mollie on /);
    expect(shipperPaidLine({ paysDriverDirect: true, paidDirect: p }, tt)).toMatch(/^Mollie confirmed you paid .*180/);
  });
});

describe('the console sets our fee', () => {
  it('on each country’s company list, under a heading of its own, with words for it', () => {
    expect(AMOUNT_ORDER).toContain('directPayFee');
    expect(DIRECT_PAY_AMOUNTS).toEqual(['directPayFee']);
    expect(t(AMOUNT_LABEL.directPayFee)).toBe('Our fee on a payment by Mollie');
    expect(t(AMOUNT_HINT.directPayFee)).toContain('Empty: nothing is taken.');
    const rates = readFileSync(join('src', 'apps', 'tower', 'screens', 'RatesScreen.tsx'), 'utf8');
    expect(rates).toMatch(/const PARCEL_AMOUNTS = AMOUNT_ORDER\.filter\(\(key\) => !ROAD_AMOUNTS\.includes\(key\) && !DIRECT_PAY_AMOUNTS\.includes\(key\)\);/);
    expect(rates).toMatch(/\[PARCEL_AMOUNTS, ROAD_AMOUNTS, DIRECT_PAY_AMOUNTS\]/);
    expect(rates).toMatch(/\{i === 2 \? <p class="chint"><b>\{t\('tower\.amounts\.directPayTitle'\)\}<\/b> \{t\('tower\.amounts\.directPayHint'\)\}<\/p> : null\}/);
  });
});

describe('wired', () => {
  const read = (...p: string[]) => readFileSync(join('src', ...p), 'utf8');

  it('the delivery step shows it on a load the shipper pays directly, and asks the driver’s own word only until Mollie confirms', () => {
    const screen = read('apps', 'driver', 'screens', 'LoadsScreen.tsx');
    expect(screen).toMatch(/\{claim\.paidByShipper && !claim\.paidDirect && claim\.lockedPrice != null \? \([\s\S]{0,400}<MolliePay freightId=\{claim\.ref\} actions=\{actions\} onPaid=\{\(\) => setMolliePaid\(true\)\} \/>\s*\{!molliePaid \? \(/);
    expect(screen).toMatch(/setPaidSeen\(false\);\s*setMolliePaid\(false\);/);
  });

  it('asks the server, and looks again while the shipper pays', () => {
    const api = read('lib', 'sbg', 'personas', 'driver.ts');
    expect(api).toMatch(/freightMollie: \(freightId: string\) => sbg\.request\(\(c\) => c\.GET\('\/v1\/sbg\/dispatch\/freight\/\{id\}\/mollie'/);
    expect(api).toMatch(/askFreightMollie: \(freightId: string\) => sbg\.request\(\(c\) => c\.POST\('\/v1\/sbg\/dispatch\/freight\/\{id\}\/mollie'/);
    const pay = read('apps', 'driver', 'screens', 'MolliePay.tsx');
    expect(pay).toMatch(/if \(!isWaiting\(view\)\) return;\s*const id = setInterval\(/);
    expect(pay).toMatch(/onPaid\(\);\s*void actions\.refresh\(\);/);
  });

  it('every word in Kiswahili, Dutch and Amharic too', () => {
    const want: Array<[string, string, RegExp]> = [
      ['driver.ts', 'en.driver.ts', /'(driver\.mollie\.[a-zA-Z]+)'/g],
      ['base.ts', 'en.ts', /'(common\.paidDirect\.(?:saidByMollie|shipperMollie))'/g],
      ['tower.ts', 'en.tower.ts', /'(tower\.amounts\.(?:k\.directPayFee|h\.directPayFee|directPayTitle|directPayHint))'/g],
    ];
    for (const [words, catalog, re] of want) {
      const keys = [...read('shared', 'i18n', 'catalogs', catalog).matchAll(re)].map((m) => m[1]);
      expect(keys.length).toBeGreaterThan(0);
      for (const locale of ['sw', 'nl', 'am']) {
        const said = read('shared', 'i18n', 'words', locale, words);
        expect(keys.filter((k) => !said.includes(`"${k}":`))).toEqual([]);
      }
    }
  });
});
