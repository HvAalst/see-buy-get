import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { t } from '../../shared/i18n';

/*
 * 2026-11-19 — PAID, SAID AS THE GOODS CHANGE HANDS (the payments plan, part 1; the owner: Ethiopia goes on the driver's word).
 * On a load the shipper pays directly, the delivery step asks the driver whether the shipper paid the price agreed, and warns
 * them to look on their own phone: a payment message can be faked. The answer travels with the delivery — so it waits with it
 * where there is no signal — and never holds the delivery back: handing over unpaid is the driver's call.
 */
const read = (...p: string[]) => readFileSync(join('src', ...p), 'utf8');
const screen = read('apps', 'driver', 'screens', 'LoadsScreen.tsx');

describe('the question at the handover', () => {
  it('names the amount, and tells the driver to look on their own phone, not the shipper’s screen', () => {
    expect(t('driver.loads.paidSeen', { amount: 'KES 4,200' })).toBe('The shipper paid me KES 4,200');
    const hint = t('driver.loads.paidSeenHint');
    expect(hint).toContain('your own phone');
    expect(hint).toContain('can be faked');
    expect(hint).toContain('You decide whether to hand it over');
  });

  it('is said in Kiswahili, Dutch and Amharic too, with the amount in each', () => {
    for (const locale of ['sw', 'nl', 'am']) {
      const words = read('shared', 'i18n', 'words', locale, 'driver.ts');
      expect(words).toMatch(/"driver\.loads\.paidSeen": "[^"]*\{amount\}[^"]*"/);
      expect(words).toMatch(/"driver\.loads\.paidSeenHint": "[^"]+"/);
    }
  });
});

describe('wired into the delivery step', () => {
  it('asks only on a load the shipper pays directly, not paid yet, at the price agreed', () => {
    expect(screen).toMatch(/\{claim\.paidByShipper && !claim\.paidDirect && claim\.lockedPrice != null \? \([\s\S]{0,400}checked=\{paidSeen\}[\s\S]{0,300}driver\.loads\.paidSeen'[\s\S]{0,200}driver\.loads\.paidSeenHint/);
  });

  it('sends the answer with the delivery itself', () => {
    expect(screen).toMatch(/actions\.deliverFreight\(ref, \{[^\n]*\.\.\.\(paidSeen && claim\.paidByShipper && !claim\.paidDirect \? \{ paidSeen: true \} : \{\}\) \}\)/);
    expect(read('lib', 'sbg', 'personas', 'driver.ts')).toMatch(/deliverFreight: \(freightId: string, driverDid: string, check\?: \{[^\n]*paidSeen\?: boolean \}\) =>\s*\n[^\n]*\n\s*sbg\.request\(\(c\) => c\.POST\('\/v1\/sbg\/dispatch\/freight\/\{id\}\/deliver', \{[^\n]*body: \{ driverDid, \.\.\.check,/);
  });

  it('never holds the delivery back', () => {
    const confirm = screen.match(/disabled=\{Boolean\(held\) \|\| !allChecked[^\n]*\}/)?.[0] ?? '';
    expect(confirm).not.toBe('');
    expect(confirm).not.toContain('paidSeen');
  });

  it('starts unticked for every load, with no code or name left over from another', () => {
    expect(screen).toMatch(/useEffect\(\(\) => \{\s*setDeliveryCode\(''\);\s*setNameChecked\(false\);\s*setPaidSeen\(false\);/);
  });
});
