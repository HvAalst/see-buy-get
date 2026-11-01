import { describe, expect, it } from 'vitest';
import { addressBody, missingPart, startingCountry, type AddressFormat } from './address';

const NL: AddressFormat = {
  country: 'NL',
  fields: [
    { key: 'street', required: true },
    { key: 'number', required: true },
    { key: 'addition', required: false },
    { key: 'postcode', required: true },
    { key: 'town', required: true },
  ],
  postcodeExample: '1015 CJ',
};

describe('an address in its country’s parts, as Settings asks it', () => {
  it('starts in the saved address’s country, else the browser’s region, else none', () => {
    expect(startingCountry({ country: 'KE', area: 'CBD', town: 'Nairobi' }, 'nl-NL')).toBe('KE');
    expect(startingCountry(undefined, 'nl-NL')).toBe('NL');
    expect(startingCountry(undefined, 'en')).toBe('');
    expect(startingCountry(undefined, undefined)).toBe('');
  });

  it('sends only the parts the country asks, trimmed, and none left empty', () => {
    const values = { street: ' Keizersgracht ', number: '123', addition: '', postcode: '1015cj', town: 'Amsterdam', area: 'left over from Kenya' };
    expect(addressBody('NL', values, NL)).toEqual({ country: 'NL', street: 'Keizersgracht', number: '123', postcode: '1015cj', town: 'Amsterdam' });
    expect(addressBody('NL', values, null)).toEqual({ country: 'NL' });
  });

  it('names the first required part still empty, and nothing once they are all there', () => {
    expect(missingPart({ street: 'Keizersgracht', postcode: '1015 CJ', town: 'Amsterdam' }, NL)).toBe('number');
    expect(missingPart({ street: 'Keizersgracht', number: '1', postcode: '1015 CJ', town: 'Amsterdam' }, NL)).toBeNull();
    expect(missingPart({}, null)).toBeNull();
  });
});
