// Quoted button names in the Bulgarian: does each “label” match how that button itself is translated?
const fs = require('fs');
const en = {}, bg = {};
for (const f of fs.readdirSync('parts')) {
  Object.assign(en, JSON.parse(fs.readFileSync('parts/' + f, 'utf8')));
  if (fs.existsSync('out/' + f)) Object.assign(bg, JSON.parse(fs.readFileSync('out/' + f, 'utf8')));
}
const byEnglish = {};
for (const [k, v] of Object.entries(en)) if (v.length < 60 && !/[{“]/.test(v)) (byEnglish[v] = byEnglish[v] || new Set()).add(bg[k]);
let checked = 0, matched = 0, ambiguous = 0;
const misses = [];
for (const [k, v] of Object.entries(en)) {
  const labels = [...v.matchAll(/“([^”]+)”/g)].map((m) => m[1]);
  for (const l of labels) {
    const parts = l.split(' › ');
    for (const p of parts) {
      const cands = byEnglish[p];
      if (!cands) continue;
      checked += 1;
      if (cands.size > 1) ambiguous += 1;
      if ([...cands].some((t) => t && bg[k].includes(t))) matched += 1;
      else misses.push({ key: k, label: p, bg: [...cands].join(' | ') });
    }
  }
}
console.log(`quoted labels checked ${checked}, matched ${matched}, not matched ${misses.length} (labels with several translations: ${ambiguous})`);
fs.writeFileSync('label-misses.json', JSON.stringify(misses, null, 1));
for (const m of misses.slice(0, 12)) console.log(`${m.key}: “${m.label}” → expected ${m.bg}`);
