import { useEffect, useState } from 'preact/hooks';
import { Button, CodeBoxes, ErrorNote, Note, RefusalNote } from '../ui';
import { useT } from '../i18n';
import type { SbgError } from '../../lib/sbg';
import { PIN_LENGTH } from './pin';
import { CAR_POLL_FOR_MS, CAR_POLL_MS, type CarApi, type CarHere } from './carMessages';
import { CAR_MIN_ANDROID, carLinkOf, insidePlayApp, openCarLink, openCarUnlink, phoneAndroid, tooOldForCar } from '../playApp';

/**
 * MESSAGES IN THE CAR, UNDER SETTINGS (the owner, 2026-11-02: "we start with 2" — the driver's messages read aloud in the
 * car and answered by voice; "just to keep drivers' safety in mind, we must reduce the tapping").
 *
 * Offered only inside the Play app (shared/playApp.ts), and only to a driver whose PIN works on this phone. ON takes the
 * PIN once more — a phone left signed in is not proof of who holds it — then opens the Play app's native part with the
 * car key; Settings says "Waiting for the phone" until the server has heard from it, then "On for this phone". OFF takes
 * one tap.
 */
export interface CarState {
  /** Inside the Play app: the only place the row is shown. */
  inside: boolean;
  /** The server's answer: null until read, or where it could not be. */
  here: CarHere | null;
  unread: boolean;
  set: (here: CarHere) => void;
  /** Ask the server again — the phone may have answered meanwhile. */
  reread: () => Promise<void>;
  /** The Android version this phone says, where it says one; below 9, the car part cannot run here (the integrator, 2026-11-02). */
  android?: number;
  tooOld?: boolean;
}

/** Asked when Settings opens, inside the Play app, for somebody whose sign-in is a PIN — and not at all otherwise. */
export function useCarHere(api: CarApi | undefined, enabled: boolean): CarState {
  const [inside] = useState(() => insidePlayApp());
  const [android, setAndroid] = useState<number | undefined>(() => phoneAndroid().now);
  // The user agent says a version at once; Chrome's own platform version, where it gives one, is the true one.
  useEffect(() => {
    if (!inside) return;
    let live = true;
    void phoneAndroid().exact.then((v) => live && setAndroid(v));
    return () => {
      live = false;
    };
  }, [inside]);
  const [here, setHere] = useState<CarHere | null>(null);
  const [unread, setUnread] = useState(false);
  const reread = async () => {
    if (!api) return;
    const r = await api.read();
    if (r.error || !r.data) setUnread(true);
    else {
      setUnread(false);
      setHere(r.data);
    }
  };
  useEffect(() => {
    if (!enabled || !inside || !api) return;
    void reread();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, inside]);
  return { inside, here, unread, set: setHere, reread, ...(android !== undefined ? { android } : {}), tooOld: tooOldForCar(android) };
}

/**
 * TURN IT OFF HERE: the server deletes the key first — from then on it opens nothing — and only then is the phone told
 * to forget it and stop (`intent://car-unlink…`; the integrator, 2026-11-02). A refusal tells the phone nothing.
 */
export async function turnOffHere(api: CarApi) {
  const r = await api.turnOff();
  if (!r.error && r.data) openCarUnlink();
  return r;
}

/** A wrong or locked PIN is said in the shared words; anything else is the server's own sentence. */
function Refused({ error }: { error: SbgError | null }) {
  if (!error) return null;
  return error.code === 'PIN_WRONG' || error.code === 'PIN_LOCKED' ? <ErrorNote error={error} /> : <RefusalNote error={error} />;
}

/**
 * The view behind the row. `key` is the car key just made, held only in this view for as long as the phone has not
 * answered: the link that hands it over stays on the screen in case the phone did not open by itself.
 */
export function CarForm({ api, state, initialKey }: { api: CarApi; state: CarState; initialKey?: string }) {
  const t = useT();
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SbgError | null>(null);
  const [key, setKey] = useState<string | undefined>(initialKey);
  const [said, setSaid] = useState<'off' | null>(null);
  const here = state.here;
  const waiting = Boolean(here?.on && here.phone !== 'on');

  // WAITING FOR THE PHONE: asked again every few seconds for two minutes, and whenever the page is shown again — the
  // phone's native part takes the key, tells the server where to wake it, and hands the screen back here.
  useEffect(() => {
    if (!waiting) return;
    const until = Date.now() + CAR_POLL_FOR_MS;
    const timer = setInterval(() => {
      if (Date.now() > until) return clearInterval(timer);
      void state.reread();
    }, CAR_POLL_MS);
    const shown = () => {
      if (globalThis.document?.visibilityState === 'visible') void state.reread();
    };
    globalThis.document?.addEventListener?.('visibilitychange', shown);
    return () => {
      clearInterval(timer);
      globalThis.document?.removeEventListener?.('visibilitychange', shown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting]);
  // The phone answered: the key is nobody's business here any more.
  useEffect(() => {
    if (here?.phone === 'on') setKey(undefined);
  }, [here?.phone]);

  const turnOn = async () => {
    setBusy(true);
    setError(null);
    setSaid(null);
    const r = await api.turnOn(pin);
    setBusy(false);
    setPin('');
    if (r.error || !r.data) return setError(r.error ?? null);
    const { key: made, ...rest } = r.data;
    state.set(rest);
    setKey(made);
    openCarLink(made);
  };
  const turnOff = async () => {
    setBusy(true);
    setError(null);
    const r = await turnOffHere(api);
    setBusy(false);
    if (r.error || !r.data) return setError(r.error ?? null);
    setKey(undefined);
    state.set(r.data);
    setSaid('off');
  };
  const off = (
    <Button variant="outline" chevron={false} busy={busy} onClick={() => void turnOff()}>
      {t('account.car.turnOff')}
    </Button>
  );

  if (!here) return state.unread ? <Note tone="warn" icon="warning" title={t('account.car.unread')} /> : <p class="t-body">{t('common.loading')}</p>;

  if (here.on && here.phone === 'on') {
    return (
      <>
        <Note tone="ok" icon="speaker" title={t('account.car.onTitle')} detail={t('account.car.onBody')} />
        <p class="t-body">{t('account.car.privacy')}</p>
        <Refused error={error} />
        {off}
      </>
    );
  }

  if (here.on) {
    const link = key ? carLinkOf(key) : null;
    return (
      <>
        <Note tone="info" icon="phone" title={t('account.car.waitingTitle')} detail={t(link ? 'account.car.waitingBody' : 'account.car.waitingAgain')} />
        {/* Only the intent naming our package: a plain sbgdriver:// link could be answered by another app (2026-11-02). */}
        {link ? (
          <a class="btn btn--outline btn--full" href={link}>
            {t('account.car.openPhone')}
          </a>
        ) : null}
        <Refused error={error} />
        {off}
      </>
    );
  }

  // AN OLDER PHONE: the car part needs Android 9 or newer — said, with nothing to type and nothing to tap.
  if (state.tooOld) {
    return (
      <>
        {said === 'off' ? <Note tone="ok" icon="check" title={t('account.car.turnedOff')} /> : null}
        <Note tone="info" icon="phone" title={t('account.car.oldTitle', { min: CAR_MIN_ANDROID })} detail={t('account.car.oldBody', { min: CAR_MIN_ANDROID, version: state.android ?? '' })} />
      </>
    );
  }

  return (
    <>
      {said === 'off' ? <Note tone="ok" icon="check" title={t('account.car.turnedOff')} /> : null}
      <p class="t-body">{t('account.car.offBody')}</p>
      <p class="t-body">{t('account.car.safety')}</p>
      <p class="t-body">{t('account.car.privacy')}</p>
      <div class="field">
        <span class="field__label">{t('account.car.pinToTurnOn')}</span>
        <CodeBoxes id="acct-car-pin" label={t('account.car.pinToTurnOn')} length={PIN_LENGTH} value={pin} onInput={(v) => { setPin(v); setError(null); }} disabled={busy} mask />
      </div>
      <Refused error={error} />
      <Button chevron={false} busy={busy} disabled={pin.length !== PIN_LENGTH} onClick={() => void turnOn()}>
        {t('account.car.turnOn')}
      </Button>
    </>
  );
}
