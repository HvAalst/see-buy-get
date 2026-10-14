import { COUNTRY_CATALOGUE, catalogueEntry, isCatalogued } from './catalogue';

describe('the country catalogue', () => {
  it('holds every country once, each with a currency, a dialling code and a side of the road', () => {
    // 249 ISO codes, less the seven uninhabited ones nobody ships from (AQ BV GS HM IO TF UM), plus Kosovo.
    expect(COUNTRY_CATALOGUE.length).toBe(243);
    for (const uninhabited of ['AQ', 'BV', 'GS', 'HM', 'IO', 'TF', 'UM']) expect(isCatalogued(uninhabited)).toBe(false);
    const codes = COUNTRY_CATALOGUE.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const c of COUNTRY_CATALOGUE) {
      expect(c.code).toMatch(/^[A-Z]{2}$/);
      expect(c.currency).toMatch(/^[A-Z]{3}$/);
      expect(c.dialCode).toMatch(/^\+\d{1,4}$/);
      expect(['left', 'right']).toContain(c.drivingSide);
      expect(c.languages.length).toBeGreaterThan(0);
      expect(c.idDocuments.length).toBeGreaterThan(0);
      // A name, not the code echoed back — the platform knows every one of these regions.
      expect(c.name).not.toBe(c.code);
    }
  });

  it('knows the countries the network trades across', () => {
    expect(catalogueEntry('KE')).toMatchObject({ name: 'Kenya', currency: 'KES', dialCode: '+254', drivingSide: 'left' });
    expect(catalogueEntry('tz')).toMatchObject({ name: 'Tanzania', currency: 'TZS', drivingSide: 'left' });
    expect(catalogueEntry('ET')).toMatchObject({ currency: 'ETB', drivingSide: 'right' });
    expect(catalogueEntry('DE')?.idDocuments).toContain('personalausweis');
    // Uganda's addresses carry no postal code, so a form must not ask for one.
    expect(catalogueEntry('UG')?.postalCode).toBe(false);
  });

  it('is not fooled by two letters that are not a country', () => {
    expect(isCatalogued('ZZ')).toBe(false);
    expect(isCatalogued('')).toBe(false);
    expect(isCatalogued(undefined)).toBe(false);
  });
});
