import { Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { MailService } from '../../foundation/mail/mail.service';
import type { MailAddress } from '../../foundation/mail/mail.types';
import { noticeLangOf, type NoticeLang } from './notice-words/say';
import { WordReviewService } from './word-review.service';
import { PersonService } from './person.service';
import { AccountService } from './account.service';
import type { IntrospectionResult } from '../../foundation/auth/auth.types';
import { STAFF_KEY_PREFIX } from '../../foundation/auth/setup-key';
import { OperatorAccountService } from '../../foundation/entity/operator-account.service';

/**
 * 2026-11-27 — THE LANGUAGE A PERSON READS IN, KEPT FOR WHAT REACHES THEM AWAY FROM THE APP (the owner: "fix as recommended",
 * then "fix everything except those waiting for a lawyer").
 *
 * A notice on the bell is said in the language the app asks in, at the moment it is read. An email is written when it is sent,
 * with no app asking, so the language a person last read their app in is kept here — with the country whose review of it the
 * app reads — and their emails are written in it (MailService asks by address, or a caller says whose address it is). Only a
 * language a notice can be said in; a person who never chose another is written to in English as before.
 *
 * Kept from every call a signed-in person's app makes (ReaderLanguageInterceptor): the language is on each of them. Written
 * only when it changes. Gone with the account (account closing forgets it).
 */
export interface ReaderLanguage {
  lang: NoticeLang;
  /** The country whose review of the language the app reads its words in. */
  wordsCountry?: string;
  at: string;
}

/** 2026-11-26 — the language an app speaks, on every call it makes (frontend/src/lib/sbg/client.ts). */
export const LANG_HEADER = 'x-sbg-lang';
/** 2026-11-27 — the country whose review of that language it reads its words in. */
export const WORDS_COUNTRY_HEADER = 'x-sbg-words-country';

/** What a call says of itself: its headers. */
export type AskedIn = { headers?: Record<string, string | string[] | undefined> };

/** The language a call asks in, where notices are written in it. */
export function langOf(req: AskedIn | undefined): NoticeLang | undefined {
  return noticeLangOf(req?.headers?.[LANG_HEADER]);
}

/** The country whose review of its language the app reads its words in: two capital letters, or nothing. */
export function wordsCountryOf(req: AskedIn | undefined): string | undefined {
  const raw = req?.headers?.[WORDS_COUNTRY_HEADER];
  const code = String((Array.isArray(raw) ? raw[0] : raw) ?? '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : undefined;
}

/** 2026-11-27 — the language of the screen that asked for something by email (a code): the app's, and whose review of it. */
export interface ScreenLanguage {
  lang?: NoticeLang;
  wordsCountry?: string;
}

/** What a call says of the screen it comes from. */
export function screenOf(req: AskedIn | undefined): ScreenLanguage {
  return { lang: langOf(req), wordsCountry: wordsCountryOf(req) };
}

/** The address's language from a screen that said one; nothing where it said none (the address is then looked up). */
export function screenLanguage(screen: ScreenLanguage | undefined): Pick<MailAddress, 'lang' | 'wordsCountry'> {
  return screen?.lang ? { lang: screen.lang, ...(screen.wordsCountry ? { wordsCountry: screen.wordsCountry } : {}) } : {};
}

/**
 * The person behind a sign-in, whose language it is: a business's or a partner's member, not the company; a member of our staff
 * by their own staff sign-in (2026-11-27: their emails too) — never the shared operator key or the setup key, which name nobody.
 */
export function personOf(actor: IntrospectionResult | undefined): string | undefined {
  if (actor?.role === 'operator') return actor.revocationKey?.startsWith(STAFF_KEY_PREFIX) ? actor.revocationKey : undefined;
  return actor?.personDid ?? (actor?.role === 'business' || actor?.role === 'partner' ? undefined : actor?.did);
}

@Injectable()
export class ReaderLanguageService implements OnModuleInit {
  private readonly langs = new PersistentMap<string, ReaderLanguage>('reader-languages');

  constructor(
    @Optional() private readonly reviews?: WordReviewService,
    @Optional() private readonly mail?: MailService,
    @Optional() private readonly persons?: PersonService,
    @Optional() private readonly accounts?: AccountService,
    @Optional() private readonly staff?: OperatorAccountService,
  ) {}

  /** The mail is told who reads an address: every email is written in its reader's language (MailService.readerOf). */
  onModuleInit(): void {
    this.mail?.useReaders({ languageOf: (address) => this.ofAddress(address), wordsOf: (lang, country) => this.reviews?.noticeWordsOf(lang, country) });
  }

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
   * Who reads an address, by the account it is the email of: a person's recovery email, else the account a shop, a hub or a
   * store signs in with. Nothing kept: nothing (the email is English).
   */
  ofAddress(address: string): ReaderLanguage | undefined {
    const person = safely(() => this.persons?.findByEmail(address));
    const kept = person ? this.of(person.personDid) : undefined;
    if (kept) return kept;
    for (const did of safely(() => this.accounts?.didsOfEmail(address)) ?? []) {
      const theirs = this.of(did);
      if (theirs) return theirs;
    }
    // A member of our staff, by their staff sign-in.
    return this.of(safely(() => this.staff?.staffKeyOfEmail(address)));
  }

  /**
   * An email's address as its reader's: with the language that person reads their app in, where it is kept — for an address
   * the caller knows is theirs but that may no longer be found as theirs (the recovery email they just replaced).
   */
  addressee(did: string | undefined, address: string): MailAddress {
    const reader = this.of(did);
    // Said even where it is English: the address may be another account's too, and this email is this person's.
    return reader ? { address, lang: reader.lang, ...(reader.wordsCountry ? { wordsCountry: reader.wordsCountry } : {}) } : { address };
  }
}

/** The same, where a service may have no record of languages (hand-built in a test): then the address as it is. */
export function addresseeOf(readers: ReaderLanguageService | undefined, did: string | undefined, address: string): MailAddress {
  return readers ? readers.addressee(did, address) : { address };
}

function safely<T>(f: () => T): T | undefined {
  try {
    return f();
  } catch {
    return undefined;
  }
}
