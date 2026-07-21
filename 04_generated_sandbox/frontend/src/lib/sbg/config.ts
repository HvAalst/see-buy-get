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
  }
}

const envBase = typeof import.meta !== 'undefined' ? (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_SBG_API : undefined;

export function resolveBaseUrl(): string {
  if (envBase) return envBase;
  if (typeof window !== 'undefined' && window.SBG_API) return window.SBG_API;
  return 'http://localhost:3000';
}

export function makeConfig(app: string, version: string, overrides: Partial<SbgConfig> = {}): SbgConfig {
  return {
    baseUrl: overrides.baseUrl ?? resolveBaseUrl(),
    clientId: overrides.clientId ?? `${app}/${version}`,
    timeoutMs: overrides.timeoutMs ?? 15000,
  };
}
