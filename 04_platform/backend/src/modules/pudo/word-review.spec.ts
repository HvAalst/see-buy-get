import { WordReviewService } from './word-review.service';

/**
 * 2026-11-03 — A COUNTRY'S OWN REVIEW OF A LANGUAGE (the owner: "a review can be edited as version 2. the first version is not
 * lost. languages are reviewed per country sbg company"): version 2 per country, its whole history kept, version 1 untouched.
 */
describe('a country’s review of a language', () => {
  const at = (iso: string) => Date.parse(iso);

  it('keeps version 2 for the country that wrote it, with every step of its history', () => {
    const reviews = new WordReviewService();
    reviews.review('sw', 'ke', 'common.save', { text: 'Hifadhi sasa' }, 'Amina', at('2026-11-03T10:00:00Z'));
    reviews.review('sw', 'KE', 'common.save', { text: 'Weka' }, 'Brian', at('2026-11-03T11:00:00Z'));
    // Saying what is said already is not a step.
    reviews.review('sw', 'KE', 'common.save', { text: '  Weka ' }, 'Brian', at('2026-11-03T12:00:00Z'));
    const [one] = reviews.list('sw', 'KE');
    expect(one).toMatchObject({ country: 'KE', locale: 'sw', key: 'common.save', text: 'Weka', by: 'Brian' });
    expect(one.history.map((h) => [h.text, h.by])).toEqual([
      ['Hifadhi sasa', 'Amina'],
      ['Weka', 'Brian'],
    ]);
    expect(reviews.wordsOf('sw', 'KE')).toEqual({ 'common.save': 'Weka' });
    // Another country's people read their own country's review — none, here.
    expect(reviews.wordsOf('sw', 'TZ')).toEqual({});
  });

  it('keeps version 1 as written when the country says so — and the words it had said stay in the history', () => {
    const reviews = new WordReviewService();
    reviews.review('sw', 'KE', 'common.next', { text: 'Mbele' }, 'Amina');
    reviews.review('sw', 'KE', 'common.next', { keep: true }, 'Brian');
    expect(reviews.wordsOf('sw', 'KE')).toEqual({});
    expect(reviews.list('sw', 'KE')[0]).toMatchObject({ kept: true, history: [{ text: 'Mbele' }, { kept: true, by: 'Brian' }] });
  });

  it('refuses in words what it cannot keep', () => {
    const reviews = new WordReviewService();
    expect(() => reviews.review('en', 'KE', 'common.save', { text: 'x' }, 'Amina')).toThrow(/English is the language written first/);
    expect(() => reviews.review('sw', 'Kenya', 'common.save', { text: 'x' }, 'Amina')).toThrow(/two letters/);
    expect(() => reviews.review('sw', 'KE', 'not a key!', { text: 'x' }, 'Amina')).toThrow(/by its key/);
    expect(() => reviews.review('sw', 'KE', 'common.save', { text: '   ' }, 'Amina')).toThrow(/Write the words, or keep version 1/);
  });
});
