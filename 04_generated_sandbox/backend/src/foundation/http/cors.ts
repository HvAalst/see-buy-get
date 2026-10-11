/**
 * WHICH WEBSITES MAY CALL THIS API FROM SOMEBODY'S BROWSER.
 *
 * It answered all of them. That was written for a laptop, where each app is a dev server on its own port, and it
 * went unnoticed because the apps carry a token and not a cookie — another website cannot make a signed-in call it
 * was not handed the token for. It is still the wrong default to take out of a sandbox: every page on the internet
 * could read every public answer and drive every public door from its visitors' browsers and their addresses, which
 * is exactly how a count per caller is spread thin.
 *
 * Outside a sandbox: OUR OWN SITES — the public site, the console, and whatever the deployment lists — and nobody
 * else, with one exception that is the whole point of it: the SHIPPING API, which a store's own web page calls with
 * its publishable key, from wherever that store lives. Apps served from the same address as the API need none of
 * this; a browser does not ask.
 */
type Env = Record<string, string | undefined>;

/** What the cors middleware is told for one request: answer this origin, or do not. */
export interface CorsAnswer {
  origin: boolean;
}

const originOf = (url: string | undefined): string | undefined => {
  try {
    return url?.trim() ? new URL(url.trim()).origin : undefined;
  } catch {
    return undefined;
  }
};

/** The sites that are ours: where the apps and the console are served from, and what `GLOS_CORS_ORIGINS` adds (comma-separated). */
export function ownOrigins(env: Env = process.env): string[] {
  const listed = (env.GLOS_CORS_ORIGINS ?? '').split(',').map((s) => originOf(s));
  return [...new Set([originOf(env.SBG_PUBLIC_URL), originOf(env.SBG_CONSOLE_URL), ...listed].filter((o): o is string => Boolean(o)))];
}

/** Open to every website, by design: what a store's own page calls with its publishable key. */
export const OPEN_TO_ANY_SITE = /^\/v1\/sbg\/shipping(\/|$)/;

export function corsFor(path: string, origin: string | undefined, env: Env = process.env): CorsAnswer {
  const sandbox = (env.GLOS_ENV ?? '').trim().toLowerCase() !== 'production';
  if (sandbox || OPEN_TO_ANY_SITE.test(path)) return { origin: true };
  return { origin: origin !== undefined && ownOrigins(env).includes(origin) };
}

/** The shape `app.enableCors` takes when the answer depends on the request. */
export function corsDelegate(env: Env = process.env) {
  return (req: { url?: string; originalUrl?: string; headers: Record<string, string | string[] | undefined> }, callback: (err: Error | null, options: CorsAnswer) => void): void => {
    const path = (req.originalUrl ?? req.url ?? '').split('?')[0];
    const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
    callback(null, corsFor(path, origin, env));
  };
}
