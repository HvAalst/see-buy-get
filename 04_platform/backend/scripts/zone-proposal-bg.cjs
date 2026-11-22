// BULGARIA ONLY — the proposed first zone map for Bulgaria (2026-11-22; the Netherlands–Bulgaria plan, part 10; the owner:
// "continue part 10 and 5"): writes src/modules/pudo/zone-proposals/bg.ts. Run by hand, never by the pipeline, after `nest build`
// (it reads the server's own geometry from dist). First download, into an empty folder of their own (data, never code):
//   bgr-ADM2.geojson  geoBoundaries gbOpen BGR ADM2: Bulgaria's 265 municipalities (Wikimedia, 2019; public domain) — simplified
//   bgr-ADM1.geojson  geoBoundaries gbOpen BGR ADM1: its 28 provinces (the same)
//   crc-tdr.txt       the Communications Regulation Commission's list of hard-to-reach settlements (Решение № 606/23.06.2011,
//                     https://www.crc.bg/files/_bg/TDR_spisak.pdf), as text: pdftotext -layout -enc UTF-8 TDR_spisak.pdf crc-tdr.txt
// then: node scripts/zone-proposal-bg.cjs <that folder>
const fs = require('fs');
const path = require('path');
const G = require('../dist/modules/pudo/zone-geometry.js');
const DATA = process.argv[2];
if (!DATA) throw new Error('usage: node scripts/zone-proposal-bg.cjs <folder with bgr-ADM1/2.geojson and crc-tdr.txt>');
const OUT = path.join(__dirname, '../src/modules/pudo/zone-proposals/bg.ts');
const read = (l) => G.parseAreaFile(fs.readFileSync(path.join(DATA, `bgr-${l}.geojson`), 'utf8'), 'shapeName');

const provinces = read('ADM1');
const raw = read('ADM2');
console.log('municipalities', raw.length, 'provinces', provinces.length);
const provinceOf = (point) => {
  const inside = provinces.find((p) => G.contains(p.shape, point));
  if (inside) return inside.name;
  let best;
  for (const p of provinces) {
    const d = G.distanceKm(p.shape, point);
    if (!best || d < best.d) best = { name: p.name, d };
  }
  return best.name;
};

// The source's own slips, put right so a person finds the place by its name: two spellings; and Zlatitsa, in two parts in the
// source, as one municipality. Sarnitsa (made from Velingrad's municipality in 2015) is not in the source: it is inside Velingrad.
const FIX = { 'Georgi Bamyanovo': 'Georgi Damyanovo', Strumyarni: 'Strumyani', Ruzhinsi: 'Ruzhintsi' };
const merged = [];
for (const m of raw) {
  const name = FIX[m.name] ?? m.name;
  const same = name === 'Zlatitsa' ? merged.find((x) => x.name === 'Zlatitsa') : undefined;
  if (same) same.shape = [...same.shape, ...m.shape];
  else merged.push({ name, shape: m.shape });
}
const areas = merged.map((m, i) => {
  const centre = G.measure(m.shape).centre;
  return { i, name: m.name, shape: m.shape, centre, province: provinceOf(centre) };
});
// A name that stands twice (Byala, in Ruse and in Varna province) is named with its province.
const count = new Map();
for (const a of areas) count.set(a.name, (count.get(a.name) ?? 0) + 1);
for (const a of areas) if (count.get(a.name) > 1) a.name = `${a.name} (${a.province})`;
if (new Set(areas.map((a) => a.name)).size !== areas.length) throw new Error('two municipalities share a name');
const byName = new Map(areas.map((a) => [a.name, a]));

// THE PROVINCE SEATS, at their centres: each is a town zone of its own — its municipality. Sofia is the capital's municipality,
// Stolichna; Sofia province has no seat of its own inside it. Each centre is checked to lie in the municipality named for it.
const SEATS = [
  ['Sofia', 'Stolichna', 42.6977, 23.3219], ['Plovdiv', 'Plovdiv', 42.1354, 24.7453], ['Varna', 'Varna', 43.2141, 27.9147],
  ['Burgas', 'Burgas', 42.5048, 27.4626], ['Ruse', 'Ruse', 43.8356, 25.9657], ['Stara Zagora', 'Stara Zagora', 42.4258, 25.6345],
  ['Pleven', 'Pleven', 43.417, 24.6067], ['Sliven', 'Sliven', 42.6817, 26.3229], ['Dobrich', 'Dobrich', 43.5726, 27.8273],
  ['Shumen', 'Shumen', 43.2712, 26.9361], ['Pernik', 'Pernik', 42.6052, 23.0378], ['Haskovo', 'Haskovo', 41.9344, 25.5554],
  ['Yambol', 'Yambol', 42.4842, 26.5035], ['Pazardzhik', 'Pazardzhik', 42.1928, 24.3336], ['Blagoevgrad', 'Blagoevgrad', 42.0209, 23.0943],
  ['Veliko Tarnovo', 'Veliko Tarnovo', 43.0757, 25.6172], ['Vratsa', 'Vratsa', 43.2102, 23.5529], ['Gabrovo', 'Gabrovo', 42.8742, 25.3187],
  ['Vidin', 'Vidin', 43.9962, 22.8679], ['Kyustendil', 'Kyustendil', 42.2839, 22.6911], ['Kardzhali', 'Kardzhali', 41.65, 25.3667],
  ['Montana', 'Montana', 43.4125, 23.225], ['Targovishte', 'Targovishte', 43.2512, 26.5726], ['Lovech', 'Lovech', 43.137, 24.7142],
  ['Silistra', 'Silistra', 44.1171, 27.2606], ['Razgrad', 'Razgrad', 43.5333, 26.5167], ['Smolyan', 'Smolyan', 41.5774, 24.7011],
].map(([town, municipality, lat, lng]) => ({ town, municipality, lat, lng }));
for (const s of SEATS) {
  const a = byName.get(s.municipality);
  if (!a) throw new Error(`${s.municipality} is no municipality in the file`);
  if (!G.contains(a.shape, { lat: s.lat, lng: s.lng })) throw new Error(`${s.town}'s centre does not lie in ${s.municipality}`);
}
const seatOf = new Map(SEATS.map((s) => [s.municipality, s.town]));

// THE REGULATOR'S HARD-TO-REACH VILLAGES, counted per municipality: each row of the list names a village (its postcode and name)
// and its municipality — on its own line, or on the line beside it where the PDF split the row.
const CYR = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sht', ъ: 'a', ь: 'y', ю: 'yu', я: 'ya' };
const latin = (s) => [...s.toLowerCase()].map((c) => CYR[c] ?? c).join('');
const key = (s) => latin(s).replace(/[^a-z]/g, '');
const lines = fs.readFileSync(path.join(DATA, 'crc-tdr.txt'), 'utf8').split(/\r?\n/);
const muniKeys = areas.map((a) => ({ a, k: key(a.name.replace(/ \(.*\)$/, '')), words: latin(a.name.replace(/ \(.*\)$/, '')).split(/\s+/) }));
const provinceKeys = provinces.map((p) => ({ name: p.name, k: key(p.name) }));
function municipalityIn(line, after = 0) {
  const t = latin(line.slice(after));
  let best;
  for (const m of muniKeys) {
    const re = new RegExp(`(^|[^a-z])${m.words.join('\\s+')}([^a-z]|$)`);
    const hit = re.exec(t);
    if (hit && (!best || hit.index < best.at || (hit.index === best.at && m.words.length > best.m.words.length))) best = { m, at: hit.index };
  }
  return best?.m.a;
}
function provinceIn(line) {
  const first = key(line.trim().split(/\s{2,}/)[0] ?? '');
  return provinceKeys.find((p) => p.k === first || (p.k === 'sofiacity' && first === 'sofiyagrad'))?.name;
}
// COUNTED ONLY WHERE THE ROW SAYS IT: a village whose own line names its province first and its municipality after it, the
// municipality one of that province's. On many pages the two are merged cells, printed once for a block of rows, and those rows
// are not guessed at — so each count is a floor, said as "at least".
const seen = new Set();
const hard = new Map();
let rows = 0;
let placed = 0;
lines.forEach((line) => {
  const row = /(^|\s)(\d{1,3})\s+(\d{4})\s+(\S+(?:\s\S+)*?)(?=\s{2,}|$)/.exec(line);
  if (!row || !/[А-Яа-я]/.test(row[4])) return;
  const village = `${row[3]}|${row[4]}`;
  if (seen.has(village)) return;
  seen.add(village);
  rows += 1;
  const province = provinceIn(line);
  const m = province ? municipalityIn(line, row.index + row[0].length) : undefined;
  if (!m || m.province !== province) return;
  placed += 1;
  hard.set(m.i, (hard.get(m.i) ?? 0) + 1);
});
console.log('hard-to-reach villages', rows, '· counted where the row names its province and municipality', placed);
if (placed < rows * 0.5) throw new Error('fewer than half the villages counted: read the list again');

// WHERE IT COSTS MORE TO SERVE: a municipality, not a province seat, with at least REMOTE_MIN of its villages on the regulator's
// list. A list of 2011, said with its date; a company that knows its roads changes it.
const REMOTE_MIN = Number(process.argv[3] ?? 15);
const CRC = 'the Communications Regulation Commission’s list of settlements meeting its criteria for being hard to reach (decision No 606 of 23 June 2011)';
const zoneKey = (a) => (seatOf.has(a.name) ? `town:${seatOf.get(a.name)}` : (hard.get(a.i) ?? 0) >= REMOTE_MIN ? `remote:${a.province}` : `province:${a.province}`);
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
  const province = list[0].province;
  if (kind === 'town') {
    const villages = hard.get(list[0].i) ?? 0;
    const evidence = [name === 'Sofia' ? 'The capital: Sofia City’s one municipality, Stolichna, as one zone.' : `The seat of ${province} province: its municipality as one zone.`];
    // Its villages are inside it: said where many are on the regulator's list, so the company can judge which it serves.
    if (villages >= REMOTE_MIN) evidence.push(`At least ${villages} of its villages are on ${CRC}: the town sets the group here; change it where the villages are what you serve.`);
    out.push({ name, group: 'urban', areas: list.map((a) => a.i), evidence, province });
  } else if (kind === 'remote') {
    const named = list.map((a) => `${a.name} (at least ${hard.get(a.i)})`).join(', ');
    out.push({ name: `${name === 'Sofia City' ? 'Sofia City' : name} province, hard to reach`, group: 'remote', areas: list.map((a) => a.i), evidence: [`Municipalities with at least ${REMOTE_MIN} villages on ${CRC}: ${named}.`], province });
  } else {
    out.push({ name: name === 'Sofia' ? 'Sofia province' : `${name} province`, group: 'rural', areas: list.map((a) => a.i), evidence: [`The rest of ${name} province: no province seat, and fewer than ${REMOTE_MIN} villages of any of its municipalities on the regulator’s hard-to-reach list. Rural until you say otherwise.`], province });
  }
}
out.sort((a, b) => a.province.localeCompare(b.province) || a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
const names = out.map((z) => z.name);
if (new Set(names).size !== names.length) throw new Error('two zones share a name');
const groups = { urban: 0, rural: 0, remote: 0 };
for (const z of out) groups[z.group]++;
console.log('zones', out.length, JSON.stringify(groups));
const top = [...hard.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([i, n]) => `${areas[i].name} ${n}`);
console.log('most villages on the list:', top.join(', '));
for (const z of out.filter((x) => x.group === 'remote')) console.log(z.name.padEnd(36), z.areas.length, 'municipalities');

const encoded = areas.map((a) => ({ name: a.name, polygons: a.shape.map(G.encodePolygon) }));
const body = `/**
 * BULGARIA ONLY — the first zone map proposed for Bulgaria (2026-11-22; the Netherlands–Bulgaria plan, part 10). Generated by
 * backend/scripts/zone-proposal-bg.cjs from geoBoundaries (gbOpen): Bulgaria's ${areas.length} municipalities as the areas, each in its
 * province (Zlatitsa's two parts as one; Sarnitsa still inside Velingrad, as the source has it); a zone for each province seat, Sofia's municipality among them; remote where at least ${REMOTE_MIN} of a municipality's villages
 * are on the Communications Regulation Commission's hard-to-reach list (2011); and a zone for the rest of each province. Whoever
 * answers in Bulgaria starts from it, or not, and changes it.
 * Nothing here is read for any other country (zone-proposals/index.ts).
 */
import type { ZoneProposal } from './types';

export const BG_PROPOSAL: ZoneProposal = {
  country: 'BG',
  label: 'Bulgaria’s ${areas.length} municipalities: a zone for each province seat and the rest of each province',
  source: 'geoBoundaries (gbOpen): Bulgaria’s municipalities and provinces (2019); the Communications Regulation Commission’s hard-to-reach list (2011)',
  licence: 'Public domain (Wikimedia, via geoBoundaries)',
  attribution: 'Municipalities and provinces: Wikimedia Commons — via geoBoundaries; hard-to-reach list: Communications Regulation Commission',
  level: 'municipalities',
  areas: ${JSON.stringify(encoded)},
  zones: ${JSON.stringify(out.map(({ name, group, areas, evidence }) => ({ name, group, areas, evidence })))},
};
`;
fs.writeFileSync(OUT, body);
console.log('module', (body.length / 1024).toFixed(0), 'KB →', OUT);
