import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { QUICK_REPLIES, MESSAGE_KINDS } from './conversation.types';
import { CAR_LANGS, CAR_WORDS, asName, carLangOf, carLineOf, carWordsFor } from './car-words';

/*
 * 2026-11-02 — WHAT THE CAR READS ALOUD IS WHAT THE CHAT SHOWS (the owner: "we start with 2"; the plan: "a quick reply
 * said in the driver's own language as the chat renders it"). The server's words for the car are read here against the
 * Driver app's own catalogs, every language of them: where the two part, this fails.
 */
const CATALOGS = join(__dirname, '..', '..', '..', '..', 'frontend', 'src', 'shared', 'i18n', 'catalogs');

/** One catalog's words, read as text: `'key': 'words',` — every line of it that is one. */
function catalog(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of readFileSync(join(CATALOGS, file), 'utf8').matchAll(/^\s*'([^']+)':\s*'((?:[^'\\]|\\.)*)',?\s*$/gm)) out[m[1]] = m[2].replace(/\\'/g, "'");
  return out;
}

describe('what the car reads aloud', () => {
  const en = catalog('en.ts');

  it('read the Driver app’s English, and the words it shows in a chat', () => {
    // A guard that matched nothing proves nothing.
    expect(Object.keys(en).length).toBeGreaterThan(500);
    expect(en['common.chat.quick.on_my_way']).toBe('On my way');
  });

  it('every quick reply, and how the chat names the poster and a closed chat, are the chat’s own English', () => {
    for (const q of QUICK_REPLIES) expect([q, CAR_WORDS.en.quick[q]]).toEqual([q, en[`common.chat.quick.${q}`]]);
    expect(CAR_WORDS.en.poster).toBe(en['common.chat.poster']);
    expect(CAR_WORDS.en.closed).toBe(en['common.chat.blocked']);
    expect(CAR_WORDS.en.closedByMe).toBe(en['common.chat.blockedByMe']);
  });

  it('…and in every other language the app has: where it translates a word, the car says that translation', () => {
    const files = readdirSync(CATALOGS).filter((f) => /^[a-z]{2}\.ts$/.test(f) && f !== 'en.ts');
    expect(files.map((f) => f.slice(0, 2)).sort()).toEqual(CAR_LANGS.filter((l) => l !== 'en').sort());
    for (const file of files) {
      const lang = file.slice(0, 2);
      const theirs = catalog(file);
      expect(Object.keys(theirs).length).toBeGreaterThan(5);
      const words = carWordsFor(lang);
      for (const q of QUICK_REPLIES) expect([lang, q, words.quick[q]]).toEqual([lang, q, theirs[`common.chat.quick.${q}`] ?? en[`common.chat.quick.${q}`]]);
      expect([lang, words.poster]).toEqual([lang, theirs['common.chat.poster'] ?? en['common.chat.poster']]);
      expect([lang, words.closed]).toEqual([lang, theirs['common.chat.blocked'] ?? en['common.chat.blocked']]);
    }
  });

  it('says the words of a message; a quick reply in words; for anything else, what it is and to open the app when they stop', () => {
    const w = carWordsFor('en');
    expect(carLineOf({ kind: 'text', body: 'Gate 3, not gate 1' }, w)).toBe('Gate 3, not gate 1');
    expect(carLineOf({ kind: 'quick', quick: 'running_late' }, w)).toBe('Running late');
    expect(carLineOf({ kind: 'voice' }, w)).toBe('A voice message: open the app when you stop.');
    expect(carLineOf({ kind: 'photo' }, w)).toBe('A photo: open the app when you stop.');
    // Every kind there is has something to say — and only words and quick replies say what was written.
    for (const kind of MESSAGE_KINDS) {
      const line = carLineOf({ kind, body: 'SECRET-BODY', quick: 'paid' }, w);
      expect(line.length).toBeGreaterThan(3);
      if (kind !== 'text') expect(line).not.toContain('SECRET-BODY');
      if (kind !== 'text' && kind !== 'quick') expect(line).toMatch(/open (the app|it) when you stop/);
    }
  });

  it('a language the app does not speak is English; the poster is named with a capital, as a sender', () => {
    expect(carLangOf('xx')).toBe('en');
    expect(carLangOf(undefined)).toBe('en');
    expect(carLangOf('sw')).toBe('sw');
    expect(asName(carWordsFor('en').poster)).toBe('The poster');
  });
});
