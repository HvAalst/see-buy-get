/**
 * 2026-11-22 — ONE CUSTOMS TERRITORY ACROSS SEVERAL COUNTRIES: the European Union (the owner's BG-2, "As recommended for all eu
 * nations"). Goods in free circulation move between its members with no customs declaration, no commercial invoice for customs,
 * no wait at a border post and no customs hold — the Union Customs Code (Regulation (EU) No 952/2013) has one customs
 * territory, and Bulgaria and Romania have been inside Schengen at their land borders too since 1 January 2025.
 *
 * Only the 27 member states, by their ISO-3166 codes (Greece is GR here, never the EU's own "EL"). Places with a code of their
 * own stay outside even where EU law reaches them — the outermost regions (GF, GP, MQ, RE, YT) are outside the VAT area, so a
 * parcel there is still declared; Monaco and San Marino share the customs territory by treaty but are not counted until a route
 * asks for them. Places inside a member's code that are outside the VAT area (the Canary Islands, Åland, Mount Athos) cannot be
 * told apart by a country code: the staff help says so, and legal.html keeps the question.
 *
 * East Africa's customs union is NOT one of these: its members still clear goods at their borders, so KE→UG stays a crossing.
 */
export const EU_MEMBERS = [
  'AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'HU',
  'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK',
] as const;

/** The customs unions whose members clear nothing between them. One today. */
export type CustomsUnion = 'EU';

const EU = new Set<string>(EU_MEMBERS);

/** The customs union a country is a member of, where it is one whose members clear nothing between them. */
export function customsUnionOf(country: string | undefined): CustomsUnion | undefined {
  return country && EU.has(country.trim().toUpperCase()) ? 'EU' : undefined;
}

/** Whether goods going from one country to the other are cleared by customs: two different countries, not in one union. */
export function customsBorderBetween(from: string | undefined, to: string | undefined): boolean {
  const a = from?.trim().toUpperCase();
  const b = to?.trim().toUpperCase();
  if (!a || !b || a === b) return false;
  const union = customsUnionOf(a);
  return !union || union !== customsUnionOf(b);
}

/** The union two different countries share, where they share one: goods go between them with no customs. */
export function unionBetween(from: string | undefined, to: string | undefined): CustomsUnion | undefined {
  const a = from?.trim().toUpperCase();
  const b = to?.trim().toUpperCase();
  if (!a || !b || a === b) return undefined;
  const union = customsUnionOf(a);
  return union && union === customsUnionOf(b) ? union : undefined;
}
