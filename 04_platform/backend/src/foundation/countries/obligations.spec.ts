import { catalogueEntry } from './catalogue';

/** 2026-11-11 — each country's own registrations, as its company's checklist asks them. */
describe('what each country requires of anybody operating there', () => {
  const keys = (country: string) => catalogueEntry(country)?.obligations.map((o) => o.key) ?? [];

  it('asks a courier licence in Kenya, Uganda and Ethiopia, of each country’s own regulator', () => {
    expect(catalogueEntry('KE')!.obligations.find((o) => o.key === 'courier_licence')?.authority).toBe('Communications Authority of Kenya');
    expect(catalogueEntry('UG')!.obligations.find((o) => o.key === 'courier_licence')?.authority).toBe('Uganda Communications Commission');
    expect(catalogueEntry('ET')!.obligations.find((o) => o.key === 'courier_licence')?.authority).toBe('Ethiopian Communications Authority');
  });

  it('asks the Netherlands what the Netherlands asks: the ACM postal-carrier registration and a reported data protection officer — not a registration the GDPR ended', () => {
    expect(keys('NL')).toEqual(['postal_registration', 'data_protection_registration']);
    const nl = catalogueEntry('NL')!.obligations;
    expect(nl[0]).toMatchObject({ authority: 'Autoriteit Consument & Markt (ACM)' });
    expect(nl[1]).toMatchObject({ name: 'Data protection officer appointed and reported', authority: 'Autoriteit Persoonsgegevens' });
  });

  // 2026-11-22 — Bulgaria (the Netherlands–Bulgaria plan, part 5): its own two, in place of the default.
  it('asks Bulgaria what Bulgaria asks: entry in the CRC’s register of postal operators and a reported data protection officer', () => {
    expect(keys('BG')).toEqual(['postal_registration', 'data_protection_registration']);
    const bg = catalogueEntry('BG')!;
    expect(bg.obligations[0]).toMatchObject({ authority: 'Communications Regulation Commission', name: expect.stringMatching(/notification .* or individual licence/) });
    expect(bg.obligations[1]).toMatchObject({ authority: 'Commission for Personal Data Protection' });
    expect(bg.idDocuments).toEqual(['id_card', 'passport', 'driving_licence', 'residence_permit']);
    expect(bg.currency).toBe('EUR');
  });

  it('keeps a nation’s rules national: no courier licence asked where none was researched', () => {
    expect(keys('DE')).not.toContain('courier_licence');
    expect(keys('NL')).not.toContain('courier_licence');
  });
});
