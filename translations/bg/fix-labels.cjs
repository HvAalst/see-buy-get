// Puts the button's own translation inside a quoted label that does not match it — only where the button has ONE
// translation and the Bulgarian phrase quotes as many labels as the English, matched by position.
const fs = require('fs');
const misses = JSON.parse(fs.readFileSync('label-misses.json', 'utf8'));
const where = {};
for (const f of fs.readdirSync('out').filter((x) => x.endsWith('.json'))) for (const k of Object.keys(JSON.parse(fs.readFileSync('out/' + f, 'utf8')))) where[k] = f;
const en = {};
for (const f of fs.readdirSync('parts')) Object.assign(en, JSON.parse(fs.readFileSync('parts/' + f, 'utf8')));
let fixed = 0, left = [];
for (const m of misses) {
  const cands = m.bg.split(' | ');
  if (cands.length !== 1) { left.push(`${m.key} (${cands.length} translations)`); continue; }
  const file = 'out/' + where[m.key];
  const o = JSON.parse(fs.readFileSync(file, 'utf8'));
  const enLabels = [...en[m.key].matchAll(/“([^”]+)”/g)].map((x) => x[1]);
  const bgQuotes = [...o[m.key].matchAll(/“([^”]+)”/g)];
  if (enLabels.length !== bgQuotes.length) { left.push(`${m.key} (quote counts differ)`); continue; }
  const i = enLabels.findIndex((l) => l.split(' › ').includes(m.label));
  const enParts = enLabels[i].split(' › ');
  const bgParts = bgQuotes[i][1].split(' › ');
  if (enParts.length !== bgParts.length) { left.push(`${m.key} (route lengths differ)`); continue; }
  bgParts[enParts.indexOf(m.label)] = cands[0];
  const q = bgQuotes[i];
  o[m.key] = o[m.key].slice(0, q.index) + '“' + bgParts.join(' › ') + '”' + o[m.key].slice(q.index + q[0].length);
  fs.writeFileSync(file, JSON.stringify(o, null, 1));
  fixed += 1;
}
console.log('fixed', fixed, '| left for the proofreader:', left.join(', ') || 'none');
