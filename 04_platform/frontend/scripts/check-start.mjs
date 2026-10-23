/**
 * EVERY APP STARTS FROM WHAT IT SAVED ON THE FIRST VISIT — checked on what was built.
 *
 * An app with a service worker copies a list of its files on the first visit, so the next opening works without signal,
 * on a phone in a place with thin data. Two ways that broke without any test seeing it (2026-10-23): a file
 * the page starts from was left off that list (the list leaves some files to be fetched when needed — vite.config.ts
 * ROOT_ON_DEMAND — and named the prerender entry among them), and the front page started from the prerender entry at
 * all — the build-time script, with the help's words and the page heads — because the prerender plugin chunks it with
 * the page on Linux and not on Windows.
 *
 * So this reads each built app's page and its service worker: every script and stylesheet the page starts from is on
 * the first visit's list; and the front page starts from nothing of the prerender entry's.
 *
 *   node scripts/check-start.mjs              # every app
 *   node scripts/check-start.mjs home agent   # some
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Where each app is built to (the APPS registry in vite.config.ts: its `base`, the console to dist-console/). */
const DIRS = { home: 'dist', tower: 'dist-console', genesis: 'dist/send' };
const dirOf = (app) => join(ROOT, DIRS[app] ?? `dist/${app}`);

const discovered = readdirSync(join(ROOT, 'src/apps'), { withFileTypes: true })
  .filter((e) => e.isDirectory() && existsSync(join(ROOT, 'src/apps', e.name, 'index.html')))
  .map((e) => e.name);
const apps = process.argv.slice(2).length ? process.argv.slice(2) : discovered;

let failed = false;
let checked = 0;
for (const app of apps) {
  const dir = dirOf(app);
  const page = join(dir, 'index.html');
  if (!existsSync(page)) {
    console.error(`check-start: ${app} — nothing built at ${page}`);
    failed = true;
    continue;
  }
  const html = readFileSync(page, 'utf8');
  // What the page starts from: its scripts, the modules it preloads, its stylesheets — as paths below the app's base.
  const base = app === 'home' || app === 'tower' ? '/' : `/${dir.slice(join(ROOT, 'dist').length + 1).replace(/\\/g, '/')}/`;
  const starts = [...html.matchAll(/<(?:script[^>]*\ssrc|link[^>]*\shref)="([^"]+\.(?:js|css))"/g)]
    .map((m) => m[1])
    .filter((u) => u.startsWith(base))
    .map((u) => u.slice(base.length));
  if (!starts.some((u) => u.endsWith('.js'))) {
    console.error(`check-start: ${app} — read no script from ${page}; did its page change shape?`);
    failed = true;
    continue;
  }
  const problems = [];
  if (app === 'home') {
    // The prerender entry is the build-time script: a visitor never needs it.
    for (const u of starts) if (/(^|\/)prerenderEntry-/.test(u)) problems.push(`starts from the prerender entry ${u} — build-time code in every visitor's download`);
  }
  const sw = join(dir, 'sw.js');
  if (existsSync(sw)) {
    const saved = new Set([...readFileSync(sw, 'utf8').matchAll(/url:"([^"]+)"/g)].map((m) => m[1]));
    if (saved.size < 5) problems.push(`its service worker lists ${saved.size} files — did sw.js change shape?`);
    for (const u of starts) if (!saved.has(u)) problems.push(`starts from ${u}, which the first visit does not save — without signal the next opening fails`);
  }
  checked++;
  if (problems.length) {
    failed = true;
    console.error(`\ncheck-start: the ${app} app —`);
    for (const p of problems) console.error(`  ${p}`);
  } else {
    console.log(`check-start: ${app} starts from ${starts.length} file(s)${existsSync(sw) ? ', every one saved on the first visit' : ' (no service worker)'}`);
  }
}
if (!checked && !failed) {
  console.error('check-start: no app checked');
  failed = true;
}
if (failed) process.exit(1);
