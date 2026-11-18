/**
 * WHEN A PAGE LAST CHANGED — for the sitemap's dates (the owner, 2026-11-18: "Is SBG optimized for GEO?").
 *
 * Every build used to stamp every page with the day it ran, nightly rebuilds included, so the dates said nothing and
 * search engines learn to ignore dates like that. Now each page carries the day its CONTENT last changed: what a reader
 * and a machine read of it — its title, description, structured data, its body as built and the data it was built from
 * — hashed, and compared with what the site published last time (page-dates.json, beside the sitemap). Unchanged: the
 * date it had. Changed, new, or nothing to compare with: today. Never the asset names a build gives its scripts.
 */
import { createHash } from 'node:crypto';

const pick = (html, re) => [...html.matchAll(re)].map((m) => m[1] ?? m[0]).join('\n');

/** What a page says, hashed: never its scripts' or style sheets' addresses, which change with every build. */
export function pageHash(html) {
  const said = [
    pick(html, /<title>([\s\S]*?)<\/title>/g),
    pick(html, /<meta\s+name="description"\s+content="([^"]*)"/g),
    pick(html, /<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g),
    pick(html, /<script[^>]*id="prerender-data"[^>]*>([\s\S]*?)<\/script>/g),
    // The body as built: the markup the app draws into, without its scripts.
    (/<div id="app"[^>]*>([\s\S]*)<\/div>\s*(?:<script|<\/body>)/.exec(html)?.[1] ?? '').replace(/<script[\s\S]*?<\/script>/g, ''),
  ].join('\n\u0000\n');
  return createHash('sha256').update(said).digest('hex').slice(0, 16);
}

/**
 * Each page's date: kept where its hash is what was published last time, today where it changed or is new.
 * `hashes` and the answer are keyed by the page's path; `previous` is the published page-dates.json, or null.
 */
export function datesFor(hashes, previous, today) {
  const was = previous && typeof previous === 'object' && previous.pages && typeof previous.pages === 'object' ? previous.pages : {};
  const out = {};
  for (const [path, hash] of Object.entries(hashes)) {
    const before = was[path];
    const kept = before && before.hash === hash && /^\d{4}-\d{2}-\d{2}$/.test(String(before.date)) && before.date <= today;
    out[path] = { hash, date: kept ? before.date : today };
  }
  return out;
}

/** The published dates, or null when the site cannot be read (a first build, no network): every page is then today's. */
export async function publishedDates(site) {
  if (!site) return null;
  try {
    const r = await fetch(`${site}/page-dates.json`, { signal: AbortSignal.timeout(10_000), headers: { 'user-agent': 'seebuyget-build' } });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}
