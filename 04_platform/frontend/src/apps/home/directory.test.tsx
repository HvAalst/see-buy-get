import { afterEach, describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from '../../shared/i18n';
import { enDirectory } from '../../shared/i18n/catalogs/en.directory';
import { DIRECTORY_KINDS, directoryCountryPath, directoryPageOf, matching, siteHost, telOf, type DirectoryBuilt, type DirectoryEntry } from './directory';
import { DirectoryScreen } from './screens/DirectoryScreen';

/*
 * THE LOGISTICS DIRECTORY (the user, 2026-10-30). Held to here: its addresses; alphabetical as the server sent it; a
 * firm's words always marked as its own, beside what we saw; a phone a Call button and never a printed number; an empty
 * record said as the kind of empty it is; and a country with nobody in it said plainly.
 */
const firm = (over: Partial<DirectoryEntry>): DirectoryEntry => ({
  handle: 'acacia-clearing',
  name: 'Acacia Clearing',
  kinds: ['clearing_agent'],
  country: 'KE',
  since: '2026-09-02T10:00:00.000Z',
  seen: {},
  checks: [{ paper: 'certificate_of_incorporation', what: 'certificate of incorporation', at: '2026-09-01' }],
  ...over,
});

function built(directory: DirectoryBuilt, url: string) {
  (globalThis as { __SBG_PRERENDER__?: unknown }).__SBG_PRERENDER__ = { url, towns: [], directory };
}

afterEach(() => {
  delete (globalThis as { __SBG_PRERENDER__?: unknown }).__SBG_PRERENDER__;
});

describe('the logistics directory', () => {
  it('reads its addresses, and nothing else', () => {
    expect(directoryPageOf('/directory/')).toEqual({ kind: 'index' });
    expect(directoryPageOf('/directory')).toEqual({ kind: 'index' });
    expect(directoryPageOf('/directory/ke/')).toEqual({ kind: 'country', country: 'KE' });
    expect(directoryPageOf('/directory/kenya/')).toBeNull();
    expect(directoryPageOf('/towns/nairobi/')).toBeNull();
    expect(directoryCountryPath('TZ')).toBe('/directory/tz/');
  });

  it('has every word it names', () => {
    for (const k of DIRECTORY_KINDS) {
      expect(t(`directory.kind.${k}`)).not.toMatch(/^directory\./);
      expect(t(`directory.kinds.${k}`)).not.toMatch(/^directory\./);
    }
    for (const v of Object.values(enDirectory)) expect(v.trim()).not.toBe('');
  });

  it('lists the countries with their counts, each a page of its own', () => {
    built({ index: { countries: [{ country: 'KE', name: 'Kenya', total: 3, forwarder: 1, clearing_agent: 2, depot: 0, haulier: 0 }] } }, '/directory/');
    const html = renderToString(<DirectoryScreen page={{ kind: 'index' }} />);
    expect(html).toContain('href="/directory/ke/"');
    expect(html).toContain('Kenya');
    expect(html).toContain('3 firms · Freight forwarders: 1 · Clearing agents: 2');
    expect(html).not.toContain('Container depots: 0');
    expect(html).toContain(t('directory.how4'));
  });

  it('says so when nobody is listed yet, and how a firm comes to be', () => {
    built({ index: { countries: [] } }, '/directory/');
    const html = renderToString(<DirectoryScreen page={{ kind: 'index' }} />);
    expect(html).toContain(t('directory.none'));
    expect(html).toContain('href="/for/business/"');
    expect(html).toContain('href="/for/fleets/"');
  });

  it('shows a firm’s own words as its own, beside what we saw — and its phone as a button, never printed', () => {
    const entries = [
      firm({ words: 'Vehicles at Mombasa, ten years.', says: { clears: ['vehicles'], places: ['Mombasa'] }, seen: { appointed: 4, cleared: 3 }, contact: { phone: '+254 700 111 222', email: 'desk@acacia.example', website: 'https://acacia.example/' } }),
      firm({ handle: 'baobab-haulage', name: 'Baobab Haulage', kinds: ['haulier'], seen: {}, checks: [{ paper: 'fleet_papers', what: 'x', at: '2026-08-30' }] }),
    ];
    built({ country: { country: 'KE', name: 'Kenya', entries } }, '/directory/ke/');
    const html = renderToString(<DirectoryScreen page={{ kind: 'country', country: 'KE' }} />);
    expect(html).toContain('Logistics firms in Kenya');
    // In the order the server sent: alphabetical.
    expect(html.indexOf('Acacia Clearing')).toBeLessThan(html.indexOf('Baobab Haulage'));
    // Their words, and whose they are.
    expect(html).toContain('“Vehicles at Mombasa, ten years.”');
    expect(html).toContain(t('directory.notChecked'));
    expect(html).toContain('Says it clears: Vehicles and plant');
    expect(html).toContain('Says it clears at: Mombasa');
    // What we saw, counted; and an empty record said as the kind of empty it is.
    expect(html).toContain('Appointed to clear 4 imports; 3 of them got on the road.');
    expect(html).toContain(t('directory.seenNone'));
    // Papers named in words, with the day.
    expect(html).toContain('Certificate of incorporation');
    expect(html).toContain(t('directory.paper.fleet_papers'));
    // A Call button, never the number as text.
    expect(html).toContain('href="tel:+254700111222"');
    expect(html.replace(/href="[^"]*"/g, '')).not.toMatch(/700 ?111 ?222/);
    expect(html).toContain('href="mailto:desk@acacia.example"');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
    expect(html).toContain('href="/@acacia-clearing"');
    // The firm with no contact says so; the kinds are buttons, never a select.
    expect(html).toContain(t('directory.noContact'));
    expect(html).not.toContain('<select');
    expect(html).toContain('aria-pressed="true"');
  });

  it('says plainly when a country has nobody listed', () => {
    built({ country: { country: 'UG', name: 'Uganda', entries: [] } }, '/directory/ug/');
    const html = renderToString(<DirectoryScreen page={{ kind: 'country', country: 'UG' }} />);
    expect(html).toContain('No firms in Uganda are listed yet.');
  });

  it('finds a firm by a few words over its name, its line and what it clears', () => {
    const entries = [firm({ words: 'Reefer boxes' }), firm({ handle: 'b', name: 'Baobab Haulage', kinds: ['haulier'] }), firm({ handle: 'c', name: 'Coast Depot', kinds: ['depot', 'clearing_agent'], says: { clears: ['vehicles'], places: ['Mombasa'] } })];
    expect(matching(entries, 'all', '').map((e) => e.name)).toEqual(['Acacia Clearing', 'Baobab Haulage', 'Coast Depot']);
    expect(matching(entries, 'clearing_agent', '').map((e) => e.name)).toEqual(['Acacia Clearing', 'Coast Depot']);
    expect(matching(entries, 'all', 'reefer').map((e) => e.name)).toEqual(['Acacia Clearing']);
    expect(matching(entries, 'all', 'mombasa').map((e) => e.name)).toEqual(['Coast Depot']);
    expect(matching(entries, 'haulier', 'coast')).toEqual([]);
  });

  it('dials a number by its digits, and names a website by its host', () => {
    expect(telOf('+254 (0) 700-111 222')).toBe('tel:+2540700111222');
    expect(telOf('0700 111 222')).toBe('tel:0700111222');
    expect(siteHost('https://acacia.example/')).toBe('acacia.example');
  });
});
