// GLOS PUDO — static site generator for GEO / local-SEO discovery pages.
// Pre-renders one "Parcel pick-up points in <Zone>" page per active zone from the live network data, an
// index of all areas, and a fresh sitemap.xml. Pure static HTML (fast, crawlable, extractable by
// generative engines — no JS needed for the content) with schema.org ItemList / LocalBusiness markup.
// Run it like the seeder, against a running backend:  node seo-build.mjs   (or: npm run seo:build)
// Phase-2 of the GEO plan ([[glos_geo_seo]]); swap HOST for the production domain.

import { writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const API = process.env.GLOS_API || 'http://localhost:3000/v1';
const HOST = process.env.GLOS_HOST || 'https://pudo.glos.example';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), 'frontend', 'src');
const AREA_DIR = join(ROOT, 'area');

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const round2 = (n) => Math.round(n * 100) / 100;
const median = (xs) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return round2(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2); };

async function token() {
  const r = await fetch(`${API}/auth/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sub: 'seo-build', type: 'client_credentials' }) });
  return (await r.json()).access_token;
}

// `prefix` is the path back to frontend/src — areas.html sits at the root, area/*.html one level down.
const HEAD = (title, desc, canonical, prefix = './') => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(desc)}" />
  <meta name="robots" content="index, follow, max-image-preview:large" />
  <link rel="canonical" href="${canonical}" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="GLOS PUDO" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(desc)}" />
  <meta property="og:url" content="${canonical}" />
  <link rel="stylesheet" href="${prefix}fonts.css" />
  <style>
    :root { --i:#4c46e0; --i-dk:#3a34c2; --o:#ff6200; --o-dk:#dc4405; --g:#1fa45a; --amber:#ffab00; --ink:#1a1a1a; --mut:#5a5a64; --bd:#e2e2e6; --bd2:#c9c9d0; --pan:#f2f2f4; --f:'PostNL','Mulish','Helvetica Neue',Helvetica,Arial,sans-serif; }
    *{box-sizing:border-box} html,body{margin:0;background:#fff;color:var(--ink);font-family:var(--f);-webkit-font-smoothing:antialiased}
    .a{max-width:760px;margin:0 auto;padding:0 22px 64px}
    .a__swoosh{height:7px;border-radius:999px;background:linear-gradient(90deg,var(--amber) 0%,var(--o) 30%,var(--o-dk) 44%,var(--i) 72%,var(--g) 100%);margin:24px 0 18px}
    .a__crumb{font-size:.88rem;color:var(--mut);margin-bottom:10px}
    .a__crumb a{color:var(--i);font-weight:700;text-decoration:none}
    .a__h1{font-size:1.8rem;font-weight:800;margin:0 0 6px}
    .a__sub{color:var(--mut);font-size:1.04rem;margin:0 0 8px}
    .a__bench{display:inline-block;background:var(--pan);border-radius:10px;padding:8px 14px;font-size:.9rem;font-weight:700;margin:6px 0 22px}
    .a__bench b{color:var(--i)}
    .a__list{display:grid;gap:12px;margin:0;padding:0;list-style:none}
    .a__pt{border:1px solid var(--bd);border-radius:12px;padding:15px 17px}
    .a__pt-n{font-weight:800;font-size:1.06rem}
    .a__pt-m{color:var(--mut);font-size:.9rem;margin-top:2px}
    .a__pt-p{float:right;color:var(--i);font-weight:800}
    .a__cta{display:inline-block;margin-top:24px;background:var(--i);color:#fff;font-weight:800;padding:11px 20px;border-radius:10px;text-decoration:none}
    .a__cta:hover{background:var(--i-dk)}
    .a__seo{margin-top:34px}
    .a__seo h2{font-size:1.2rem;font-weight:800;margin:24px 0 8px}
    .a__seo p{color:#333;font-size:1rem;line-height:1.6}
    .a__foot{margin-top:40px;padding-top:18px;border-top:1px solid var(--bd);color:var(--mut);font-size:.9rem}
    .a__foot a{color:var(--i);font-weight:700;text-decoration:none}
    .a__grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;margin-top:8px}
    .a__zone{border:1px solid var(--bd);border-radius:12px;padding:16px 18px;text-decoration:none;color:inherit;display:block}
    .a__zone:hover{border-color:var(--i)}
    .a__zone-n{font-weight:800;font-size:1.08rem}
    .a__zone-c{color:var(--mut);font-size:.88rem;margin-top:2px}
  </style>
</head>
<body>`;

function areaPage(zone, agents) {
  const prices = agents.map((a) => a.pricePerParcel).filter((p) => typeof p === 'number');
  const med = median(prices);
  const canonical = `${HOST}/area/${slug(zone)}.html`;
  const title = `Parcel pick-up points in ${zone} | GLOS PUDO`;
  const desc = `${agents.length} GLOS PUDO pick-up & drop-off points in ${zone}. Collect and send parcels at local shops, track with your key, typical handling fee ${med.toFixed(2)} per parcel.`;
  const items = agents.map((a, i) => ({
    '@type': 'ListItem', position: i + 1,
    item: { '@type': 'LocalBusiness', name: a.shopName, areaServed: zone,
      address: { '@type': 'PostalAddress', addressLocality: zone, streetAddress: a.physicalAddress || a.landmark || undefined },
      ...(a.location ? { geo: { '@type': 'GeoCoordinates', latitude: a.location.lat, longitude: a.location.lng } } : {}),
      additionalType: 'https://schema.org/PostalService' },
  }));
  const ld = { '@context': 'https://schema.org', '@type': 'ItemList', name: `PUDO pick-up points in ${zone}`, numberOfItems: agents.length, itemListElement: items };
  const rows = agents.map((a) => `      <li class="a__pt"><span class="a__pt-p">${a.pricePerParcel?.toFixed(2) ?? '—'}</span><div class="a__pt-n">${esc(a.shopName)}</div><div class="a__pt-m">${esc(a.landmark || a.physicalAddress || zone)}${a.openState === 'closed' ? ' · temporarily closed' : ''}</div></li>`).join('\n');
  return `${HEAD(title, desc, canonical, '../')}
  <main class="a">
    <div class="a__swoosh"></div>
    <div class="a__crumb"><a href="../index.html">Home</a> › <a href="../areas.html">Pick-up points by area</a> › ${esc(zone)}</div>
    <h1 class="a__h1">Parcel pick-up points in ${esc(zone)}</h1>
    <p class="a__sub">${agents.length} GLOS PUDO point${agents.length === 1 ? '' : 's'} where you can collect and send parcels in ${esc(zone)}.</p>
    <div class="a__bench">Typical handling fee near here: <b>${med.toFixed(2)}</b> per parcel</div>
    <ul class="a__list">
${rows}
    </ul>
    <a class="a__cta" href="../onboarding.html">Open a pick-up point in ${esc(zone)} →</a>
    <section class="a__seo">
      <h2>Collecting a parcel in ${esc(zone)}</h2>
      <p>Choose any GLOS PUDO point above, then track your parcel with your key to see when it's ready. Collect any time the shop is open by showing your collection code. Sending works the same way — drop your parcel at a point and it travels point → hub → point to the destination pick-up point.</p>
      <h2>What it costs</h2>
      <p>Pricing is open data: each point sets its own per-parcel fee, so you always see a competitive rate. The typical fee near ${esc(zone)} is ${med.toFixed(2)} per parcel, plus distance-based transport on the route.</p>
    </section>
    <footer class="a__foot"><a href="../index.html">GLOS PUDO home</a> · <a href="../track.html">Track a parcel</a> · <a href="../onboarding.html">Join the network</a></footer>
  </main>
  <script type="application/ld+json">${JSON.stringify(ld)}</script>
</body>
</html>`;
}

function areasIndex(zones) {
  const canonical = `${HOST}/areas.html`;
  const title = 'Parcel pick-up points by area | GLOS PUDO';
  const desc = `Find GLOS PUDO parcel pick-up & drop-off points by area — ${zones.length} areas covered.`;
  const cards = zones.map(([z, list]) => `      <a class="a__zone" href="area/${slug(z)}.html"><div class="a__zone-n">${esc(z)}</div><div class="a__zone-c">${list.length} pick-up point${list.length === 1 ? '' : 's'}</div></a>`).join('\n');
  const ld = { '@context': 'https://schema.org', '@type': 'ItemList', name: 'GLOS PUDO areas', numberOfItems: zones.length, itemListElement: zones.map(([z], i) => ({ '@type': 'ListItem', position: i + 1, name: z, url: `${HOST}/area/${slug(z)}.html` })) };
  return `${HEAD(title, desc, canonical)}
  <main class="a">
    <div class="a__swoosh"></div>
    <div class="a__crumb"><a href="index.html">Home</a> › Pick-up points by area</div>
    <h1 class="a__h1">Parcel pick-up points by area</h1>
    <p class="a__sub">GLOS PUDO covers ${zones.length} area${zones.length === 1 ? '' : 's'}. Pick yours to see nearby pick-up &amp; drop-off points.</p>
    <div class="a__grid">
${cards}
    </div>
    <footer class="a__foot"><a href="index.html">GLOS PUDO home</a> · <a href="track.html">Track a parcel</a> · <a href="onboarding.html">Join the network</a></footer>
  </main>
  <script type="application/ld+json">${JSON.stringify(ld)}</script>
</body>
</html>`;
}

function sitemap(zones) {
  const today = new Date().toISOString().slice(0, 10);
  const stat = ['', 'track.html', 'areas.html', 'onboarding.html', 'signup-pudo.html', 'signup-driver.html', 'signup-mdp.html', 'vendor.html'];
  const urls = [
    ...stat.map((p) => `  <url><loc>${HOST}/${p}</loc><lastmod>${today}</lastmod></url>`),
    ...zones.map(([z]) => `  <url><loc>${HOST}/area/${slug(z)}.html</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq></url>`),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!-- Generated by seo-build.mjs. Swap HOST for the production domain. -->\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

async function main() {
  const t = await token().catch(() => { throw new Error(`Can't reach the backend at ${API}. Start it first.`); });
  const agents = await (await fetch(`${API}/pudo/agents`, { headers: { Authorization: `Bearer ${t}` } })).json();
  const active = (agents || []).filter((a) => a.status === 'ACTIVE');
  const byZone = new Map();
  for (const a of active) { if (!byZone.has(a.zone)) byZone.set(a.zone, []); byZone.get(a.zone).push(a); }
  const zones = [...byZone.entries()].sort((x, y) => y[1].length - x[1].length);
  if (!zones.length) throw new Error('No active PUDO agents found — seed the demo first (npm run seed).');

  mkdirSync(AREA_DIR, { recursive: true });
  for (const [zone, list] of zones) writeFileSync(join(AREA_DIR, `${slug(zone)}.html`), areaPage(zone, list), 'utf8');
  writeFileSync(join(ROOT, 'areas.html'), areasIndex(zones), 'utf8');
  writeFileSync(join(ROOT, 'sitemap.xml'), sitemap(zones), 'utf8');

  console.log(`\n✓ SEO build complete — ${zones.length} area page${zones.length === 1 ? '' : 's'} from ${active.length} active points:`);
  for (const [z, l] of zones) console.log(`  /area/${slug(z)}.html  ${z} (${l.length})`);
  console.log(`  /areas.html  + sitemap.xml refreshed\n`);
}

main().catch((e) => { console.error(`\n✗ SEO build failed: ${e.message}\n`); process.exitCode = 1; });
