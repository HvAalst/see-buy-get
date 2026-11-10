import { describe, expect, it } from 'vitest';
import { en } from './i18n/catalogs/en';
import { MOYALE_COUNTRIES, manifestGapWords } from './manifestGaps';

/** 2026-11-10 — what a border manifest at Moyale still lacks, said in the reader's language. */
describe('manifestGapWords', () => {
  const t = (key: string) => (en as Record<string, string>)[key] ?? `?${key}`;

  it('says each gap the server names by its key, in the chosen language', () => {
    for (const key of ['invoice', 'consignor_tax', 'consignee_tax', 'consignor_country', 'consignee_country', 'hs_codes', 'export_entry', 'etims_invoice', 'import_declaration', 'vehicle', 'vehicle_country', 'yellow_card', 'passport']) {
      const said = manifestGapWords({ key, who: 'shipper', words: 'server words' }, t as never);
      expect(said.startsWith('?')).toBe(false);
      expect(said).not.toBe('server words');
    }
    expect(manifestGapWords({ key: 'passport', who: 'carrier', words: 'x' }, t as never)).toMatch(/passport/);
  });

  it('says the server’s own sentence for a gap it does not know yet', () => {
    expect(manifestGapWords({ key: 'something_new', who: 'shipper', words: 'The new thing, from the server' }, t as never)).toBe('The new thing, from the server');
  });

  it('asks only Kenya and Ethiopia', () => {
    expect([...MOYALE_COUNTRIES].sort()).toEqual(['ET', 'KE']);
  });
});
