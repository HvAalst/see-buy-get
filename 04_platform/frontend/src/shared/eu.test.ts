import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EU_MEMBERS, euPassage } from './eu';

describe('the EU, as the server holds it', () => {
  it('is the same 27 countries as the server’s list', () => {
    const server = readFileSync('../backend/src/foundation/countries/customs-union.ts', 'utf8');
    const list = /export const EU_MEMBERS = \[([^\]]+)\]/.exec(server)![1].match(/'([A-Z]{2})'/g)!.map((c) => c.slice(1, 3));
    expect([...EU_MEMBERS]).toEqual(list);
    expect(EU_MEMBERS).toHaveLength(27);
  });

  it('is a passage only between two different members', () => {
    expect(euPassage('NL', 'bg')).toEqual({ fromCountry: 'NL', toCountry: 'BG' });
    expect(euPassage('NL', 'NL')).toBeNull();
    expect(euPassage('NL', 'KE')).toBeNull();
    expect(euPassage(undefined, 'BG')).toBeNull();
  });
});
