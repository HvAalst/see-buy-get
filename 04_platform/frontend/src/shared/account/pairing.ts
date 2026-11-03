import { publicRequest, type Result, type SbgConfig } from '../../lib/sbg';
import { qrPayload } from '../qr';

/*
 * A NEW PHONE LINKED BY ONE THE ACCOUNT ALREADY USES (the owner, 2026-11-03: "A different device can be linked like the dutch
 * digid with a qr and a couple code or something similar"). The password was right on the new phone; it shows a pairing
 * code — a QR code, and the same eight letters and digits in words — and asks after it every few seconds. One of the
 * shop's, hub's or store's own phones, signed in, scans or types it under Settings → "Link a new phone"; the new phone is
 * then signed in, and one of the account's phones. It needs no code to the account's number, so it works where none can
 * be texted.
 */

export interface PairShown {
  pairCode: string;
  expiresIn: number;
  /** How many phones the account has that could scan it: none, and the screen says to use the code to its number. */
  phones: number;
}

/** The new phone, signed in: the same answer a code typed on it gives, so each app enters as it always does. */
export interface Paired {
  linked: true;
  role: string;
  did: string;
  email: string;
  token: { access_token: string; expires_in?: number };
  device?: string;
  /** A store's: its id, as the store's own door answers. */
  vendorId?: string;
}

export type PairStatus = { linked: false; expiresIn: number } | Paired;

export function startPairing(config: SbgConfig, challenge: string): Promise<Result<PairShown>> {
  return publicRequest<PairShown>(config, '/v1/sbg/auth/device/pair', { body: { challenge } });
}

export function pairingStatus(config: SbgConfig, challenge: string): Promise<Result<PairStatus>> {
  return publicRequest<PairStatus>(config, '/v1/sbg/auth/device/pair/status', { body: { challenge } });
}

/** What the QR code says: the code, under the scheme every SeeBuyGet code carries. */
export const pairQr = (code: string): string => qrPayload('pair', code);

/** The code as it is shown and read out: two groups of four. */
export const shownPairCode = (code: string): string => (code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code);

/** The code as typed — any case, with or without the dash — ready to send; null while it cannot be one. */
export function typedPairCode(typed: string): string | null {
  const code = typed.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return code.length === 8 ? code : null;
}
