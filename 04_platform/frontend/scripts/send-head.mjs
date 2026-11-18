/**
 * 2026-11-18 — THE SEND PAGE AS A SEARCH ENGINE OR AN AI ASSISTANT READS IT (the owner: "do it", of the weakness named after
 * the GEO work). /send/ is where the price and the tracking live, yet its HTML said one line, named no address of its own,
 * carried no structured data, and its link-preview picture was a file that does not exist (social-card.png, 404), so a
 * shared invite showed no picture. Written into the Send app's index.html at build time (vite.config.ts):
 *
 *   - a title and a description that say what the page does;
 *   - its canonical address, and a link preview with the share card that does exist, at its full address and size;
 *   - structured data: a web application of SeeBuyGet's, with the tracking address (?track=<code>) as its action;
 *   - a short summary inside the app's element, read by a crawler that runs no script and replaced when the app starts.
 *
 * Without the site's address (a local build) no absolute address is written, as on the other public pages.
 */
export const SHARE_CARD = { path: '/img/share-card.png', width: 1200, height: 630, type: 'image/png' };

export const SEND_TITLE = 'SeeBuyGet Send — see the price, send and track a parcel';
export const SEND_DESCRIPTION =
  'See what a parcel costs before you send it, with no account: choose the shop to send from and the shop to collect at, hand it in and pay at the counter, and follow it with its tracking code. The receiver collects it with a code.';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** What the page says to a reader that runs no script: replaced the moment the app starts. */
export const SEND_SUMMARY = [
  '<main class="send-about" style="max-width:36rem;margin:0 auto;padding:24px 16px;line-height:1.5">',
  '<h1>Send a parcel with SeeBuyGet</h1>',
  '<p>See the price before you send, with no account. Choose the shop to send from and the shop to collect at, hand the parcel in there and pay at the counter, the price you saw. It is photographed when it is handed in.</p>',
  '<p>The receiver collects it at their shop with a code. Nobody without the code can collect it.</p>',
  '<h2>Track a parcel</h2>',
  '<p>Open this page with the parcel’s tracking code at the end of its address (/send/?track=…), or type the code in once the page has loaded.</p>',
  '<p><a href="/">How SeeBuyGet works</a> · <a href="/help/">Help</a></p>',
  '</main>',
].join('');

function swap(html, from, to) {
  if (!html.includes(from)) throw new Error(`send-head: the Send page no longer has ${from.slice(0, 60)} — update scripts/send-head.mjs`);
  return html.replace(from, () => to);
}

export function sendHead(html, site = '') {
  const SITE = String(site || '').trim().replace(/\/+$/, '');
  const here = `${SITE}/send/`;
  let out = html;
  out = swap(out, '<title>SeeBuyGet Send</title>', `<title>${esc(SEND_TITLE)}</title>`);
  out = swap(out, '<meta name="description" content="Send a parcel on the SeeBuyGet network." />', `<meta name="description" content="${esc(SEND_DESCRIPTION)}" />`);
  // The preview's own address and picture: at their full address, or not at all.
  out = swap(out, '<meta property="og:url" content="https://www.seebuyget.com" />', SITE ? `<meta property="og:url" content="${here}" />` : '');
  out = swap(
    out,
    '<meta property="og:image" content="https://www.seebuyget.com/social-card.png" />',
    SITE
      ? [
          `<meta property="og:image" content="${SITE}${SHARE_CARD.path}" />`,
          `    <meta property="og:image:type" content="${SHARE_CARD.type}" />`,
          `    <meta property="og:image:width" content="${SHARE_CARD.width}" />`,
          `    <meta property="og:image:height" content="${SHARE_CARD.height}" />`,
          '    <meta property="og:image:alt" content="SeeBuyGet: send and collect parcels at a shop near you, no address needed" />',
        ].join('\n')
      : '',
  );
  if (!SITE) out = swap(out, '<meta name="twitter:card" content="summary_large_image" />', '<meta name="twitter:card" content="summary" />');
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: 'SeeBuyGet Send',
    description: SEND_DESCRIPTION,
    applicationCategory: 'UtilitiesApplication',
    operatingSystem: 'Any, in a web browser',
    provider: { '@type': 'Organization', name: 'SeeBuyGet', ...(SITE ? { url: `${SITE}/` } : {}) },
    ...(SITE
      ? {
          url: here,
          potentialAction: { '@type': 'TrackAction', target: { '@type': 'EntryPoint', urlTemplate: `${here}?track={tracking_code}` } },
        }
      : {}),
  };
  const head = [...(SITE ? [`<link rel="canonical" href="${here}" />`] : []), `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>`].map((l) => `    ${l}`).join('\n');
  out = swap(out, '  </head>', `${head}\n  </head>`);
  out = swap(out, '<div id="app"></div>', `<div id="app">${SEND_SUMMARY}</div>`);
  return out;
}
