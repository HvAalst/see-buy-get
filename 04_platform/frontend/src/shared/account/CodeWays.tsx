import { useEffect, useState } from 'preact/hooks';
import { publicRequest, type SbgConfig } from '../../lib/sbg';
import { useT } from '../i18n';
import { Button } from '../ui';

/*
 * 2026-11-16 — HOW A CODE COMES (the plan "Sign-in codes beyond Twilio SMS", D2 to D4): by text, or — where staff offer it in
 * the number's country and it is set up — by WhatsApp or Telegram, the person's own choice (never the default: Meta itself
 * advises against it, and choosing it is the person's agreement to hear from us there). A code chosen by an app that does
 * not arrive within a minute comes by text by itself; after a minute the person may also ask another way. Where no app is
 * offered, nothing here shows: the screens stay as they were.
 */
export type CodeWay = 'sms' | 'whatsapp' | 'telegram';
export type AppWay = Exclude<CodeWay, 'sms'>;

/** The server's own wait between two codes for one number: another way is offered once it has passed. */
export const ANOTHER_WAY_AFTER_S = 60;
const KEY = 'sbg.codeWay';
const APP_NAME: Record<AppWay, string> = { whatsapp: 'WhatsApp', telegram: 'Telegram' };

/** The way this phone last chose, for the choice's starting point. A convenience: lost, it starts at a text. */
export function rememberedWay(): CodeWay {
  try {
    const v = globalThis.localStorage?.getItem(KEY);
    return v === 'whatsapp' || v === 'telegram' ? v : 'sms';
  } catch {
    return 'sms';
  }
}

export function rememberWay(way: CodeWay): void {
  try {
    globalThis.localStorage?.setItem(KEY, way);
  } catch {
    /* storage unavailable: the choice starts at a text next time */
  }
}

const asked = new Map<string, Promise<AppWay[]>>();

/** The apps offered for this number's country, in the server's order. Empty until known, and when none is. */
export function useCodeWays(config: SbgConfig, phone: string): AppWay[] {
  const clean = phone.replace(/[^\d+]/g, '');
  const [ways, setWays] = useState<AppWay[]>([]);
  useEffect(() => {
    if (clean.replace(/\D/g, '').length < 9) return setWays([]);
    let live = true;
    if (!asked.has(clean)) {
      asked.set(
        clean,
        publicRequest<{ ways?: AppWay[] }>(config, `/v1/sbg/auth/phone/ways?phone=${encodeURIComponent(clean)}`, { method: 'GET' }).then((r) => (r.error ? [] : (r.data?.ways ?? []).filter((w): w is AppWay => w === 'whatsapp' || w === 'telegram'))),
      );
    }
    void asked.get(clean)!.then((w) => live && setWays(w));
    return () => {
      live = false;
    };
  }, [clean, config.baseUrl]);
  return ways;
}

/**
 * BEFORE THE FIRST CODE: how it should come. Shown only where an app is offered for the number; its starting point is the
 * way this phone chose last time.
 */
export function CodeWayChoice({ config, phone, value, onChange, look = 'app', ways: given }: { config: SbgConfig; phone: string; value: CodeWay; onChange: (way: CodeWay) => void; look?: 'app' | 'console'; /** The apps offered, where the caller knows them (a test); otherwise asked. */ ways?: AppWay[] }) {
  const t = useT();
  const asked = useCodeWays(config, given ? '' : phone);
  const ways = given ?? asked;
  if (!ways.length) return null;
  const current: CodeWay = value !== 'sms' && !ways.includes(value) ? 'sms' : value;
  return (
    <fieldset class={look === 'console' ? 'cfield' : 'field'} style="margin-top:12px;border:0;padding:0">
      <legend class={look === 'console' ? 'cfield__label' : 'field__label'}>{t('account.ways.how')}</legend>
      {(['sms', ...ways] as CodeWay[]).map((way) => (
        <label key={way} class="checkline" style="margin-top:6px">
          <input type="radio" name="code-way" checked={current === way} onChange={() => onChange(way)} />
          <span>{way === 'sms' ? t('account.ways.sms') : APP_NAME[way]}</span>
        </label>
      ))}
      {current !== 'sms' ? <p class={look === 'console' ? 'chint' : 'hint'}>{t('account.ways.appHint', { app: APP_NAME[current] })}</p> : null}
    </fieldset>
  );
}

/**
 * AFTER A CODE WAS SENT: by an app, said so; and after a minute, the other ways — the offered apps not used yet, and a text.
 * Nothing where no app is offered and the code went by text: the screen's own "new code" stays the way to ask again.
 */
export function OtherWays({ config, phone, sentAt, sentVia, busy = false, onSend, look = 'app', ways: given }: { config: SbgConfig; phone: string; sentAt: number; sentVia: CodeWay; busy?: boolean; onSend: (way: CodeWay) => void; look?: 'app' | 'console'; /** The apps offered, where the caller knows them (a test); otherwise asked. */ ways?: AppWay[] }) {
  const t = useT();
  const asked = useCodeWays(config, given ? '' : phone);
  const ways = given ?? asked;
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  if (!ways.length && sentVia === 'sms') return null;
  const left = Math.max(0, Math.ceil((sentAt + ANOTHER_WAY_AFTER_S * 1000 - now) / 1000));
  const others: CodeWay[] = [...ways.filter((w) => w !== sentVia), 'sms'];
  const note = look === 'console' ? 'chint' : 'hint';
  const label = (way: CodeWay) => (way === 'sms' ? t(sentVia === 'sms' ? 'account.ways.byTextAgain' : 'account.ways.byTextInstead') : t('account.ways.byApp', { app: APP_NAME[way] }));
  return (
    <div style="margin-top:12px">
      {sentVia !== 'sms' ? <p class={note}>{t('account.ways.sentBy', { app: APP_NAME[sentVia] })}</p> : null}
      <p class={note}>{left > 0 ? t('account.ways.wait', { s: left }) : t('account.ways.ready')}</p>
      <div>
        {others.map((way) =>
          look === 'console' ? (
            <button key={way} type="button" class="cbtn cbtn--ghost cbtn--sm" style="margin-right:6px" disabled={busy || left > 0} onClick={() => onSend(way)}>
              {label(way)}
            </button>
          ) : (
            <Button key={way} variant="link" full={false} disabled={busy || left > 0} onClick={() => onSend(way)}>
              {label(way)}
            </Button>
          ),
        )}
      </div>
      <p class={note}>{t('account.ways.never')}</p>
    </div>
  );
}
