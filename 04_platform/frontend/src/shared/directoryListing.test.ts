import { describe, expect, it } from 'vitest';
import { t } from './i18n';
import { cleanLine, listingLink, listingState, listingWhy, websiteOf } from './directoryListing';

/** A firm's own place in the logistics directory, as the Business and Fleet apps say it (2026-10-30). */
describe('a firm’s place in the directory', () => {
  it('says where it stands, and why it is not shown', () => {
    expect(listingState({ listed: true, eligible: true, kinds: ['forwarder'] })).toBe('shown');
    expect(listingState({ listed: false, eligible: true, kinds: ['forwarder'] })).toBe('off');
    expect(listingState({ listed: false, eligible: false, kinds: ['forwarder'] })).toBe('notChecked');
    expect(listingState({ listed: false, eligible: false, kinds: [] })).toBe('noKinds');
    expect(listingWhy('shown', 'business')).toBeNull();
    expect(t(listingWhy('off', 'fleet')!)).toBe('Not shown: you took it off the directory.');
    expect(t(listingWhy('notChecked', 'business')!)).toMatch(/two of our staff/);
    expect(t(listingWhy('noKinds', 'business')!)).toMatch(/^The directory lists forwarders/);
    expect(t(listingWhy('notChecked', 'fleet')!)).toMatch(/active/);
  });

  it('opens its own entry on its country’s page', () => {
    expect(listingLink({ listed: true, eligible: true, kinds: ['haulier'], country: 'KE', handle: 'baobab-haulage' })).toBe('/directory/ke/#baobab-haulage');
    expect(listingLink({ listed: false, eligible: false, kinds: [] })).toBe('/directory/');
  });

  it('keeps a line as it will be shown, and gives a typed website the https:// it needs', () => {
    expect(cleanLine('  Flatbeds,   Nairobi\nto Kampala ')).toBe('Flatbeds, Nairobi to Kampala');
    expect(cleanLine('x'.repeat(300))).toHaveLength(240);
    expect(websiteOf('baobab.example')).toBe('https://baobab.example');
    expect(websiteOf(' www.baobab.co.ke/fleet ')).toBe('https://www.baobab.co.ke/fleet');
    expect(websiteOf('http://baobab.example')).toBe('http://baobab.example');
    expect(websiteOf('')).toBe('');
    expect(websiteOf('baobab')).toBe('baobab');
  });
});
