/**
 * Build every SeeBuyGet PWA.
 *
 * Vite 5 resolves one `root` and one `base` per build, and each app installs at its own
 * path, so five installable apps is five `vite build` runs. vite.config.ts configures the
 * app named by SBG_APP; this script sets it once per app and runs them in sequence.
 *
 * The app list is READ FROM DISK (any src/apps/<id>/index.html), not hard-coded, so a new
 * app folder plus its entry in the APPS registry in vite.config.ts is all it takes. An app
 * directory with no registry entry fails loudly on its own build (unknown SBG_APP).
 *
 *   node scripts/build-all.mjs              # all apps
 *   node scripts/build-all.mjs agent mdp    # a subset
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APPS_DIR = resolve(ROOT, 'src/apps');
const VITE_BIN = resolve(ROOT, 'node_modules/vite/bin/vite.js');

const discovered = readdirSync(APPS_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory() && existsSync(resolve(APPS_DIR, e.name, 'index.html')))
  .map((e) => e.name)
  // driver first: it is the reference build, so a regression shows up in the first line.
  // `home` LAST: it ships at the web root (outDir is dist/ itself), so building it last
  // keeps the root index.html newer than the leaf apps it links to — and makes the
  // ordering intent explicit next to the emptyOutDir carve-out in vite.config.ts.
  .sort((a, b) => {
    if (a === 'driver' || b === 'driver') return a === 'driver' ? -1 : 1;
    if (a === 'home' || b === 'home') return a === 'home' ? 1 : -1;
    return a.localeCompare(b);
  });

const wanted = process.argv.slice(2);
const unknown = wanted.filter((w) => !discovered.includes(w));
if (unknown.length) {
  console.error(`unknown app(s): ${unknown.join(', ')} — have: ${discovered.join(', ')}`);
  process.exit(1);
}
const apps = wanted.length ? wanted : discovered;

for (const app of apps) {
  console.log(`\n--- vite build: ${app} ---`);
  // The bin is invoked through node directly, not the `vite` shim: this script must work
  // when run as plain `node scripts/build-all.mjs` (no npm-injected node_modules/.bin on
  // PATH) and with no shell, on Windows as well as CI Linux.
  const r = spawnSync(process.execPath, [VITE_BIN, 'build'], {
    cwd: ROOT,
    env: { ...process.env, SBG_APP: app },
    stdio: 'inherit',
  });
  if (r.status !== 0) {
    console.error(`\nbuild failed: ${app} (exit ${r.status ?? 'signal ' + r.signal})`);
    process.exit(r.status ?? 1);
  }
}

console.log(`\nbuilt ${apps.length} app(s): ${apps.join(', ')}`);

/**
 * The embeddable quote widget — built last, and only on a full run.
 *
 * It is not an app (no manifest, no service worker, no install path) so it is not in the loop above, and
 * its count is reported on its own line: "built N app(s)" has been the one-line proof that a frontend
 * change did not break a build, and quietly folding a library into that number would blunt it.
 *
 * After the apps because the root app's outDir IS dist/ with emptyOutDir off — order does not matter today,
 * and this way it cannot start to.
 */
if (!wanted.length) {
  console.log(`\n--- vite build: embed widget ---`);
  const r = spawnSync(process.execPath, [VITE_BIN, 'build', '--config', 'vite.widget.config.ts'], { cwd: ROOT, env: process.env, stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`\nbuild failed: embed widget (exit ${r.status ?? 'signal ' + r.signal})`);
    process.exit(r.status ?? 1);
  }
  console.log('built 1 embed: sbg-quote.js');
}
