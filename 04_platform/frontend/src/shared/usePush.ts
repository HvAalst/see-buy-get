import { useCallback, useEffect, useState } from 'preact/hooks';
import type { NotificationsApi } from '../lib/sbg';
import { disablePush, enablePush, getPushState, giveLanguageAgain, loadInbox, sendTestPush, type InboxItem, type PushFailure, type PushState } from './push';
import { t, useLocale } from './i18n';

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
  // --- inbox / notification centre (N2b) ---
  items: InboxItem[];
  /** Unread count, derived from the loaded items — drives the bell badge. */
  unread: number;
  inboxState: 'idle' | 'loading' | 'ready' | 'error';
  loadInbox: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
}

/** The user-facing sentence for a failed opt-in — truthful and actionable, never "no signal". */
function failText(reason: PushFailure | undefined): string {
  switch (reason) {
    case 'denied':
      return t('notify.flash.denied');
    case 'dismissed':
      return t('notify.flash.dismissed');
    case 'unsupported':
      return t('notify.push.unsupported');
    case 'no-key':
    case 'save-failed':
      return t('notify.flash.unfinished');
    case 'no-serviceworker':
    case 'subscribe-failed':
      return t('notify.flash.refused');
    default:
      return t('notify.flash.failed');
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
  const [items, setItems] = useState<InboxItem[]>([]);
  const [inboxState, setInboxState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');

  // Unread is DERIVED from the loaded items, so an optimistic markRead updates the badge with no
  // separate counter to keep in sync (the badge caps at the loaded page — accepted at prototype scale).
  const unread = items.reduce((n, it) => (it.readAt ? n : n + 1), 0);

  useEffect(() => {
    let live = true;
    void getPushState().then((s) => {
      if (live) setState(s);
    });
    return () => {
      live = false;
    };
  }, []);

  const loadInboxCb = useCallback(async () => {
    if (!api) return;
    setInboxState('loading');
    const r = await loadInbox(api);
    if (r) {
      setItems(r.items);
      setInboxState('ready');
    } else {
      setInboxState('error');
    }
  }, [api]);

  // Load once when a signed-in client arrives, so the bell badge is right before the sheet is opened — and again when the
  // app's language changes (2026-11-26): the server says each notice in the language the app asks in.
  const locale = useLocale();
  useEffect(() => {
    void loadInboxCb();
  }, [loadInboxCb, locale]);

  // 2026-11-26 — a device with notifications on gives its language again, so its phone is pushed in it (push.ts).
  useEffect(() => {
    if (api && state === 'on') void giveLanguageAgain(api, locale);
  }, [api, state, locale]);

  const markRead = useCallback(
    async (id: string) => {
      if (!api) return;
      setItems((xs) => xs.map((x) => (x.id === id && !x.readAt ? { ...x, readAt: new Date().toISOString() } : x)));
      await api.markRead(id).catch(() => undefined);
    },
    [api],
  );

  const markAllRead = useCallback(async () => {
    if (!api) return;
    setItems((xs) => xs.map((x) => (x.readAt ? x : { ...x, readAt: new Date().toISOString() })));
    await api.markAllRead().catch(() => undefined);
  }, [api]);

  const enable = useCallback(async () => {
    if (!api) return;
    setBusy('enable');
    setFlash(null);
    const r = await enablePush(api);
    setState(r.state);
    // A block or a dismiss is a soft 'warn' (the user chose this, and it's retryable); a real failure is 'danger'.
    const soft = r.reason === 'denied' || r.reason === 'dismissed';
    setFlash(r.ok ? { tone: 'ok', text: t('notify.flash.on') } : { tone: soft ? 'warn' : 'danger', text: failText(r.reason) });
    setBusy(null);
  }, [api]);

  const disable = useCallback(async () => {
    if (!api) return;
    setBusy('disable');
    setFlash(null);
    await disablePush(api);
    setState(await getPushState());
    setFlash({ tone: 'ok', text: t('notify.flash.off') });
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
          ? { tone: 'ok', text: t('notify.flash.sent') }
          : { tone: 'warn', text: t('notify.flash.noDevices') }
        : { tone: 'danger', text: t('notify.flash.testFailed') },
    );
    setBusy(null);
  }, [api]);

  const clearFlash = useCallback(() => setFlash(null), []);

  return { state, busy, flash, enable, disable, test, clearFlash, items, unread, inboxState, loadInbox: loadInboxCb, markRead, markAllRead };
}
