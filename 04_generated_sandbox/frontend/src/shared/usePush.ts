import { useCallback, useEffect, useState } from 'preact/hooks';
import type { NotificationsApi } from '../lib/sbg';
import { disablePush, enablePush, getPushState, sendTestPush, type PushFailure, type PushState } from './push';

export interface PushFlash {
  tone: 'ok' | 'warn' | 'danger';
  text: string;
}

export type PushBusy = null | 'enable' | 'disable' | 'test';

export interface PushControls {
  /** 'loading' until the first state read resolves, then the live device state. */
  state: PushState | 'loading';
  busy: PushBusy;
  flash: PushFlash | null;
  enable: () => Promise<void>;
  disable: () => Promise<void>;
  test: () => Promise<void>;
  clearFlash: () => void;
}

/** The user-facing sentence for a failed opt-in — truthful and actionable, never "no signal". */
function failText(reason: PushFailure | undefined): string {
  switch (reason) {
    case 'denied':
      return 'Notifications are blocked. Turn them on for this app in your browser settings.';
    case 'dismissed':
      return 'Not turned on yet — tap Turn on notifications to try again.';
    case 'unsupported':
      return 'This device can’t show push notifications.';
    case 'no-key':
    case 'save-failed':
      return 'We couldn’t finish turning them on. Please try again.';
    case 'no-serviceworker':
    case 'subscribe-failed':
      return 'This device wouldn’t let us set up notifications. Please try again.';
    default:
      return 'We couldn’t turn notifications on.';
  }
}

/**
 * The push opt-in state machine for the UI (N1b). Wraps shared/push.ts with local state so a
 * NotificationBell — or, later, a notification centre — can render the right control (turn on /
 * send a test / turn off) and a truthful result line, without each app re-implementing it.
 *
 * `api` is null while the app is signed out (no client); every action no-ops until it arrives.
 */
export function usePush(api: NotificationsApi | null): PushControls {
  const [state, setState] = useState<PushState | 'loading'>('loading');
  const [busy, setBusy] = useState<PushBusy>(null);
  const [flash, setFlash] = useState<PushFlash | null>(null);

  useEffect(() => {
    let live = true;
    void getPushState().then((s) => {
      if (live) setState(s);
    });
    return () => {
      live = false;
    };
  }, []);

  const enable = useCallback(async () => {
    if (!api) return;
    setBusy('enable');
    setFlash(null);
    const r = await enablePush(api);
    setState(r.state);
    // A block or a dismiss is a soft 'warn' (the user chose this, and it's retryable); a real failure is 'danger'.
    const soft = r.reason === 'denied' || r.reason === 'dismissed';
    setFlash(r.ok ? { tone: 'ok', text: 'Notifications are on for this device.' } : { tone: soft ? 'warn' : 'danger', text: failText(r.reason) });
    setBusy(null);
  }, [api]);

  const disable = useCallback(async () => {
    if (!api) return;
    setBusy('disable');
    setFlash(null);
    await disablePush(api);
    setState(await getPushState());
    setFlash({ tone: 'ok', text: 'Notifications are off for this device.' });
    setBusy(null);
  }, [api]);

  const test = useCallback(async () => {
    if (!api) return;
    setBusy('test');
    setFlash(null);
    const r = await sendTestPush(api);
    setFlash(
      r.ok
        ? r.sent > 0
          ? { tone: 'ok', text: 'Sent — watch for it on your screen.' }
          : { tone: 'warn', text: 'No devices are turned on yet.' }
        : { tone: 'danger', text: 'Couldn’t send the test. Please try again.' },
    );
    setBusy(null);
  }, [api]);

  const clearFlash = useCallback(() => setFlash(null), []);

  return { state, busy, flash, enable, disable, test, clearFlash };
}
