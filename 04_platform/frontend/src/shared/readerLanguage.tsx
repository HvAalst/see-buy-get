import { LOCALE_ENDONYMS, getLocale, localesWithWords, type Locale } from './i18n';

/*
 * 2026-11-27 — THE LANGUAGE A RECEIVER READS (the owner: "continue the weak spots"). Somebody who receives a parcel or a load
 * often has no account of ours, so the server cannot know their language: the emails to them (their code, where to collect)
 * were English. Whoever names them by email now says the language they read too — the sender's own by default — and the server
 * writes those emails in it (receiverLanguage on a load or a parcel).
 */

/** The languages the server writes emails in, of those this app has words for. */
const EMAIL_LANGS: readonly Locale[] = ['en', 'sw', 'nl', 'am', 'bg'] as Locale[];

export function readerLanguages(): Locale[] {
  const here = localesWithWords();
  return EMAIL_LANGS.filter((l) => here.includes(l));
}

/** The language a receiver is written to in when the sender chose none: the sender's own, where emails are written in it. */
export function defaultReaderLanguage(): Locale {
  const l = getLocale();
  return (readerLanguages() as string[]).includes(l) ? l : ('en' as Locale);
}

/** The choices, each language named in itself. */
export function ReaderLanguageOptions() {
  return (
    <>
      {readerLanguages().map((l) => (
        <option key={l} value={l}>
          {LOCALE_ENDONYMS[l]}
        </option>
      ))}
    </>
  );
}
