import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from '../../shared/i18n';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AUDIENCES, NOTICES, countriesOf, forPath, infoPageOf, noticeKey, pageKey, range, type Notice } from './pages';
import { InfoScreen } from './screens/InfoScreen';
import { PublicShell } from './screens/PublicShell';

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
 * THE TERMS OF USE, YOUR DATA, AND COOKIES (/terms/, /privacy/, /cookies/) — written by staff in the console and read from
 * the server (the user, 2026-10-25). Held to here: every address means one page; a page draws the published text with
 * its version, and the way to write to us; the first versions inserted with the system claim nothing the system does
 * not do; and "SeeBuyGet sets no cookies" stays true of the code itself.
 */
describe('the terms of use, your data, and cookies', () => {
  const NOTICE_KINDS = Object.keys(NOTICES) as Notice[];
  /** The first versions, as the server inserts them on a new server (backend/src/foundation/documents/documents.seed.ts). */
  const seeds = readFileSync(join('..', 'backend', 'src', 'foundation', 'documents', 'documents.seed.ts'), 'utf8');

  it('reads their addresses', () => {
    expect(infoPageOf('/terms/')).toEqual({ kind: 'notice', which: 'terms' });
    expect(infoPageOf('/privacy/')).toEqual({ kind: 'notice', which: 'privacy' });
    expect(infoPageOf('/cookies')).toEqual({ kind: 'notice', which: 'cookies' });
    expect(infoPageOf('/privacy/more/')).toBeNull();
  });

  it('has, for each, what a search result says and the title to show before the text arrives', () => {
    for (const which of NOTICE_KINDS) {
      for (const part of ['metaTitle', 'metaDescription', 'title']) expect(t(noticeKey(which, part)), `${which}.${part}`).not.toMatch(/^pages\./);
    }
  });

  it('draws the published text with its version and what changed — and the way to write to us; the three are in the foot', () => {
    const body = ['Opening words.', '', '## Who you agree with', '', '- One line.', '- [Your data](/privacy/)'].join('\n');
    const doc = { kind: 'terms' as const, number: 2, title: 'Terms of use', body, publishedAt: '2026-10-25T09:00:00.000Z', changeNote: 'A clearer line', askAgain: false, path: '/terms/' };
    (globalThis as { __SBG_PRERENDER__?: unknown }).__SBG_PRERENDER__ = { url: '/terms/', towns: [], documents: { terms: doc } };
    try {
      const html = renderToString(<InfoScreen page={{ kind: 'notice', which: 'terms' }} />);
      expect(html).toContain('<h1 class="land__title">Terms of use</h1>');
      expect(html).toContain('<h2>Who you agree with</h2>');
      expect((html.match(/<li>/g) ?? []).length).toBe(2);
      expect(html).toContain('href="/privacy/"');
      expect(html).toMatch(/Version 2, published/);
      expect(html).toContain('What changed in this version: A clearer line');
      expect(html).toContain('href="/help/contact/?topic=privacy"');
    } finally {
      delete (globalThis as { __SBG_PRERENDER__?: unknown }).__SBG_PRERENDER__;
    }
    const foot = renderToString(<PublicShell>{null}</PublicShell>);
    for (const which of NOTICE_KINDS) expect(foot, which).toContain(`href="${NOTICES[which].path}"`);
  });

  it('starts every new server with first versions that claim nothing the system does not do', () => {
    // The guard read the three: the terms' own heading, the data notice's, the cookie statement's.
    expect(seeds).toContain('## Who you agree with');
    expect(seeds).toContain('## How long it is kept');
    expect(seeds).toContain('## No cookies, no tracking');
    expect(seeds).not.toMatch(/sign(ing)? out (removes|clears|deletes|wipes|erases)/i);
    expect(seeds).not.toMatch(/(all|every(thing)?)( of)?( your| personal)? data is encrypted|everything is encrypted/i);
    expect(seeds).not.toMatch(/(you can|to) (delete|close) your account (in|from|under)/i);
    expect(seeds).not.toMatch(/download (all )?your (personal )?data/i);
    expect(seeds).not.toMatch(/never (stored|kept)|we never keep/i);
    // And the things they must say, because the system does them.
    expect(seeds).toMatch(/four years without a sign-in can be closed by its owner/);
    expect(seeds).not.toMatch(/close (it|your account) (at )?any ?time|delete everything/i);
    expect(seeds).toMatch(/Some things stay after signing out/);
    expect(seeds).toMatch(/without that extra encryption/);
    // The terms promise no cover and no payment of anybody's money: SeeBuyGet insures nothing, and quotes, never pays.
    expect(seeds).toMatch(/SeeBuyGet insures nothing/);
    expect(seeds).toMatch(/SeeBuyGet does not handle payments between businesses/);
    expect(seeds).not.toMatch(/SeeBuyGet (will )?(pays?|refunds?|compensates?) (you|the)/i);
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
