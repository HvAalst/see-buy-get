import { useCallback, useEffect, useState } from 'preact/hooks';
import { narrow, type Result, type SbgClient, type SbgError } from '../../lib/sbg';

/**
 * THE ACCOUNT, THE SAME IN EVERY APP.
 *
 * `/v1/sbg/account/*` answers for whoever the token signed in as, because every role in this network
 * proves the same phone and PIN against the same identity spine. So this hook takes a client and nothing
 * else: a driver app, a shop app and a fleet office all get the same person back, and the menu above it
 * does not need to know which one it is running in.
 */
export interface AccountView {
  personId: string;
  hasPin: boolean;
  displayName?: string;
  avatarMediaId?: string;
  address?: string;
  pinChangedAt?: string;
  /** The role this token is acting as, and its DID — what the menu heads itself with. */
  actingAs?: string;
  actingDid?: string;
  /**
   * The public page this participant answers on, where they have one.
   *
   * ABSENT IS THE COMMON CASE and must stay absent: an owner-driver has a page and a fleet driver does
   * not, so a menu that showed "@yourname" to everybody would be advertising a dead link to most of them.
   */
  handle?: string;
  /** The recovery email, masked by the server ("a…@example.com"). Absent: none confirmed yet. */
  email?: string;
  /** Email to that address came back, for good: the way to reach them without their phone does not work. */
  emailBounced?: boolean;
  /** A number change that can still be undone, and until when. */
  numberChange?: { at: string; undoUntil: string };
  /**
   * Somebody has asked SeeBuyGet staff to move THIS account to another number — saying they lost the number and
   * the PIN. Its holder, who is looking at this, is the one person who knows whether that was them.
   */
  moveAsked?: { askedAt: string; toEnds: string };
}

type Sent = { sent: boolean; code?: string };

export interface AccountApi {
  account: AccountView | null;
  loading: boolean;
  error: SbgError | null;
  busy: boolean;
  reload: () => Promise<void>;
  /** Name, photo or address. Each independent; an empty address clears it. */
  save: (patch: { displayName?: string; avatarMediaId?: string; address?: string }) => Promise<boolean>;
  /**
   * Change the PIN. Resolves TRUE when it changed — and the caller must then sign the person out, because
   * changing a PIN ends every session it opened, this one included. That is not a quirk to work around:
   * the whole point is that a stolen PIN cannot outlive being changed.
   */
  changePin: (currentPin: string, newPin: string) => Promise<boolean>;
  /** Upload an image as this person's avatar and apply it. Returns the media id, or null. */
  saveAvatar: (dataUrl: string) => Promise<string | null>;
  /** Fetch owner-gated bytes for an <AuthImage>, whose `load` prop takes exactly this Result shape. */
  loadMedia: (mediaId: string) => Promise<{ data: Blob | null; error: unknown }>;
  /**
   * SETTINGS — the recovery email and the phone number. These answer with the Result itself rather than through
   * `error` above: a refusal belongs in the sheet where the person typed, not on the menu behind it.
   */
  sendEmailCode: (email: string) => Promise<Result<Sent>>;
  /** The PIN again, and the code sent to the NEW address. The menu redraws from what the server stored. */
  setEmail: (pin: string, email: string, code: string) => Promise<Result<unknown>>;
  sendPhoneCode: (phone: string) => Promise<Result<Sent>>;
  confirmPhoneCode: (phone: string, code: string) => Promise<Result<unknown>>;
  /** Move the account to a number already confirmed by code. On success EVERY session is over, this one included. */
  changeNumber: (pin: string, newPhone: string) => Promise<Result<unknown>>;
  /** "That was not me": end every request waiting to move this account. Being signed in is what makes it theirs to say. */
  stopMove: () => Promise<Result<{ stopped: number }>>;
}

const NO_CLIENT = { data: null, error: null } as unknown as Result<never>;

/** No client yet (an app still booting, or signed out) — every call is a no-op rather than a crash. */
const IDLE: AccountApi = {
  account: null,
  loading: false,
  error: null,
  busy: false,
  reload: async () => {},
  save: async () => false,
  changePin: async () => false,
  saveAvatar: async () => null,
  loadMedia: async () => ({ data: null, error: null }),
  sendEmailCode: async () => NO_CLIENT,
  setEmail: async () => NO_CLIENT,
  sendPhoneCode: async () => NO_CLIENT,
  confirmPhoneCode: async () => NO_CLIENT,
  changeNumber: async () => NO_CLIENT,
  stopMove: async () => NO_CLIENT,
};

export function useAccount(client: SbgClient | null, enabled = true): AccountApi {
  const [account, setAccount] = useState<AccountView | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SbgError | null>(null);

  const reload = useCallback(async () => {
    if (!client) return;
    setLoading(true);
    const r: Result<unknown> = await client.request((raw) => raw.GET('/v1/sbg/account/me' as never, {} as never) as never);
    setLoading(false);
    if (r.error || !r.data) {
      setError(r.error ?? null);
      return;
    }
    setError(null);
    setAccount(narrow<AccountView>(r.data));
  }, [client]);

  useEffect(() => {
    if (enabled && client) void reload();
  }, [enabled, client, reload]);

  const save = useCallback(
    async (patch: { displayName?: string; avatarMediaId?: string; address?: string }) => {
      if (!client) return false;
      setBusy(true);
      const r: Result<unknown> = await client.request((raw) => raw.PATCH('/v1/sbg/account/profile' as never, { body: patch } as never) as never);
      setBusy(false);
      if (r.error || !r.data) {
        setError(r.error ?? null);
        return false;
      }
      setError(null);
      /*
       * REPLACED, NOT MERGED — and the difference is a whole feature.
       *
       * The response IS the updated self-view, so the menu redraws from what the server actually stored
       * rather than from what was typed; those differ whenever a field was trimmed or refused. Merging it
       * over the previous state looks equivalent and is not: a field the server has REMOVED comes back
       * absent, and absent-over-present leaves the old value sitting there. So "Remove my address" cleared
       * it on the server and the menu went on showing it, which is the worst possible outcome for that
       * particular button. Caught by pressing it in a browser.
       *
       * The self-view keeps the fields that are facts about the token rather than the person, because the
       * PATCH response is about the person and says nothing about which role is asking.
       */
      const fresh = narrow<AccountView>(r.data);
      setAccount((prev) => ({ ...fresh, actingAs: prev?.actingAs, actingDid: prev?.actingDid, handle: prev?.handle }));
      return true;
    },
    [client],
  );

  const changePin = useCallback(
    async (currentPin: string, newPin: string) => {
      if (!client) return false;
      setBusy(true);
      const r: Result<unknown> = await client.request((raw) => raw.POST('/v1/sbg/account/pin/change' as never, { body: { currentPin, newPin } } as never) as never);
      setBusy(false);
      if (r.error) {
        setError(r.error);
        return false;
      }
      setError(null);
      return true;
    },
    [client],
  );

  const saveAvatar = useCallback(
    async (dataUrl: string) => {
      if (!client) return null;
      setBusy(true);
      // Uploaded AS an avatar: the server refuses to re-kind an evidence photo onto a profile, because a
      // later avatar replace purges the old bytes and that would hard-delete locked evidence mid-case.
      const up: Result<unknown> = await client.request((raw) => raw.POST('/v1/sbg/media' as never, { body: { kind: 'avatar', dataUrl } } as never) as never);
      if (up.error || !up.data) {
        setBusy(false);
        setError(up.error ?? null);
        return null;
      }
      const mediaId = narrow<{ mediaId?: string; id?: string }>(up.data).mediaId ?? narrow<{ id?: string }>(up.data).id ?? null;
      setBusy(false);
      if (!mediaId) return null;
      return (await save({ avatarMediaId: mediaId })) ? mediaId : null;
    },
    [client, save],
  );

  const loadMedia = useCallback(
    async (mediaId: string) => {
      if (!client) return { data: null, error: null };
      const r: Result<unknown> = await client.request((raw) => raw.GET('/v1/sbg/media/{id}' as never, { params: { path: { id: mediaId } }, parseAs: 'blob' } as never) as never);
      return { data: (r.data as Blob) ?? null, error: r.error ?? null };
    },
    [client],
  );

  const post = useCallback(
    <T,>(path: string, body: unknown): Promise<Result<T>> => {
      if (!client) return Promise.resolve(NO_CLIENT);
      return client.request((raw) => raw.POST(path as never, { body } as never) as never) as Promise<Result<T>>;
    },
    [client],
  );

  const setEmail = useCallback(
    async (pin: string, email: string, code: string) => {
      const r = await post<unknown>('/v1/sbg/account/email', { pin, email, code });
      // The response is the person's self-view; what belongs to the token (acting as, handle) is kept, as in `save`.
      if (!r.error && r.data) setAccount((prev) => ({ ...narrow<AccountView>(r.data), actingAs: prev?.actingAs, actingDid: prev?.actingDid, handle: prev?.handle }));
      return r;
    },
    [post],
  );
  const sendEmailCode = useCallback((email: string) => post<Sent>('/v1/sbg/identity/email/request', { email }), [post]);
  const sendPhoneCode = useCallback((phone: string) => post<Sent>('/v1/sbg/auth/phone/request', { phone }), [post]);
  const confirmPhoneCode = useCallback((phone: string, code: string) => post<unknown>('/v1/sbg/auth/phone/verify', { phone, code }), [post]);
  const changeNumber = useCallback((pin: string, newPhone: string) => post<unknown>('/v1/sbg/account/phone/change', { pin, newPhone }), [post]);

  const stopMove = useCallback(async () => {
    const r = await post<{ stopped: number }>('/v1/sbg/account/move-requests/stop', {});
    // Gone from the account as the server now sees it — read again rather than assumed.
    if (!r.error) setAccount((prev) => (prev ? { ...prev, moveAsked: undefined } : prev));
    return r;
  }, [post]);

  if (!client) return IDLE;
  return { account, loading, error, busy, reload, save, changePin, saveAvatar, loadMedia, sendEmailCode, setEmail, sendPhoneCode, confirmPhoneCode, changeNumber, stopMove };
}
