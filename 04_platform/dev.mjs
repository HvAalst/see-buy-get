// GLOS sandbox dev runner — starts the NestJS backend (:3000) and ONE frontend app together, with
// prefixed logs. No build step needed (backend runs via `nest start`). Ctrl-C stops both.
//   npm run dev      # then, once the backend is up:  npm --prefix backend run seed:demo
//
// There are eight apps and Vite builds ONE at a time, so this runs the default (driver, :5173). For a
// different one, start it yourself beside this: SBG_APP=tower npm --prefix frontend run dev.
// Nothing serves `frontend/src` statically any more — the last hand-rolled page there is gone.

import { spawn } from 'node:child_process';

const tasks = [
  { name: 'backend ', args: ['--prefix', 'backend', 'run', 'start:dev'], color: '\x1b[36m' },
  { name: 'frontend', args: ['--prefix', 'frontend', 'run', 'dev'], color: '\x1b[32m' },
];

console.log('\n\x1b[1mGLOS sandbox — dev\x1b[0m');
console.log('  backend  → http://localhost:3000/v1');
console.log('  frontend → http://localhost:5173/driver/  (SBG_APP=tower … for another app)');
console.log('  seed demo data (once backend is up): \x1b[1mnpm --prefix backend run seed:demo\x1b[0m\n');

const children = tasks.map(({ name, args, color }) => {
  const child = spawn('npm', args, { shell: true, cwd: import.meta.dirname });
  const prefix = `${color}[${name}]\x1b[0m `;
  const pipe = (stream, out) => stream.on('data', (d) => out.write(String(d).replace(/\r?\n$/, '').split('\n').map((l) => prefix + l).join('\n') + '\n'));
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => console.log(`${prefix}exited (${code})`));
  return child;
});

const stop = () => { children.forEach((c) => c.kill()); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
