import { describe, expect, it } from 'vitest';
import helpRaw from '../../../../../help.html?raw';
import { enHelp } from '../i18n/catalogs/en.help';
import { enHelpApp } from '../i18n/catalogs/en.help-app';
import { ARTICLE_SPECS, GUIDE_APPS, articles, articlesFor, siteArticles, type GuideApp } from './articles';
import { STAFF_ARTICLES, STAFF_LINES, consoleArticles } from './staff-articles';

/**
 * Help is ONE set of articles: behind every app's Help link, and — those about getting in and getting started — at
 * /help/ on the front door. Their words are in the catalog (en.help.ts for the site's, en.help-app.ts for the rest),
 * their shape in articles.ts; these tests keep the two agreeing, and keep the staff's own help where only staff read it.
 */
const words = (a: { title: string; summary: string; steps?: string[]; notes?: string[] }) => [a.title, a.summary, ...(a.steps ?? []), ...(a.notes ?? [])];

describe('help, in the apps and at /help/', () => {
  it('gives every app help of its own', () => {
    for (const app of [...Object.keys(GUIDE_APPS), 'console'] as GuideApp[]) expect(articlesFor(app).length, app).toBeGreaterThan(0);
  });

  it('never uses one address twice — the staff’s articles included', () => {
    const ids = [...ARTICLE_SPECS.map((a) => a.id), ...STAFF_ARTICLES.map((a) => a.id)];
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id, id).toMatch(/^[a-z0-9-]+$/);
  });

  it('has every word of every article in its catalog — the public site’s in en.help.ts, the rest in en.help-app.ts only — and no word no article has', () => {
    // key → whether it is a public site article's
    const wanted = new Map<string, boolean>();
    for (const s of ARTICLE_SPECS) {
      for (const part of ['title', 'summary', ...Array.from({ length: s.steps ?? 0 }, (_, i) => `step${i + 1}`), ...Array.from({ length: s.notes?.length ?? 0 }, (_, i) => `note${i + 1}`)]) wanted.set(`help.${s.id}.${part}`, Boolean(s.site));
    }
    expect([...wanted.values()].filter(Boolean).length).toBeGreaterThan(50);
    expect([...wanted.values()].filter((site) => !site).length).toBeGreaterThan(300);
    for (const [k, site] of wanted) {
      expect(k in (site ? enHelp : enHelpApp), k).toBe(true);
      // The public site downloads en.help.ts: an article about working in an app is not in it (2026-10-23).
      expect(k in (site ? enHelpApp : enHelp), `${k} is in both`).toBe(false);
    }
    const articleKeys = [...Object.keys(enHelp), ...Object.keys(enHelpApp)].filter((k) => !/^help\.(ui|app|contact)\./.test(k));
    expect(articleKeys.filter((k) => !wanted.has(k))).toEqual([]);
    // Read as words, never as their keys.
    for (const a of articles()) for (const w of words(a)) expect(w, a.id).not.toMatch(/^help\./);
  });

  it('shows on the front door only articles the public site carries: it never fetches the help inside the apps', () => {
    const home = articlesFor('home').map((a) => a.id);
    expect(home).toContain('which-sign-in');
    expect(home.filter((id) => !siteArticles().some((s) => s.id === id))).toEqual([]);
  });

  it('keeps the staff’s own help out of the articles and the catalog every app carries', () => {
    expect(STAFF_ARTICLES.map((a) => a.id)).toEqual(expect.arrayContaining(['console-setup-key', 'staff-roles', 'two-person']));
    const everyWord = [...Object.values(enHelp), ...Object.values(enHelpApp)].join('\n');
    expect(everyWord).not.toMatch(/Operator console|operator console|setup key/);
    for (const a of STAFF_ARTICLES) {
      expect(a.apps, a.id).toEqual(['console']);
      expect(ARTICLE_SPECS.some((s) => s.id === a.id), a.id).toBe(false);
    }
  });

  it('gives the console every one of its articles, the staff’s lines back in place', () => {
    const mine = consoleArticles();
    expect(mine.map((a) => a.id)).toEqual(expect.arrayContaining([...STAFF_ARTICLES.map((a) => a.id), ...articlesFor('console').map((a) => a.id)]));
    for (const [id, more] of Object.entries(STAFF_LINES)) {
      const a = mine.find((x) => x.id === id);
      expect(a, id).toBeDefined();
      for (const line of [...(more.steps ?? []), ...(more.notes ?? [])]) expect(words(a!), id).toContain(line);
      // ... and every other app shows that article without them.
      expect(words(articles().find((x) => x.id === id)!).some((w) => (more.steps ?? []).includes(w))).toBe(false);
    }
  });

  it('sends an old help.html address — and its #article — to the help’s new one', () => {
    const html = helpRaw.replace(/\r\n/g, '\n');
    expect(html).toContain('/help/');
    // An old link to an article lands on that article; anything else on the help's front.
    expect(html).toMatch(/location\.replace\(/);
    expect(html).toMatch(/\/help\/'\s*\+/);
    expect(html).not.toMatch(/Operator console|setup key/);
  });
});
