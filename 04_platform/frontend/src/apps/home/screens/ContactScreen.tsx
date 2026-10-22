import { useEffect, useMemo, useState } from 'preact/hooks';
import { Button, ErrorNote, Icon, Note } from '../../../shared/ui';
import { useLocale, useT, type MessageKey } from '../../../shared/i18n';
import { articles, type GuideArticle } from '../../../shared/guide/articles';
import type { SbgError } from '../../../lib/sbg';
import { writeToUs, type SupportCategory } from '../api';
import { HELP_PATH, articlePath } from '../help';

/** What a message can be about, in the reader's words — and the help that most often answers it, offered first. */
export const TOPICS: ReadonlyArray<{ category: SupportCategory; label: MessageKey; answers: string[] }> = [
  { category: 'sign-in', label: 'help.contact.topic.sign-in', answers: ['which-sign-in', 'account-recovery', 'change-pin', 'change-password'] },
  { category: 'parcel', label: 'help.contact.topic.parcel', answers: ['send-sign-in', 'follow-shop-order', 'freight-tracking', 'no-signal'] },
  { category: 'damage', label: 'help.contact.topic.damage', answers: ['parcel-problem', 'tampering'] },
  { category: 'money', label: 'help.contact.topic.money', answers: ['who-you-contract-with', 'quotations'] },
  { category: 'joining', label: 'help.contact.topic.joining', answers: ['shop-papers', 'hub-papers', 'driver-fleet', 'new-partner-limit'] },
  { category: 'business', label: 'help.contact.topic.business', answers: ['business-sign-in', 'business-loads', 'api-keys', 'business-check'] },
  { category: 'safety', label: 'help.contact.topic.safety', answers: ['tampering', 'held-on-the-road', 'account-recovery'] },
  { category: 'privacy', label: 'help.contact.topic.privacy', answers: ['account-recovery'] },
  { category: 'other', label: 'help.contact.topic.other', answers: [] },
];

/** The apps a message may say it came from (?from=driver, from that app's Help). */
const FROM = ['home', 'send', 'agent', 'driver', 'mdp', 'vendor', 'fleet', 'business'];
const MAX = 2000;

/**
 * WRITE TO US — /help/contact/ (the user, 2026-10-22: "direct message field that is sorted by category by the system for
 * sbg staff. User selects what type of issue they have ... They will have to leave their email").
 *
 * What it is about first, as the person would say it; then the help that most often answers that, before any form —
 * the quickest answer is one already written; then the address to answer and the words. Thanked with a reference.
 * Nobody signs in to write: the person who most needs to is often the one who cannot get in.
 */
export function ContactScreen() {
  const t = useT();
  const locale = useLocale();
  const all = useMemo(() => articles(t), [t, locale]);
  const [topic, setTopic] = useState<SupportCategory | null>(null);
  const [about, setAbout] = useState<string | undefined>(undefined);
  const [from, setFrom] = useState<string | undefined>(undefined);
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [website, setWebsite] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SbgError | null>(null);
  const [done, setDone] = useState<{ reference: string; email: string } | null>(null);

  // Where it was written from — the article (?about=) and the app (?from=) — read after the first frame, which is the
  // page as it was built. An article that is the help for one topic chooses that topic.
  useEffect(() => {
    const q = new URLSearchParams(globalThis.location?.search ?? '');
    const a = q.get('about') ?? undefined;
    if (a && /^[a-z0-9-]+$/.test(a) && all.some((x) => x.id === a)) {
      setAbout(a);
      const match = TOPICS.find((x) => x.answers.includes(a));
      if (match) setTopic(match.category);
    }
    const f = q.get('from');
    if (f && FROM.includes(f)) setFrom(f);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (done) {
    return (
      <div class="scr help">
        <h1 class="scr__title">{t('help.contact.doneTitle')}</h1>
        <p class="scr__lede">{t('help.contact.doneBody', { email: done.email })}</p>
        <div class="help__ref">
          <span class="help__refk">{t('help.contact.reference')}</span>
          <span class="help__refv">{done.reference}</span>
        </div>
        <Note tone="info" icon="lock" title={t('help.contact.never')} />
        <a class="land__link" href={HELP_PATH}>
          {t('help.contact.backToHelp')}
          <Icon name="chevronRight" size={18} />
        </a>
      </div>
    );
  }

  const chosen = TOPICS.find((x) => x.category === topic) ?? null;
  const offered = (chosen?.answers ?? []).map((id) => all.find((a) => a.id === id)).filter((a): a is GuideArticle => Boolean(a)).slice(0, 3);
  const words = message.trim();
  const plausible = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const ready = Boolean(chosen) && plausible && words.length >= 10 && words.length <= MAX;

  const send = async () => {
    if (!chosen || !ready) return;
    setBusy(true);
    setError(null);
    const r = await writeToUs({ category: chosen.category, email: email.trim(), message: words, ...(about ? { about } : {}), from: from ?? 'home', locale, ...(website ? { website } : {}) });
    setBusy(false);
    if (r.error || !r.data) return setError(r.error);
    setDone({ reference: r.data.reference, email: email.trim() });
  };

  return (
    <div class="scr help">
      <nav class="help__crumbs" aria-label={t('help.ui.crumbsLabel')}>
        <a href={HELP_PATH}>{t('help.ui.title')}</a>
        <Icon name="chevronRight" size={16} />
        <span aria-current="page">{t('help.contact.title')}</span>
      </nav>
      <h1 class="scr__title">{t('help.contact.title')}</h1>
      <p class="scr__lede">{t('help.contact.lede')}</p>

      {!chosen ? (
        <section class="help__sec">
          <h2 class="help__h2">{t('help.contact.topicsLabel')}</h2>
          <ul class="rows help__rows">
            {TOPICS.map((x) => (
              <li key={x.category}>
                <button type="button" class="row" onClick={() => setTopic(x.category)}>
                  <span class="row__body">
                    <span class="row__t">{t(x.label)}</span>
                  </span>
                  <span class="row__end">
                    <Icon name="chevronRight" size={20} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <>
          <div class="help__chosen">
            <span class="help__chosenk">{t('help.contact.topicsLabel')}</span>
            <span class="help__chosenv">{t(chosen.label)}</span>
            <button type="button" class="btn btn--link" onClick={() => setTopic(null)}>
              {t('help.contact.change')}
            </button>
          </div>

          {chosen.category === 'safety' ? <Note tone="warn" icon="warning" title={t('help.contact.safetyNote')} /> : null}

          {offered.length ? (
            <section class="help__sec">
              <h2 class="help__h2">{t('help.contact.mayAnswer')}</h2>
              <ul class="rows help__rows">
                {offered.map((a) => (
                  <li key={a.id}>
                    <a class="row" href={articlePath(a.id)}>
                      <span class="row__body">
                        <span class="row__t">{a.title}</span>
                        <span class="row__s">{a.summary}</span>
                      </span>
                      <span class="row__end">
                        <Icon name="chevronRight" size={20} />
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <form
            class="help__form"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            {error ? <ErrorNote error={error} /> : null}
            <div class="field">
              <label class="field__label" for="contact-email">
                {t('help.contact.email')}
              </label>
              <input id="contact-email" class="input" type="email" inputMode="email" autocomplete="email" autocapitalize="none" spellcheck={false} value={email} disabled={busy} onInput={(e) => setEmail(e.currentTarget.value)} />
              <p class="hint">{t('help.contact.emailHint')}</p>
            </div>
            <div class="field">
              <label class="field__label" for="contact-message">
                {t('help.contact.message')}
              </label>
              <textarea id="contact-message" class="input help__text" rows={6} maxLength={MAX} value={message} disabled={busy} onInput={(e) => setMessage(e.currentTarget.value)} />
              <p class="hint">
                {t('help.contact.messageHint')} {t('help.contact.count', { n: words.length, max: MAX })}
              </p>
            </div>
            {/* Never seen by a person; a form-filling machine fills it, and what it sends is dropped. */}
            <div class="sr-only" aria-hidden="true">
              <label for="contact-website">{t('help.contact.honeypot')}</label>
              <input id="contact-website" name="website" tabIndex={-1} autocomplete="off" value={website} onInput={(e) => setWebsite(e.currentTarget.value)} />
            </div>
            <Button type="submit" chevron={false} busy={busy} disabled={busy || !ready}>
              {t('help.contact.send')}
            </Button>
            <p class="hint">{t('help.contact.never')}</p>
          </form>
        </>
      )}
    </div>
  );
}
