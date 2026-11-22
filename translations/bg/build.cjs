// Writes the Bulgarian word files, words/bg/<file>.ts, from out/<part>.json — only once EVERY part in manifest.json is
// translated and passes the checker: a partial folder would tell a draft company's readiness that the apps speak
// Bulgarian when they do not (app-languages.test.ts). Phrases are kept in the English catalogue's key order.
// node build.cjs            → refuses while parts are missing, and lists them
// node build.cjs --status   → how far it is
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const HERE = __dirname;
const WORDS = 'C:/Users/yukel/Documents/Projects/GLOS/04_platform/frontend/src/shared/i18n/words/bg';
const manifest = JSON.parse(fs.readFileSync(path.join(HERE, 'manifest.json'), 'utf8'));
const done = manifest.filter((p) => fs.existsSync(path.join(HERE, 'out', p.id + '.json')));
const status = `${done.length} of ${manifest.length} parts, ${done.reduce((a, p) => a + p.phrases, 0)} of ${manifest.reduce((a, p) => a + p.phrases, 0)} phrases`;
if (process.argv.includes('--status')) { console.log(status); process.exit(0); }
const missing = manifest.filter((p) => !done.includes(p));
if (missing.length) { console.log(`Not yet: ${status}. Missing: ${missing.map((p) => p.id).join(' ')}`); process.exit(1); }
execSync(`node check.cjs ${manifest.map((p) => p.id).join(' ')}`, { cwd: HERE, stdio: 'inherit' });
fs.mkdirSync(WORDS, { recursive: true });
const byFile = {};
for (const p of manifest) {
  const en = JSON.parse(fs.readFileSync(path.join(HERE, 'parts', p.id + '.json'), 'utf8'));
  const bg = JSON.parse(fs.readFileSync(path.join(HERE, 'out', p.id + '.json'), 'utf8'));
  byFile[p.file] = byFile[p.file] ?? [];
  for (const k of Object.keys(en)) byFile[p.file].push([k, bg[k]]);
}
for (const [file, pairs] of Object.entries(byFile)) {
  const body = pairs.map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join('\n');
  const head = `// Български — version 1, written in for en.${file === 'base' ? '' : file + '.'}ts (2026-11-22). Fetched only when the language is chosen\n// (shared/i18n/index.ts); a country's own review is laid over it, and this stays as written. Generated: edit the review, not this.\n`;
  fs.writeFileSync(path.join(WORDS, file + '.ts'), `${head}export const words: Record<string, string> = {\n${body}\n};\n`);
}
console.log(`wrote ${Object.keys(byFile).length} files to words/bg (${status})`);
