import { saveDeviceKey } from './pin';
import { pinDevicesApi, type PinDevicesApi } from './devices';
import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import { narrow, type Result, type SbgClient, type SbgError } from '../../lib/sbg';
import type { ContractView } from './contract';
import { idDisputeApi, type DisputeAgainstMe, type IdDisputeApi } from './idDispute';
import type { PayoutNumberSaved, PayoutNumberView } from './payoutNumber';

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
   * The number this account moved off is still its own until then: what is sent to it arrives here. `canBlock` once
   * the move can no longer be undone — the holder lets the old number go themselves, or it is let go at `until`.
   */
  oldNumber?: { since: string; until: string; canBlock: boolean };
  /**
   * Somebody has asked SeeBuyGet staff to move THIS account to another number — saying they lost the number and
   * the PIN. Its holder, who is looking at this, is the one person who knows whether that was them.
   */
  moveAsked?: { askedAt: string; toEnds: string };
  /**
   * Somebody says the national ID on one of this person's registrations is theirs — or it has gone to them, and
   * the registration is held. With THIS person's own reference: it is what they answer with.
   */
  idDispute?: DisputeAgainstMe;
  /** Muted by its owner, since when (the user, 2026-10-22). Absent: not muted. */
  mutedAt?: string;
  /** Told it can be closed — four years without a sign-in — since when. Absent: it cannot be closed yet. */
  closableSince?: string;
}

/** What keeps an account from closing, by kind (account-closing.service.ts on the server): each has its sentence. */
export const CLOSE_OPEN_KINDS = ['parcels', 'shop-parcels', 'shop-money', 'loads', 'driver-money', 'fleet-drivers', 'fleet-loads', 'hub', 'store-parcels', 'store-orders', 'store-money', 'claims', 'id-dispute', 'account-move'] as const;
export type CloseOpenKind = (typeof CLOSE_OPEN_KINDS)[number];
export interface ClosingStanding {
  closableSince?: string;
  open: Array<{ kind: CloseOpenKind; count?: number }>;
}

type Sent = { sent: boolean; code?: string };

export interface AccountApi {
  account: AccountView | null;
  /**
   * WHO THIS SIGN-IN CONTRACTS WITH, and that company's licences and insurance policies. Null until read, and where
   * it could not be read (a sign-in that contracts with nobody is answered with no company, not with a refusal).
   */
  contract: ContractView | null;
  /** Say one of those papers is not right: which, what is wrong, and what shows it. The list is read again after. */
  reportContractPaper: (body: { source: 'licence' | 'insurance'; number: string; category: string; note: string; evidenceDataUrl: string }) => Promise<Result<{ reportId: string; answerBy: string }>>;
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
  /** "The old number is not mine any more": the PIN again. From then a parcel sent to it does not reach this account. */
  blockOldNumber: (pin: string) => Promise<Result<unknown>>;
  /** "That was not me": end every request waiting to move this account. Being signed in is what makes it theirs to say. */
  stopMove: () => Promise<Result<{ stopped: number }>>;
  /** Mute the account (it rests: nothing new reaches it), or unmute it. The menu redraws from what the server stored. */
  setMuted: (muted: boolean) => Promise<Result<unknown>>;
  /** Can it be closed, and what is still open. */
  closing: () => Promise<Result<ClosingStanding>>;
  /** Close it, with the PIN. On success every session is over, this one included. */
  closeAccount: (pin: string) => Promise<Result<{ closedAt: string }>>;
  /** This person's side of a dispute over their national ID, by their own reference. */
  idDispute: IdDisputeApi;
  /** "The number on my record is not mine — this one is." Ends a dispute at once, or a hold it left. */
  ownId: (nationalId: string) => Promise<Result<{ saved: boolean }>>;
  /** The phones and browsers this person's PIN works on: read them, forget the others, forget this one. */
  devices: PinDevicesApi;
  /**
   * WHERE THIS PAYEE IS PAID (the user, 2026-10-18): in a country that pays by M-Pesa, a number the payee set and
   * confirmed with a code. Null until read, and for a sign-in that is not paid out at all.
   */
  payout: PayoutNumberView | null;
  /** Text a code to the number to be paid to. */
  sendPayoutCode: (phone: string) => Promise<Result<Sent & { masked: string }>>;
  /** The code back: that number is the payout number from now. A change pauses payouts for a day. */
  savePayoutNumber: (code: string) => Promise<Result<PayoutNumberSaved>>;
}

const NO_CLIENT = { data: null, error: null } as unknown as Result<never>;

/** No client yet (an app still booting, or signed out) — every call is a no-op rather than a crash. */
const IDLE: AccountApi = {
  account: null,
  contract: null,
  reportContractPaper: async () => NO_CLIENT,
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
  blockOldNumber: async () => NO_CLIENT,
  stopMove: async () => NO_CLIENT,
  setMuted: async () => NO_CLIENT,
  closing: async () => NO_CLIENT,
  closeAccount: async () => NO_CLIENT,
  idDispute: idDisputeApi(async () => NO_CLIENT),
  ownId: async () => NO_CLIENT,
  devices: pinDevicesApi(async () => NO_CLIENT),
  payout: null,
  sendPayoutCode: async () => NO_CLIENT,
  savePayoutNumber: async () => NO_CLIENT,
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

  // WHO THEY CONTRACT WITH — read with the account and apart from it: whether Settings has that row depends on the
  // answer, and a failure here must not take the person's own account off the screen.
  const [contract, setContract] = useState<ContractView | null>(null);
  const loadContract = useCallback(async () => {
    if (!client) return;
    const r: Result<unknown> = await client.request((raw) => raw.GET('/v1/sbg/contract/company' as never, {} as never) as never);
    setContract(r.error || !r.data ? null : narrow<ContractView>(r.data));
  }, [client]);
  useEffect(() => {
    if (enabled && client) void loadContract();
  }, [enabled, client, loadContract]);

  // WHERE THIS PAYEE IS PAID — read apart from the account, as the contract is: a sign-in that is not paid out is
  // refused, and that must take nothing else off the screen.
  const [payout, setPayout] = useState<PayoutNumberView | null>(null);
  const loadPayout = useCallback(async () => {
    if (!client) return;
    const r: Result<unknown> = await client.request((raw) => raw.GET('/v1/sbg/payout-number' as never, {} as never) as never);
    setPayout(r.error || !r.data ? null : narrow<PayoutNumberView>(r.data));
  }, [client]);
  useEffect(() => {
    if (enabled && client) void loadPayout();
  }, [enabled, client, loadPayout]);

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
  const reportContractPaper = useCallback(
    async (body: { source: 'licence' | 'insurance'; number: string; category: string; note: string; evidenceDataUrl: string }) => {
      const r = await post<{ reportId: string; answerBy: string }>('/v1/sbg/contract/company/papers/report', body);
      // Read again: the paper now says "you reported this", and the button to report it goes with that.
      if (!r.error) await loadContract();
      return r;
    },
    [post, loadContract],
  );
  const sendEmailCode = useCallback((email: string) => post<Sent>('/v1/sbg/identity/email/request', { email }), [post]);
  const sendPhoneCode = useCallback((phone: string) => post<Sent>('/v1/sbg/auth/phone/request', { phone }), [post]);
  const confirmPhoneCode = useCallback((phone: string, code: string) => post<unknown>('/v1/sbg/auth/phone/verify', { phone, code }), [post]);
  const changeNumber = useCallback(
    async (pin: string, newPhone: string) => {
      const r = await post<{ device?: string }>('/v1/sbg/account/phone/change', { pin, newPhone });
      // No device goes with a number that moves — except this one: the code to the new number was typed here, so the
      // server hands it its key and the person signs back in on the new number with their PIN.
      saveDeviceKey(newPhone, r.data?.device);
      return r;
    },
    [post],
  );

  const blockOldNumber = useCallback(
    async (pin: string) => {
      const r = await post<unknown>('/v1/sbg/account/phone/old/block', { pin });
      // Gone from the account as the server now has it: the note and the button go with it.
      if (!r.error) setAccount((prev) => (prev ? { ...prev, oldNumber: undefined } : prev));
      return r;
    },
    [post],
  );

  const stopMove = useCallback(async () => {
    const r = await post<{ stopped: number }>('/v1/sbg/account/move-requests/stop', {});
    // Gone from the account as the server now sees it — read again rather than assumed.
    if (!r.error) setAccount((prev) => (prev ? { ...prev, moveAsked: undefined } : prev));
    return r;
  }, [post]);

  const setMuted = useCallback(
    async (muted: boolean) => {
      const r = await post<{ mutedAt?: string }>(muted ? '/v1/sbg/account/mute' : '/v1/sbg/account/unmute', {});
      // Only the mute changes: the rest of the account, as the menu already has it, stays.
      if (!r.error && r.data) setAccount((prev) => (prev ? { ...prev, mutedAt: narrow<{ mutedAt?: string }>(r.data).mutedAt } : prev));
      return r;
    },
    [post],
  );

  const closing = useCallback(async (): Promise<Result<ClosingStanding>> => {
    if (!client) return NO_CLIENT;
    return client.request((raw) => raw.GET('/v1/sbg/account/closing' as never, {} as never) as never) as Promise<Result<ClosingStanding>>;
  }, [client]);
  const closeAccount = useCallback((pin: string) => post<{ closedAt: string }>('/v1/sbg/account/close', { pin }), [post]);

  const idDispute = useMemo(() => idDisputeApi(post), [post]);
  const ownId = useCallback((nationalId: string) => post<{ saved: boolean }>('/v1/sbg/account/id-disputes/own-id', { nationalId }), [post]);
  const devices = useMemo(() => pinDevicesApi(post), [post]);
  const sendPayoutCode = useCallback((phone: string) => post<Sent & { masked: string }>('/v1/sbg/payout-number/code', { phone }), [post]);
  const savePayoutNumber = useCallback(
    async (code: string) => {
      const r = await post<PayoutNumberSaved>('/v1/sbg/payout-number', { code });
      // What the server stored, not what was typed: the row redraws from it.
      if (!r.error && r.data) setPayout(narrow<PayoutNumberSaved>(r.data));
      return r;
    },
    [post],
  );

  if (!client) return IDLE;
  return { account, contract, reportContractPaper, loading, error, busy, reload, save, changePin, saveAvatar, loadMedia, sendEmailCode, setEmail, sendPhoneCode, confirmPhoneCode, changeNumber, blockOldNumber, stopMove, setMuted, closing, closeAccount, idDispute, ownId, devices, payout, sendPayoutCode, savePayoutNumber };
}
