import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { articles } from '../../shared/guide/articles';
import { HELP_ROLES, MOST_ASKED, alphabetical, articlePath, forRole, helpPageOf, relatedOf, roleOf, searchArticles } from './help';
import { HelpScreen } from './screens/HelpScreen';
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
    for (const step of a.steps ?? []) expect(html).toContain(step.replace(/&/g, '&amp;').replace(/"/g, '&quot;').slice(0, 40));
    expect(html).toContain('href="/help/"');
    expect(html).toContain('/help/contact/?about=change-pin');
  });

  it('builds the index with every article linked, so a crawler finds each page from it', () => {
    const html = renderToString(<HelpScreen page={{ kind: 'index' }} />);
    for (const a of all) expect(html, a.id).toContain(`href="/help/${a.id}/"`);
  });

  it('says an address it does not know is not here, rather than showing an empty page', () => {
    expect(renderToString(<HelpScreen page={{ kind: 'article', id: 'no-such-article' }} />)).toContain('That help page is not here');
  });
});
