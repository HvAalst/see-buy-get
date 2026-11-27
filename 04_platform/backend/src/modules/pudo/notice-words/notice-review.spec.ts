import { NOTICE_EN, NOTICE_TRANSLATIONS } from './catalog';
import { noticeOf, said, sayIn } from './say';
import { NotificationService } from '../notification.service';
import { NotificationsController } from '../notifications.controller';
import { OutboxPushSender } from '../push-sender';
import { ReaderLanguageService } from '../reader-language.service';
import { WordReviewService } from '../word-review.service';
import { WordReviewController } from '../word-review.controller';
import type { IntrospectionResult } from '../../../foundation/auth/auth.types';

/*
 * 2026-11-27 — A COUNTRY'S OWN WORDS FOR THE NOTICES, AND THE LANGUAGE KEPT FOR EMAILS (the owner: "fix as recommended"). Held
 * to here: the notice phrases are on the review sheet, under their own keys and never given to the apps; a country's words are
 * checked against the English where it is kept, here, and refused if a place is lost; its readers — on the bell and on a phone
 * — are told a notice in them, and nobody else is; and the language a person reads their app in is kept, as it changes, for
 * the emails beside notices.
 */
const KEY = 'payout.bankChanged.title';
const REVIEW_KEY = `notice.${KEY}`;
const driver = { role: 'driver', did: 'did:glos:driver-ana', personDid: 'did:glos:person-ana' } as IntrospectionResult;
const asked = (lang: string, country?: string) => ({ headers: { 'x-sbg-lang': lang, ...(country ? { 'x-sbg-words-country': country } : {}) } });

describe('the notices on the review sheet', () => {
  it('every notice phrase is there, with its English and version 1, under its own key — and never given to the apps', () => {
    const book = new WordReviewController(new WordReviewService()).notices('bg');
    expect(Object.keys(book.english)).toHaveLength(Object.keys(NOTICE_EN).length);
    expect(book.english[REVIEW_KEY]).toBe(NOTICE_EN[KEY]);
    expect(book.words[REVIEW_KEY]).toBe(NOTICE_TRANSLATIONS.bg[KEY]);
    expect(() => WordReviewService.noticeBook('xx')).toThrow(/Reviews are kept for/);

    const reviews = new WordReviewService();
    reviews.review('bg', 'BG', REVIEW_KEY, { text: 'Сметката ви за изплащания е сменена' }, 'Proofreader BG');
    reviews.review('bg', 'BG', 'common.save', { text: 'Запази' }, 'Proofreader BG');
    expect(reviews.wordsOf('bg', 'BG')).toEqual({ 'common.save': 'Запази' });
    expect(reviews.list('bg', 'BG').map((r) => r.key)).toEqual(['common.save', REVIEW_KEY]);
  });

  it('a country’s words for a notice phrase must keep every place of its English, and be a phrase there is', () => {
    const reviews = new WordReviewService();
    const placed = 'payout.bankChanged.what';
    expect(() => reviews.review('nl', 'NL', `notice.${placed}`, { text: 'Uitbetalingen gaan nu naar een andere rekening.' }, 'Proofreader NL')).toThrow(/Keep every place of the English/);
    expect(() => reviews.review('nl', 'NL', 'notice.no.such.phrase', { text: 'x' }, 'Proofreader NL')).toThrow(/no notice phrase by that key/);
    const kept = reviews.review('nl', 'NL', `notice.${placed}`, { text: 'Uitbetalingen gaan voortaan naar {account}; tot {until} wordt er niets naar betaald.' }, 'Proofreader NL');
    expect(kept.text).toContain('{account}');
    // Version 1 kept as it is needs no words, so no places either.
    expect(reviews.review('nl', 'NL', REVIEW_KEY, { keep: true }, 'Proofreader NL').kept).toBe(true);
  });

  it('a country’s words are laid over version 1 for its readers only — a phrase inside a phrase too — and English is never touched', () => {
    const reviews = new WordReviewService();
    reviews.review('bg', 'BG', REVIEW_KEY, { text: 'Сметката ви за изплащания е сменена' }, 'Proofreader BG');
    const words = reviews.noticeWordsOf('bg', 'BG');
    expect(words).toEqual({ [KEY]: 'Сметката ви за изплащания е сменена' });
    expect(reviews.noticeWordsOf('bg', 'KE')).toBeUndefined();
    expect(reviews.noticeWordsOf('en', 'BG')).toBeUndefined();
    expect(reviews.noticeWordsOf('bg', undefined)).toBeUndefined();
    expect(sayIn('bg', said('bell.twoParts', { what: said(KEY), next: 'x' }), words)).toBe('Сметката ви за изплащания е сменена x');
    expect(sayIn('en', said(KEY), { [KEY]: 'nope' })).toBe(NOTICE_EN[KEY]);
    // Said again, the country's words change at once; kept as written, version 1 is back.
    reviews.review('bg', 'BG', REVIEW_KEY, { text: 'Сменена сметка за изплащания' }, 'Proofreader BG');
    expect(reviews.noticeWordsOf('bg', 'BG')?.[KEY]).toBe('Сменена сметка за изплащания');
    reviews.review('bg', 'BG', REVIEW_KEY, { keep: true }, 'Proofreader BG');
    expect(reviews.noticeWordsOf('bg', 'BG')).toBeUndefined();
    // Kept before its English gained or lost a place (a phrase rewritten since): never used — version 1 instead.
    const store = (reviews as unknown as { reviews: Map<string, unknown> }).reviews;
    store.set('NL|nl|notice.payout.bankChanged.what', { country: 'NL', locale: 'nl', key: 'notice.payout.bankChanged.what', text: 'Uitbetalingen gaan naar een andere rekening.', by: 'x', at: 'x', history: [] });
    expect(reviews.noticeWordsOf('nl', 'NL')).toBeUndefined();
  });
});

describe('the bell, the phone and the language kept', () => {
  const setUp = () => {
    const reviews = new WordReviewService();
    reviews.review('bg', 'BG', REVIEW_KEY, { text: 'Сметката ви за изплащания е сменена' }, 'Proofreader BG');
    const sender = new OutboxPushSender();
    const notices = new NotificationService(sender, undefined, undefined, reviews);
    const readers = new ReaderLanguageService(reviews);
    const controller = new NotificationsController(notices, undefined, readers);
    return { reviews, sender, notices, readers, controller };
  };
  const words = () => noticeOf(said(KEY), said('payout.bankChanged.nextPin'));

  it('the bell is read with the reader’s country’s words; another country’s reader reads version 1', async () => {
    const { notices, controller } = setUp();
    await notices.notify(driver.did!, { kind: 'security', ...words(), link: '/' });
    const titleIn = (lang: string, country?: string) => controller.inbox(driver, asked(lang, country)).items.find((n) => n.kind === 'security')!.title;
    expect(titleIn('bg', 'BG')).toBe('Сметката ви за изплащания е сменена');
    expect(titleIn('bg', 'KE')).toBe(NOTICE_TRANSLATIONS.bg[KEY]);
    expect(titleIn('bg', 'bg')).toBe('Сметката ви за изплащания е сменена');
    expect(titleIn('bg')).toBe(NOTICE_TRANSLATIONS.bg[KEY]);
    expect(titleIn('en', 'BG')).toBe(NOTICE_EN[KEY]);
  });

  it('a phone is pushed with the country’s words its app reads in', async () => {
    const { sender, notices, controller } = setUp();
    const keys = { p256dh: 'BPk_p256dh_key', auth: 'auth_secret' };
    controller.subscribe({ endpoint: 'https://push/bg', keys }, driver, asked('bg', 'BG'));
    controller.subscribe({ endpoint: 'https://push/ke', keys }, driver, asked('bg', 'KE'));
    expect(notices.subscriptionsFor(driver.did!).find((s) => s.endpoint === 'https://push/bg')?.wordsCountry).toBe('BG');
    await notices.notify(driver.did!, { kind: 'security', ...words(), link: '/' });
    const sent = sender.outboxFor(driver.did!);
    expect(sent.find((d) => d.endpoint === 'https://push/bg')!.payload.title).toBe('Сметката ви за изплащания е сменена');
    expect(sent.find((d) => d.endpoint === 'https://push/ke')!.payload.title).toBe(NOTICE_TRANSLATIONS.bg[KEY]);
  });

  it('the language a person reads their app in is kept from the bell and from turning notifications on — the person’s, never a company’s', () => {
    const { readers, controller } = setUp();
    controller.inbox(driver, asked('sw', 'KE'));
    expect(readers.of(driver.personDid)).toMatchObject({ lang: 'sw', wordsCountry: 'KE' });
    controller.inbox(driver, asked('nl', 'NL'));
    expect(readers.of(driver.personDid)).toMatchObject({ lang: 'nl', wordsCountry: 'NL' });
    // Back to English: kept too, so the emails are English again.
    controller.inbox(driver, asked('en'));
    expect(readers.of(driver.personDid)).toMatchObject({ lang: 'en' });
    // A language no notice is written in changes nothing.
    controller.inbox(driver, asked('fr'));
    expect(readers.of(driver.personDid)?.lang).toBe('en');
    // A device turning notifications on says it as well.
    controller.subscribe({ endpoint: 'https://push/am', keys: { p256dh: 'BPk_p256dh_key', auth: 'auth_secret' } }, driver, asked('am', 'ET'));
    expect(readers.of(driver.personDid)).toMatchObject({ lang: 'am', wordsCountry: 'ET' });
    // A business's member: the person, never the business they read for.
    const member = { role: 'business', did: 'did:glos:business-acme', personDid: 'did:glos:person-ben', actorName: 'Ben' } as IntrospectionResult;
    controller.inbox(member, asked('bg', 'BG'));
    expect(readers.of('did:glos:person-ben')).toMatchObject({ lang: 'bg' });
    expect(readers.of('did:glos:business-acme')).toBeUndefined();
    // Gone with the account.
    readers.forget(driver.personDid!);
    expect(readers.of(driver.personDid)).toBeUndefined();
  });

  it('an email’s phrases are all in the person’s language with their country’s words, or all in English', () => {
    const { readers } = setUp();
    readers.heard('did:glos:person-ivo', 'bg', 'BG');
    const parts = { headline: said(KEY), what: said('payout.bankChanged.nextPin'), next: said('payout.bankChanged.nextPassword') };
    const mail = readers.safetyMail('did:glos:person-ivo', parts, '2026-11-27T08:00:00.000Z');
    expect(mail.lang).toBe('bg');
    expect(mail.headline).toBe('Сметката ви за изплащания е сменена');
    expect(mail.words?.subject).toBe('SeeBuyGet: Сметката ви за изплащания е сменена');
    expect(mail.words?.whenShown).toContain('2026');
    expect(mail.words?.whenShown).not.toBe('27 Nov 2026, 08:00 UTC');
    // A phrase not written in the language: the whole email in English, its own words too.
    const english = readers.safetyMail('did:glos:person-ivo', { ...parts, next: said('no.such.phrase' as never) }, '2026-11-27T08:00:00.000Z');
    expect(english.lang).toBeUndefined();
    expect(english.words).toBeUndefined();
    expect(english.headline).toBe(NOTICE_EN[KEY]);
    // Nobody kept: English.
    expect(readers.safetyMail('did:glos:nobody', parts, '2026-11-27T08:00:00.000Z')).toEqual({ headline: NOTICE_EN[KEY], what: NOTICE_EN['payout.bankChanged.nextPin'], next: NOTICE_EN['payout.bankChanged.nextPassword'], when: '2026-11-27T08:00:00.000Z' });
  });
});
