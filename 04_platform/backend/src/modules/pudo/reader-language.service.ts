import { Injectable, Optional } from '@nestjs/common';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { formatWhen, type MailParams } from '../../foundation/mail/mail.templates';
import { at, said, sayAllIn, sayEnglish, showIn, type NoticeLang, type Said } from './notice-words/say';
import { WordReviewService } from './word-review.service';

/**
 * 2026-11-27 — THE LANGUAGE A PERSON READS IN, KEPT FOR WHAT REACHES THEM AWAY FROM THE APP (the owner: "fix as recommended":
 * the emails beside notices in the person's language).
 *
 * A notice on the bell is said in the language the app asks in, at the moment it is read. An email is written when it is sent,
 * with no app asking, so the language a person last read their app in is kept here — with the country whose review of it the
 * app reads — and an email beside a notice is written in it. Only a language a notice can be said in; English needs no record
 * of its own, and a person who never chose another is written to in English as before.
 *
 * Kept from the bell (the inbox, read on every app's first screen and again when the language changes) and from a device
 * turning notifications on. Written only when it changes. Gone with the account (account closing forgets it).
 */
export interface ReaderLanguage {
  lang: NoticeLang;
  /** The country whose review of the language the app reads its words in. */
  wordsCountry?: string;
  at: string;
}

@Injectable()
export class ReaderLanguageService {
  private readonly langs = new PersistentMap<string, ReaderLanguage>('reader-languages');

  constructor(@Optional() private readonly reviews?: WordReviewService) {}

  /** The language a person's app speaks now, and whose review of it — kept where it changed. */
  heard(did: string | undefined, lang: NoticeLang | undefined, wordsCountry?: string, now: number = Date.now()): void {
    if (!did || !lang) return;
    const country = wordsCountry && /^[A-Z]{2}$/.test(wordsCountry) ? wordsCountry : undefined;
    const before = this.langs.get(did);
    if (before && before.lang === lang && before.wordsCountry === country) return;
    this.langs.set(did, { lang, ...(country ? { wordsCountry: country } : {}), at: new Date(now).toISOString() });
  }

  /** What a person last read their app in, where it is kept. */
  of(did: string | undefined): ReaderLanguage | undefined {
    return did ? this.langs.get(did) : undefined;
  }

  /** The record of a closed account goes with it. */
  forget(did: string): void {
    this.langs.delete(did);
  }

  /**
   * THE SECURITY EMAIL TO A PERSON (account-safety): what happened, what it means and what to do, with the email's own words
   * around them — all in the language they read their app in where every phrase of it is written there, else all in English.
   */
  safetyMail(did: string | undefined, parts: { headline: Said; what: Said; next: Said }, when: string, until?: string): MailParams['account-safety'] {
    const frame = {
      subject: said('mail.safety.subject', { headline: parts.headline }),
      when: said('mail.safety.when'),
      until: said('mail.safety.until'),
      whatToDo: said('mail.safety.whatToDo'),
      help: said('mail.safety.help'),
      reason: said('mail.safety.reason'),
      noReply: said('mail.footer.noReply'),
      helpLead: said('mail.footer.helpLead'),
      helpLink: said('mail.footer.helpLink'),
    };
    const { lang, texts } = this.sayFor(did, { ...parts, ...frame });
    const base = { headline: texts.headline, what: texts.what, next: texts.next, when, ...(until ? { until } : {}) };
    if (!lang) return base;
    const shown = (iso: string) => showIn(lang, at(formatWhen(iso), iso));
    return {
      ...base,
      lang,
      words: {
        subject: texts.subject,
        when: texts.when,
        until: texts.until,
        whatToDo: texts.whatToDo,
        help: texts.help,
        reason: texts.reason,
        whenShown: shown(when),
        ...(until ? { untilShown: shown(until) } : {}),
        noReply: texts.noReply,
        helpLead: texts.helpLead,
        helpLink: texts.helpLink,
      },
    };
  }

  /**
   * Phrases for an email to a person: in the language they read their app in — with their country's own words for them —
   * where every one of them is written there; otherwise all of them in English, never half and half. `lang` is set only
   * where it is not English, so the email's own words follow it.
   */
  sayFor<K extends string>(did: string | undefined, parts: Record<K, Said>): { lang?: NoticeLang; texts: Record<K, string> } {
    const reader = this.of(did);
    if (reader && reader.lang !== 'en') {
      const texts = sayAllIn(reader.lang, parts, this.reviews?.noticeWordsOf(reader.lang, reader.wordsCountry));
      if (texts) return { lang: reader.lang, texts };
    }
    return sayEnglishFor(parts);
  }
}

/** The security email to a person, where a service may have no record of languages (hand-built in a test): then in English. */
export function safetyMailOf(
  readers: ReaderLanguageService | undefined,
  did: string | undefined,
  parts: { headline: Said; what: Said; next: Said },
  when: string,
  until?: string,
): MailParams['account-safety'] {
  if (readers) return readers.safetyMail(did, parts, when, until);
  return { ...sayEnglishFor(parts).texts, when, ...(until ? { until } : {}) };
}

/** The same, where no record is kept (a hand-built service in a test): every email in English. */
export function sayEnglishFor<K extends string>(parts: Record<K, Said>): { lang?: NoticeLang; texts: Record<K, string> } {
  const texts = {} as Record<K, string>;
  for (const k of Object.keys(parts) as K[]) texts[k] = sayEnglish(parts[k]);
  return { texts };
}
