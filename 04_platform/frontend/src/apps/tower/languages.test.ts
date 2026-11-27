import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { languageRows, placeholderList, reviewProblem, rowCounts, visibleRows, type WordReviewRow } from './languages';

/*
 * 2026-11-03 — THE LANGUAGES REVIEW SHEET (the owner: "a separate review sheet that lives in 'languages' where a review can be
 * edited as version 2. the first version is not lost. languages are reviewed per country sbg company").
 */
const english = { 'a.save': 'Save', 'a.hello': 'Hello, {name}', 'a.count': '{n, plural, one {# parcel} other {# parcels}} waiting' };
const v1 = { 'a.save': 'Hifadhi', 'a.hello': 'Habari, {name}' };
const review = (key: string, over: Partial<WordReviewRow> = {}): WordReviewRow => ({ key, by: 'Amina', at: '2026-11-03T10:00:00Z', history: [], ...over });

describe('the review sheet', () => {
  it('shows every phrase with its English, version 1 and the country’s version 2', () => {
    const rows = languageRows(english, v1, [review('a.save', { text: 'Weka' }), review('a.hello', { kept: true })]);
    expect(rows.map((r) => [r.key, r.v1, r.review?.text, r.review?.kept])).toEqual([
      ['a.count', undefined, undefined, undefined],
      ['a.hello', 'Habari, {name}', undefined, true],
      ['a.save', 'Hifadhi', 'Weka', undefined],
    ]);
    expect(rowCounts(rows)).toEqual({ all: 3, open: 1, reviewed: 2, own: 1 });
    expect(visibleRows(rows, 'open', '').map((r) => r.key)).toEqual(['a.count']);
    expect(visibleRows(rows, 'own', '').map((r) => r.key)).toEqual(['a.save']);
    // Found by its key, its English or either version.
    expect(visibleRows(rows, 'all', 'habari').map((r) => r.key)).toEqual(['a.hello']);
    expect(visibleRows(rows, 'all', 'weka').map((r) => r.key)).toEqual(['a.save']);
    expect(visibleRows(rows, 'all', 'a.count').map((r) => r.key)).toEqual(['a.count']);
  });

  it('saves version 2 only with every placeholder of the English kept', () => {
    expect(reviewProblem('Hello, {name}', 'Habari')).toBe('placeholders');
    expect(reviewProblem('Hello, {name}', 'Karibu, {name}')).toBeNull();
    expect(reviewProblem('Hello, {name}', '  ')).toBe('empty');
    expect(reviewProblem(english['a.count'], '{n, plural, one {kifurushi #} other {vifurushi #}} vinasubiri')).toBeNull();
    expect(reviewProblem(english['a.count'], 'vifurushi vinasubiri')).toBe('placeholders');
    expect(placeholderList(english['a.count'])).toEqual(['{n}']);
  });

  it('is the console’s Languages screen, in its Setup group', () => {
    expect(readFileSync('src/apps/tower/nav.ts', 'utf8')).toMatch(/'documents', 'languages'/);
    const screen = readFileSync('src/apps/tower/screens/LanguagesScreen.tsx', 'utf8');
    expect(screen).toMatch(/client\.api\.reviewWord\(locale, country, row\.key, body\)/);
    expect(screen).toMatch(/reviewProblem\(row\.english, body\.text\)/);
  });

  /*
   * 2026-11-27 — THE NOTICES ARE REVIEWED TOO (the owner: "fix as recommended"). Their English and version 1 come from the
   * server, under keys of their own (notice. and the phrase's key); a review of one is a row of the notices only, never of
   * the apps' words, and the other way round.
   */
  it('reviews the notices beside the apps’ words: their rows from the server, each kind’s reviews on its own rows', () => {
    const notices = { english: { 'notice.payout.bankChanged.title': 'Your payout bank account was changed' }, words: { 'notice.payout.bankChanged.title': 'Je bankrekening is gewijzigd' } };
    const reviews = [
      { key: 'notice.payout.bankChanged.title', text: 'Je uitbetaalrekening is gewijzigd', by: 'NL', at: '2026-11-27T10:00:00Z', history: [] },
      { key: 'a.save', text: 'Bewaar', by: 'NL', at: '2026-11-27T10:00:00Z', history: [] },
    ];
    const noticeRows = languageRows(notices.english, notices.words, reviews);
    expect(noticeRows.map((r) => [r.key, r.v1, r.review?.text])).toEqual([['notice.payout.bankChanged.title', 'Je bankrekening is gewijzigd', 'Je uitbetaalrekening is gewijzigd']]);
    expect(languageRows({ 'a.save': 'Save' }, {}, reviews).map((r) => r.key)).toEqual(['a.save']);
    const screen = readFileSync('src/apps/tower/screens/LanguagesScreen.tsx', 'utf8');
    expect(screen).toMatch(/client\.api\.noticeWords\(locale\)/);
    expect(screen).toMatch(/languageRows\(notices\.english, notices\.words, reviews\)/);
    expect(screen).toMatch(/t\('tower\.langs\.book\.notices'\)/);
  });
});
