import createClient, { type Client, type Middleware } from 'openapi-fetch';
import type { paths } from './schema';
import type { SbgConfig } from './config';
import type { Session } from './session';
import { type SbgError, clientError, toSbgError } from './errors';

/**
 * Result envelope — a business failure is DATA, never an exception. Every call resolves to exactly one
 * of these; call sites branch on `error` instead of try/catch. This is the single divergence that lets
 * a low-literacy UI render an icon for a 402/409 the same way it renders a success.
 */
export interface Ok<T> {
  data: T;
  error: null;
  status: number;
}
export interface Err {
  data: null;
  error: SbgError;
  status: number;
}
export type Result<T> = Ok<T> | Err;

/** The raw openapi-fetch result shape (resolves for HTTP errors; rejects only on network/abort). */
type Raw<T> = { data?: T; error?: unknown; response: Response };

export interface SbgClientOptions {
  config: SbgConfig;
  session: Session;
  /** Override the trace-id generator (deterministic in tests). */
  traceId?: () => string;
  /** Override fetch (for tests / a custom transport). */
  fetch?: typeof fetch;
}

export interface SbgClient {
  /** The typed openapi-fetch client — call `client.GET('/v1/sbg/...', {...})`. */
  raw: Client<paths>;
  /**
   * Run a typed call through the envelope + resilience layer: injects auth/version/trace headers,
   * enforces the timeout, re-mints once on 401, and normalizes every outcome to a Result.
   */
  request<T>(fn: (raw: Client<paths>) => Promise<Raw<T>>): Promise<Result<T>>;
}

const HEX = '0123456789abcdef';
function defaultTraceId(): string {
  // Vary without Math.random dependency concerns; good enough for correlation, not security.
  let s = 'trc_';
  const seed = (typeof performance !== 'undefined' ? performance.now() : 0) * 1000;
  for (let i = 0; i < 16; i++) s += HEX[Math.floor((seed + i * 7.13) % 16)];
  return s;
}

export function createSbgClient(opts: SbgClientOptions): SbgClient {
  const { config, session } = opts;
  const genTrace = opts.traceId ?? defaultTraceId;
  const baseFetch = opts.fetch ?? fetch;

  // Per-request timeout — a hung socket on EDGE must not wedge the UI.
  const timeoutFetch: typeof fetch = async (input, init) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      return await baseFetch(input as RequestInfo, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  };

  const headerMiddleware: Middleware = {
    async onRequest({ request }) {
      const token = await session.getToken();
      request.headers.set('Authorization', `Bearer ${token}`);
      request.headers.set('X-SBG-Client', config.clientId);
      request.headers.set('X-SBG-Trace-Id', genTrace());
      return request;
    },
  };

  const raw = createClient<paths>({ baseUrl: config.baseUrl, fetch: timeoutFetch });
  raw.use(headerMiddleware);

  async function request<T>(fn: (c: Client<paths>) => Promise<Raw<T>>): Promise<Result<T>> {
    let outcome = await attempt(fn);
    // Re-mint once on 401: the middleware injects a fresh token on the retry via session.getToken().
    if (outcome.kind === 'http' && outcome.response.status === 401) {
      session.clear();
      outcome = await attempt(fn);
    }
    return normalize<T>(outcome);
  }

  async function attempt<T>(fn: (c: Client<paths>) => Promise<Raw<T>>): Promise<Attempt<T>> {
    try {
      const r = await fn(raw);
      return { kind: 'http', data: r.data, error: r.error, response: r.response };
    } catch (e) {
      return { kind: 'thrown', error: e };
    }
  }

  return { raw, request };
}

type Attempt<T> = { kind: 'http'; data?: T; error?: unknown; response: Response } | { kind: 'thrown'; error: unknown };

function normalize<T>(a: Attempt<T>): Result<T> {
  if (a.kind === 'thrown') {
    const aborted = a.error instanceof Error && a.error.name === 'AbortError';
    return { data: null, error: clientError(aborted ? 'TIMEOUT' : 'NETWORK', String((a.error as Error)?.message ?? a.error)), status: 0 };
  }
  const status = a.response.status;
  if (status === 426) {
    return { data: null, error: clientError('CLIENT_OUTDATED', 'This app must be updated to continue.'), status };
  }
  if (a.error !== undefined || !a.response.ok) {
    return { data: null, error: toSbgError(a.error, status), status };
  }
  return { data: (a.data ?? null) as T, error: null, status };
}
