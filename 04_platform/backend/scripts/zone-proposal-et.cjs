// ETHIOPIA ONLY — the proposed first zone map for Ethiopia's company: writes src/modules/pudo/zone-proposals/et.ts.
// Run by hand, never by the pipeline, after `nest build` (it reads the server's own geometry from dist). First download,
// into an empty folder of their own (data, never code), OCHA's Common Operational Dataset for Ethiopia's boundaries
// (HDX, cod-ab-eth, v04: boundaries of August 2023, reviewed December 2025; CC BY-IGO) and unzip it:
//   https://data.humdata.org/dataset/cb58fa1f-687d-4cac-81a7-655ab1efb2d0/resource/0518da1b-42d1-4624-ad64-768cb69f9d40/download/eth_admin_boundaries.geojson.zip
// then: node --max-old-space-size=2048 scripts/zone-proposal-et.cjs <that folder>
// 2026-11-11 — moved from geoBoundaries' 2016 woredas (690, before Sidama, South West, South and Central Ethiopia) to
// these: 1,148 woredas in 15 regions, each carrying its zone's and region's names. The file is drawn at full detail; each
// shape is simplified to SIMPLIFY_DEG first (about 300 m), as a pin finds its zone to the woreda, not to the metre.
const fs = require('fs');
const path = require('path');
const G = require('../dist/modules/pudo/zone-geometry.js');
const DATA = process.argv[2];
if (!DATA) throw new Error('usage: node scripts/zone-proposal-et.cjs <folder with eth_admin3.geojson>');
const OUT = path.join(__dirname, '../src/modules/pudo/zone-proposals/et.ts');
const SIMPLIFY_DEG = Number(process.argv[3] ?? 0.003);

/** Douglas–Peucker on one ring, kept closed and never below four points. */
function simplify(ring, tol) {
  if (!tol || ring.length < 5) return ring;
  const keep = new Uint8Array(ring.length);
  keep[0] = keep[ring.length - 1] = 1;
  // A closed ring starts and ends on one point, so the line between them has no length: split it at its farthest point first.
  let far = 0;
  let farD = -1;
  for (let i = 1; i < ring.length - 1; i++) {
    const d = Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]);
    if (d > farD) { farD = d; far = i; }
  }
  keep[far] = 1;
  const stack = [[0, far], [far, ring.length - 1]];
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
const raw = JSON.parse(fs.readFileSync(path.join(DATA, 'eth_admin3.geojson'), 'utf8'));
for (const f of raw.features) {
  const g = f.geometry;
  if (g.type === 'Polygon') g.coordinates = g.coordinates.map((r) => simplify(r, SIMPLIFY_DEG));
  else if (g.type === 'MultiPolygon') g.coordinates = g.coordinates.map((p) => p.map((r) => simplify(r, SIMPLIFY_DEG)));
}
const woredas = G.parseAreaFile(JSON.stringify(raw), 'adm3_name');
const props = raw.features.map((f) => f.properties);
console.log('woredas', woredas.length);

const areas = woredas.map((w, i) => {
  const m = G.measure(w.shape);
  // Addis Ababa is a city administration: its sub-cities one zone, whatever its zone level is called.
  return { i, name: w.name, shape: w.shape, centre: m.centre, region: props[i].adm1_name, zone: props[i].adm1_name === 'Addis Ababa' ? 'Addis Ababa' : props[i].adm2_name };
});
// A name that stands more than once is named with its zone, so a list can tell them apart (none does in v04).
const seen = new Map();
for (const a of areas) seen.set(a.name, (seen.get(a.name) ?? 0) + 1);
for (const a of areas) if (seen.get(a.name) > 1) a.name = `${a.name} (${a.zone})`;

// FAR PLACES, each with what says it is dearer to serve. Fuel in Ethiopia is priced as the Addis Ababa price plus a
// road-transport charge per kilometre (Ministry of Trade notice, November 2021): the far places pay for the road twice.
const FAR = [
  { name: 'Gambela', lat: 8.25, lng: 34.59, why: 'Gambela: the dearest jet fuel in the Ministry of Trade’s list (November 2021), and diesel sold at 400–550 birr a litre at its stations in March 2026, three to four times the official price (The Horn Frequency, 10 March 2026).' },
  { name: 'Asosa', lat: 10.07, lng: 34.53, why: 'Asosa: diesel up to 500 birr a litre in March 2026, over three times the official price (The Horn Frequency, 10 March 2026).' },
  { name: 'Gode', lat: 5.95, lng: 43.55, why: 'Gode: one of the Somali and southern Oromia towns where fuel is rationed by quota (Addis Fortune, 22 January 2022).' },
  { name: 'Degehabur', lat: 8.22, lng: 43.56, why: 'Degehabur: fuel rationed by quota (Addis Fortune, 22 January 2022).' },
  { name: 'Moyale', lat: 3.53, lng: 39.05, why: 'Moyale: a border town where fuel is rationed by quota (Addis Fortune, 22 January 2022).' },
  { name: 'Negele Borena', lat: 5.33, lng: 39.58, why: 'Negele Borena: fuel rationed by quota (Addis Fortune, 22 January 2022).' },
  { name: 'Yabelo', lat: 4.88, lng: 38.1, why: 'Yabelo: fuel rationed by quota (Addis Fortune, 22 January 2022).' },
  { name: 'Dolo Ado', lat: 4.17, lng: 42.06, why: 'Dolo Ado: reached by the United Nations’ humanitarian flights (UNHAS schedule, July 2025).' },
  { name: 'Melkadida', lat: 4.52, lng: 41.72, why: 'Melkadida: reached by the United Nations’ humanitarian flights (UNHAS schedule, July 2025).' },
  { name: 'Omorate', lat: 4.8, lng: 36.05, why: 'Omorate: the Omo floods displaced 79,000 people in August 2024, and the roads are passable in the dry season (Addis Standard, August 2024).' },
];
const index = new G.AreaIndex(areas.map((a) => ({ id: String(a.i), shape: a.shape, box: G.boxOf(a.shape) })));
const farZones = new Map(); // a far place's whole administrative zone is remote: the road to it is the same road
for (const f of FAR) {
  const id = index.find({ lat: f.lat, lng: f.lng }, 10);
  if (!id) throw new Error(`${f.name} lies in no woreda`);
  const zone = areas[Number(id)].zone;
  if (!farZones.has(zone)) farZones.set(zone, []);
  farZones.get(zone).push(f);
}

// The towns SeeBuyGet's own map already knows in Ethiopia (geo-gazetteer.ts), read from the source so the two never differ.
// A town is a zone of its own: the woreda its centre lies in, and the woredas of its zone whose centres lie within TOWN_KM.
// Addis Ababa is a city administration and one zone whole; its sub-city names in the gazetteer are parts of it.
const GAZ = fs.readFileSync(path.join(__dirname, '../src/modules/pudo/geo-gazetteer.ts'), 'utf8');
const ethiopian = GAZ.slice(GAZ.indexOf('// --- Ethiopia'));
const TOWNS = [...ethiopian.slice(0, ethiopian.indexOf('];')).matchAll(/name: '([^']+)', location: \{ lat: (-?[\d.]+), lng: (-?[\d.]+) \}/g)].map((m) => ({ name: m[1], lat: Number(m[2]), lng: Number(m[3]) }));
const TOWN_KM = 5;
const kmBetween = (a, b) => Math.hypot((a.lat - b.lat) * 110.574, (a.lng - b.lng) * 111.32 * Math.cos((a.lat * Math.PI) / 180));
const WHOLE = ['Addis Ababa'];
const townOf = new Map();
for (const town of TOWNS) {
  const id = index.find({ lat: town.lat, lng: town.lng }, 10);
  if (!id) throw new Error(`${town.name} lies in no woreda`);
  const home = areas[Number(id)];
  if (WHOLE.includes(home.zone) || townOf.has(home.i)) continue;
  for (const a of areas) if (a.zone === home.zone && !townOf.has(a.i) && (a.i === home.i || kmBetween(a.centre, town) <= TOWN_KM)) townOf.set(a.i, town);
}
console.log('towns', TOWNS.length, 'woredas in towns', townOf.size);

const zoneKey = (a) => (WHOLE.includes(a.zone) ? `city:${a.zone}` : townOf.has(a.i) ? `town:${townOf.get(a.i).name}` : `zone:${a.zone}`);
const zones = new Map();
for (const a of areas) {
  const k = zoneKey(a);
  if (!zones.has(k)) zones.set(k, []);
  zones.get(k).push(a);
}

const out = [];
for (const [k, list] of zones) {
  const [kind, name] = [k.slice(0, k.indexOf(':')), k.slice(k.indexOf(':') + 1)];
  const region = list[0].region;
  const evidence = [];
  let group;
  const far = kind === 'zone' ? farZones.get(name) : undefined;
  if (kind === 'city') {
    group = 'urban';
    evidence.push(`The city of ${name}: its ${list.length} sub-cities as one zone.`);
  } else if (kind === 'town') {
    group = 'urban';
    evidence.push(`The town of ${name}: the woreda its centre lies in${list.length > 1 ? `, and the woredas around it within ${TOWN_KM} km` : ''}.`);
  } else if (far) {
    group = 'remote';
    evidence.push(...far.map((f) => f.why));
  } else {
    group = 'rural';
    evidence.push(`The rest of ${name} zone (${region}), with no town SeeBuyGet’s map knows and no far place found: rural until you say otherwise.`);
  }
  out.push({ name, group, areas: list.map((a) => a.i), evidence, region });
}
// A town named as its zone (Dire Dawa): the rest of the zone says so, so no two zones share a name.
const townNames = new Set(out.filter((z) => z.group === 'urban').map((z) => z.name));
for (const z of out) if (z.group !== 'urban' && townNames.has(z.name)) z.name = `${z.name} (rest of zone)`;
out.sort((a, b) => a.region.localeCompare(b.region) || a.name.localeCompare(b.name));
const groups = { urban: 0, rural: 0, remote: 0 };
for (const z of out) groups[z.group]++;
console.log('zones', out.length, JSON.stringify(groups));
for (const probe of ['Addis Ababa', 'Adama', 'Hawassa', 'Bahir Dar', 'Mekelle', 'Dire Dawa', 'Dire Dawa (rest of zone)', 'Borena', 'Liben', 'Afder', 'Shabelle', 'East Shewa']) {
  const z = out.find((x) => x.name === probe);
  console.log(probe.padEnd(14), z ? `${z.group.padEnd(7)} ${z.areas.length} woredas · ${z.evidence[0].slice(0, 100)}` : '— not found');
}

const encoded = areas.map((a) => ({ name: a.name, polygons: a.shape.map(G.encodePolygon) }));
const body = `/**
 * ETHIOPIA ONLY — the first zone map proposed to SeeBuyGet's Ethiopian company (2026-11-10; the owner: "set up a draft for
 * both Kenya and Ethiopia"; 2026-11-11 moved to the 2023 boundaries). Generated by backend/scripts/zone-proposal-et.cjs from
 * OCHA's Common Operational Dataset (HDX cod-ab-eth v04: August 2023, with Sidama, South West, South and Central Ethiopia):
 * Ethiopia's ${areas.length.toLocaleString('en')} woredas as the areas, simplified to about 300 m; Addis Ababa one zone; a zone for each of the towns
 * SeeBuyGet's map knows (geo-gazetteer.ts) and for the rest of each administrative zone; remote only where a source says a
 * place is dearer to serve. Ethiopia's company starts from it, or not, and changes it.
 * Nothing here is read for any other country (zone-proposals/index.ts).
 */
import type { ZoneProposal } from './types';

export const ET_PROPOSAL: ZoneProposal = {
  country: 'ET',
  label: 'Ethiopia’s ${areas.length.toLocaleString('en')} woredas: a zone for each town and each administrative zone',
  source: 'OCHA Common Operational Dataset for Ethiopia (HDX, v04): woredas, zones and regions as of August 2023',
  licence: 'CC BY-IGO',
  attribution: 'OCHA, Ethiopian Statistics Service (CSA) and the regional Bureaus of Finance (BoFED) — via HDX',
  level: 'woredas',
  areas: ${JSON.stringify(encoded)},
  zones: ${JSON.stringify(out.map(({ name, group, areas, evidence }) => ({ name, group, areas, evidence })))},
};
`;
fs.writeFileSync(OUT, body);
console.log('module', (body.length / 1024).toFixed(0), 'KB →', OUT);
