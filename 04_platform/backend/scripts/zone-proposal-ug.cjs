// UGANDA ONLY — the proposed first zone map for Uganda's company (2026-11-10; the owner: "check for a zone map of Uganda. We
// have a registered business there"): writes src/modules/pudo/zone-proposals/ug.ts. Run by hand, never by the pipeline, after
// `nest build` (it reads the server's own geometry from dist). First download, into an empty folder of their own (data, never
// code), from geoBoundaries gbOpen UGA (https://www.geoboundaries.org/api/current/gbOpen/UGA/ADM4/ …):
//   uga-ADM4.geojson  sub-counties, town councils and city divisions (UNHCR, 2019; CC BY 3.0 IGO) — the simplified file
//   uga-ADM3.geojson  districts (Wikimedia Commons, 2020; CC0)
// then: node scripts/zone-proposal-ug.cjs <that folder>
// The two levels come from different sources and do not nest: each sub-county's district is found by where its centre lies.
const fs = require('fs');
const path = require('path');
const G = require('../dist/modules/pudo/zone-geometry.js');
const DATA = process.argv[2];
if (!DATA) throw new Error('usage: node scripts/zone-proposal-ug.cjs <folder with uga-ADM3/4.geojson>');
const OUT = path.join(__dirname, '../src/modules/pudo/zone-proposals/ug.ts');
const read = (l) => G.parseAreaFile(fs.readFileSync(path.join(DATA, `uga-${l}.geojson`), 'utf8'), 'shapeName');

// The source's own misspellings, put right so a person finds the place by its name.
const FIX_DISTRICT = { Kalanga: 'Kalangala', Kitagwenga: 'Kitagwenda' };
const fixArea = (n) => n.replace(/Divison\b/g, 'Division').replace(/\bTwon\b/g, 'Town');
const LAKE = 'Lake Victoria'; // a water polygon among the districts
const KAMPALA_DIVISIONS = /^(Central|Kawempe|Makindye|Nakawa|Rubaga|Lubaga) Division$/;

const subs = read('ADM4');
const districts = read('ADM3').filter((d) => d.name !== LAKE).map((d) => ({ ...d, name: FIX_DISTRICT[d.name] ?? d.name }));
const lake = read('ADM3').find((d) => d.name === LAKE);
console.log('sub-counties', subs.length, 'districts', districts.length);

const nearest = (list, point) => {
  const inside = list.find((a) => G.contains(a.shape, point));
  if (inside) return inside.name;
  let best;
  for (const a of list) {
    const d = G.distanceKm(a.shape, point);
    if (!best || d < best.d) best = { name: a.name, d };
  }
  return best.name;
};
const areas = subs.map((s, i) => {
  const m = G.measure(s.shape);
  const onLake = Boolean(lake && G.contains(lake.shape, m.centre) && !districts.some((d) => G.contains(d.shape, m.centre)));
  let district = nearest(districts, m.centre);
  // Kampala's polygon in the district file reaches over Wakiso's towns (Kira and its divisions, Kasangati): the city is its five divisions.
  if (district === 'Kampala' && !KAMPALA_DIVISIONS.test(fixArea(s.name))) district = 'Wakiso';
  return { i, name: fixArea(s.name), shape: s.shape, centre: m.centre, district, island: onLake };
});
// A name that stands more than once (Central Division, Western Division …) is named with its district.
const count = new Map();
for (const a of areas) count.set(a.name, (count.get(a.name) ?? 0) + 1);
for (const a of areas) if (count.get(a.name) > 1) a.name = `${a.name} (${a.district})`;
const again = new Map();
for (const a of areas) again.set(a.name, (again.get(a.name) ?? 0) + 1);
for (const a of areas) if (again.get(a.name) > 1) a.name = `${a.name} ${a.i}`;

// WHERE IT COSTS MORE TO SERVE, each with what says so. The evidence the country itself publishes: Posta Uganda's EMS price
// for under 1 kg, which it sets by band, read from the Uganda Communications Commission's consumer guide (March 2026) — UGX
// 4,500 in central Kampala, 16,500 at its far band. A district in that far band is proposed remote, as is an island.
const UCC = 'Uganda Communications Commission, “Know your rates”, March 2026';
const POSTA_FAR = ['Adjumani', 'Agago', 'Alebtong', 'Bukedea', 'Bundibugyo', 'Kaabong', 'Kakumiro', 'Kalangala', 'Kanungu', 'Kiryandongo', 'Koboko', 'Kotido', 'Moroto', 'Moyo', 'Nakapiripirit', 'Sheema', 'Yumbe'];
const WHY = {};
for (const d of POSTA_FAR) WHY[d] = [`Posta Uganda prices EMS to ${d} at its far band: UGX 16,500 for under 1 kg, against 4,500 in central Kampala (${UCC}).`];
WHY.Zombo = [`Paidha, its town: Posta Uganda prices EMS there at its far band, UGX 16,500 for under 1 kg (${UCC}).`];
WHY.Kalangala.unshift('The Ssese islands: reached by ferry, and the outer islands by private boat only (Nile Post, 23 March 2026).');
WHY.Buvuma = ['Islands reached by the Kiyindi–Kirongo ferry; boat fares rise when it is suspended (Daily Monitor).'];
WHY.Kisoro = [`A courier charges UGX 59,000 for under 1 kg here, against 25,000 elsewhere (${UCC}).`];
WHY.Karenga = ['Among the places worst cut off when the 2026 rains closed the roads of north Karamoja (Uganda Radio Network, May 2026).'];
WHY.Abim = ['The Abim–Amuria road is near impassable, and the 2025 floods cut north Karamoja off for weeks (The Independent, 2026).'];
WHY.Moroto.push('Petrol UGX 6,850 and diesel 7,099 a litre, against 6,650 and 6,800 in Kampala (the Minister of Energy, 8 October 2026).');
const known = new Set(districts.map((d) => d.name));
for (const d of Object.keys(WHY)) if (!known.has(d)) throw new Error(`${d} is no district in the file`);

// THE TOWNS: Uganda's cities and its other large towns, at their centres (Wikipedia's coordinates). A town is a zone of its own:
// the sub-county its centre lies in, and the sub-counties of its district whose centres lie within TOWN_KM. Kampala is its five
// divisions as one zone; a town in a district proposed remote stays in it.
const TOWNS = [
  ['Arua', 3.0353, 30.9108], ['Gulu', 2.7817, 32.2992], ['Jinja', 0.4233, 33.2039], ['Mbarara', -0.6133, 30.6583], ['Fort Portal', 0.6544, 30.2744],
  ['Mbale', 1.0806, 34.175], ['Masaka', -0.3411, 31.7361], ['Lira', 2.2472, 32.9], ['Soroti', 1.715, 33.6111], ['Hoima', 1.4319, 31.3525],
  ['Entebbe', 0.05, 32.46], ['Wakiso', 0.3981, 32.4781], ['Kabale', -1.25, 29.99], ['Nakasongola', 1.315, 32.465], ['Nansana', 0.3639, 32.5286],
  ['Kira', 0.3972, 32.6389], ['Makindye-Ssabagabo', 0.2428, 32.56], ['Mukono', 0.3533, 32.7553], ['Njeru', 0.4311, 33.1478], ['Lugazi', 0.3833, 32.9242],
  ['Mityana', 0.4006, 32.0422], ['Mubende', 0.5575, 31.395], ['Masindi', 1.6836, 31.7222], ['Kasese', 0.1867, 30.0881], ['Tororo', 0.6928, 34.1811],
  ['Busia', 0.4669, 34.09], ['Iganga', 0.615, 33.485], ['Kitgum', 3.2889, 32.8778],
].map(([name, lat, lng]) => ({ name, lat, lng }));
const TOWN_KM = 5;
const kmBetween = (a, b) => Math.hypot((a.lat - b.lat) * 110.574, (a.lng - b.lng) * 111.32 * Math.cos((a.lat * Math.PI) / 180));
const index = new G.AreaIndex(areas.map((a) => ({ id: String(a.i), shape: a.shape, box: G.boxOf(a.shape) })));
const townOf = new Map();
for (const town of TOWNS) {
  const id = index.find({ lat: town.lat, lng: town.lng }, 5);
  if (!id) throw new Error(`${town.name} lies in no sub-county`);
  const home = areas[Number(id)];
  if (home.district === 'Kampala' || WHY[home.district] || home.island) continue;
  for (const a of areas) if (a.district === home.district && !a.island && !townOf.has(a.i) && (a.i === home.i || kmBetween(a.centre, town) <= TOWN_KM)) townOf.set(a.i, town);
}
console.log('towns', TOWNS.length, 'sub-counties in towns', townOf.size);

const zoneKey = (a) =>
  a.district === 'Kampala' ? 'city:Kampala' : a.island && !['Kalangala', 'Buvuma'].includes(a.district) ? `island:${a.district}` : townOf.has(a.i) ? `town:${townOf.get(a.i).name}` : `district:${a.district}`;
const zones = new Map();
for (const a of areas) {
  const k = zoneKey(a);
  if (!zones.has(k)) zones.set(k, []);
  zones.get(k).push(a);
}
const out = [];
for (const [k, list] of zones) {
  const kind = k.slice(0, k.indexOf(':'));
  const name = k.slice(k.indexOf(':') + 1);
  const district = list[0].district;
  let group;
  const evidence = [];
  if (kind === 'city') {
    group = 'urban';
    evidence.push(`The city of Kampala: its ${list.length} divisions as one zone.`);
  } else if (kind === 'island') {
    group = 'remote';
    evidence.push(`Islands of ${name} district in Lake Victoria: reached by ferry or boat (Daily Monitor, on the MV Sigulu and the island ferries).`);
  } else if (kind === 'town') {
    group = 'urban';
    evidence.push(`The town of ${name}: the sub-county its centre lies in${list.length > 1 ? `, and those of ${district} district around it within ${TOWN_KM} km` : ''}.`);
  } else if (WHY[name]) {
    group = 'remote';
    evidence.push(...WHY[name]);
  } else {
    group = 'rural';
    evidence.push(`The rest of ${name} district, with no city or large town and no far band found: rural until you say otherwise.`);
  }
  const zoneName = kind === 'island' ? `${name} islands` : name;
  out.push({ name: zoneName, group, areas: list.map((a) => a.i), evidence, district });
}
// A town named as its district (Arua, Gulu …): the rest of the district says so, so no two zones share a name.
const urbanNames = new Set(out.filter((z) => z.group === 'urban').map((z) => z.name));
for (const z of out) if (z.group !== 'urban' && urbanNames.has(z.name)) z.name = `${z.name} (rest of district)`;
out.sort((a, b) => a.district.localeCompare(b.district) || a.name.localeCompare(b.name));
const names = out.map((z) => z.name);
if (new Set(names).size !== names.length) throw new Error('two zones share a name');
const groups = { urban: 0, rural: 0, remote: 0 };
for (const z of out) groups[z.group]++;
console.log('zones', out.length, JSON.stringify(groups));
for (const probe of ['Kampala', 'Entebbe', 'Wakiso', 'Kira', 'Jinja', 'Gulu', 'Gulu (rest of district)', 'Kalangala', 'Buvuma', 'Namayingo islands', 'Kaabong', 'Moroto', 'Busia', 'Kisoro']) {
  const z = out.find((x) => x.name === probe);
  console.log(probe.padEnd(24), z ? `${z.group.padEnd(7)} ${z.areas.length} sub-counties · ${z.evidence[0].slice(0, 90)}` : '— not found');
}

const encoded = areas.map((a) => ({ name: a.name, polygons: a.shape.map(G.encodePolygon) }));
const body = `/**
 * UGANDA ONLY — the first zone map proposed to SeeBuyGet's Ugandan company (2026-11-10; the owner: "check for a zone map of
 * Uganda. We have a registered business there"). Generated by backend/scripts/zone-proposal-ug.cjs from geoBoundaries (gbOpen):
 * Uganda's ${areas.length.toLocaleString('en')} sub-counties, town councils and city divisions as the areas (UNHCR, 2019), each placed in its district
 * (2020); Kampala's divisions one zone; a zone for each city and large town and for the rest of each district; remote where
 * Posta Uganda prices at its far band (UCC, March 2026), the islands, and where a source says the roads are cut. Uganda's
 * company starts from it, or not, and changes it.
 * Nothing here is read for any other country (zone-proposals/index.ts).
 */
import type { ZoneProposal } from './types';

export const UG_PROPOSAL: ZoneProposal = {
  country: 'UG',
  label: 'Uganda’s ${areas.length.toLocaleString('en')} sub-counties: a zone for each city and town and each district',
  source: 'geoBoundaries (gbOpen): Uganda’s sub-counties (2019) and districts (2020)',
  licence: 'Sub-counties CC BY 3.0 IGO; districts CC0',
  attribution: 'Sub-counties: UNHCR Operational Data Portal; districts: Wikimedia Commons — via geoBoundaries',
  level: 'sub-counties',
  areas: ${JSON.stringify(encoded)},
  zones: ${JSON.stringify(out.map(({ name, group, areas, evidence }) => ({ name, group, areas, evidence })))},
};
`;
fs.writeFileSync(OUT, body);
console.log('module', (body.length / 1024).toFixed(0), 'KB →', OUT);
