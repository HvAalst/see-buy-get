/*
 * 2026-11-04 — ANOTHER SIGN-UP, STARTED FROM A SIGNED-IN APP ON THIS PHONE (the owner: "I am in the hub, click 'all sbg
 * apps' then select fleet and sign up. The phone number, name etc is not prefilled" — then: "Phone, name, email, country",
 * and the text code skipped). The signed-in app asks for a one-time code that carries its number, its email, the owner's
 * name and its country (POST account/my-apps/carry), and opens the next app with it in the address (#carry=…). That app's
 * sign-in keeps it for its "New here? Sign up", which hands it to the front page's sign-up — which takes it once and fills
 * itself in. What follows # in an address never reaches a server.
 */

import { publicRequest, type Result, type SbgConfig } from '../../lib/sbg';

/** What a signed-in app carried, as the sign-up takes it. */
export interface Carried {
  email?: string;
  phone?: string;
  name?: string;
  country?: string;
  /** The number came checked: the sign-up asks no text code for it. */
  phoneChecked: boolean;
  /** The number already opens with a PIN: the sign-up asks for that one — never a new one in its place. */
  hasPin?: boolean;
}

/** Taken once, by whichever sign-up was opened with it. */
export function takeCarry(config: SbgConfig, code: string): Promise<Result<Carried>> {
  return publicRequest<Carried>(config, '/v1/sbg/auth/join-carry', { body: { code } });
}

/**
 * Where an app's own sign-up starts with it (Business, Send): the number and the email filled in — and, for a number that
 * already opens with a PIN, that PIN asked; for a checked number without one, straight to choosing it; else at the number.
 */
export function carriedEntry(c: Carried): { phone: string; email: string; start: 'signin' | 'choose' | 'phone' } {
  const phone = c.phone ?? '';
  return { phone, email: c.email ?? '', start: phone && c.hasPin ? 'signin' : phone && c.phoneChecked ? 'choose' : 'phone' };
}

/** Reads #carry= out of this page's address — the address cleaned of it — and takes it: undefined where there is none. */
export function takeCarryFromAddress(config: SbgConfig): Promise<Result<Carried>> | undefined {
  const code = readCarry(globalThis.location?.hash);
  if (!code) return undefined;
  try {
    history.replaceState(null, '', `${location.pathname}${location.search}`);
  } catch {
    /* a browser that refuses the rewrite still fills the form */
  }
  return takeCarry(config, code);
}

const KEY = 'sbg-carry';
/** As long as the server holds it. */
export const CARRY_KEEP_MS = 10 * 60_000;

/** The code in an address's `#carry=…`, or undefined. */
export function readCarry(hash: string | undefined): string | undefined {
  const m = /(?:^#|&)carry=([^&]+)/.exec(hash ?? '');
  if (!m) return undefined;
  try {
    const code = decodeURIComponent(m[1]).trim();
    return /^jc_[A-Za-z0-9_-]{8,80}$/.test(code) ? code : undefined;
  } catch {
    return undefined;
  }
}

/** An address with the code after it — or as it was, with none. */
export const withCarry = (href: string, code: string | undefined): string => (code ? `${href.split('#')[0]}#carry=${encodeURIComponent(code)}` : href);

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
function tabStore(): Store | undefined {
  try {
    return globalThis.sessionStorage;
  } catch {
    return undefined;
  }
}

/**
 * The code this tab was opened with: from the address — kept for the tab, and the address cleaned of it — else the one
 * kept, while it is fresh. Read once, where the sign-up link is drawn.
 */
export function keptCarry(now: number = Date.now(), loc: Pick<Location, 'hash' | 'pathname' | 'search'> | undefined = globalThis.location, store: Store | undefined = tabStore()): string | undefined {
  const fromAddress = readCarry(loc?.hash);
  if (fromAddress) {
    try {
      store?.setItem(KEY, JSON.stringify({ code: fromAddress, at: now }));
    } catch {
      /* a private tab that keeps nothing still has the address */
    }
    try {
      if (loc) globalThis.history?.replaceState(null, '', `${loc.pathname}${loc.search}`);
    } catch {
      /* a browser that refuses the rewrite still carries the code */
    }
    return fromAddress;
  }
  try {
    const held = JSON.parse(store?.getItem(KEY) ?? 'null') as { code?: string; at?: number } | null;
    if (held?.code && typeof held.at === 'number' && now - held.at < CARRY_KEEP_MS) return held.code;
    store?.removeItem(KEY);
  } catch {
    /* nothing kept */
  }
  return undefined;
}
