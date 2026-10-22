import { describe, expect, it } from 'vitest';
import helpRaw from '../../../../../help.html?raw';
import { ARTICLES, GUIDE_APPS, articlesFor, type GuideApp } from './articles';
import { STAFF_ARTICLES, STAFF_LINES, consoleArticles } from './staff-articles';

/**
 * Help lives in two places — behind every app's Help link, and on help.html — and the second is written from the first
 * (scripts/help-page.ts). These tests are what keep the two saying the same thing, and keep the staff's own help where
 * only staff read it.
 */
const html = helpRaw.replace(/\r\n/g, '\n');
const decode = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const words = (a: { title: string; summary: string; steps?: string[]; notes?: string[] }) => [a.title, a.summary, ...(a.steps ?? []), ...(a.notes ?? [])];

describe('help, in the apps and on help.html', () => {
  it('gives every app help of its own', () => {
    for (const app of Object.keys(GUIDE_APPS) as GuideApp[]) expect(articlesFor(app).length, app).toBeGreaterThan(0);
  });

  it('never uses one anchor twice — the staff’s articles included', () => {
    const ids = [...ARTICLES, ...STAFF_ARTICLES].map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('carries every article on help.html, word for word', () => {
    for (const a of ARTICLES) {
      const section = html.match(new RegExp(`<section class="article" id="${a.id}">([\\s\\S]*?)</section>`));
      expect(section, a.id).not.toBeNull();
      const body = decode(section![1]);
      for (const w of words(a)) expect(body, a.id).toContain(w);
    }
  });

  it('has no article on help.html that the apps do not show', () => {
    const onPage = [...html.matchAll(/<section class="article" id="([^"]+)">/g)].map((m) => m[1]);
    expect(onPage.sort()).toEqual(ARTICLES.map((a) => a.id).sort());
  });

  it('keeps the staff’s own help off the public page and out of the articles every app carries', () => {
    expect(STAFF_ARTICLES.map((a) => a.id)).toEqual(expect.arrayContaining(['console-setup-key', 'staff-roles', 'two-person']));
    for (const a of STAFF_ARTICLES) expect(html, a.id).not.toContain(`id="${a.id}"`);
    // Not a word of the console on the page, nor in any article an app other than the console shows.
    expect(html).not.toMatch(/Operator console|operator console|setup key|progress\.html/);
    for (const a of ARTICLES) for (const w of words(a)) expect(w, a.id).not.toMatch(/Operator console|operator console|setup key/);
    for (const a of STAFF_ARTICLES) expect(a.apps, a.id).toEqual(['console']);
  });

  it('gives the console every one of its articles, the staff’s lines back in place', () => {
    const mine = consoleArticles();
    expect(mine.map((a) => a.id)).toEqual(expect.arrayContaining([...STAFF_ARTICLES.map((a) => a.id), ...articlesFor('console').map((a) => a.id)]));
    for (const [id, more] of Object.entries(STAFF_LINES)) {
      const a = mine.find((x) => x.id === id);
      expect(a, id).toBeDefined();
      for (const line of [...(more.steps ?? []), ...(more.notes ?? [])]) expect(words(a!), id).toContain(line);
      // ... and every other app shows that article without them.
      expect(words(ARTICLES.find((x) => x.id === id)!).some((w) => (more.steps ?? []).includes(w))).toBe(false);
    }
  });
});
