import type { MessageView, QuickReply } from './conversation.types';

/**
 * WHAT THE CAR READS ALOUD (05_engineering/android-auto-messages.md; the owner, 2026-11-02: "we start with 2").
 *
 * A message from the other side of a driver's chat, as the chat shows it: its words; a quick reply ("On my way") in the
 * DRIVER's language, as the Driver app renders it — the chat stores a quick reply as a key, and each reader's app says it
 * in its own language; for anything that is not words — a voice message, a photo, a price, a settlement — a sentence that
 * says what it is and to open the app when they have stopped. Never a voice message's audio: a decision, or something to
 * look at, does not belong at the wheel.
 *
 * THE WORDS MIRROR THE DRIVER APP'S OWN (frontend/src/shared/i18n/catalogs/*.ts, `common.chat.*`). car-words.spec.ts reads
 * those catalogs and fails when the two part, so "as the chat renders it" stays true. A language the app does not yet
 * translate these words into falls back to English, as the app does.
 */
export interface CarWords {
  /** How the chat names the poster to a driver (`common.chat.poster`): "the poster". Said with a capital as a sender. */
  poster: string;
  /** `common.chat.quick.*`. */
  quick: Record<QuickReply, string>;
  /** `common.chat.blocked` / `common.chat.blockedByMe`: why a reply cannot go. */
  closed: string;
  closedByMe: string;
  /** What is not words, said for the car. These are the car's own sentences: the app shows a card instead. */
  voice: string;
  photo: string;
  price: string;
  settlement: string;
  report: string;
  other: string;
}

export const CAR_WORDS: Record<'en', CarWords> & Partial<Record<string, Partial<CarWords>>> = {
  en: {
    poster: 'the poster',
    quick: {
      on_my_way: 'On my way',
      loaded: 'Loaded',
      arrived: 'Arrived',
      delivered: 'Delivered',
      paid: 'Paid',
      running_late: 'Running late',
      coming_today: 'Coming today',
      coming_tomorrow: 'Coming tomorrow',
      cannot_make_it: 'I cannot make it yet',
      still_here: 'Your parcel is still here',
      closing_soon: 'We close soon',
    },
    closed: 'This conversation is closed.',
    closedByMe: 'You blocked this conversation.',
    voice: 'A voice message: open the app when you stop.',
    photo: 'A photo: open the app when you stop.',
    price: 'An answer about a price: open the app when you stop.',
    settlement: 'A way to settle was written down: open the app when you stop.',
    report: 'A report of this conversation was shared with the network: open the app when you stop.',
    other: 'Something to see in the app: open it when you stop.',
  },
};

/** The app's languages (frontend/src/shared/i18n/locales.ts). A language outside them is kept as English. */
export const CAR_LANGS = ['en', 'sw', 'am', 'fr', 'ar'] as const;
export const carLangOf = (lang: unknown): string => (typeof lang === 'string' && (CAR_LANGS as readonly string[]).includes(lang) ? lang : 'en');

/** The words in this language, each one falling back to English where it is not translated — as the app's catalogs do. */
export function carWordsFor(lang: string): CarWords {
  const en = CAR_WORDS.en;
  const own = CAR_WORDS[lang];
  if (!own || lang === 'en') return en;
  return { ...en, ...own, quick: { ...en.quick, ...(own.quick ?? {}) } };
}

/** "The poster" — a name in the chat's own words, said as a sender's. */
export const asName = (words: string): string => (words ? words.charAt(0).toUpperCase() + words.slice(1) : words);

/** What the car says for one message. */
export function carLineOf(m: Pick<MessageView, 'kind' | 'body' | 'quick'>, words: CarWords): string {
  switch (m.kind) {
    case 'text':
      return m.body ?? '';
    case 'quick':
      return (m.quick && words.quick[m.quick]) || words.other;
    case 'voice':
      return words.voice;
    case 'photo':
      return words.photo;
    case 'proposal':
    case 'decision':
      return words.price;
    case 'settlement':
    case 'settlement_agreed':
      return words.settlement;
    case 'report_shared':
      return words.report;
    default:
      return words.other;
  }
}
