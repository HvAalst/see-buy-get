/**
 * EVERY APP CARRIES THE WORDS IT SHOWS — checked on what was built.
 *
 * Each app adds only its own words before it draws (src/apps/<app>/english.ts), so its first download stays light on a
 * slow connection (the user, 2026-10-23: "the loading time of the homepage should be short for a low quality phone with
 * poor connection"). The cost of that: a word an app's code names but its english.ts does not add is drawn as its
 * key — "tower.imports.title" on a button. The Business app showed the console's screens that way from 2026-10-22
 * until this check found it, and no test could: the tests load every word there is, and an app reaches code it never
 * runs.
 *
 * So this reads each built app, after tree-shaking, as the browser will get it: every key its code names must be one of
 * its catalogs' entries, in its own files (the help's, fetched when a help sheet opens, included).
 *
 *   node scripts/check-words.mjs              # every app
 *   node scripts/check-words.mjs agent mdp    # some
 *
 * A key named with a variable end (`agent.status.${s}`, or a prefix handed to a function) is satisfied by any entry
 * under it. A tip's id (src/shared/tips.ts) looks like a key and is not one: it names a tip to remember it was closed.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CATALOGS = join(ROOT, 'src/shared/i18n/catalogs');

/** Where each app is built to (the APPS registry in vite.config.ts: its `base`, the console to dist-console/). */
const ASSETS = {
  home: 'dist/assets',
  tower: 'dist-console/assets',
  genesis: 'dist/send/assets',
};
const assetsOf = (app) => join(ROOT, ASSETS[app] ?? `dist/${app}/assets`);

const discovered = readdirSync(join(ROOT, 'src/apps'), { withFileTypes: true })
  .filter((e) => e.isDirectory() && existsSync(join(ROOT, 'src/apps', e.name, 'index.html')))
  .map((e) => e.name);
const apps = process.argv.slice(2).length ? process.argv.slice(2) : discovered;

// The namespaces words live under — read from the catalogs, so a string like 'error.generic' (an audio clip's name) is
// not taken for a word.
const namespaces = new Set();
for (const f of readdirSync(CATALOGS).filter((f) => /^en.*\.ts$/.test(f) && !f.includes('.test.'))) {
  for (const m of readFileSync(join(CATALOGS, f), 'utf8').matchAll(/^\s*'([a-z][A-Za-z]*)\.[^']+':/gm)) namespaces.add(m[1]);
}
const tips = new Set([...readFileSync(join(ROOT, 'src/shared/tips.ts'), 'utf8').matchAll(/\|\s*'([a-z][\w.-]+)'/g)].map((m) => m[1]));
if (namespaces.size < 20 || tips.size < 5) {
  console.error(`check-words: read ${namespaces.size} namespaces and ${tips.size} tip ids — the catalogs or tips.ts moved`);
  process.exit(1);
}

// A quoted dotted string; a catalog's entry is followed by a colon, a word named in code is not.
const QUOTED = /(["'`])([a-z][A-Za-z]*\.[A-Za-z0-9_.-]+(?:\$\{)?)(?:\1|(?<=\$\{))(\s*:)?/g;

let failed = false;
for (const app of apps) {
  const dir = assetsOf(app);
  if (!existsSync(dir)) {
    console.error(`check-words: ${app} — nothing built at ${dir}`);
    failed = true;
    continue;
  }
  const carried = new Set();
  const named = new Map();
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    const js = readFileSync(join(dir, f), 'utf8');
    for (const m of js.matchAll(QUOTED)) {
      if (!namespaces.has(m[2].split('.')[0])) continue;
      if (m[3]) carried.add(m[2]);
      else if (!named.has(m[2])) named.set(m[2], f);
    }
  }
  // The guard read something: an app with no words in it was not read.
  if (carried.size < 200 || named.size < 100) {
    console.error(`check-words: ${app} — read ${carried.size} words and ${named.size} uses; is ${dir} an app?`);
    failed = true;
    continue;
  }
  const keys = [...carried];
  const under = (stem) => keys.some((k) => k.startsWith(stem));
  const missing = [...named].filter(([k]) => {
    if (carried.has(k) || tips.has(k)) return false;
    if (k.endsWith('${')) return !under(k.slice(0, -2));
    if (k.endsWith('.')) return !under(k);
    return !under(`${k}.`);
  });
  if (missing.length) {
    failed = true;
    console.error(`\ncheck-words: the ${app} app names ${missing.length} word(s) it does not carry — it would show their keys:`);
    for (const [k, f] of missing.slice(0, 40)) console.error(`  ${k}   (${f})`);
    if (missing.length > 40) console.error(`  … and ${missing.length - 40} more`);
    console.error(`  Add the catalog they are in to src/apps/${app}/english.ts — or, for a few words of another app's, move them to a shared catalog both add (en.goods.ts is one).`);
  } else {
    console.log(`check-words: ${app} carries every word it names (${named.size} named, ${carried.size} carried)`);
  }
}
if (failed) process.exit(1);
