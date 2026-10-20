/**
 * A GS1 COMPANY PREFIX, as every app that prints under one reads it: a business's (round 16), a forwarder's client's
 * (round 20), a store's (round 29). One rule for all of them — a prefix shared only under different extension digits,
 * and a prefix two say is theirs decided by two members of SeeBuyGet staff on the licences — so one reading of it.
 */

/** The prefix as its holder's screens read it: the digit, how many codes are left under it, who set it and when. */
export interface Gs1View {
  companyPrefix: string;
  extensionDigit: number;
  left: number;
  setAt: string;
  setBy: string;
}

/** One dispute about a prefix, as a party to it reads it: its side, the others by name, where it stands. */
export interface Gs1DisputeView {
  disputeId: string;
  companyPrefix: string;
  extensionDigit: number;
  side: 'claimant' | 'holder';
  state: 'open' | 'proposed' | 'decided' | 'withdrawn';
  openedAt: string;
  answerBy: string;
  claimantName: string;
  holderNames: string[];
  licenceSent: boolean;
  /** Round 20 — the client a forwarder stands for in it. */
  forClient?: string;
  decided?: { mine: boolean; reason: string; at: string };
  withdrawnAt?: string;
}

/** The refusal a party may answer with its licence: another prints under that prefix and digit. */
export const PREFIX_TAKEN = 'GS1_PREFIX_TAKEN';

export type DisputeTone = 'ok' | 'warn' | 'danger' | 'idle';

const alive = (d: Gs1DisputeView) => d.state === 'open' || d.state === 'proposed';

/** The party using the prefix can still send its licence — or a clearer one. */
export function maySendLicence(d: Gs1DisputeView): boolean {
  return d.side === 'holder' && alive(d);
}

/** The party that opened it can take it back while nothing is decided. */
export function mayTakeBack(d: Gs1DisputeView): boolean {
  return d.side === 'claimant' && alive(d);
}

/** Over for a month: no longer worth a line. */
export function stillWorthShowing(d: Gs1DisputeView, now: number): boolean {
  const over = d.decided?.at ?? d.withdrawnAt;
  return !over || now - Date.parse(over) < 30 * 86_400_000;
}

/** A prefix as it was typed — spaces and dashes dropped — or undefined when it is not 6 to 12 digits. */
export function cleanPrefix(raw: string): string | undefined {
  const digits = raw.replace(/[\s-]/g, '');
  return /^\d{6,12}$/.test(digits) ? digits : undefined;
}

/** An SSCC as GS1 prints it for a person: the extension digit, the prefix, the serial, the check digit. */
export function ssccSpaced(sscc: string, prefixLength: number): string {
  return `${sscc[0]} ${sscc.slice(1, 1 + prefixLength)} ${sscc.slice(1 + prefixLength, 17)} ${sscc[17]}`;
}
