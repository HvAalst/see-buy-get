import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from '../../shared/i18n';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AUDIENCES, NOTICES, countriesOf, forPath, infoPageOf, noticeKey, pageKey, range, type Notice } from './pages';
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
    // A count from the build, never a list of towns; and where SeeBuyGet has no company, that it only matches.
    expect(html).not.toMatch(/href="\/towns\//);
    expect(html).toContain(t('pages.about.matchOnly'));
  });
});

/*
 * YOUR DATA, AND COOKIES (/privacy/, /cookies/) — what the system does with personal data today. Held to here: every
 * sentence each section counts is in the catalog, and no more; the page claims none of what the system does not do; and
 * "SeeBuyGet sets no cookies" stays true of the code itself.
 */
describe('your data, and cookies', () => {
  const NOTICE_KINDS = Object.keys(NOTICES) as Notice[];
  const words = (which: Notice) => NOTICES[which].sections.flatMap((s) => range(s.items).map((i) => t(noticeKey(which, `${s.id}.${i}`))));

  it('reads their addresses', () => {
    expect(infoPageOf('/privacy/')).toEqual({ kind: 'notice', which: 'privacy' });
    expect(infoPageOf('/cookies')).toEqual({ kind: 'notice', which: 'cookies' });
    expect(infoPageOf('/privacy/more/')).toBeNull();
  });

  it('has every sentence each section counts, and no sentence it does not', () => {
    for (const which of NOTICE_KINDS) {
      for (const part of ['metaTitle', 'metaDescription', 'title', 'lede', 'other']) expect(t(noticeKey(which, part)), `${which}.${part}`).not.toMatch(/^pages\./);
      for (const s of NOTICES[which].sections) {
        expect(t(noticeKey(which, `${s.id}.title`)), `${which}.${s.id}.title`).not.toMatch(/^pages\./);
        for (const i of range(s.items)) expect(t(noticeKey(which, `${s.id}.${i}`)), `${which}.${s.id}.${i}`).not.toMatch(/^pages\./);
        expect(t(noticeKey(which, `${s.id}.${s.items + 1}`)), `${which}.${s.id} counts too few`).toMatch(/^pages\./);
      }
    }
  });

  it('draws each page whole, with the way to write to us about your data and the other page', () => {
    for (const which of NOTICE_KINDS) {
      const html = renderToString(<InfoScreen page={{ kind: 'notice', which }} />);
      const count = NOTICES[which].sections.reduce((n, s) => n + s.items, 0);
      expect((html.match(/<li>/g) ?? []).length, which).toBe(count);
      expect(html, which).toContain('href="/help/contact/?topic=privacy"');
      expect(html, which).toContain(`href="${NOTICES[NOTICES[which].other].path}"`);
    }
  });

  it('claims nothing the system does not do: signing out does not clear a phone, not everything is encrypted, no account can be deleted from an app', () => {
    const all = NOTICE_KINDS.flatMap(words).join('\n');
    expect(all).not.toMatch(/sign(ing)? out (removes|clears|deletes|wipes|erases)/i);
    expect(all).not.toMatch(/(all|every(thing)?)( of)?( your| personal)? data is encrypted|everything is encrypted/i);
    expect(all).not.toMatch(/(you can|to) (delete|close) your account (in|from|under)/i);
    expect(all).not.toMatch(/download (all )?your (personal )?data/i);
    expect(all).not.toMatch(/never (stored|kept)|we never keep/i);
    // And the things it must say, because the system does them.
    expect(all).toMatch(/no button yet to close a SeeBuyGet account/);
    expect(all).toMatch(/Some things stay after signing out/);
    expect(all).toMatch(/without that extra encryption/);
  });

  it('keeps "SeeBuyGet sets no cookies" true of the code: no app writes one, no server route sets one, no page loads a script from elsewhere', () => {
    // From where the suite runs (04_platform/frontend), as the other tests that read this repository do.
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue;
        const full = join(dir, e.name);
        if (e.isDirectory()) walk(full, out);
        else if (/\.(ts|tsx|js|mjs|html)$/.test(e.name) && !/\.(test|spec)\.tsx?$/.test(e.name)) out.push(full);
      }
      return out;
    };
    const front = walk('src');
    const back = walk(join('..', 'backend', 'src'));
    // Each app's page, as a browser first opens it (src/apps/<app>/index.html).
    const html = front.filter((x) => x.endsWith('.html'));
    // The guard read something: the apps, the server and the pages a browser opens.
    expect(front.length).toBeGreaterThan(200);
    expect(back.length).toBeGreaterThan(200);
    expect(html.length).toBeGreaterThan(5);
    for (const f of front) expect(readFileSync(f, 'utf8'), f).not.toMatch(/document\.cookie|cookieStore\./);
    for (const f of back) expect(readFileSync(f, 'utf8'), f).not.toMatch(/\.cookie\(|['"]Set-Cookie['"]|cookie-parser|express-session/i);
    for (const f of html) expect(readFileSync(f, 'utf8'), f).not.toMatch(/<script[^>]+src="(https?:)?\/\//i);
  });
});
