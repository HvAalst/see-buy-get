// THE NETHERLANDS' PROPOSED ZONE MAP, made again (2026-11-09): writes src/modules/pudo/zone-proposals/nl.ts.
// Run by hand, never by the pipeline. First download, into an empty folder of their own (data, never code):
//   gemeente26.json  https://service.pdok.nl/cbs/gebiedsindelingen/2026/wfs/v1_0?request=GetFeature&service=WFS&version=2.0.0&outputFormat=application/json&srsName=EPSG:4326&typeNames=gebiedsindelingen:gemeente_gegeneraliseerd
//   corop26.json     … the same with typeNames=gebiedsindelingen:coropgebied_gegeneraliseerd
//   gmpoint26.json   … the same with typeNames=gebiedsindelingen:gemeente_labelpoint
//   kern.json        https://opendata.cbs.nl/ODataApi/odata/85984NED/TypedDataSet?$format=json&$filter=startswith(WijkenEnBuurten,'GM')&$select=WijkenEnBuurten,Gemeentenaam_1,SoortRegio_2,AantalInwoners_5,MateVanStedelijkheid_120,Omgevingsadressendichtheid_121
// then: node scripts/zone-proposal-nl.cjs <that folder>
// All CC BY 4.0 (CBS, Kadaster / PDOK). A year with new municipalities: change the year in the URLs and the header text.
const fs = require('fs');
const path = require('path');
const DATA = process.argv[2];
const OUT = path.join(__dirname, '../src/modules/pudo/zone-proposals/nl.ts');
const TOL = Number(process.argv[3] ?? 0); // Douglas–Peucker tolerance in degrees (0 = as PDOK generalised it)
const read = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));

const gm = read('gemeente26.json').features;
const corop = read('corop26.json').features;
const points = read('gmpoint26.json').features;
const kern = new Map(read('kern.json').value.map((v) => [v.WijkenEnBuurten.trim(), { people: v.AantalInwoners_5, level: v.MateVanStedelijkheid_120, density: v.Omgevingsadressendichtheid_121 }]));

const ISLANDS = new Set(['GM0060', 'GM0088', 'GM0093', 'GM0448', 'GM0096']); // Ameland, Schiermonnikoog, Terschelling, Texel, Vlieland
const CITY_PEOPLE = 100_000;
const LEVEL = { 1: 'very strongly urban', 2: 'strongly urban', 3: 'moderately urban', 4: 'hardly urban', 5: 'not urban' };

// --- geometry ---------------------------------------------------------------------------------------------------------
function inRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const inPolygon = (pt, poly) => inRing(pt, poly[0]) && !poly.slice(1).some((h) => inRing(pt, h));
const inGeometry = (pt, g) => (g.type === 'Polygon' ? inPolygon(pt, g.coordinates) : g.coordinates.some((p) => inPolygon(pt, p)));

function simplify(ring, tol) {
  if (!tol || ring.length < 5) return ring;
  const keep = new Uint8Array(ring.length);
  keep[0] = keep[ring.length - 1] = 1;
  const stack = [[0, ring.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let max = 0;
    let at = -1;
    const [ax, ay] = ring[a];
    const [bx, by] = ring[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1e-12;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * ring[i][0] - dx * ring[i][1] + bx * ay - by * ax) / len;
      if (d > max) { max = d; at = i; }
    }
    if (max > tol && at > 0) { keep[at] = 1; stack.push([a, at], [at, b]); }
  }
  const out = ring.filter((_, i) => keep[i]);
  return out.length >= 4 ? out : ring;
}

function encodeNumber(n) {
  let v = n < 0 ? ~(n << 1) : n << 1;
  let out = '';
  while (v >= 0x20) { out += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; }
  return out + String.fromCharCode(v + 63);
}
function encodeRing(ring) {
  let lat = 0;
  let lng = 0;
  let out = '';
  for (const [x, y] of ring) {
    const ilat = Math.round(y * 1e5);
    const ilng = Math.round(x * 1e5);
    out += encodeNumber(ilat - lat) + encodeNumber(ilng - lng);
    lat = ilat;
    lng = ilng;
  }
  return out;
}
const polygonsOf = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates);

// --- the areas: the 342 municipalities, in name order ---------------------------------------------------------------------
const byCode = new Map(gm.map((f) => [f.properties.statcode, f]));
const codes = [...byCode.keys()].sort((a, b) => byCode.get(a).properties.statnaam.localeCompare(byCode.get(b).properties.statnaam, 'nl'));
const index = new Map(codes.map((c, i) => [c, i]));
const areas = codes.map((c) => {
  const f = byCode.get(c);
  return { name: f.properties.statnaam, polygons: polygonsOf(f.geometry).map((p) => p.map((r) => encodeRing(simplify(r, TOL))).join(' ')) };
});

// --- each municipality's COROP region, by its label point --------------------------------------------------------------
const pointOf = new Map();
for (const p of points) if (!pointOf.has(p.properties.statcode)) pointOf.set(p.properties.statcode, p.geometry.coordinates);
const regionOf = new Map();
for (const c of codes) {
  const pt = pointOf.get(c);
  const r = corop.find((k) => inGeometry(pt, k.geometry));
  if (!r) throw new Error(`no COROP region for ${c} ${byCode.get(c).properties.statnaam}`);
  regionOf.set(c, r.properties.statnaam);
}

// --- the zones ---------------------------------------------------------------------------------------------------------
const fmt = (n) => n.toLocaleString('en-GB');
const zones = [];
const isCity = (c) => !ISLANDS.has(c) && (kern.get(c).level === 1 || kern.get(c).people >= CITY_PEOPLE);
for (const c of codes) {
  const k = kern.get(c);
  const name = byCode.get(c).properties.statnaam;
  if (ISLANDS.has(c)) {
    zones.push({ name, group: 'remote', areas: [index.get(c)], evidence: [`A Wadden island, reached by ferry only: remote until you say otherwise.`, `${fmt(k.people)} inhabitants; CBS rates it ${LEVEL[k.level]} (${fmt(k.density)} addresses per km² around each).`] });
  } else if (isCity(c)) {
    const urban = k.level <= 2;
    zones.push({
      name,
      group: urban ? 'urban' : 'rural',
      areas: [index.get(c)],
      evidence: [
        `A zone of its own: ${k.level === 1 ? 'CBS rates it very strongly urban' : `${fmt(k.people)} inhabitants`}.`,
        `${fmt(k.people)} inhabitants; CBS rates it ${LEVEL[k.level]} (${fmt(k.density)} addresses per km² around each): ${urban ? 'urban' : 'rural'} until you say otherwise.`,
      ],
    });
  }
}
const regions = [...new Set(codes.map((c) => regionOf.get(c)))].sort((a, b) => a.localeCompare(b, 'nl'));
for (const r of regions) {
  const members = codes.filter((c) => regionOf.get(c) === r);
  const rest = members.filter((c) => !ISLANDS.has(c) && !isCity(c));
  if (!rest.length) continue;
  const cut = members.filter((c) => !rest.includes(c)).map((c) => byCode.get(c).properties.statnaam);
  const people = rest.reduce((s, c) => s + kern.get(c).people, 0);
  const urbanPeople = rest.filter((c) => kern.get(c).level <= 2).reduce((s, c) => s + kern.get(c).people, 0);
  const share = Math.round((urbanPeople / people) * 100);
  const urban = share >= 50;
  zones.push({
    name: cut.length ? `${r} (outside ${cut.join(', ')})` : r,
    group: urban ? 'urban' : 'rural',
    areas: rest.map((c) => index.get(c)),
    evidence: [
      `The rest of the CBS region ${r}: ${rest.length} municipalit${rest.length === 1 ? 'y' : 'ies'}, ${fmt(people)} inhabitants.`,
      `${share}% of them live in a municipality CBS rates strongly or very strongly urban: ${urban ? 'urban' : 'rural'} until you say otherwise.`,
    ],
  });
}

// Every area in exactly one zone.
const seen = new Map();
for (const z of zones) for (const a of z.areas) { if (seen.has(a)) throw new Error(`area ${a} twice`); seen.set(a, z.name); }
if (seen.size !== areas.length) throw new Error(`${areas.length - seen.size} areas in no zone`);

const counts = zones.reduce((m, z) => ((m[z.group] = (m[z.group] ?? 0) + 1), m), {});
const ts = `/**
 * NETHERLANDS ONLY — the first zone map proposed to SeeBuyGet Nederland (2026-11-09; the owner: "wire in the map for the
 * Netherlands as per your recommendation"). Generated from CBS open data by a one-off script: the Netherlands' 342
 * municipalities of 2026 (CBS Gebiedsindelingen, generalised, via PDOK) as the areas; a zone for each municipality CBS rates
 * very strongly urban or with 100,000 inhabitants or more, for each Wadden island, and for the rest of each of the 40 COROP
 * regions; each zone's proposed group with the evidence for it, from CBS Kerncijfers wijken en buurten 2024 (inhabitants,
 * degree of urbanisation). The Dutch company starts from it, or not, and changes it.
 * ${zones.length} zones: ${Object.entries(counts).map(([g, n]) => `${n} ${g}`).join(', ')}.
 * Nothing here is read for any other country (zone-proposals/index.ts).
 */
import type { ZoneProposal } from './types';

export const NL_PROPOSAL: ZoneProposal = {
  country: 'NL',
  label: 'The Netherlands’ 342 municipalities: a zone for each city, each Wadden island and each region’s rest',
  source: 'CBS Gebiedsindelingen 2026 (municipalities, COROP regions; generalised) via PDOK, and CBS Kerncijfers wijken en buurten 2024',
  licence: 'CC BY 4.0',
  attribution: 'CBS, Kadaster / PDOK',
  level: 'municipalities',
  areas: ${JSON.stringify(areas)},
  zones: ${JSON.stringify(zones)},
};
`;
fs.writeFileSync(OUT, ts);
console.log('areas', areas.length, 'zones', zones.length, counts, 'bytes', Buffer.byteLength(ts));
for (const z of zones.filter((z) => z.name.includes('outside')).slice(0, 4)) console.log(' ', z.name, z.group, z.areas.length);
