import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { en } from '../../shared/i18n/catalogs/en';
import { enBusiness } from '../../shared/i18n/catalogs/en.business';
import { localesOfCountry } from '../../shared/i18n/locales';

/*
 * 2026-11-03 — the owner, reading the Business app in the Netherlands: "the top up of balance is with M-pesa or bank. that is
 * not correct … simplify the text for now like 'per bank or other payment service'", and "it is not clear how to open a
 * parcel account so that is an open end, we should answer for that on where the user can navigate next". And: "the language
 * would require a little digging for the nations where it is actually not applicable".
 */
describe('the parcel account where SeeBuyGet holds no money yet', () => {
  it('names no country’s way of paying in, and says where to go next', () => {
    expect(enBusiness['business.parcels.openStep2']).not.toMatch(/M-Pesa/);
    expect(enBusiness['business.parcels.openStep2']).toMatch(/bank or another payment service/);
    const screen = readFileSync('src/apps/business/screens/ParcelsScreen.tsx', 'utf8');
    expect(screen).toMatch(/<p class="chint">\{account\.whyNot\}<\/p>\s*\{\/\*[\s\S]*?\*\/\}\s*\{onGo && sectionsFor\(business\.activities\)\.includes\('loads'\)/);
    expect(screen).toMatch(/onClick=\{\(\) => onGo\('loads'\)\}/);
    expect(readFileSync('src/apps/business/app.tsx', 'utf8')).toMatch(/<ParcelsScreen business=\{business\} client=\{client\} onGo=\{actions\.go\} \/>/);
  });
});

describe('the languages offered in a country', () => {
  it('offers English everywhere, and a language at once only where it counts', () => {
    expect(localesOfCountry('NL')).toEqual(['en']);
    expect(localesOfCountry('KE')).toEqual(['en', 'sw']);
    expect(localesOfCountry('ET')).toEqual(['en', 'am']);
    expect(localesOfCountry(undefined)).toEqual(['en']);
    const picker = readFileSync('src/shared/ui/LanguageSwitcher.tsx', 'utf8');
    expect(picker).toMatch(/localesOfCountry\(firstGuess\(\)\)/);
    expect(picker).toMatch(/common\.otherLanguages/);
    expect(en['common.otherLanguages']).toBe('Other languages');
  });
});
