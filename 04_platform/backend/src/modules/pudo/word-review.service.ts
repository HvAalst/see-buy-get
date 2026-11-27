import { Injectable } from '@nestjs/common';
import { GlosError } from '../../foundation/http/glos-error';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { NOTICE_EN, NOTICE_TRANSLATIONS } from './notice-words/catalog';
import { placesOf, type NoticeWords } from './notice-words/say';

/**
 * 2026-11-03 — A COUNTRY'S OWN REVIEW OF A LANGUAGE (the owner: "write the translation in and write a separate review sheet
 * that lives in 'languages' where a review can be edited as version 2. the first version is not lost. languages are reviewed
 * per country sbg company").
 *
 * Version 1 is the translation written into the apps (frontend shared/i18n/words). Version 2 is kept here: for one country,
 * one language and one phrase, what that country's SeeBuyGet company says instead — or that version 1 stands as written
 * ("kept"). Every change is kept in the phrase's history, so no wording is ever lost, the first included; the apps lay a
 * country's version 2 over version 1 for the people there.
 */
export const REVIEW_LOCALES = ['sw', 'am', 'nl', 'bg', 'fr', 'ar'] as const;
export type ReviewLocale = (typeof REVIEW_LOCALES)[number];

export interface WordReviewStep {
  /** Version 2's words, or nothing where version 1 was kept as written. */
  text?: string;
  kept?: boolean;
  by: string;
  at: string;
}

export interface WordReview {
  country: string;
  locale: ReviewLocale;
  key: string;
  /** What the country says now: its own words, or that version 1 stands. */
  text?: string;
  kept?: boolean;
  by: string;
  at: string;
  /** Every step, oldest first. */
  history: WordReviewStep[];
}

const KEY = /^[A-Za-z0-9._-]{1,160}$/;
const MAX_TEXT = 4000;

/**
 * 2026-11-27 — THE NOTICES ARE REVIEWED TOO (the owner: "fix as recommended"). A notice is said by this server, not by an app
 * (notice-words/), so its phrases are kept apart from the apps' words: under this prefix, followed by the phrase's own key.
 * The apps are never given them; the server lays a country's words over version 1 when it tells that country's readers.
 */
export const NOTICE_REVIEW_PREFIX = 'notice.';
const isNoticeKey = (key: string): boolean => key.startsWith(NOTICE_REVIEW_PREFIX);

/** The notice phrases as the review sheet shows them: English and version 1, each under its review key. */
export interface NoticeBook {
  locale: string;
  english: Record<string, string>;
  words: Record<string, string>;
}

@Injectable()
export class WordReviewService {
  private readonly reviews = new PersistentMap<string, WordReview>('word-reviews');
  /** A country's own words for the notice phrases of a language, worked out once and forgotten on the next review. */
  private readonly noticeWordsCache = new Map<string, NoticeWords>();

  private static idOf(country: string, locale: string, key: string): string {
    return `${country}|${locale}|${key}`;
  }

  /** Every notice phrase, its English and version 1 in a language — for the review sheet. */
  static noticeBook(locale: string): NoticeBook {
    if (!(REVIEW_LOCALES as readonly string[]).includes(locale)) throw new GlosError('INVALID_INPUT', `Reviews are kept for ${REVIEW_LOCALES.join(', ')}; English is the language written first`);
    const theirs = (NOTICE_TRANSLATIONS as Partial<Record<string, Record<string, string>>>)[locale] ?? {};
    const english: Record<string, string> = {};
    const words: Record<string, string> = {};
    for (const [key, text] of Object.entries(NOTICE_EN)) {
      english[NOTICE_REVIEW_PREFIX + key] = text;
      if (typeof theirs[key] === 'string') words[NOTICE_REVIEW_PREFIX + key] = theirs[key];
    }
    return { locale, english, words };
  }

  /**
   * A country's own words for the notice phrases of a language, as the server says a notice to its readers: only phrases it
   * said in its own words whose places are the English's — never a gap or a raw place on a lock screen. Nothing for English,
   * for a language or country nobody reviews, or where the country has said nothing.
   */
  noticeWordsOf(locale: string | undefined, country: string | undefined): NoticeWords | undefined {
    if (!locale || locale === 'en' || !country || !(REVIEW_LOCALES as readonly string[]).includes(locale) || !/^[A-Z]{2}$/.test(country)) return undefined;
    const id = `${country}|${locale}`;
    const cached = this.noticeWordsCache.get(id);
    if (cached) return Object.keys(cached).length ? cached : undefined;
    const out: Record<string, string> = {};
    for (const r of this.reviews.values()) {
      if (r.country !== country || r.locale !== locale || !r.text || !isNoticeKey(r.key)) continue;
      const key = r.key.slice(NOTICE_REVIEW_PREFIX.length);
      const english = (NOTICE_EN as Record<string, string>)[key];
      if (typeof english === 'string' && placesOf(english) === placesOf(r.text)) out[key] = r.text;
    }
    this.noticeWordsCache.set(id, out);
    return Object.keys(out).length ? (out as NoticeWords) : undefined;
  }

  /** The country and language, said right — or refused in words. */
  static checked(locale: string, country: string): { locale: ReviewLocale; country: string } {
    if (!(REVIEW_LOCALES as readonly string[]).includes(locale)) throw new GlosError('INVALID_INPUT', `Reviews are kept for ${REVIEW_LOCALES.join(', ')}; English is the language written first`);
    const cc = String(country ?? '').trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(cc)) throw new GlosError('INVALID_INPUT', 'Name the country by its two letters, like KE');
    return { locale: locale as ReviewLocale, country: cc };
  }

  /** A country's version 2 of a language, as the apps lay it over version 1: only the phrases it said in its own words. */
  wordsOf(locale: string, country: string): Record<string, string> {
    const c = WordReviewService.checked(locale, country);
    const out: Record<string, string> = {};
    // The notices' phrases are the server's to say, never given to the apps (2026-11-27).
    for (const r of this.reviews.values()) if (r.country === c.country && r.locale === c.locale && r.text && !isNoticeKey(r.key)) out[r.key] = r.text;
    return out;
  }

  /** Every phrase the country has reviewed in the language, with its history — for the review sheet. */
  list(locale: string, country: string): WordReview[] {
    const c = WordReviewService.checked(locale, country);
    return [...this.reviews.values()].filter((r) => r.country === c.country && r.locale === c.locale).sort((a, b) => a.key.localeCompare(b.key));
  }

  /**
   * Say a phrase in the country's own words (`text`), or keep version 1 as written (`keep`). Saying what is already said is
   * not a step. Whatever was said before stays in the history.
   */
  review(locale: string, country: string, key: string, change: { text?: string; keep?: boolean }, by: string, now: number = Date.now()): WordReview {
    const c = WordReviewService.checked(locale, country);
    if (!KEY.test(key)) throw new GlosError('INVALID_INPUT', 'Name the phrase by its key, as the review sheet shows it');
    const text = change.keep ? undefined : String(change.text ?? '').trim();
    if (!change.keep && !text) throw new GlosError('FIELD_REQUIRED', 'Write the words, or keep version 1 as it is', { field: 'text' });
    if (text && text.length > MAX_TEXT) throw new GlosError('INVALID_INPUT', `A phrase is at most ${MAX_TEXT} characters`);
    // 2026-11-27 — a notice's phrase is checked here, where its English is: it must be one, and keep every place of it — a
    // notice with a place lost would reach a lock screen with a gap in it.
    if (isNoticeKey(key)) {
      const english = (NOTICE_EN as Record<string, string>)[key.slice(NOTICE_REVIEW_PREFIX.length)];
      if (typeof english !== 'string') throw new GlosError('NOT_FOUND', 'There is no notice phrase by that key');
      if (text && placesOf(text) !== placesOf(english)) {
        throw new GlosError('INVALID_INPUT', `Keep every place of the English, as it is written there: ${placesOf(english) || 'it has none'}`, { field: 'text' });
      }
    }
    const id = WordReviewService.idOf(c.country, c.locale, key);
    const before = this.reviews.get(id);
    if (before && (change.keep ? before.kept : before.text === text)) return before;
    const at = new Date(now).toISOString();
    const step: WordReviewStep = change.keep ? { kept: true, by, at } : { text, by, at };
    const next: WordReview = { country: c.country, locale: c.locale, key, ...(change.keep ? { kept: true } : { text }), by, at, history: [...(before?.history ?? []), step] };
    this.reviews.set(id, next);
    if (isNoticeKey(key)) this.noticeWordsCache.delete(`${c.country}|${c.locale}`);
    return next;
  }
}
