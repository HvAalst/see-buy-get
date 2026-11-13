import { useState } from 'preact/hooks';
import { publicRequest, type SbgConfig, type SbgError } from '../../lib/sbg';
import { formatDate, useLocale, useT } from '../i18n';
import { Button } from '../ui/Button';
import { ErrorNote, Note } from '../ui/ErrorNote';
import { Sheet } from '../ui/Sheet';
import { countryNameIn } from '../documents/documents';

/** What the asker would be in the network — the kinds the server counts requests by (interest.service.ts). */
export type AskKind = 'shop' | 'hub' | 'store' | 'carrier' | 'other';

const KEY = 'sbg-asked-open:';
/** When this phone last asked for the country, if it did: a reminder for this viewer only (the server keeps the request). */
function askedOn(country: string): string | null {
  try {
    return globalThis.localStorage?.getItem(KEY + country) ?? null;
  } catch {
    return null;
  }
}
function rememberAsked(country: string, at: string): void {
  try {
    globalThis.localStorage?.setItem(KEY + country, at);
  } catch {
    /* a private tab keeps nothing: the request still went */
  }
}

/** The request as the server keeps it: one message, the business and the reason under their own headings, for staff. */
export function askMessage(business: string, why: string): string {
  return `Business: ${business.trim()}\n\nWhy SeeBuyGet is needed there: ${why.trim()}`.slice(0, 600);
}

/**
 * 2026-11-04 — "ASK SEEBUYGET TO OPEN IN THE NETHERLANDS" (the owner: "anytime that message is shown the user should be able to
 * request SBG to open in their country like early sign ups can do, explain their type of business and why SBG would be
 * needed there with an auto response email"). Beside every "not open here yet" notice: the business, the reason, the email —
 * sent to the requests staff weigh country by country (POST countries/:code/interest), and answered at once by email
 * ("interest-received"); the day the country takes sign-ups or opens, everybody who asked is written to again.
 */
/** 2026-11-13 — what a person waiting on a country being tested says, for the staff reading the list: no business to describe. */
export const WAITING_MESSAGE = 'Waiting while SeeBuyGet is being tested here: tell me the day it opens to everyone.';

export function AskToOpen({ country, kind, email = '', config, waiting = false }: { country: string | undefined; kind: AskKind; email?: string; config: SbgConfig; /** 2026-11-13 — test mode: only an email, to be told the day it opens to everyone. */ waiting?: boolean }) {
  const t = useT();
  const locale = useLocale();
  const code = (country ?? '').trim().toUpperCase();
  const [open, setOpen] = useState(false);
  const [asked, setAsked] = useState<string | null>(() => (code ? askedOn(code) : null));
  const [form, setForm] = useState({ email, business: '', why: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SbgError | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  if (!/^[A-Z]{2}$/.test(code)) return null;
  const name = countryNameIn(code, locale);
  const ready = form.email.includes('@') && (waiting || (form.business.trim().length >= 3 && form.why.trim().length >= 10));

  const send = async () => {
    setBusy(true);
    setError(null);
    const r = await publicRequest<{ noteId: string }>(config, `/v1/sbg/countries/${encodeURIComponent(code)}/interest`, {
      body: { kind, email: form.email.trim(), message: waiting ? WAITING_MESSAGE : askMessage(form.business, form.why) },
    });
    setBusy(false);
    if (r.error) return setError(r.error);
    const at = new Date().toISOString();
    rememberAsked(code, at);
    setAsked(at);
    setSentTo(form.email.trim());
  };

  return (
    <>
      {asked ? (
        <p class="hint">
          {t('opening.ask.asked', { country: name, day: formatDate(asked) })}{' '}
          <button type="button" class="linkbtn" onClick={() => setOpen(true)}>
            {t('opening.ask.change')}
          </button>
        </p>
      ) : (
        <Button variant="outline" chevron={false} onClick={() => setOpen(true)}>
          {t(waiting ? 'opening.wait.button' : 'opening.ask.button', { country: name })}
        </Button>
      )}
      <Sheet open={open} onClose={() => { setOpen(false); setSentTo(null); }} title={t(waiting ? 'opening.wait.title' : 'opening.ask.title', { country: name })}>
        {sentTo ? (
          <>
            <Note tone="ok" icon="check" title={t('opening.ask.sent', { email: sentTo })} detail={t('opening.ask.sentDetail', { country: name })} />
            <Button chevron={false} onClick={() => { setOpen(false); setSentTo(null); }}>
              {t('common.close')}
            </Button>
          </>
        ) : (
          <>
            <p class="t-body">{t(waiting ? 'opening.wait.lede' : 'opening.ask.lede', { country: name })}</p>
            {waiting ? null : (
            <>
            <div class="field">
              <label class="field__label" for="ask-business">
                {t('opening.ask.business')}
              </label>
              <input id="ask-business" class="input" maxLength={160} placeholder={t('opening.ask.businessPh')} value={form.business} onInput={(e) => setForm({ ...form, business: e.currentTarget.value })} />
            </div>
            <div class="field">
              <label class="field__label" for="ask-why">
                {t('opening.ask.why', { country: name })}
              </label>
              <textarea id="ask-why" class="input" rows={4} maxLength={420} placeholder={t('opening.ask.whyPh')} value={form.why} onInput={(e) => setForm({ ...form, why: e.currentTarget.value })} />
            </div>
            </>
            )}
            <div class="field">
              <label class="field__label" for="ask-email">
                {t('opening.ask.email')}
              </label>
              <input id="ask-email" class="input" type="email" inputMode="email" autoComplete="email" value={form.email} onInput={(e) => setForm({ ...form, email: e.currentTarget.value })} />
            </div>
            {error ? <ErrorNote error={error} /> : null}
            <Button chevron={false} busy={busy} disabled={!ready} onClick={() => void send()}>
              {t('opening.ask.send')}
            </Button>
          </>
        )}
      </Sheet>
    </>
  );
}
