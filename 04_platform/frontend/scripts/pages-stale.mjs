/**
 * ARE THE PUBLIC PAGES OUT OF DATE? (the user, 2026-10-30: the pages built into HTML refreshed at night, so a firm
 * listed in the directory is read by search engines and AI assistants without waiting for a release.)
 *
 * The site's public pages are built into HTML when a release is made (src/apps/home/prerender.tsx), each carrying the
 * data it was built from (`prerender-data`). This reads that data from the LIVE pages and asks the live API what it says
 * now, and names every difference that changes what a page says:
 *   - the towns, and the shops in each (their names, landmarks and pages — not whether a shop is open right now);
 *   - the terms of use, the data notice and the cookie statement (which version is published);
 *   - the directory's countries and their counts, and each country's firms — everything on an entry but the counts of
 *     what we have seen, which move with every delivery and would rebuild the site every night.
 * A page the release did not build (a country listed since) is a difference too.
 *
 *   node scripts/pages-stale.mjs https://seebuyget.com
 *
 * Prints the differences; with GITHUB_OUTPUT set (the deploy workflow), writes `stale=true` or `stale=false` there.
 * A site that cannot be read fails the run: nothing is rebuilt, and the failure is seen.
 */
import { appendFileSync } from 'node:fs';

/** The site being read — set when it runs, so its tests can import the comparisons alone. */
let SITE = '';

async function get(path, as = 'json') {
  const r = await fetch(`${SITE}${path}`, { signal: AbortSignal.timeout(20_000), headers: { 'user-agent': 'seebuyget-pages-check' } });
  if (!r.ok) throw new Error(`${path} answered ${r.status}`);
  return as === 'json' ? r.json() : r.text();
}

/** What a built page was built from: its `prerender-data`, or null for a page the release did not build. */
export function builtData(html) {
  const m = /<script[^>]*id="prerender-data"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

/** The towns as a page shows them — never whether a shop is open now. */
export function townsKey(towns) {
  return JSON.stringify(
    (towns ?? [])
      .map((t) => [t.slug, t.town, t.country, (t.shops ?? []).map((s) => [s.shopName, s.landmark, s.handle ?? ''].join('|')).sort()])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  );
}

/** A directory entry as its page shows it, but for the counts of what we have seen. */
export function entriesKey(entries) {
  return JSON.stringify((entries ?? []).map(({ seen: _seen, ...rest }) => rest));
}

export function countriesKey(countries) {
  return JSON.stringify((countries ?? []).map((c) => [c.country, c.total, c.forwarder, c.clearing_agent, c.depot, c.haulier, c.at?.lat ?? null, c.at?.lng ?? null]));
}

/**
 * 2026-11-18 — where SeeBuyGet runs, as the pages name it: the countries open to everyone (joinable, not coming, not being
 * tested), the same rule as the build's (src/apps/home/pages.ts, openCountriesOf).
 */
export function openKey(rows) {
  return JSON.stringify(
    (Array.isArray(rows) ? rows : [])
      .filter((c) => c && typeof c.country === 'string' && (c.joinable === undefined ? true : c.joinable === true && !c.coming && !c.testing))
      .map((c) => c.country)
      .sort(),
  );
}

/** 2026-11-18 — a town page's prices as it shows them: the money, and each town's lowest price per size. */
export function pricesKey(prices) {
  if (!prices || !Array.isArray(prices.to)) return '';
  return JSON.stringify([prices.currency, prices.to.map((r) => [r.slug, r.from?.S ?? null, r.from?.M ?? null, r.from?.L ?? null])]);
}

async function main() {
  SITE = (process.argv[2] ?? process.env.SBG_PUBLIC_URL ?? '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//.test(SITE)) throw new Error('give the site, like https://seebuyget.com');
  const reasons = [];

  // The front page carries the towns and the three documents.
  const front = builtData(await get('/', 'text'));
  if (!front) reasons.push('the front page carries no build data');
  const towns = await get('/v1/sbg/network/towns');
  if (front && townsKey(front.towns) !== townsKey(towns.items)) reasons.push('the towns or their shops changed');
  // 2026-11-18 — what it costs from each town: a price card changed since the build, or a town priced (or not) since.
  const prices = (await get('/v1/sbg/network/prices').catch(() => ({ items: [] }))).items ?? [];
  for (const town of towns.items ?? []) {
    const live = prices.find((p) => p.slug === town.slug) ?? null;
    const built = builtData(await get(`/towns/${town.slug}/`, 'text').catch(() => ''))?.prices ?? null;
    if (pricesKey(live) !== pricesKey(built)) reasons.push(`${town.town}: its prices changed`);
  }
  // Where it runs: a country opened (or closed) since the build. The built list holds only open ones, so it is read as is.
  const countries = await get('/v1/sbg/countries');
  if (front && openKey(front.openCountries) !== openKey(countries)) reasons.push('the countries SeeBuyGet runs in changed');
  for (const which of ['terms', 'privacy', 'cookies']) {
    const live = await get(`/v1/sbg/documents/${which}`).catch(() => null);
    const was = front?.documents?.[which]?.number ?? null;
    if ((live?.number ?? null) !== was) reasons.push(`the ${which} page was built with version ${was ?? 'none'}; ${live?.number ?? 'none'} is published`);
  }

  // The directory: its countries, then each country's firms — those built, and those listed since.
  const index = await get('/v1/sbg/directory');
  const builtIndex = builtData(await get('/directory/', 'text'))?.directory?.index;
  if (!builtIndex) reasons.push('the directory’s page was not built');
  else if (countriesKey(builtIndex.countries) !== countriesKey(index.countries)) reasons.push('the directory’s countries or their counts changed');
  const codes = new Set([...(index.countries ?? []), ...(builtIndex?.countries ?? [])].map((c) => c.country));
  for (const cc of codes) {
    const live = await get(`/v1/sbg/directory/${cc}`);
    const built = builtData(await get(`/directory/${cc.toLowerCase()}/`, 'text'))?.directory?.country;
    if (!built || built.country !== cc) {
      if (live.entries.length) reasons.push(`${cc}: its page was not built`);
    } else if (entriesKey(built.entries) !== entriesKey(live.entries)) reasons.push(`${cc}: its firms changed`);
  }

  const stale = reasons.length > 0;
  console.log(stale ? `The public pages are out of date:\n- ${reasons.join('\n- ')}` : 'The public pages say what the site says.');
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `stale=${stale}\n`);
}

// Run as a script; imported (its tests), only the comparisons.
if (process.argv[1]?.replace(/\\/g, '/').endsWith('/pages-stale.mjs')) {
  main().catch((e) => {
    console.error(`pages-stale: could not read the site — ${e.message}`);
    process.exit(1);
  });
}
