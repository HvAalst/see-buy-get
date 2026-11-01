import { addressFormatFor, checkAddress, formatAddress } from './address-format';

/**
 * AN ADDRESS AS THE COUNTRY WRITES IT (the owner, 2026-10-30: "the address field is poor, especially for countries that
 * do have formal physical addresses. We say it is used for invoicing").
 */
describe('an address, as its country writes it', () => {
  it('asks a Dutch address for its street, number, postcode and town — and writes it the Dutch way', () => {
    expect(addressFormatFor('nl')).toEqual({
      country: 'NL',
      fields: [
        { key: 'street', required: true },
        { key: 'number', required: true },
        { key: 'addition', required: false },
        { key: 'postcode', required: true },
        { key: 'town', required: true },
      ],
      postcodeExample: '1015 CJ',
    });
    const nl = checkAddress({ country: 'nl', street: ' Keizersgracht ', number: '123', addition: 'B', postcode: '1015cj', town: 'Amsterdam' });
    expect(nl).toEqual({ country: 'NL', street: 'Keizersgracht', number: '123', addition: 'B', postcode: '1015 CJ', town: 'Amsterdam' });
    expect(formatAddress(nl)).toBe('Keizersgracht 123 B, 1015 CJ Amsterdam');
  });

  it('refuses by the field: a missing part, a postcode that is not the country’s, a country that is none', () => {
    expect(() => checkAddress({ country: 'NL', street: 'Keizersgracht', postcode: '1015 CJ', town: 'Amsterdam' })).toThrow(expect.objectContaining({ params: { field: 'number' } }));
    expect(() => checkAddress({ country: 'NL', street: 'Keizersgracht', number: '1', postcode: '10155', town: 'Amsterdam' })).toThrow(/not a postcode of Netherlands: it looks like 1015 CJ/);
    expect(() => checkAddress({ country: 'XX', line: 'Somewhere' })).toThrow(/Choose the country/);
    expect(() => checkAddress({ country: 'DE', street: 'x'.repeat(121), number: '1', postcode: '10115', town: 'Berlin' })).toThrow(/too long/);
  });

  it('writes the number first in France, and the town, state and postcode on one line in the United States', () => {
    expect(formatAddress(checkAddress({ country: 'FR', number: '12', street: 'rue de Rivoli', postcode: '75001', town: 'Paris' }))).toBe('12 rue de Rivoli, 75001 Paris');
    expect(formatAddress(checkAddress({ country: 'US', line: '350 Fifth Avenue', town: 'New York', region: 'NY', postcode: '10118' }))).toBe('350 Fifth Avenue, New York NY 10118');
    expect(formatAddress(checkAddress({ country: 'GB', line: '10 Downing Street', town: 'London', postcode: 'sw1a2aa' }))).toBe('10 Downing Street, London, SW1A 2AA');
  });

  it('asks a Kenyan address for a building, a road and an area, and a post office box — none of them a number it must have', () => {
    expect(addressFormatFor('KE').fields.map((f) => `${f.key}${f.required ? '*' : ''}`)).toEqual(['building', 'street', 'area*', 'poBox', 'postcode', 'town*']);
    const ke = checkAddress({ country: 'KE', building: 'Mama Ngina Plaza', street: 'Moi Avenue', area: 'CBD', poBox: '12345', postcode: '00100', town: 'Nairobi' });
    expect(formatAddress(ke)).toBe('Mama Ngina Plaza Moi Avenue, CBD, P.O. Box 12345 - 00100, Nairobi');
    // An area and a town is an address there.
    expect(formatAddress(checkAddress({ country: 'KE', area: 'Kibera', town: 'Nairobi' }))).toBe('Kibera, Nairobi');
    expect(() => checkAddress({ country: 'KE', area: 'CBD', postcode: '100', town: 'Nairobi' })).toThrow(/looks like 00100/);
  });

  it('asks anywhere else for a line and a town, and no postcode where the country has none', () => {
    expect(addressFormatFor('BR').fields.map((f) => f.key)).toEqual(['line', 'area', 'postcode', 'town']);
    // Uganda has no postal codes (the catalogue): none is asked.
    expect(addressFormatFor('UG').fields.map((f) => f.key)).not.toContain('postcode');
    expect(formatAddress(checkAddress({ country: 'BR', line: 'Avenida Paulista 1578', area: 'Bela Vista', postcode: '01310-200', town: 'São Paulo' }))).toBe('Avenida Paulista 1578, Bela Vista, 01310-200 São Paulo');
  });
});
