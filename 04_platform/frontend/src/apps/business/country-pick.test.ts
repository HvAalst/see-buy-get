import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/*
 * A COUNTRY IS PICKED, NEVER TYPED AS A CODE (the owner, 2026-11-02: "'sent from' and 'going to' for reporting exports
 * as we said should be country picker"; every choice a picker, since the exports work began).
 */
const src = (f: string) => readFileSync(`src/apps/business/screens/${f}`, 'utf8');

describe('an export’s countries', () => {
  it('are picked from the atlas — sent from, going to, and the airport’s country — on a sea export and an air export', () => {
    for (const f of ['ExportsScreen.tsx', 'ExportByAir.tsx']) {
      const s = src(f);
      expect(s).toMatch(/<CountrySelect value=\{form\.from\}[^\n]*label=\{t\('business\.exports\.f\.from'\)\}/);
      expect(s).toMatch(/<CountrySelect value=\{form\.to\}[^\n]*label=\{t\('business\.exports\.f\.to'\)\}/);
      // No two-letter box left for a country.
      expect({ f, typed: /field\('(from|to|departsFrom)'/.test(s) }).toEqual({ f, typed: false });
    }
    expect(src('ExportByAir.tsx')).toMatch(/<CountrySelect value=\{form\.departsFrom\}/);
  });

  it('say what they ask, not "country code"', () => {
    const words = readFileSync('src/shared/i18n/catalogs/en.business.ts', 'utf8');
    expect(words).toMatch(/'business\.exports\.f\.from': "Sent from"/);
    expect(words).toMatch(/'business\.exports\.f\.to': "Going to"/);
    expect(words).not.toMatch(/two letters\), if its airport/);
  });
});
