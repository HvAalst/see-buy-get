import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from '../../shared/i18n';
import { AUDIENCES, countriesOf, forPath, infoPageOf, pageKey, range } from './pages';
import { InfoScreen } from './screens/InfoScreen';

/*
 * THE PAGES WRITTEN TO BE QUOTED (/about/, /for/<who>/). What is held to here: every address means one page; every page
 * has all its words; an answer stands on its own, as an assistant quotes it; nothing promises a text about a parcel.
 */
describe('the pages written to be quoted', () => {
  it('reads their addresses, and nothing else', () => {
    expect(infoPageOf('/about/')).toEqual({ kind: 'about' });
    expect(infoPageOf('/for/shops/')).toEqual({ kind: 'for', who: 'shops' });
    expect(infoPageOf('/for/pilots/')).toBeNull();
    expect(infoPageOf('/help/')).toBeNull();
    expect(forPath('stores')).toBe('/for/stores/');
  });

  it('has every word of every reader’s page, and draws it', () => {
    for (const a of AUDIENCES) {
      const parts = ['metaTitle', 'metaDescription', 'title', 'lede', 'cta', ...range(a.steps).map((i) => `step${i}`), ...range(a.needs).map((i) => `need${i}`), ...range(a.questions).flatMap((i) => [`q${i}`, `a${i}`])];
      for (const part of parts) expect(t(pageKey(a.who, part)), `${a.who}.${part}`).not.toMatch(/^pages\./);
      const html = renderToString(<InfoScreen page={{ kind: 'for', who: a.who }} />);
      expect(html, a.who).toContain(t(pageKey(a.who, 'title')).replace(/&/g, '&amp;'));
      expect(html, a.who).toContain(`href="${a.join}"`);
      expect((html.match(/class="land__qa"/g) ?? []).length, a.who).toBe(a.questions);
    }
  });

  it('answers every question on its own, and never promises a text about a parcel', () => {
    const answers = AUDIENCES.flatMap((a) => range(a.questions).map((i) => t(pageKey(a.who, `a${i}`))));
    for (const a of answers) {
      expect(a).not.toMatch(/this page|above|below/i);
      expect(a).not.toMatch(/code by (message|text|SMS)|we text you/i);
    }
  });

  it('says where SeeBuyGet runs from the towns it was built with — or where to look when it knows none', () => {
    expect(countriesOf([{ country: 'KE' }, { country: 'UG' }, { country: 'KE' }], 'en')).toBe('Kenya, Uganda');
    const html = renderToString(<InfoScreen page={{ kind: 'about' }} />);
    expect(html).toContain(t('pages.about.whereNone'));
    for (const a of AUDIENCES) expect(html).toContain(`href="${forPath(a.who)}"`);
    expect(html).toContain('href="/llms-full.txt"');
  });
});
