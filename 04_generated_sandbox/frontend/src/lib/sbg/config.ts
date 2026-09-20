/**
 * SeeBuyGet API library — runtime configuration.
 *
 * baseUrl is the server ORIGIN (no /v1/sbg) — the generated OpenAPI paths already carry the full
 * `/v1/sbg/...` prefix, so openapi-fetch prepends only the origin. It resolves from the build-time env,
 * then a window global, then localhost — so a page that never sets either still works in the sandbox
 * (the historical `window.GLOS_API` was referenced everywhere and assigned nowhere, so only the fallback
 * ever ran; this keeps that working while allowing override).
 */
export interface SbgConfig {
  /** Server origin, e.g. https://api.seebuyget.com — NOT including /v1/sbg. */
  baseUrl: string;
  /** Sent as `X-SBG-Client: <app>/<version>` so the server can 426 an out-of-date app in the field. */
  clientId: string;
  /** Per-request timeout (ms) before the AbortController fires — a hung socket on EDGE must not wedge the UI. */
  timeoutMs: number;
}

declare global {
  interface Window {
    SBG_API?: string;
    /** Origin of the public site, for /@handle links from an app served on another port. */
    SBG_SITE?: string;
  }
}

const envBase = typeof import.meta !== 'undefined' ? (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_SBG_API : undefined;
/** Same escape hatch for the public site, so a split-port sandbox can still open a participant page. */
const envSite = typeof import.meta !== 'undefined' ? (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_SBG_SITE : undefined;

export function resolveBaseUrl(): string {
  if (envBase) return envBase;
  if (typeof window !== 'undefined' && window.SBG_API) return window.SBG_API;
  return 'http://localhost:3000';
}

/**
 * WHERE A PARTICIPANT'S PUBLIC PAGE LIVES — `/@handle`, the canonical address of the directory.
 *
 * Relative by default, which is correct wherever the apps are one site: seebuyget.com/@fedex is the page
 * and every app can link straight at it. In a split-port development sandbox the home app is not at the
 * root of whatever port the console is on, so `window.SBG_SITE` overrides the origin — the same escape
 * hatch `window.SBG_API` already is for the backend, and for the same reason.
 *
 * A HANDLE THAT IS NOT A HANDLE GETS NO LINK. Handles are lowercase, url-safe and issued by us; anything
 * else arriving here is not something to put in an href, and returning null lets the caller draw the name
 * without a door behind it rather than a door that opens somewhere unintended.
 */
export function publicPageUrl(handle: string): string | null {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(handle)) return null;
  const site = envSite || (typeof window !== 'undefined' && window.SBG_SITE) || '';
  return `${site.replace(/\/$/, '')}/@${handle}`;
}

export function makeConfig(app: string, version: string, overrides: Partial<SbgConfig> = {}): SbgConfig {
  return {
    baseUrl: overrides.baseUrl ?? resolveBaseUrl(),
    clientId: overrides.clientId ?? `${app}/${version}`,
    timeoutMs: overrides.timeoutMs ?? 15000,
  };
}
