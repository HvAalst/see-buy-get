/**
 * 2026-11-01 — THE INVITE A LINK CARRIED, held on this device until its person signs up.
 *
 * A shared link opens the front page (`/?invite=<token>`), and the newcomer may sign up there or move on to the Send or
 * Business app first; every app's sign-up passes the held token, so the person who shared the link is counted wherever
 * the newcomer joins. The server credits it only on a FIRST sign-up, so a member who opens a link changes nothing. Kept
 * thirty days, then forgotten; dropped once this device has signed up. Only the opaque token is kept — never a name.
 */
const KEY = 'sbg.invite';
const KEEP_MS = 30 * 24 * 3600 * 1000;

/** Keep the token in this page's address, if it has one (the landing). */
export function captureInvite(search: string = globalThis.location?.search ?? '', now = Date.now()): string | null {
  const token = new URLSearchParams(search).get('invite')?.trim();
  if (!token) return null;
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify({ token, at: now }));
  } catch {
    /* storage blocked: the token still goes from this page's own address */
  }
  return token;
}

/** The token this device holds: the page's own address first, else one kept within thirty days. */
export function heldInvite(search: string = globalThis.location?.search ?? '', now = Date.now()): string | undefined {
  const here = new URLSearchParams(search).get('invite')?.trim();
  if (here) return here;
  try {
    const kept = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? 'null') as { token?: unknown; at?: unknown } | null;
    if (kept && typeof kept.token === 'string' && typeof kept.at === 'number' && now - kept.at <= KEEP_MS) return kept.token;
  } catch {
    /* nothing kept, or storage blocked */
  }
  return undefined;
}

/** This device signed up: the invite is spent (or was never needed). */
export function dropInvite(): void {
  try {
    globalThis.localStorage?.removeItem(KEY);
  } catch {
    /* storage blocked */
  }
}

/** The sign-up body's part: the token, when one is held. */
export function inviteBody(): { inviteToken?: string } {
  const token = heldInvite();
  return token ? { inviteToken: token } : {};
}
