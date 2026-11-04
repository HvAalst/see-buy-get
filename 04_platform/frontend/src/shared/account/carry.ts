/*
 * 2026-11-04 — ANOTHER SIGN-UP, STARTED FROM A SIGNED-IN APP ON THIS PHONE (the owner: "I am in the hub, click 'all sbg
 * apps' then select fleet and sign up. The phone number, name etc is not prefilled" — then: "Phone, name, email, country",
 * and the text code skipped). The signed-in app asks for a one-time code that carries its number, its email, the owner's
 * name and its country (POST account/my-apps/carry), and opens the next app with it in the address (#carry=…). That app's
 * sign-in keeps it for its "New here? Sign up", which hands it to the front page's sign-up — which takes it once and fills
 * itself in. What follows # in an address never reaches a server.
 */

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
