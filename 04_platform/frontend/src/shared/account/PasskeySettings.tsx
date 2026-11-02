import { useEffect, useState } from 'preact/hooks';
import { Button, CodeBoxes, ErrorNote, Note, RefusalNote } from '../ui';
import { useT } from '../i18n';
import type { SbgError } from '../../lib/sbg';
import { PIN_LENGTH } from './pin';
import { passkeySupported, type PasskeyApi, type PasskeyHere } from './passkey';

/**
 * UNLOCK WITH FINGERPRINT OR FACE, UNDER SETTINGS (the owner, 2026-11-02: "if face unlock works, integrate it, but then
 * in settings users should be able to undo it and get back to a preferred option").
 *
 * Offered only where the browser says this phone can check a fingerprint or face itself, and only to somebody whose
 * sign-in is a PIN. It says which is on. ON takes the PIN once more (a phone left signed in is not proof of who holds
 * it), then the phone's own prompt; OFF takes one tap and nothing else — the PIN, which never stopped working, is the
 * way in again.
 */
export interface PasskeyState {
  /** The browser's answer: null until it has given one. */
  supported: boolean | null;
  /** The server's: null until read, or where it could not be. */
  here: PasskeyHere | null;
  unread: boolean;
  set: (here: PasskeyHere) => void;
}

/** Asked when Settings opens, for a person whose sign-in is a PIN — and not at all otherwise. */
export function usePasskeyHere(api: PasskeyApi, enabled: boolean): PasskeyState {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [here, setHere] = useState<PasskeyHere | null>(null);
  const [unread, setUnread] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void (async () => {
      const can = await passkeySupported();
      if (!live) return;
      setSupported(can);
      if (!can) return;
      const r = await api.read();
      if (!live) return;
      if (r.error || !r.data) setUnread(true);
      else setHere(r.data);
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
  return { supported, here, unread, set: setHere };
}

/**
 * The row's second line — which is on — or null where there is no row: the phone cannot do it, it is not known yet,
 * or this browser holds no device key of this person's (their PIN does not work here, so nothing could stand in for it).
 */
export function passkeyRowSub(state: Pick<PasskeyState, 'supported' | 'here' | 'unread'>, t: (key: never) => string): string | null {
  const say = t as (key: string) => string;
  if (state.supported !== true) return null;
  if (state.unread) return say('account.passkey.unread');
  if (!state.here || state.here.which < 0) return null;
  return say(state.here.on ? 'account.passkey.subOn' : 'account.passkey.subOff');
}

/** A wrong or locked PIN is said in the shared words; anything else is the server's own sentence. */
function Refused({ error }: { error: SbgError | null }) {
  if (!error) return null;
  return error.code === 'PIN_WRONG' || error.code === 'PIN_LOCKED' ? <ErrorNote error={error} /> : <RefusalNote error={error} />;
}

/** The view behind the row: which is on, and the one thing to do about it. */
export function PasskeyForm({ api, state, initialStep = 'pin' }: { api: PasskeyApi; state: PasskeyState; initialStep?: 'pin' | 'now' }) {
  const t = useT();
  const [step, setStep] = useState<'pin' | 'now'>(initialStep);
  const [pin, setPin] = useState('');
  const [prepared, setPrepared] = useState<Parameters<PasskeyApi['create']>[0] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SbgError | null>(null);
  const [said, setSaid] = useState<'on' | 'off' | 'cancelled' | null>(null);
  // The WebAuthn code, fetched while the PIN is typed: the tap that follows starts the phone's prompt itself.
  useEffect(() => api.warm(), [api]);

  const here = state.here;
  const when = (iso?: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '');

  const next = async () => {
    setBusy(true);
    setError(null);
    setSaid(null);
    const r = await api.prepare(pin);
    setBusy(false);
    if (r.error || !r.data) return setError(r.error ?? null);
    setPrepared(r.data);
    setStep('now');
  };
  const turnOn = async () => {
    if (!prepared) return setStep('pin');
    setBusy(true);
    setError(null);
    setSaid(null);
    const out = await api.create(prepared);
    setBusy(false);
    if (out.cancelled) return setSaid('cancelled');
    if (out.error || !out.here) {
      // A challenge that ran out, or an answer that did not check out: the PIN again, from the start.
      setPrepared(null);
      setPin('');
      setStep('pin');
      return setError(out.error ?? null);
    }
    state.set(out.here);
    setPin('');
    setPrepared(null);
    setStep('pin');
    setSaid('on');
  };
  const turnOff = async () => {
    setBusy(true);
    setError(null);
    setSaid(null);
    const r = await api.turnOff();
    setBusy(false);
    if (r.error || !r.data) return setError(r.error ?? null);
    state.set(r.data);
    setSaid('off');
  };

  if (!here) return state.unread ? <Note tone="warn" icon="warning" title={t('account.passkey.unread')} /> : <p class="t-body">{t('common.loading')}</p>;

  if (here.on) {
    return (
      <>
        {said === 'on' ? <Note tone="ok" icon="check" title={t('account.passkey.turnedOn')} /> : null}
        <Note tone="ok" icon="key" title={t('account.passkey.onTitle')} detail={t('account.passkey.onBody', { when: when(here.addedAt) })} />
        <p class="t-body">{t('account.passkey.privacy')}</p>
        <Refused error={error} />
        <Button variant="outline" chevron={false} busy={busy} onClick={() => void turnOff()}>
          {t('account.passkey.turnOff')}
        </Button>
      </>
    );
  }

  return (
    <>
      {said === 'off' ? <Note tone="ok" icon="check" title={t('account.passkey.turnedOff')} /> : null}
      {step === 'now' ? (
        <>
          <Note tone="info" icon="key" title={t('account.passkey.nowTitle')} detail={t('account.passkey.nowBody')} />
          {said === 'cancelled' ? <Note tone="warn" icon="lock" title={t('account.passkey.cancelled')} /> : null}
          <Refused error={error} />
          <Button chevron={false} busy={busy} onClick={() => void turnOn()}>
            {t('account.passkey.turnOn')}
          </Button>
        </>
      ) : (
        <>
          <p class="t-body">{t('account.passkey.offBody')}</p>
          <p class="t-body">{t('account.passkey.privacy')}</p>
          <div class="field">
            <span class="field__label">{t('account.passkey.pinToTurnOn')}</span>
            <CodeBoxes id="acct-passkey-pin" label={t('account.passkey.pinToTurnOn')} length={PIN_LENGTH} value={pin} onInput={(v) => { setPin(v); setError(null); }} disabled={busy} mask />
          </div>
          <Refused error={error} />
          <Button chevron={false} busy={busy} disabled={pin.length !== PIN_LENGTH} onClick={() => void next()}>
            {t('account.passkey.next')}
          </Button>
        </>
      )}
    </>
  );
}
