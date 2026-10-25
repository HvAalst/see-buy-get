import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * WHAT A PAGE MAY RUN (2026-10-25). The Caddyfile's Content-Security-Policy allows scripts from the site itself and, by
 * its fingerprint, the one inline script the public pages carry: the help's dark theme, set before the page paints. An
 * edit to that script changes its fingerprint, and the policy would then block it on every public page without a word
 * — so the two are held equal here.
 *
 * The fingerprint is of the text AS A BROWSER READS IT: the HTML parser turns every CRLF into LF before anything is
 * hashed. A checkout on Windows has CRLF on disk; the release is built on Linux, with LF. Hashing the bytes on disk
 * gave a fingerprint no browser ever matched (found walking the policy, 2026-10-25).
 *
 * Read off disk with the repository's own small `node:fs` (see node-fs.d.ts), from the frontend folder the tests run in.
 */
const caddyfile = readFileSync('Caddyfile', 'utf8');
const policy = caddyfile.match(/Content-Security-Policy "([^"]+)"/)?.[1] ?? '';

/** Every inline script that runs, in an HTML file: not one with a src, and not data (JSON, JSON-LD). */
function inlineScripts(html: string): string[] {
  return [...html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/g)].filter((m) => !/\ssrc=|application\/(ld\+)?json/.test(m[1] ?? '')).map((m) => m[2]);
}

/** `'sha256-…'` of the text as a browser reads it — the way a policy names an inline script. */
async function fingerprint(script: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(script.replace(/\r\n?/g, '\n'))));
  return `'sha256-${btoa(String.fromCharCode(...digest))}'`;
}

/** The HTML every app is built from. */
function templates(dir = join('src', 'apps')): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? (entry.name === 'node_modules' ? [] : templates(join(dir, entry.name))) : entry.name === 'index.html' ? [join(dir, entry.name)] : [],
  );
}

describe('the content policy that ships', () => {
  it('is read from the Caddyfile: scripts from the site only, no frames of ours elsewhere, no plug-ins', () => {
    expect(policy).toContain("default-src 'self'");
    expect(policy).toMatch(/script-src 'self'( 'sha256-[A-Za-z0-9+/=]+')*;/);
    expect(policy).not.toMatch(/script-src[^;]*'unsafe-(inline|eval)'/);
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("object-src 'none'");
  });

  it('allows each inline script an app is built with, by its fingerprint — and nothing it does not carry', async () => {
    const allowed = policy.match(/'sha256-[A-Za-z0-9+/=]+'/g) ?? [];
    const carried = await Promise.all(templates().flatMap((file) => inlineScripts(readFileSync(file, 'utf8'))).map(fingerprint));
    // The help's dark theme, at least: proof the templates were read.
    expect(carried.length).toBeGreaterThan(0);
    for (const one of carried) expect(allowed).toContain(one);
    // A fingerprint left behind by a script since removed allows nothing anybody wrote: it goes.
    for (const one of allowed) expect(carried).toContain(one);
  });

  it('fingerprints the text as a browser reads it, whatever the line ends on disk', async () => {
    expect(await fingerprint('a\r\nb')).toBe(await fingerprint('a\nb'));
  });
});
