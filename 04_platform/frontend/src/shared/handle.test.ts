import { describe, expect, it } from 'vitest';
import { pageNameFor, pageStem } from './handle';

// The same names as the server's own test (backend/src/foundation/handle/handle.spec.ts): what is shown while signing
// up must be what the server issues on approval.
describe('the page name a name gives, as the server makes it', () => {
  it('keeps an accented word whole — the mark dropped, never a hyphen in the middle of a name', () => {
    const cases: Array<[string, string]> = [
      ['Citroën Garage', 'citroen-garage'],
      ['Société Générale', 'societe-generale'],
      ['Ölçü Kargo', 'olcu-kargo'],
      ['Café Mbeya', 'cafe-mbeya'],
      ['Straße & Söhne', 'strasse-sohne'],
      ['Ærø Færge', 'aero-faerge'],
      ['Łódź Spedycja', 'lodz-spedycja'],
      ['FedEx Kenya Ltd', 'fedex-kenya-ltd'],
    ];
    for (const [name, stem] of cases) expect([name, pageStem(name)]).toEqual([name, stem]);
  });

  it('is at most thirty long, never ends on a hyphen, and is nothing while nothing survives', () => {
    expect(pageStem('Mama Sarah General Merchandise and Sons Ltd')).toBe('mama-sarah-general-merchandise');
    // Cut on the hyphen after the thirtieth letter: the hyphen goes too.
    expect(pageStem('Mama Sarah General Merchandis & Sons')).toBe('mama-sarah-general-merchandis');
    expect([pageNameFor('', 'NL'), pageNameFor('  —  ', 'NL')]).toEqual(['', '']);
  });

  it('gives a name that reads like one of our own pages the country’s code, as the server does', () => {
    expect(pageNameFor('Support', 'NL')).toBe('support-nl');
    expect(pageNameFor('Central Sort', 'NL')).toBe('central-sort');
  });
});
