// ETHIOPIA ONLY — the proposed first zone map for Ethiopia's company (2026-11-10): writes src/modules/pudo/zone-proposals/et.ts.
// Run by hand, never by the pipeline, after `nest build` (it reads the server's own geometry from dist). First download,
// into an empty folder of their own (data, never code), geoBoundaries gbOpen ETH (https://www.geoboundaries.org/api/current/gbOpen/ETH/ADM1/ …):
//   eth-ADM1.geojson  regions   (CC BY 4.0)
//   eth-ADM2.geojson  zones     (ODbL 1.0)
//   eth-ADM3.geojson  woredas   (ODbL 1.0)
// then: node scripts/zone-proposal-et.cjs <that folder>
// The boundaries are of 2016 (Open Africa / Code for Ethiopia): before Sidama, South West, South and Central Ethiopia
// regions. The company imports newer ones when it has them; a zone is whole areas, so nothing here is cut.
const fs = require('fs');
const path = require('path');
const G = require('../dist/modules/pudo/zone-geometry.js');
const DATA = process.argv[2];
if (!DATA) throw new Error('usage: node scripts/zone-proposal-et.cjs <folder with eth-ADM1/2/3.geojson>');
const OUT = path.join(__dirname, '../src/modules/pudo/zone-proposals/et.ts');
const read = (l) => G.parseAreaFile(fs.readFileSync(path.join(DATA, `eth-${l}.geojson`), 'utf8'), 'shapeName');

const woredas = read('ADM3');
const zonesAdm = read('ADM2');
const regions = read('ADM1');
console.log('woredas', woredas.length, 'zones', zonesAdm.length, 'regions', regions.length);

const holder = (list, point) => {
  const inside = list.find((a) => G.contains(a.shape, point));
  if (inside) return inside.name;
  let best;
  for (const a of list) {
    const d = G.distanceKm(a.shape, point);
    if (!best || d < best.d) best = { name: a.name, d };
  }
  return best.name;
};
// geoBoundaries names Addis Ababa's one zone "Region 14".
const ZONE_NAME = { 'Region 14': 'Addis Ababa' };
const areas = woredas.map((w, i) => {
  const m = G.measure(w.shape);
  const adm2 = holder(zonesAdm, m.centre);
  return { i, name: w.name, shape: w.shape, centre: m.centre, region: holder(regions, m.centre), zone: ZONE_NAME[adm2] ?? adm2 };
});
// Fifteen woreda names stand twice (Moyale, Gursum, Kersa …): each is named with its zone, so a list can tell them apart.
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
 * both Kenya and Ethiopia"). Generated by backend/scripts/zone-proposal-et.cjs from geoBoundaries (gbOpen; 2016 boundaries,
 * Open Africa / Code for Ethiopia): Ethiopia's ${areas.length.toLocaleString('en')} woredas as the areas; Addis Ababa one zone; a zone for each of the
 * towns SeeBuyGet's map knows (geo-gazetteer.ts) and for the rest of each administrative zone; remote only where a source says
 * a place is dearer to serve. Ethiopia's company starts from it, or not, and changes it.
 * Nothing here is read for any other country (zone-proposals/index.ts).
 */
import type { ZoneProposal } from './types';

export const ET_PROPOSAL: ZoneProposal = {
  country: 'ET',
  label: 'Ethiopia’s ${areas.length.toLocaleString('en')} woredas: a zone for each town and each administrative zone',
  source: 'geoBoundaries (gbOpen): Ethiopia’s woredas, zones and regions as they were in 2016',
  licence: 'Woredas and zones ODbL 1.0; regions CC BY 4.0',
  attribution: 'Open Africa, Code for Ethiopia — via geoBoundaries',
  level: 'woredas',
  areas: ${JSON.stringify(encoded)},
  zones: ${JSON.stringify(out.map(({ name, group, areas, evidence }) => ({ name, group, areas, evidence })))},
};
`;
fs.writeFileSync(OUT, body);
console.log('module', (body.length / 1024).toFixed(0), 'KB →', OUT);
