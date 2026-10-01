import { publicRequest, type Result, type SbgConfig, type SbgError } from '../../lib/sbg';

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
  /** A code to an email address, to CONFIRM it as a recovery address. */
  emailCode: (email: string) => Promise<Result<{ sent: boolean; code?: string }>>;
  /** A code to the address ON an account — to get back in, or to undo a number change. Answers the same for any address. */
  accountCode: (email: string, why: 'recover' | 'undo') => Promise<Result<{ sent: boolean; code?: string }>>;
  undo: (body: { phone?: string; pin?: string; email?: string; code?: string }) => Promise<Result<{ undone: boolean }>>;
  recover: (body: { email: string; code: string; nationalId?: string; newPhone: string; pin: string }) => Promise<Result<{ recovered: boolean; undoUntil?: string }>>;
}

export function recoveryApi(config: SbgConfig): RecoveryApi {
  const post = <T>(path: string, body: unknown) => publicRequest<T>(config, path, { body });
  return {
    phoneCode: (phone) => post('/v1/sbg/auth/phone/request', { phone }),
    verifyPhone: (phone, code) => post('/v1/sbg/auth/phone/verify', { phone, code }),
    emailCode: (email) => post('/v1/sbg/identity/email/request', { email }),
    accountCode: (email, why) => post('/v1/sbg/identity/account-code', { email, why }),
    undo: (body) => post('/v1/sbg/identity/phone/undo', body),
    recover: (body) => post('/v1/sbg/identity/recover', body),
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
