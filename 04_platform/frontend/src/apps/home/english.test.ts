import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { en } from '../../shared/i18n/catalogs/en';
import { enHome } from '../../shared/i18n/catalogs/en.home';
import { enFront } from '../../shared/i18n/catalogs/en.front';
import { enPages } from '../../shared/i18n/catalogs/en.pages';
import { enPrivacy } from '../../shared/i18n/catalogs/en.privacy';

/*
 * THE FRONT DOOR CARRIES ITS OWN WORDS ONLY (the user, 2026-10-23: "the loading time of the homepage should be short for
 * a low quality phone with poor connection"). Its english.ts adds the front door's catalogs and nothing else — not the
 * other apps' and not the help's — so a word of theirs used by any code the front door reaches would be drawn as its
 * key. What is held to here: no code the front door reaches uses another app's words; the help's words are used, in the
 * first download, only where they are fetched before they are drawn.
 */
const SRC = 'src';

/** Every source file under src/, as 'apps/home/main.tsx'. (node-fs.d.ts declares just enough of node for this, on purpose.) */
function allFiles(dir = ''): string[] {
  return readdirSync(join(SRC, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : allFiles(rel);
    return /\.tsx?$/.test(e.name) ? [rel] : [];
  });
}
const FILES = new Set(allFiles());

/** 'apps/home/screens' + '../logic' → 'apps/home/logic'. */
function joinPath(dir: string, spec: string): string {
  const out = dir.split('/');
  for (const part of spec.split('/')) {
    if (part === '..') out.pop();
    else if (part !== '.') out.push(part);
  }
  return out.join('/');
}

/** Every source file reached from `entry` through relative imports — `dynamic` ones too, or only the first download. */
function reached(entry: string, dynamic: boolean): string[] {
  const seen = new Set<string>();
  const stack = [entry];
  const imports = dynamic
    ? /(?:import|export)\s[^'"]*?from\s*['"](\.[^'"]+)['"]|import\(\s*['"](\.[^'"]+)['"]\s*\)|import\s+['"](\.[^'"]+)['"]/g
    : /(?:import|export)\s(?!type\b)[^'"]*?from\s*['"](\.[^'"]+)['"]|import\s+['"](\.[^'"]+)['"]/g;
  while (stack.length) {
    const f = stack.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    for (const m of readFileSync(join(SRC, f), 'utf8').matchAll(imports)) {
      const base = joinPath(f.slice(0, f.lastIndexOf('/')), m[1] ?? m[2] ?? m[3]);
      const hit = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`].find((p) => FILES.has(p));
      if (hit) stack.push(hit);
    }
  }
  return [...seen].filter((f) => !f.includes('i18n/catalogs/'));
}

const wordsIn = (file: string, ns: string) => [...readFileSync(join(SRC, file), 'utf8').matchAll(new RegExp(`['"\`](${ns})\\.[A-Za-z0-9_$]`, 'g'))].length;

describe('the front door’s own words', () => {
  it('no code the front door reaches uses another app’s words, which it does not carry', () => {
    const files = reached('apps/home/main.tsx', true);
    // The guard read something: the homepage and the joining are among what it found.
    expect(files).toEqual(expect.arrayContaining(['apps/home/screens/WelcomeScreen.tsx', 'apps/home/screens/JoinScreen.tsx']));
    // shared/tips.ts names each tip by an id shaped like a key ('driver.route.how') — a name to remember a closed tip by,
    // never a word looked up.
    const borrowed = files.filter((f) => f !== 'shared/tips.ts' && wordsIn(f, 'agent|driver|fleet|mdp|vendor|business') > 0);
    expect(borrowed).toEqual([]);
  });

  it('in the first download, the help’s words are used only where they are fetched before they are drawn', () => {
    const first = reached('apps/home/main.tsx', false);
    expect(first).toContain('apps/home/screens/WelcomeScreen.tsx');
    // The help screen and the joining are not in it at all.
    expect(first).not.toContain('apps/home/screens/HelpScreen.tsx');
    expect(first).not.toContain('apps/home/screens/JoinScreen.tsx');
    const fetchFirst = [
      'apps/home/app.tsx', // the help screen's title, drawn only once loadHelpPage() has brought the help in
      'apps/home/help.ts', // the help's own addresses and labels, drawn by the help screen
      'shared/account/TroubleSheet.tsx', // draws articles only once useHelpWords() says they are here
      'shared/guide/HelpLink.tsx', // likewise
      'shared/guide/articles.ts', // the articles' shape, read by the two sheets above
      'shared/i18n/index.ts', // asks whether the help's words are here yet, by one of them
    ];
    expect(first.filter((f) => wordsIn(f, 'help') > 0 && !fetchFirst.includes(f))).toEqual([]);
  });

  it('never fetches the help about working in an app: the public site holds getting in and getting started only', () => {
    // The user, 2026-10-23: "Just the info to get started should be enough, and the operational issues could live in the
    // apps". Each other app asks for en.help-app.ts in its english.ts; nothing the front door reaches may.
    const asks = (f: string) => /(?:import\(|from)\s*['"][^'"]*\/en\.help-app['"]/.test(readFileSync(join(SRC, f), 'utf8'));
    const files = reached('apps/home/main.tsx', true);
    expect(files).toContain('shared/i18n/index.ts');
    expect(files.filter(asks)).toEqual([]);
    // The guard reads what it is meant to: an app that does ask for them is found asking.
    expect(asks('apps/agent/english.ts')).toBe(true);
  });

  it('what it adds is its own: the front page, joining, the pages written to be quoted — and the core every app carries', () => {
    const own = { ...enHome, ...enFront, ...enPages, ...enPrivacy };
    expect(Object.keys(own).every((k) => /^(home|front|pages)\./.test(k))).toBe(true);
    // The core holds none of an app's own words.
    expect(Object.keys(en).filter((k) => /^(agent|driver|fleet|mdp|vendor|business|home|help|front|pages)\./.test(k))).toEqual([]);
  });
});
