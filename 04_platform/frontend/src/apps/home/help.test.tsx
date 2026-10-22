import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToString } from 'preact-render-to-string';
import { articles } from '../../shared/guide/articles';
import { HELP_ROLES, MOST_ASKED, alphabetical, articlePath, forRole, helpPageOf, relatedOf, roleOf, searchArticles } from './help';
import { HelpScreen } from './screens/HelpScreen';
import { pieces } from './helpText';
import { HELP_GROUPS } from '../../shared/guide/articles';
import { FAQ, FAQ_GROUPS } from './screens/WelcomeScreen';
import { t } from '../../shared/i18n';
import { TOPICS } from './screens/ContactScreen';

/*
 * THE HELP CENTRE (/help/ on the front door). What is held to here: every address means one page; search finds an
 * article by any of its words, title first; a role shows that role's help; what is related shares an app; the pages, as
 * built, carry the article's own words — and every "may answer it" points at an article that exists.
 */
const all = articles();

describe('the help centre', () => {
  it('reads its addresses: the index, an article, writing to us — nothing else', () => {
    expect(helpPageOf('/help/')).toEqual({ kind: 'index' });
    expect(helpPageOf('/help')).toEqual({ kind: 'index' });
    expect(helpPageOf('/help/change-pin/')).toEqual({ kind: 'article', id: 'change-pin' });
    expect(helpPageOf('/help/contact/')).toEqual({ kind: 'contact' });
    expect(helpPageOf('/help/a/b/')).toBeNull();
    expect(helpPageOf('/towns/nairobi/')).toBeNull();
    expect(articlePath('change-pin')).toBe('/help/change-pin/');
  });

  it('finds an article by any of its words, every word typed, title matches first, accents and case aside', () => {
    expect(searchArticles(all, '')).toEqual([]);
    const pin = searchArticles(all, 'PIN');
    expect(pin.length).toBeGreaterThan(2);
    expect(pin[0].title).toMatch(/PIN/);
    expect(searchArticles(all, 'pìn').map((a) => a.id)).toEqual(pin.map((a) => a.id));
    // Every word must be there: a word no article has finds nothing.
    expect(searchArticles(all, 'PIN zzqqxx')).toEqual([]);
  });

  it('shows a role the help of its apps, and everybody all of it', () => {
    expect(forRole(all, null)).toHaveLength(all.length);
    const shop = forRole(all, 'shop');
    expect(shop.every((a) => a.apps.includes('agent'))).toBe(true);
    expect(shop.some((a) => a.id === 'shop-sign-in')).toBe(true);
    for (const r of HELP_ROLES) expect(forRole(all, r.role).length, r.role).toBeGreaterThan(0);
    expect(roleOf('?for=driver')).toBe('driver');
    expect(roleOf('?for=operator')).toBeNull();
  });

  it('relates an article to others in the same apps, never to itself', () => {
    const a = all.find((x) => x.id === 'change-pin')!;
    const related = relatedOf(a, all);
    expect(related.length).toBeGreaterThan(0);
    expect(related.length).toBeLessThanOrEqual(4);
    expect(related.some((x) => x.id === a.id)).toBe(false);
    for (const r of related) expect(r.apps.some((app) => a.apps.includes(app))).toBe(true);
  });

  it('asks nothing of an article that does not exist: most asked and "may answer it" name real ones', () => {
    for (const id of MOST_ASKED) expect(all.some((a) => a.id === id), id).toBe(true);
    for (const topic of TOPICS) for (const id of topic.answers) expect(all.some((a) => a.id === id), `${topic.category}: ${id}`).toBe(true);
    expect(alphabetical(all, 'en')[0].title.localeCompare(alphabetical(all, 'en')[1].title)).toBeLessThanOrEqual(0);
  });

  it('builds an article’s page with its own words, a way back, and a way to write to us about it', () => {
    const html = renderToString(<HelpScreen page={{ kind: 'article', id: 'change-pin' }} />);
    const a = all.find((x) => x.id === 'change-pin')!;
    const text = html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    // Every step and note is on the page, in its words — chips and paths drawn without their quotation marks.
    for (const s of [...(a.steps ?? []), ...(a.notes ?? [])]) expect(text, s).toContain(s.replace(/[“”]/g, '').replace(/ › /g, '›').slice(0, 30).replace(/›/g, '›'.normalize()).split('›')[0].trim().slice(0, 20));
    expect((html.match(/<li><p>/g) ?? []).length).toBe(a.steps?.length ?? 0);
    expect(html).toContain('href="/help/"');
    expect(html).toContain('/help/contact/?about=change-pin');
    // The reader's other articles, under their task headings, beside it; the steps' numbers are the page's own.
    expect(html).toContain('class="hc__side');
    expect(html).toContain('aria-current="page"');
  });

  it('draws a careful note as a warning, and folds the why and the rare cases away', () => {
    const a = all.find((x) => (x.noteKinds ?? []).includes('careful') && (x.noteKinds ?? []).includes('why'))!;
    expect(a).toBeDefined();
    const html = renderToString(<HelpScreen page={{ kind: 'article', id: a.id }} />);
    expect(html).toContain('hc__call--careful');
    expect(html).toMatch(/<details class="hc__fold" id="why">/);
  });

  it('gives every public article a task heading and a kind for every note', () => {
    for (const a of all) {
      expect(HELP_GROUPS, a.id).toContain(a.group);
      expect((a.noteKinds ?? []).length, a.id).toBe((a.notes ?? []).length);
    }
    // Every heading is used: a reader's help is never under one heading alone.
    for (const g of HELP_GROUPS) expect(all.some((a) => a.group === g), g).toBe(true);
  });

  it('answers every front-page question on its own, and never promises a text about a parcel', () => {
    expect(FAQ.length).toBe(FAQ_GROUPS.reduce((n, g) => n + g.items.length, 0));
    for (const [, a] of FAQ) {
      // Quoted alone — by an AI assistant, or a friend — an answer must not lean on the page around it.
      expect(t(a), a).not.toMatch(/this page|above|below/i);
      // The user, 2026-10-11: a receiver is not texted.
      expect(t(a), a).not.toMatch(/code by (message|text|SMS)|we text you/i);
    }
    for (const g of FAQ_GROUPS) expect(g.more.startsWith('/help/'), g.key).toBe(true);
  });

  it('marks what the reader must find: a quoted button as a chip, a quoted route as a path', () => {
    expect(pieces('Tap “Sign in” now.')).toEqual([{ kind: 'text', text: 'Tap ' }, { kind: 'ui', text: 'Sign in' }, { kind: 'text', text: ' now.' }]);
    expect(pieces('Open “Home › Shop settings › Password”, then type it.')).toEqual([{ kind: 'text', text: 'Open ' }, { kind: 'path', steps: ['Home', 'Shop settings', 'Password'] }, { kind: 'text', text: ', then type it.' }]);
    // Other languages' quotation marks are read the same way.
    expect(pieces('Gusa «Ingia».')[1]).toEqual({ kind: 'ui', text: 'Ingia' });
    expect(pieces('Nothing to mark here.')).toEqual([{ kind: 'text', text: 'Nothing to mark here.' }]);
  });

  it('builds the index with every article linked, so a crawler finds each page from it', () => {
    const html = renderToString(<HelpScreen page={{ kind: 'index' }} />);
    for (const a of all) expect(html, a.id).toContain(`href="/help/${a.id}/"`);
  });

  it('says an address it does not know is not here, rather than showing an empty page', () => {
    expect(renderToString(<HelpScreen page={{ kind: 'article', id: 'no-such-article' }} />)).toContain('That help page is not here');
  });

  it('leads home from every help page: the mark to the front page, the word to the help’s start', () => {
    for (const page of [{ kind: 'index' } as const, { kind: 'article', id: all[0].id } as const, { kind: 'contact' } as const]) {
      const html = renderToString(<HelpScreen page={page} />);
      expect(html, page.kind).toMatch(/<a class="hc__logo" href="\/" aria-label="SeeBuyGet front page"/);
      expect(html, page.kind).toMatch(/<a class="hc__logo hc__logo--help" href="\/help\/"/);
      // The brand tile itself, never letters typed on a square.
      expect(html, page.kind).toContain('<img class="hc__tile" src="/img/brand-tile.svg"');
    }
  });

  it('names its favicon from the site’s root, so a page below it (/help/<id>/) finds it too', () => {
    const index = readFileSync(join('src', 'apps', 'home', 'index.html'), 'utf8');
    const icons = [...index.matchAll(/<link rel="(?:icon|apple-touch-icon)"[^>]*href="([^"]+)"/g)].map((m) => m[1]);
    expect(icons.length).toBeGreaterThan(2);
    for (const href of icons) expect(href, href).toMatch(/^\/icons\//);
    expect(icons).toContain('/icons/favicon.svg');
  });
});
