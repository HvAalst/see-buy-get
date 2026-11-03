import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { addressCountry, addressLine, EMPTY_JOIN, signupBody, stepBlocker, stepsFor, zoneFromAddress, type JoinForm, type RoleSpec } from './logic';
import { en } from '../../shared/i18n/catalogs/en';
import { enHome } from '../../shared/i18n/catalogs/en.home';
import { interpolate, type MessageKey } from '../../shared/i18n';
import type { AddressFormat } from '../../shared/account/address';

/*
 * 2026-11-03 — THE SHOP SIGN-UP (the owner: "the shop sign up is asking for id number, but not yet the upload. same for
 * trading license … we should take the same measures as business, skip, but pending. photo or pdf for both docs"; and "A
 * country like the Netherlands should be checked at first step … It would trigger the address field besides the map …
 * An address would be better in that case").
 */
const words = { ...en, ...enHome } as Record<string, string>;
const t = (key: MessageKey, params?: Record<string, string | number>) => (params ? interpolate(words[key] ?? key, params) : (words[key] ?? key));
const shop = { id: 'pudo', kind: 'signup' } as unknown as RoleSpec;
const NL: AddressFormat = { country: 'NL', fields: [{ key: 'street', required: true }, { key: 'number', required: true }, { key: 'postcode', required: true }, { key: 'town', required: true }] } as AddressFormat;
const KE: AddressFormat = { country: 'KE', fields: [{ key: 'line', required: false }, { key: 'area', required: false }, { key: 'town', required: true }] } as AddressFormat;
const form = (over: Partial<JoinForm>): JoinForm => ({ ...EMPTY_JOIN, country: 'NL', location: { lat: 52.37, lng: 4.9 }, ...over });

describe('a shop’s papers, after its account is made', () => {
  it('are a step of their own after the email, skippable, and all three to send', () => {
    expect(stepsFor('signup', false, true)).toEqual(['phone', 'code', 'about', 'where', 'login', 'papers', 'done']);
    expect(stepsFor('signup')).not.toContain('papers');
    expect(stepBlocker(shop, 'papers', form({}), t)).toMatch(/skip for now/);
    expect(stepBlocker(shop, 'papers', form({ shopPapers: { idCopyRef: 'med_1', tradingLicenceRef: 'med_2', shopPhotoRef: 'med_3' } }), t)).toBeNull();
    const screen = readFileSync('src/apps/home/screens/JoinScreen.tsx', 'utf8');
    // The ID and the licence take a photo or a PDF; the shop's front a photo.
    expect(screen).toMatch(/<PhotoField id="shop-id" document /);
    expect(screen).toMatch(/<PhotoField id="shop-licence-paper" document /);
    expect(screen).toMatch(/actions\.sendShopPapers\(true\)/);
    expect(readFileSync('src/shared/ui/PhotoField.tsx', 'utf8')).toMatch(/accept="image\/\*,application\/pdf"/);
  });
});

describe('a shop’s place, in its country’s way', () => {
  it('asks the address where the country writes it with a postcode, and not the area', () => {
    expect(addressCountry(NL)).toBe(true);
    expect(addressCountry(KE)).toBe(false);
    expect(stepBlocker(shop, 'where', form({ addressFormat: NL }), t)).toMatch(/address/);
    const full = { country: 'NL', street: 'Keizersgracht', number: '123', postcode: '1015 CJ', town: 'Amsterdam' };
    expect(stepBlocker(shop, 'where', form({ addressFormat: NL, address: full }), t)).toBeNull();
    // Kenya keeps the area, as before.
    expect(stepBlocker(shop, 'where', form({ country: 'KE', addressFormat: KE, zone: '' }), t)).toMatch(/area/);
    expect(addressLine(full, NL)).toBe('Keizersgracht, 123, 1015 CJ, Amsterdam');
    expect(zoneFromAddress(full)).toBe('1015');
    const body = signupBody(shop, form({ addressFormat: NL, address: full, displayName: 'Hoek', email: 'a@b.nl', password: 'x'.repeat(10) }), 'm') as { profile: { agent: { zone: string; physicalAddress?: string } } };
    expect(body.profile.agent).toMatchObject({ zone: '1015', physicalAddress: 'Keizersgracht, 123, 1015 CJ, Amsterdam' });
  });
});
