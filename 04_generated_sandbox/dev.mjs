// GLOS sandbox dev runner — starts the NestJS backend (:3000) and the vanilla frontend (:4173)
// together, with prefixed logs. No build step needed (backend runs via `nest start`). Ctrl-C stops both.
//   npm run dev      # then, once the backend is up:  npm run seed

import { spawn } from 'node:child_process';

const tasks = [
  { name: 'backend ', args: ['--prefix', 'backend', 'run', 'start:dev'], color: '\x1b[36m' },
  { name: 'frontend', args: ['--prefix', 'frontend', 'run', 'start'], color: '\x1b[32m' },
];

console.log('\n\x1b[1mGLOS sandbox — dev\x1b[0m');
console.log('  backend  → http://localhost:3000/v1');
console.log('  frontend → http://localhost:4173/  (index = the PUDO hub)');
console.log('  seed demo data (once backend is up): \x1b[1mnpm run seed\x1b[0m\n');

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
