import { publicRequest, type Result, type SbgConfig, type SbgError } from '../../lib/sbg';
import { saveDeviceKey } from './pin';
import { idDisputeApi, type DisputeOpened, type IdDisputeApi, type IdRegister } from './idDispute';
import type { MoveAsked, MoveStatus } from './move';

/**
 * THE DOORS A PERSON USES BEFORE THEY ARE SIGNED IN — the same in every app.
 *
 * Confirming an email address, getting back into an account whose number is gone, undoing a number change: all of
 * them happen at a sign-in screen, with no token, so they go through `publicRequest` against the public routes.
 * Every app that has a sign-in screen builds this from its own config and hands it to the shared sheets.
 */
export interface RecoveryApi {
  /** A code to a phone number (echoed back only in a sandbox). */
  phoneCode: (phone: string) => Promise<Result<{ sent: boolean; code?: string }>>;
  verifyPhone: (phone: string, code: string) => Promise<Result<{ verified: boolean }>>;
  /**
   * THIS DEVICE, CONFIRMED — after the code to the phone has been checked. The key the server hands back is kept on
   * the device (`saveDeviceKey`): from then on the PIN works here.
   */
  confirmDevice: (phone: string) => Promise<Result<{ device: string }>>;
  /** A code to an email address, to CONFIRM it as a recovery address. */
  emailCode: (email: string) => Promise<Result<{ sent: boolean; code?: string }>>;
  /** A code to the address ON an account — to get back in, or to undo a number change. Answers the same for any address. */
  accountCode: (email: string, why: 'recover' | 'undo') => Promise<Result<{ sent: boolean; code?: string }>>;
  undo: (body: { phone?: string; pin?: string; email?: string; code?: string }) => Promise<Result<{ undone: boolean }>>;
  recover: (body: { email: string; code: string; nationalId?: string; newPhone: string; pin: string }) => Promise<Result<{ recovered: boolean; undoUntil?: string; device?: string }>>;
  /** No number, no PIN, no inbox: ask two members of staff to move the account. The new number is already confirmed by a code. */
  askStaff: (body: { oldPhone: string; newPhone: string; nationalId?: string; note?: string }) => Promise<Result<MoveAsked>>;
  /** What became of it, by the reference that was handed back. */
  moveStatus: (reference: string) => Promise<Result<MoveStatus>>;
  /** Refused at registration because somebody else holds the national ID: open a dispute. The phone is already confirmed by a code. */
  openIdDispute: (body: { register: IdRegister; nationalId: string; phone: string }) => Promise<Result<DisputeOpened>>;
  /** Either person's side of a dispute over a national ID, by their own reference. */
  idDispute: IdDisputeApi;
}

export function recoveryApi(config: SbgConfig): RecoveryApi {
  const post = <T>(path: string, body: unknown) => publicRequest<T>(config, path, { body });
  return {
    phoneCode: (phone) => post('/v1/sbg/auth/phone/request', { phone }),
    verifyPhone: (phone, code) => post('/v1/sbg/auth/phone/verify', { phone, code }),
    confirmDevice: async (phone) => {
      const r = await post<{ device: string }>('/v1/sbg/identity/device', { phone });
      saveDeviceKey(phone, r.data?.device);
      return r;
    },
    emailCode: (email) => post('/v1/sbg/identity/email/request', { email }),
    accountCode: (email, why) => post('/v1/sbg/identity/account-code', { email, why }),
    undo: (body) => post('/v1/sbg/identity/phone/undo', body),
    // The code to the NEW number was typed on this device: the server hands it its key, and the new PIN works here.
    recover: async (body) => {
      const r = await post<{ recovered: boolean; undoUntil?: string; device?: string }>('/v1/sbg/identity/recover', body);
      saveDeviceKey(body.newPhone, r.data?.device);
      return r;
    },
    askStaff: (body) => post('/v1/sbg/identity/move-requests', body),
    moveStatus: (reference) => post('/v1/sbg/identity/move-requests/status', { reference }),
    openIdDispute: (body) => post('/v1/sbg/identity/id-disputes', body),
    idDispute: idDisputeApi(post),
  };
}

const fieldOf = (error: SbgError | null | undefined): string | undefined => {
  const field = (error?.params as { field?: unknown } | undefined)?.field;
  return typeof field === 'string' ? field : undefined;
};

/**
 * The server is asking for the recovery email — not refusing the PIN. A new person choosing a PIN is told so as the
 * next thing to fill in, never as an error; somebody who already gave an address is never asked.
 */
export function asksForEmail(error: SbgError | null | undefined): boolean {
  if (!error) return false;
  const field = fieldOf(error);
  return (error.code === 'FIELD_REQUIRED' && field === 'email') || error.code === 'EMAIL_NOT_VERIFIED';
}

/** The server is asking for the national ID number a driver or shopkeeper registered with. */
export function asksForNationalId(error: SbgError | null | undefined): boolean {
  return fieldOf(error) === 'nationalId';
}

/** Plausible, not deliverable — the code is the real test. Mirrors the server's check. */
export function looksLikeEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/**
 * WHAT THE SETTINGS ROW SAYS UNDER "Recovery email": the address (masked, as the server gives it), that there is
 * none — or that email to it is COMING BACK. That last one is a live fact about the account, not teaching: it is
 * said for as long as it is true, on the row somebody would press to put it right.
 */
/**
 * What Settings say of the number an account moved off, for as long as it is still the account's: until when a parcel
 * sent to it arrives, and whether its holder can block it yet. A live fact, said for as long as it is true.
 */
export function oldNumberSays(
  me: { oldNumber?: { until: string; canBlock: boolean } } | null | undefined,
  t: (key: never, vars?: Record<string, string | number>) => string,
  when: (iso: string) => string,
): { title: string; detail: string; canBlock: boolean } | null {
  const say = t as (key: string, vars?: Record<string, string | number>) => string;
  const old = me?.oldNumber;
  if (!old) return null;
  const until = when(old.until);
  return { title: say('account.settings.oldNumber.kept', { until }), detail: say(old.canBlock ? 'account.settings.oldNumber.blockWhenReady' : 'account.settings.oldNumber.notYet', { until }), canBlock: old.canBlock };
}

export function recoveryEmailSays(me: { email?: string; emailBounced?: boolean } | null | undefined, t: (key: never, vars?: Record<string, string | number>) => string): { sub: string; bounced: boolean } {
  const say = t as (key: string, vars?: Record<string, string | number>) => string;
  if (!me?.email) return { sub: say('account.settings.emailNone'), bounced: false };
  return me.emailBounced ? { sub: say('account.settings.emailBouncedSub', { email: me.email }), bounced: true } : { sub: me.email, bounced: false };
}
