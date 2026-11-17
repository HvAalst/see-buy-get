import { isSandbox } from '../runtime/sandbox';
import type { RouteState } from './code-routes.types';

/**
 * 2026-11-17 — A NUMBER CONFIRMED BY TRUECALLER, AS PLAIN FUNCTIONS (the owner, of the BRICS nations' own apps: "as
 * recommended … clear, build it"). No code is sent: Truecaller on the person's Android phone confirms the number its account
 * holds, and that number must be the one they typed. Free; from an Android browser only.
 *
 * Read from Truecaller's developer pages on 2026-11-17 (truecaller4developers.gitbook.io, mobile websites):
 *   the page opens `truecallersdk://truesdk/web_verify?type=btmsheet&requestNonce=…&partnerKey=<app key>&partnerName=…&lang=…
 *   &privacyUrl=…&termsUrl=…`; requestNonce 8–64 characters, one per request. Truecaller POSTs to the callback set in its
 *   portal: { requestId, status: "flow_invoked" } when it opened; { requestId, status: "user_rejected" } when declined; and
 *   { requestId, accessToken, endpoint } when approved. The profile is a GET of `endpoint` with `Authorization: Bearer <token>`
 *   and `Cache-Control: no-cache`; it answers `phoneNumbers` (country code first), a name and more — of which only the
 *   numbers are read here, and nothing is kept.
 *
 * THE CALLBACK CARRIES NO SIGNATURE. What makes it believable: the request number is ours, made a minute ago and secret; and
 * the profile is fetched only from an https address of Truecaller's own (`truecallerEndpoint`), so a forged callback naming
 * an address of its own confirms nothing.
 */
type Env = Record<string, string | undefined>;

export interface TruecallerConfig {
  state: RouteState;
  appKey?: string;
  appName: string;
}

/** `TRUECALLER_APP_KEY` (from its developer portal), and `TRUECALLER_APP_NAME` (default SeeBuyGet). A SANDBOX DOES NOT ASK IT. */
export function truecallerConfig(env: Env = process.env, sandbox: boolean = isSandbox()): TruecallerConfig {
  const appKey = (env.TRUECALLER_APP_KEY ?? '').trim();
  const appName = (env.TRUECALLER_APP_NAME ?? '').trim() || 'SeeBuyGet';
  if (!appKey) return { state: 'not_set_up', appName };
  if (sandbox) return { state: 'sandbox', appName };
  return { state: 'ready', appKey, appName };
}

/** The link the page opens. `site`: the site's address, for the privacy and terms pages Truecaller shows. */
export function truecallerLink(config: TruecallerConfig, nonce: string, lang: string, site: string): string {
  const q = new URLSearchParams({
    type: 'btmsheet',
    requestNonce: nonce,
    partnerKey: config.appKey ?? '',
    partnerName: config.appName,
    lang,
    ...(site ? { privacyUrl: `${site}/privacy/`, termsUrl: `${site}/terms/` } : {}),
  });
  return `truecallersdk://truesdk/web_verify?${q.toString()}`;
}

export type TruecallerCallback = { requestId: string; kind: 'invoked' } | { requestId: string; kind: 'rejected' } | { requestId: string; kind: 'approved'; accessToken: string; endpoint: string };

/** What Truecaller posted to the callback, or undefined when it is not one of its three. */
export function readTruecallerCallback(body: unknown): TruecallerCallback | undefined {
  const b = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const requestId = typeof b.requestId === 'string' ? b.requestId : '';
  if (!requestId) return undefined;
  if (typeof b.accessToken === 'string' && b.accessToken && typeof b.endpoint === 'string' && b.endpoint) return { requestId, kind: 'approved', accessToken: b.accessToken, endpoint: b.endpoint };
  if (b.status === 'flow_invoked') return { requestId, kind: 'invoked' };
  if (b.status === 'user_rejected') return { requestId, kind: 'rejected' };
  return undefined;
}

/** The profile is fetched only from an https address of Truecaller's own: anything else is a forged callback's. */
export function truecallerEndpoint(endpoint: string): string | undefined {
  try {
    const url = new URL(endpoint);
    const own = url.hostname === 'truecaller.com' || url.hostname.endsWith('.truecaller.com');
    return url.protocol === 'https:' && own && !url.username && !url.password ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** The numbers a profile holds, as E.164. Everything else in it is left unread. */
export function truecallerNumbers(profile: unknown): string[] {
  const raw = (profile as { phoneNumbers?: unknown } | undefined)?.phoneNumbers;
  if (!Array.isArray(raw)) return [];
  return raw.map((n) => String(n ?? '').replace(/\D/g, '')).filter((d) => d.length >= 8 && d.length <= 15).map((d) => `+${d}`);
}
