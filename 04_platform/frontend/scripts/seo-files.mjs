/**
 * robots.txt AND sitemap.xml FOR THE PUBLIC SITE — written into dist/ after the build, from what the build made.
 *
 * The sitemap lists every page the build prerendered (the front page and each town page: any index.html in dist/
 * outside the installable apps), so it can never name a page that does not exist — the old hand-written one in
 * src/ named a dozen pages from a site that is gone. robots.txt welcomes search and AI crawlers to the public pages
 * and keeps them out of the apps behind sign-in. It never mentions the operator console: that lives on its own
 * address, and naming it here would advertise it.
 *
 * `SBG_PUBLIC_URL` is the site's own address; a sitemap needs absolute URLs, so without it only robots.txt is
 * written (with no Sitemap line) and the build says so.
 *
 *   node scripts/seo-files.mjs        (build-all runs it after a full build)
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = resolve(ROOT, 'dist');
const SITE = (process.env.SBG_PUBLIC_URL ?? '').trim().replace(/\/+$/, '');
/** The installable apps: behind a sign-in, nothing for a crawler. */
const APPS = ['driver', 'agent', 'send', 'fleet', 'mdp', 'vendor'];
/** Kept from crawlers: the apps behind a sign-in. The Send app is public — prices, booking, tracking — so it is read. */
const PRIVATE = APPS.filter((a) => a !== 'send');

if (!existsSync(DIST)) {
  console.error('seo-files: no dist/ — build first');
  process.exit(1);
}

/** Every prerendered page: dist/index.html and dist/<path>/index.html, outside the apps and the asset folders. */
function pages(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const rel = relative(DIST, full).split(sep).join('/');
    if (statSync(full).isDirectory()) {
      if (dir === DIST && (APPS.includes(name) || ['assets', 'icons', 'img', 'embed'].includes(name))) continue;
      pages(full, out);
    } else if (name === 'index.html') {
      out.push('/' + rel.replace(/index\.html$/, ''));
    }
  }
  return out;
}

const found = pages(DIST).sort((a, b) => (a === '/' ? -1 : b === '/' ? 1 : a.localeCompare(b)));
const today = new Date().toISOString().slice(0, 10);

const robots = [
  '# SeeBuyGet — the public site. Search and AI crawlers are welcome on the public pages.',
  'User-agent: *',
  'Allow: /',
  ...PRIVATE.map((a) => `Disallow: /${a}/`),
  '',
  '# Named so the welcome is explicit: these read the public pages to answer questions about sending parcels.',
  ...['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot', 'PerplexityBot', 'Google-Extended', 'Applebot-Extended'].flatMap((bot) => [`User-agent: ${bot}`, 'Allow: /', ...PRIVATE.map((a) => `Disallow: /${a}/`), '']),
  ...(SITE ? [`Sitemap: ${SITE}/sitemap.xml`] : []),
  '',
].join('\n');
writeFileSync(join(DIST, 'robots.txt'), robots);

/*
 * llms.txt — a short plain summary for AI assistants (a young convention: cheap, and read by some). Facts only, and
 * the public pages only; the towns are the ones the build actually rendered.
 */
const abs = (p) => `${SITE}${p}`;
/** The town's own spelling, from the page the build rendered (its heading), not from its address. */
const townName = (p) => {
  const html = readFileSync(join(DIST, p, 'index.html'), 'utf8');
  return (html.match(/<h1[^>]*>Parcel shops in ([^<]+)<\/h1>/)?.[1] ?? p.replace('/towns/', '').replace(/\/$/, '')).trim();
};
const towns = found.filter((p) => p.startsWith('/towns/'));
writeFileSync(
  join(DIST, 'llms.txt'),
  [
    '# SeeBuyGet',
    '',
    '> SeeBuyGet is a parcel network of neighbourhood shops, drivers and sort hubs. A parcel is sent to a shop and collected from a shop with a code, so nobody needs a street address. The price is shown before sending, with no account, and is paid at the counter.',
    '',
    '## How it works',
    '- See the price first: choose the shop to send from and the shop to collect at; no account is needed.',
    '- Drop the parcel at the sending shop and pay there. It is photographed at drop-off.',
    '- The receiver finds the parcel and its collection code in the Send app, on the phone number it was sent to (SeeBuyGet sends no text about a parcel), and collects it at the chosen shop with the code. Nobody without the code can collect it.',
    '- Shops and drivers are ID-checked. A consignment note can be checked for authenticity on the front page.',
    '',
    '## Pages',
    `- [Front page](${abs('/')}): how it works, the network's live figures, who it is for, questions and answers`,
    `- [Send or track a parcel](${abs('/send/')}): prices, booking and tracking by tracking code`,
    `- [Help](${abs('/help/')}): how each app works, signing in, codes and PINs — one page per article — and how to write to us`,
    ...(towns.length ? ['', '## Towns with parcel shops', ...towns.map((p) => `- [${townName(p)}](${abs(p)})`)] : []),
    '',
    '## Earning with the network',
    '- Shops earn a fee on every parcel they take in or hand out; drivers and riders per load; sort hubs per parcel sorted; online stores ship to shops for click-and-collect.',
    '',
  ].join('\n'),
);

if (SITE) {
  const urls = found.map((p) => `  <url><loc>${SITE}${p}</loc><lastmod>${today}</lastmod>${p === '/' ? '<priority>1.0</priority>' : ''}</url>`);
  writeFileSync(join(DIST, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`);
  console.log(`seo-files: robots.txt, and sitemap.xml with ${found.length} page(s)`);
} else {
  console.log(`seo-files: robots.txt written; no sitemap.xml — set SBG_PUBLIC_URL to the site's address (found ${found.length} page(s))`);
}
