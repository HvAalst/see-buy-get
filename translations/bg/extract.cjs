// Bulgarian (bg), version 1: the English of every app, split into parts of about 30,000 characters for translators.
// The key set of each word file is the Dutch one (words/nl/<file>.ts, complete and guarded); the English comes from the
// catalogues as they stand now (bundled with esbuild). Writes parts/<file>.<nn>.json ({ key: english }) and manifest.json.
// Run once; never again while translators are reading parts.
const fs = require('fs');
const path = require('path');
const FE = 'C:/Users/yukel/Documents/Projects/GLOS/04_platform/frontend';
const HERE = __dirname;
const esbuild = require(FE + '/node_modules/esbuild');

const catalogDir = FE + '/src/shared/i18n/catalogs';
const files = fs.readdirSync(catalogDir).filter((f) => /^en(\.[a-z-]+)?\.ts$/.test(f));
const entry = files.map((f, i) => `import * as m${i} from ${JSON.stringify(catalogDir + '/' + f)};`).join('\n') + `\nexport const all = [${files.map((_, i) => `m${i}`).join(',')}];`;
const out = path.join(HERE, 'en-bundle.cjs');
esbuild.buildSync({ stdin: { contents: entry, resolveDir: catalogDir, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', outfile: out, logLevel: 'error' });
const { all } = require(out);
const english = {};
for (const mod of all) for (const v of Object.values(mod)) if (v && typeof v === 'object' && !Array.isArray(v)) for (const [k, s] of Object.entries(v)) if (typeof s === 'string') english[k] = s;

const nlDir = FE + '/src/shared/i18n/words/nl';
const PART_CHARS = 30000;
fs.rmSync(path.join(HERE, 'parts'), { recursive: true, force: true });
fs.mkdirSync(path.join(HERE, 'parts'), { recursive: true });
const manifest = [];
let total = 0;
let missing = 0;
for (const f of fs.readdirSync(nlDir).filter((x) => x.endsWith('.ts')).sort()) {
  const name = f.replace(/\.ts$/, '');
  const src = fs.readFileSync(path.join(nlDir, f), 'utf8');
  const keys = [...src.matchAll(/^\s*("(?:[^"\\]|\\.)*"):/gm)].map((m) => JSON.parse(m[1]));
  let part = {};
  let size = 0;
  let n = 0;
  const flush = () => {
    if (!Object.keys(part).length) return;
    n += 1;
    const id = `${name}.${String(n).padStart(2, '0')}`;
    fs.writeFileSync(path.join(HERE, 'parts', id + '.json'), JSON.stringify(part, null, 1));
    manifest.push({ id, file: name, phrases: Object.keys(part).length, chars: size });
    part = {};
    size = 0;
  };
  for (const k of keys) {
    const en = english[k];
    if (en == null) { missing += 1; continue; }
    part[k] = en;
    size += k.length + en.length;
    total += 1;
    if (size >= PART_CHARS) flush();
  }
  flush();
}
fs.writeFileSync(path.join(HERE, 'manifest.json'), JSON.stringify(manifest, null, 1));
console.log(`${manifest.length} parts, ${total} phrases, ${manifest.reduce((a, p) => a + p.chars, 0)} chars; ${missing} Dutch keys with no English now (left out)`);
