import { describe, expect, it } from 'vitest';
import helpRaw from '../../../../../help.html?raw';
import { ARTICLES, GUIDE_APPS, articlesFor, type GuideApp } from './articles';

/**
 * Help lives in two places — behind every app's Help link, and on help.html beside progress.html — and the second is
 * written by hand. These tests are what keep the two saying the same thing.
 */
const html = helpRaw.replace(/\r\n/g, '\n');
const decode = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

describe('help, in the apps and on help.html', () => {
  it('gives every app help of its own', () => {
    for (const app of Object.keys(GUIDE_APPS) as GuideApp[]) expect(articlesFor(app).length, app).toBeGreaterThan(0);
  });

  it('never uses one anchor twice', () => {
    const ids = ARTICLES.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('carries every article on help.html, word for word', () => {
    for (const a of ARTICLES) {
      const section = html.match(new RegExp(`<section class="article" id="${a.id}">([\\s\\S]*?)</section>`));
      expect(section, a.id).not.toBeNull();
      const body = decode(section![1]);
      for (const words of [a.title, a.summary, ...(a.steps ?? []), ...(a.notes ?? [])]) expect(body, a.id).toContain(words);
    }
  });

  it('has no article on help.html that the apps do not show', () => {
    const onPage = [...html.matchAll(/<section class="article" id="([^"]+)">/g)].map((m) => m[1]);
    expect(onPage.sort()).toEqual(ARTICLES.map((a) => a.id).sort());
  });
});
