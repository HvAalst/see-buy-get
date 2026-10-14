/**
 * Just enough of `node:fs` and `node:path` for a test to read this repository off disk.
 *
 * THIS PROJECT SHIPS NO @types/node ON PURPOSE (see raw-import.d.ts): browser code must not be able to
 * reach for a Node global, and keeping the types out is what makes that a compile error rather than a
 * convention. The usual way round it is vite's `?raw` import, and for the OpenAPI contract and help.html
 * that is exactly right.
 *
 * It is not right for stylesheets. Vitest short-circuits CSS modules — `css: false` is its default — and
 * a `?raw` import of a .css file comes back as an EMPTY STRING with no error anywhere. A guard that read
 * its stylesheets that way passed 31 checks against nothing at all, which is a worse outcome than no
 * guard: it reports that something is being watched.
 *
 * So the four functions that one suite needs are declared here, by hand, rather than pulling in a type
 * package that would also declare `process`, `Buffer` and `__dirname` for every app file in the tree.
 */
declare module 'node:fs' {
  export interface Dirent {
    name: string;
    isDirectory(): boolean;
  }
  export function readdirSync(path: string, options: { withFileTypes: true }): Dirent[];
  export function readFileSync(path: string, encoding: 'utf8'): string;
}

declare module 'node:path' {
  export function join(...parts: string[]): string;
}
