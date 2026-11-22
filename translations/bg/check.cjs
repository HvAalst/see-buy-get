// The gate for a translated part: node check.cjs <part id> [<part id> …]   (e.g. node check.cjs send.01 send.02)
// Reads parts/<id>.json (English) and out/<id>.json (Bulgarian). FAILS on: a key missing or added, an empty phrase, a
// {placeholder} or counted word that differs from the English (the same rule as the app's guard), a counted word in a form
// Bulgarian does not have (Bulgarian counts in "one" and "other" only). WARNS on: a phrase left identical to the English
// with words in it, a phrase with no Cyrillic letter, quoted labels (“…”) that do not match the English count.
const fs = require('fs');
const path = require('path');
const HERE = __dirname;

function closing(s, open) {
  let depth = 0;
  for (let i = open; i < s.length; i += 1) {
    if (s[i] === '{') depth += 1;
    else if (s[i] === '}' && --depth === 0) return i;
  }
  return -1;
}
function placeholdersOf(msg) {
  const found = new Set();
  const walk = (s) => {
    for (let open = s.indexOf('{'); open >= 0; ) {
      const end = closing(s, open);
      if (end < 0) return;
      const inner = s.slice(open + 1, end);
      const plural = /^(\w+),\s*plural,([\s\S]*)$/.exec(inner);
      if (plural) {
        found.add(`${plural[1]}#`);
        let rest = plural[2].trim();
        for (let m = /^(=\d+|zero|one|two|few|many|other)\s*\{/.exec(rest); m; m = /^(=\d+|zero|one|two|few|many|other)\s*\{/.exec(rest)) {
          const e = closing(rest, m[0].length - 1);
          if (e < 0) break;
          walk(rest.slice(m[0].length, e));
          rest = rest.slice(e + 1).trim();
        }
      } else if (/^\w+$/.test(inner)) found.add(inner);
      open = s.indexOf('{', end + 1);
    }
  };
  walk(msg);
  return [...found].sort().join(',');
}
const pluralForms = (msg) => [...msg.matchAll(/(?:^|[\s}])(=\d+|zero|one|two|few|many|other)\s*\{/g)].map((m) => m[1]);
const BG_FORMS = new Set(['one', 'other']);
const quotes = (s) => (s.match(/“/g) || []).length;
// Words that stay as they are in any language: names, codes and units.
const KEEP = /^(SeeBuyGet|M-Pesa|Mollie|iDEAL|telebirr|Chapa|OK|PIN|QR|GS1|GLN|SSCC|CMR|e-CMR|ADR|VAT|ID|SMS|API|URL|PDF|CSV|ZPL|NFC|GPS|km|kg|m³|cm|EUR|KES|ETB|USD|\W|\d|\s)+$/i;

const ids = process.argv.slice(2);
if (!ids.length) { console.error('usage: node check.cjs <part id> …'); process.exit(2); }
let failed = 0;
for (const id of ids) {
  const en = JSON.parse(fs.readFileSync(path.join(HERE, 'parts', id + '.json'), 'utf8'));
  const outPath = path.join(HERE, 'out', id + '.json');
  if (!fs.existsSync(outPath)) { console.log(`FAIL ${id}: out/${id}.json is missing`); failed += 1; continue; }
  let bg;
  try { bg = JSON.parse(fs.readFileSync(outPath, 'utf8')); } catch (e) { console.log(`FAIL ${id}: not valid JSON — ${e.message}`); failed += 1; continue; }
  const problems = [];
  const warnings = [];
  for (const k of Object.keys(en)) if (!(k in bg)) problems.push(`missing ${k}`);
  for (const k of Object.keys(bg)) if (!(k in en)) problems.push(`not in the English: ${k}`);
  for (const [k, text] of Object.entries(bg)) {
    const base = en[k];
    if (base === undefined) continue;
    if (typeof text !== 'string' || !text.trim()) { problems.push(`empty ${k}`); continue; }
    if (placeholdersOf(base) !== placeholdersOf(text)) problems.push(`${k} has {${placeholdersOf(text)}}, English {${placeholdersOf(base)}}`);
    for (const f of pluralForms(text)) if (!f.startsWith('=') && !BG_FORMS.has(f)) problems.push(`${k} counts in "${f}", which Bulgarian does not have (one, other only)`);
    const plain = base.replace(/\{[^}]*\}/g, '');
    if (!KEEP.test(plain)) {
      if (text === base && /[A-Za-z]{3,}\s+[A-Za-z]{3,}/.test(plain)) warnings.push(`left in English: ${k}`);
      else if (!/[Ѐ-ӿ]/.test(text) && /[A-Za-z]{3,}/.test(plain)) warnings.push(`no Cyrillic: ${k}`);
    }
    if (quotes(base) !== quotes(text)) warnings.push(`quoted labels ${quotes(text)} ≠ English ${quotes(base)}: ${k}`);
  }
  if (problems.length) {
    failed += 1;
    console.log(`FAIL ${id}: ${problems.length} problem(s)`);
    for (const p of problems.slice(0, 40)) console.log('  ' + p);
  } else {
    console.log(`PASS ${id}: ${Object.keys(bg).length} phrases${warnings.length ? `, ${warnings.length} warning(s)` : ''}`);
  }
  for (const w of warnings.slice(0, 15)) console.log('  warn ' + w);
}
process.exit(failed ? 1 : 0);
