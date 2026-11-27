import { MAIL_TEMPLATES, renderMail, writeMail, type MailTemplateId } from './mail.templates';
import { ENGLISH_MAIL_WORDS } from './mail.kit';
import { NOTICE_EN, NOTICE_TRANSLATIONS } from '../../modules/pudo/notice-words/catalog';
import { said } from '../../modules/pudo/notice-words/say';

/*
 * 2026-11-27 — EVERY EMAIL IN THE READER'S LANGUAGE (the owner: "fix everything except those waiting for a lawyer"). Held to
 * here: every template writes its words as phrases; written with its sample data in each language, every phrase of it is
 * there — the whole email in that language, never a raw key, a place left unfilled or an English fallback; and English is
 * what it always was (the byte-for-byte comparison of every email before and after was made when the templates were turned).
 */
const LANGS = ['sw', 'nl', 'am', 'bg'] as const;
const samples = (Object.keys(MAIL_TEMPLATES) as MailTemplateId[]).flatMap((id) => {
  const def = MAIL_TEMPLATES[id];
  return [{ id, key: 'sample', sample: def.sample }, ...(def.also ?? []).map((v) => ({ id, key: v.key, sample: v.sample }))];
});
const textOf = (doc: ReturnType<typeof writeMail>): string => JSON.stringify(doc);

describe('every email in the reader’s language', () => {
  it('every template is written in phrases', () => {
    const unphrased = (Object.keys(MAIL_TEMPLATES) as MailTemplateId[]).filter((id) => !MAIL_TEMPLATES[id].phrased);
    expect(unphrased).toEqual([]);
  });

  it('in English, every phrase is found: no raw key and no place left in any email', () => {
    for (const s of samples) {
      const doc = MAIL_TEMPLATES[s.id].build(s.sample as never, ENGLISH_MAIL_WORDS);
      const text = textOf(doc);
      expect(`${s.id}|${s.key}: ${/\bmail\.[a-z][\w-]*\.[\w.-]+/.exec(text)?.[0] ?? 'no raw key'}`).toBe(`${s.id}|${s.key}: no raw key`);
      expect(`${s.id}|${s.key}: ${/\{[a-zA-Z]+\}/.exec(text)?.[0] ?? 'no place'}`).toBe(`${s.id}|${s.key}: no place`);
    }
  });

  it.each(LANGS)('in %s, every email is written wholly in the language — its own words and the footer too', (lang) => {
    for (const s of samples) {
      const doc = writeMail(MAIL_TEMPLATES[s.id] as never, s.sample as never, { lang });
      expect(`${s.id}|${s.key}: ${doc.lang ?? 'fell back to English'}`).toBe(`${s.id}|${s.key}: ${lang}`);
      const text = textOf(doc);
      expect(`${s.id}|${s.key}: ${/\{[a-zA-Z]+\}/.exec(text)?.[0] ?? 'no place'}`).toBe(`${s.id}|${s.key}: no place`);
      expect(doc.footer?.noReply).toBeDefined();
      expect(doc.footer?.noReply).not.toBe(NOTICE_EN['mail.footer.noReply']);
    }
  });

  it('the rendered email’s footer and an app’s name are the language’s own, not the English', () => {
    const mail = renderMail('password-reset', MAIL_TEMPLATES['password-reset'].sample, undefined, { lang: 'nl' });
    expect(mail.text).not.toContain('Please do not reply');
    expect(mail.text).toContain(NOTICE_TRANSLATIONS.nl['mail.footer.noReply']!);
    expect(mail.text).toContain(NOTICE_TRANSLATIONS.nl['mail.app.agent']!);
    expect(mail.text).not.toContain('Shop app');
  });

  it('one phrase not written in the language, and the whole email is English — the html marked so', () => {
    const p = { ...MAIL_TEMPLATES['account-safety'].sample, next: said('no.such.phrase' as never) };
    const mail = renderMail('account-safety', p, undefined, { lang: 'nl' });
    expect(mail.html).toContain('<html lang="en">');
    expect(mail.text).toContain('Please do not reply — this address is not read.');
  });

  it('a language no email is written in is English, as is no language at all', () => {
    const def = MAIL_TEMPLATES['password-reset'];
    const english = writeMail(def, def.sample);
    expect(writeMail(def, def.sample, { lang: 'fr' })).toEqual(english);
    expect(writeMail(def, def.sample, { lang: 'en' })).toEqual(english);
    expect(english.lang).toBeUndefined();
  });
});
