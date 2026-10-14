// Copy the illustration masters from the brand folder into the backend's shipped assets.
//
// `brand/illustrations/` is where the drawings are AUTHORED — beside the logo files, under the rules in
// brand/README.md. `backend/assets/illustrations/` is what SHIPS, so the server stays self-contained and
// never reaches out of its own package at runtime.
//
// Two directories rather than one because they answer different questions: the first is a design source and
// belongs with the identity, the second is a build artefact and belongs with the thing that serves it. This
// script is the seam, and running it is the whole ceremony.
//
//   node scripts/sync-illustrations.mjs

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKEND = resolve(HERE, '..');
const SOURCE = resolve(BACKEND, '..', '..', 'brand', 'illustrations');
const DEST = join(BACKEND, 'assets', 'illustrations');

if (!existsSync(SOURCE)) {
  console.error(`No masters at ${SOURCE} — nothing to sync.`);
  process.exit(1);
}

// Replaced wholesale, not merged: a drawing deleted from the masters must disappear from what ships, or the
// house set slowly fills with pictures of options that no longer exist.
if (existsSync(DEST)) rmSync(DEST, { recursive: true, force: true });
mkdirSync(DEST, { recursive: true });
cpSync(SOURCE, DEST, { recursive: true });

let count = 0;
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path);
    else count += 1;
  }
};
walk(DEST);

console.log(`Synced ${count} illustration${count === 1 ? '' : 's'} → assets/illustrations`);
