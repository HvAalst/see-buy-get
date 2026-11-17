import { useEffect, useState } from 'preact/hooks';
import { publicRequest, type SbgConfig } from '../../lib/sbg';
import { useT } from '../i18n';
import { Button } from '../ui';

/*
 * 2026-11-16 — HOW A CODE COMES (the plan "Sign-in codes beyond Twilio SMS", D2 to D4; the owner, later: "they should be given
 * the same choice … the choice is for the user in every country"): by text, or by WhatsApp or Telegram where offered for the
 * number's country and set up — the person's own choice, never the default (Meta itself advises against it, and choosing it is
 * the person's agreement to hear from us there). A code chosen by an app that does not arrive within a minute comes by text by
 * itself; after a minute the person may also ask another way. Where no app is offered, nothing here shows.
 */
export type CodeWay = 'sms' | 'whatsapp' | 'telegram';
export type AppWay = Exclude<CodeWay, 'sms'>;
/** Where the offered apps are asked: an app's settings (the public door), or a loader of its own (a signed-in Settings). */
export type WaysSource = SbgConfig | ((phone: string) => Promise<OfferedWay[]>);

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

/** 2026-11-17 — what a country may offer: the apps that carry a code, and Truecaller, which confirms a number without one. */
export type OfferedWay = AppWay | 'truecaller';

/** Only the apps this screen knows how to name. */
const appsOnly = (ways: unknown): AppWay[] => (Array.isArray(ways) ? ways.filter((w): w is AppWay => w === 'whatsapp' || w === 'telegram') : []);
/** The ways a server answer names that a screen knows: the apps, and Truecaller. */
export const offeredWaysOf = (ways: unknown): OfferedWay[] => (Array.isArray(ways) ? ways.filter((w): w is OfferedWay => w === 'whatsapp' || w === 'telegram' || w === 'truecaller') : []);

/** The public door: GET auth/phone/ways for this number. */
export function waysFromServer(config: SbgConfig): (phone: string) => Promise<OfferedWay[]> {
  return async (phone) => {
    const r = await publicRequest<{ ways?: OfferedWay[] }>(config, `/v1/sbg/auth/phone/ways?phone=${encodeURIComponent(phone)}`, { method: 'GET' });
    return r.error ? [] : offeredWaysOf(r.data?.ways);
  };
}

const asked = new Map<string, Promise<OfferedWay[]>>();

/** Every way offered for this number's country, in the server's order. Empty until known, and when none is. */
export function useOfferedWays(source: WaysSource, phone: string): OfferedWay[] {
  const clean = phone.replace(/[^\d+]/g, '');
  const [ways, setWays] = useState<OfferedWay[]>([]);
  useEffect(() => {
    if (clean.replace(/\D/g, '').length < 9) return setWays([]);
    let live = true;
    if (!asked.has(clean)) asked.set(clean, (typeof source === 'function' ? source : waysFromServer(source))(clean).then(offeredWaysOf, () => []));
    void asked.get(clean)!.then((w) => live && setWays(w));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clean]);
  return ways;
}

/** The apps offered for this number's country, in the server's order. Empty until known, and when none is. */
export function useCodeWays(source: WaysSource, phone: string): AppWay[] {
  return appsOnly(useOfferedWays(source, phone));
}

/*
 * 2026-11-17 — WHY A CODE CAME BY TEXT AFTER TRUECALLER WAS TRIED: said once on the code step that follows. Kept in this
 * page's memory only, for the number it was tried for.
 */
export type TruecallerMiss = 'not_installed' | 'rejected' | 'other_number' | 'failed' | 'expired' | 'refused' | 'cancelled';
const misses = new Map<string, { why: TruecallerMiss; at: number }>();
const MISS_SHOWN_MS = 10 * 60_000;
const digitsOf = (phone: string) => phone.replace(/\D/g, '');

export function noteTruecallerMiss(phone: string, why: TruecallerMiss | 'confirmed', now: number = Date.now()): void {
  if (why === 'confirmed') misses.delete(digitsOf(phone));
  else misses.set(digitsOf(phone), { why, at: now });
}

export function truecallerMissFor(phone: string, now: number = Date.now()): TruecallerMiss | null {
  const m = digitsOf(phone) ? misses.get(digitsOf(phone)) : undefined;
  return m && now - m.at < MISS_SHOWN_MS ? m.why : null;
}

const MISS_WORDS = {
  not_installed: 'account.truecaller.notInstalled',
  rejected: 'account.truecaller.declined',
  cancelled: 'account.truecaller.declined',
  other_number: 'account.truecaller.otherNumber',
  failed: 'account.truecaller.failed',
  expired: 'account.truecaller.failed',
  refused: 'account.truecaller.failed',
} as const;

/**
 * BEFORE THE FIRST CODE: how it should come. Shown only where an app is offered for the number; its starting point is the
 * way this phone chose last time.
 */
export function CodeWayChoice({ config, phone, value, onChange, look = 'app', ways: given }: { config: WaysSource; phone: string; value: CodeWay; onChange: (way: CodeWay) => void; look?: 'app' | 'console'; /** The apps offered, where the caller knows them (a test, or the server said); otherwise asked. */ ways?: AppWay[] }) {
  const t = useT();
  const found = useCodeWays(config, given ? '' : phone);
  const ways = given ?? found;
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
 *
 * When it was sent and how may be said (`sentAt`, `sentVia`); otherwise it counts from when it first shows, and from each way
 * asked for here — `onSend` may answer the way the server says it went.
 */
export function OtherWays({
  config,
  phone,
  sentAt,
  sentVia,
  busy = false,
  onSend,
  look = 'app',
  ways: given,
}: {
  config: WaysSource;
  phone: string;
  sentAt?: number;
  sentVia?: CodeWay;
  busy?: boolean;
  onSend: (way: CodeWay) => void | Promise<CodeWay | void | undefined | null>;
  look?: 'app' | 'console';
  /** The apps offered, where the caller knows them (a test, or the server said); otherwise asked. */
  ways?: AppWay[];
}) {
  const t = useT();
  const found = useCodeWays(config, given ? '' : phone);
  const ways = given ?? found;
  const [since, setSince] = useState(() => sentAt || Date.now());
  const [last, setLast] = useState<CodeWay>(sentVia ?? 'sms');
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (sentAt) setSince(sentAt);
  }, [sentAt]);
  useEffect(() => {
    if (sentVia) setLast(sentVia);
  }, [sentVia]);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const note = look === 'console' ? 'chint' : 'hint';
  // 2026-11-17 — Truecaller was tried for this number and did not confirm it: why the code came by text instead.
  const miss = truecallerMissFor(phone);
  const missLine = miss ? <p class={note}>{t(MISS_WORDS[miss])}</p> : null;
  if (!ways.length && last === 'sms') return missLine;
  const left = Math.max(0, Math.ceil((since + ANOTHER_WAY_AFTER_S * 1000 - now) / 1000));
  const others: CodeWay[] = [...ways.filter((w) => w !== last), 'sms'];
  const label = (way: CodeWay) => (way === 'sms' ? t(last === 'sms' ? 'account.ways.byTextAgain' : 'account.ways.byTextInstead') : t('account.ways.byApp', { app: APP_NAME[way] }));
  const ask = async (way: CodeWay) => {
    const went = await onSend(way);
    setSince(Date.now());
    if (typeof went === 'string') setLast(went);
  };
  return (
    <div style="margin-top:12px">
      {missLine}
      {last !== 'sms' ? <p class={note}>{t('account.ways.sentBy', { app: APP_NAME[last] })}</p> : null}
      <p class={note}>{left > 0 ? t('account.ways.wait', { s: left }) : t('account.ways.ready')}</p>
      <div>
        {others.map((way) =>
          look === 'console' ? (
            <button key={way} type="button" class="cbtn cbtn--ghost cbtn--sm" style="margin-right:6px" disabled={busy || left > 0} onClick={() => void ask(way)}>
              {label(way)}
            </button>
          ) : (
            <Button key={way} variant="link" full={false} disabled={busy || left > 0} onClick={() => void ask(way)}>
              {label(way)}
            </Button>
          ),
        )}
      </div>
      <p class={note}>{t('account.ways.never')}</p>
    </div>
  );
}

/**
 * 2026-11-16 — A NEW PHONE'S CODE, ANOTHER WAY (the owner: "they should be given the same choice"): a shop, hub or store
 * signing in on a phone it has not used sees only the end of its number, so the apps offered come with the server's answer
 * (`ways`), and the same code goes again by the way chosen (POST auth/device/again), a minute after the last.
 */
export function DeviceCodeAgain({ config, challenge, ways, via, look = 'app' }: { config: SbgConfig; challenge: string; ways?: AppWay[]; via?: CodeWay; look?: 'app' | 'console' }) {
  const [busy, setBusy] = useState(false);
  return (
    <OtherWays
      config={config}
      phone=""
      ways={appsOnly(ways)}
      sentVia={via}
      busy={busy}
      look={look}
      onSend={async (way) => {
        setBusy(true);
        const r = await publicRequest<{ via?: CodeWay }>(config, '/v1/sbg/auth/device/again', { body: { challenge, via: way } });
        setBusy(false);
        if (r.error) return null;
        if (way !== 'sms') rememberWay(way);
        return r.data?.via ?? way;
      }}
    />
  );
}
