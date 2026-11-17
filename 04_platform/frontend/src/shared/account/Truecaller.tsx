import { useEffect, useRef, useState } from 'preact/hooks';
import { publicRequest, type SbgConfig } from '../../lib/sbg';
import { getLocale, useT } from '../i18n';
import { Button } from '../ui';
import { noteTruecallerMiss, useOfferedWays, type TruecallerMiss } from './CodeWays';

/*
 * 2026-11-17 — A NUMBER CONFIRMED BY TRUECALLER, NO CODE (the owner, of the BRICS nations' own apps: "as recommended … build
 * it"). Where staff offer it for the number's country (India, Egypt, South Africa and Kenya to start) and this is an Android
 * phone's browser — the driver app too, Chrome underneath — one tap opens Truecaller's own sheet. The person agrees there;
 * the number Truecaller holds must be the one typed, and then it counts as a code typed. Truecaller not on the phone,
 * declined, another number, or nothing within two minutes: a code goes by text by itself, and the code step says why.
 */
export type TruecallerOutcome = 'confirmed' | TruecallerMiss;

/** Truecaller's own page opens only from an Android phone's browser — not an app's built-in one (`wv`), not a computer. */
export function truecallerUsable(ua: string = globalThis.navigator?.userAgent ?? ''): boolean {
  return /Android/i.test(ua) && !/;\s*wv\)/.test(ua);
}

/** Whether this number may be confirmed by Truecaller here: offered for its country, and this phone can open it. */
export function useTruecallerOffered(config: SbgConfig, phone: string): boolean {
  return useOfferedWays(config, phone).includes('truecaller') && truecallerUsable();
}

const POLL_MS = 1500;
const GIVE_UP_MS = 2 * 60_000;
/** Truecaller's own test: had its sheet opened, this page would have lost the focus by then. */
const FOCUS_CHECK_MS = 600;
const DONE: ReadonlySet<string> = new Set(['confirmed', 'rejected', 'other_number', 'failed', 'expired']);

export interface TruecallerDeps {
  open: (link: string) => void;
  focused: () => boolean;
  wait: (ms: number) => Promise<void>;
  now: () => number;
}

const inBrowser: TruecallerDeps = {
  open: (link) => {
    globalThis.location.href = link;
  },
  focused: () => (typeof document === 'undefined' ? true : document.hasFocus()),
  wait: (ms) => new Promise((done) => setTimeout(done, ms)),
  now: () => Date.now(),
};

/** One try: the server's secret request number and link, Truecaller opened, then asked until it is done. */
export async function confirmByTruecaller(config: SbgConfig, phone: string, stop: { stopped: boolean } = { stopped: false }, deps: TruecallerDeps = inBrowser): Promise<TruecallerOutcome> {
  const r = await publicRequest<{ nonce?: string; link?: string }>(config, '/v1/sbg/auth/truecaller/start', { body: { phone, lang: getLocale() } });
  if (r.error || !r.data?.nonce || !r.data.link) return 'refused';
  const { nonce, link } = r.data;
  deps.open(link);
  await deps.wait(FOCUS_CHECK_MS);
  if (stop.stopped) return 'cancelled';
  if (deps.focused()) return 'not_installed';
  const until = deps.now() + GIVE_UP_MS;
  while (deps.now() < until) {
    await deps.wait(POLL_MS);
    if (stop.stopped) return 'cancelled';
    const s = await publicRequest<{ state?: string }>(config, `/v1/sbg/auth/truecaller/${encodeURIComponent(nonce)}`, { method: 'GET' });
    const state = s.data?.state;
    if (state && DONE.has(state)) return state as TruecallerOutcome;
  }
  return 'expired';
}

/**
 * The button, beside the screen's own "Send code". `onConfirmed`: the screen goes on as after a code typed right.
 * `onFallback`: the screen sends a code by text (the code step then says why, from `noteTruecallerMiss`).
 */
export function TruecallerOffer({
  config,
  phone,
  disabled = false,
  look = 'app',
  onConfirmed,
  onFallback,
}: {
  config: SbgConfig;
  phone: string;
  disabled?: boolean;
  look?: 'app' | 'console';
  onConfirmed: () => void | Promise<void>;
  onFallback: (why: TruecallerMiss) => void | Promise<void>;
}) {
  const t = useT();
  const clean = phone.replace(/[^\d+]/g, '');
  const offered = useTruecallerOffered(config, clean);
  const [going, setGoing] = useState(false);
  const run = useRef({ stopped: false });
  useEffect(
    () => () => {
      run.current.stopped = true;
    },
    [],
  );
  if (!offered) return null;
  const note = look === 'console' ? 'chint' : 'hint';

  const go = async () => {
    const mine = { stopped: false };
    run.current = mine;
    setGoing(true);
    const outcome = await confirmByTruecaller(config, clean, mine);
    // Given up here ("by text instead"), or the screen left: that answer is nobody's any more.
    if (mine.stopped) return;
    setGoing(false);
    noteTruecallerMiss(clean, outcome);
    if (outcome === 'confirmed') await onConfirmed();
    else await onFallback(outcome);
  };
  const instead = () => {
    run.current.stopped = true;
    setGoing(false);
    noteTruecallerMiss(clean, 'cancelled');
    void onFallback('cancelled');
  };

  return (
    <div style="margin-top:12px">
      {going ? (
        <>
          <p class={note} role="status">
            {t('account.truecaller.waiting')}
          </p>
          {look === 'console' ? (
            <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={instead}>
              {t('account.truecaller.instead')}
            </button>
          ) : (
            <Button variant="link" full={false} onClick={instead}>
              {t('account.truecaller.instead')}
            </Button>
          )}
        </>
      ) : (
        <>
          {look === 'console' ? (
            <button type="button" class="cbtn cbtn--ghost" disabled={disabled} onClick={() => void go()}>
              {t('account.truecaller.button')}
            </button>
          ) : (
            <Button variant="outline" chevron={false} disabled={disabled} onClick={() => void go()}>
              {t('account.truecaller.button')}
            </Button>
          )}
          <p class={note}>{t('account.truecaller.hint')}</p>
        </>
      )}
    </div>
  );
}
