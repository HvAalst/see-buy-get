import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { exportLink, importLink, loadLink, runLink } from './notification.types';

/*
 * 2026-11-02 — WHERE A NOTICE OPENS, in one tap (the owner: "we must reduce the tapping, so that's why it should open").
 * A notice's link names the record it is about, as a query on the app's own address — the apps read it in
 * frontend/src/shared/launch.ts. Never a path: the build has one page per app.
 */
describe('a notice’s link names its record', () => {
  it('a load, a run and its booking, an export, an import — each a query on the app root', () => {
    expect(loadLink('frt_1', 'road')).toBe('/?load=frt_1&about=road');
    expect(runLink('dep_1')).toBe('/?run=dep_1');
    expect(runLink('dep_1', 'bk_1')).toBe('/?run=dep_1&booking=bk_1');
    expect(exportLink('exp_1')).toBe('/?export=exp_1');
    expect(importLink('imp_1')).toBe('/?import=imp_1');
    for (const l of [loadLink('a'), runLink('a', 'b'), exportLink('a'), importLink('a')]) expect(l).toMatch(/^\/\?[a-z]+=[^/]+$/);
  });

  it('an id that could break the address is written safely', () => {
    expect(runLink('dep 1', 'bk&2')).toBe('/?run=dep%201&booking=bk%262');
  });

  it('every problem told to a business about its export or import opens that export or import', () => {
    const read = (f: string) => readFileSync(join(__dirname, f), 'utf8');
    const exports = read('export.service.ts');
    const imports = read('import.service.ts');
    // Read something: a guard that matched nothing proves nothing.
    expect(exports.match(/tag: `export:\$\{c\.exportId\}/g)?.length).toBeGreaterThan(0);
    expect(imports.match(/tag: `import:\$\{c\.importId\}/g)?.length).toBe(4);
    expect(exports).not.toMatch(/link: '\/', tag: `export:/);
    expect(imports).not.toMatch(/link: '\/', tag: `import:/);
    expect(exports.match(/link: exportLink\(c\.exportId\), tag: `export:/g)?.length).toBe(1);
    expect(imports.match(/link: importLink\(c\.importId\), tag: `import:/g)?.length).toBe(4);
  });
});
