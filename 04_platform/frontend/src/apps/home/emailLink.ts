/**
 * THE KEY OF A "YES, IT IS ME" EMAIL (2026-11-03), out of the part of an address a browser sends to no server: `#link=<token>`.
 *
 * The email was sent because an address that signs in to one kind of SeeBuyGet account was used to sign up another (a
 * shop, a hub, a store). Its button lands here; the page asks once more, and one tap links the two. `undefined` only when
 * the address is not about such a link at all. Whatever follows `link=` is handed back as it is: a mail program that cut
 * the address short has still sent somebody here, and the page says so rather than showing the front door.
 */
export function readEmailLink(hash: string | undefined): string | undefined {
  const m = /(?:^#|&)link=([^&]*)/.exec(hash ?? '');
  if (!m) return undefined;
  try {
    return decodeURIComponent(m[1]).trim().slice(0, 80);
  } catch {
    return m[1].trim().slice(0, 80);
  }
}

/** Could this be one of ours at all? 24 random bytes, base64url: 32 characters. Anything else is not asked about. */
export function looksLikeALinkToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{32}$/.test(token);
}
