import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Button, ErrorNote, Note, errorSentence } from '../ui';
import { useT } from '../i18n';
import type { SbgConfig, SbgError } from '../../lib/sbg';
import { hasAccountUnlockHere, hasUnlockHere } from './unlock';
import { unlockCeremony, type UnlockCeremony } from './passkey';

/**
 * UNLOCK WITH FINGERPRINT OR FACE, AT A SIGN-IN SCREEN (the owner, 2026-11-02: "if face unlock works, integrate it, but
 * then in settings users should be able to undo it and get back to a preferred option").
 *
 * Where it was turned on for this number on this phone (unlock.ts), it is the FIRST choice — one button, because a
 * phone's fingerprint prompt may only be started by a tap (Safari) — and the PIN is one tap away, "Use my PIN instead".
 * Everywhere else the screen is what it was. The ticket that comes back is handed to the app's own sign-in in the
 * PIN's place, so each app signs in exactly as it does with a PIN.
 *
 * 2026-11-02, later (the owner: "ok go ahead with the fingerprint") — the Shop, Hub and Store apps' sign-in too: by the
 * account's email and the key this phone holds for it (`account.keyOf`, shopDevice.ts), with "Use my password instead".
 */
export interface UnlockFirstState {
  /** The fingerprint is the choice on show; the screen hides its own PIN button meanwhile. */
  offered: boolean;
  /** It is on for this number here, whichever was chosen. */
  available: boolean;
  /** It turned out to be off for this number: said once, above the PIN. */
  wentOff: boolean;
  usePin: () => void;
  useFace: () => void;
  off: () => void;
  /** An account's sign-in (a shop's, a hub's, a store's): where this phone keeps its key for the address. Absent: a person's. */
  account?: { keyOf: (email: string) => string | undefined };
}

/**
 * For one sign-in screen: is the fingerprint offered for the number in its phone field — or, with `account`, for the address
 * in its email field. Read on every draw: a number typed in full may be one.
 */
export function useUnlockFirst(phone: string, account?: { keyOf: (email: string) => string | undefined }): UnlockFirstState {
  const [chosePin, setChosePin] = useState(false);
  const [offFor, setOffFor] = useState<string | null>(null);
  const available = account ? hasAccountUnlockHere(phone, account.keyOf(phone)) : hasUnlockHere(phone);
  return {
    offered: available && !chosePin,
    available,
    wentOff: offFor !== null && offFor === phone,
    usePin: () => setChosePin(true),
    useFace: () => setChosePin(false),
    off: () => setOffFor(phone),
    ...(account ? { account } : {}),
  };
}

export interface UnlockFirstProps {
  state: UnlockFirstState;
  phone: string;
  /** The app's own config: the ceremony's two calls go where its sign-in goes. */
  config: SbgConfig;
  /** The app's sign-in, given the ticket in the PIN's place. */
  onTicket: (ticket: string) => Promise<unknown> | void;
  /** The app is busy signing in. */
  busy?: boolean;
  /** The Business app draws its own buttons (the console's). */
  look?: 'app' | 'console';
  /** The PIN field, shown when the fingerprint is not the choice. */
  children: ComponentChildren;
}

export function UnlockFirst({ state, phone, config, onTicket, busy, look = 'app', children }: UnlockFirstProps) {
  const t = useT();
  const ceremony = useRef<UnlockCeremony | null>(null);
  ceremony.current ??= unlockCeremony(config, state.account);
  // What it stands in for, in the words: the PIN, or the account's password.
  const pw = state.account ? 'Password' : '';
  const [working, setWorking] = useState(false);
  const [said, setSaid] = useState<'cancelled' | 'failed' | null>(null);
  const [error, setError] = useState<SbgError | null>(null);

  // Ahead of the tap: the challenge and the WebAuthn code, so the tap itself starts the phone's prompt.
  useEffect(() => {
    if (!state.offered) return;
    let live = true;
    void ceremony.current?.prepare(phone).then((r) => {
      if (live && r === 'off') state.off();
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.offered, phone]);

  const go = async () => {
    if (working) return;
    setWorking(true);
    setSaid(null);
    setError(null);
    try {
      const out = await (ceremony.current as UnlockCeremony).unlock(phone);
      if (out.ticket) {
        await onTicket(out.ticket);
        return;
      }
      if (out.off) return state.off();
      setSaid(out.cancelled ? 'cancelled' : 'failed');
      setError(out.cancelled ? null : (out.error ?? null));
      // The next tap starts from a fresh challenge.
      void ceremony.current?.prepare(phone);
    } finally {
      setWorking(false);
    }
  };

  const consoleLook = look === 'console';
  const saidLine = said ? t(`account.unlock.${said}${pw}` as never) : '';
  if (!state.offered) {
    return (
      <>
        {state.wentOff ? (
          consoleLook ? (
            <p class="chint">{`${t('account.unlock.offTitle')}. ${t(`account.unlock.offBody${pw}` as never)}`}</p>
          ) : (
            <Note tone="info" icon="lock" title={t('account.unlock.offTitle')} detail={t(`account.unlock.offBody${pw}` as never)} />
          )
        ) : null}
        {children}
        {state.available ? (
          consoleLook ? (
            <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={state.useFace}>
              {t('account.unlock.useFace')}
            </button>
          ) : (
            <Button variant="link" onClick={state.useFace}>
              {t('account.unlock.useFace')}
            </Button>
          )
        ) : null}
      </>
    );
  }

  return (
    <div class="field unlock-first">
      {consoleLook ? (
        <button type="button" class="cbtn cbtn--primary" disabled={working || busy} onClick={() => void go()} style="margin-top:8px">
          {t('account.unlock.button')}
        </button>
      ) : (
        <Button chevron={false} busy={working || busy} onClick={() => void go()}>
          {t('account.unlock.button')}
        </Button>
      )}
      {consoleLook ? (
        error || said ? <p class="cerr">{error ? errorSentence(error) : saidLine}</p> : null
      ) : error ? (
        <ErrorNote error={error} />
      ) : said ? (
        <Note tone="warn" icon="lock" title={saidLine} />
      ) : null}
      {consoleLook ? (
        <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={working} onClick={state.usePin}>
          {t(state.account ? 'account.unlock.usePassword' : 'account.unlock.usePin')}
        </button>
      ) : (
        <Button variant="link" disabled={working} onClick={state.usePin}>
          {t(state.account ? 'account.unlock.usePassword' : 'account.unlock.usePin')}
        </Button>
      )}
    </div>
  );
}
