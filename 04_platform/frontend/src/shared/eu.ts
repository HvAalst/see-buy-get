/**
 * 2026-11-22 — THE EU AS ONE CUSTOMS TERRITORY, as the server holds it (backend foundation/countries/customs-union.ts; the owner's
 * BG-2): between two of its 27 members there are no customs. A form asks the sender's word on what goods with their own rules
 * are not inside before it is sent, instead of after a refusal. A test keeps this list the server's.
 */
export const EU_MEMBERS = [
  'AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'HU',
  'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK',
] as const;

const EU = new Set<string>(EU_MEMBERS);

/** Two different countries both in the EU: the passage between them, or nothing. */
export function euPassage(from: string | undefined, to: string | undefined): { fromCountry: string; toCountry: string } | null {
  const a = from?.trim().toUpperCase();
  const b = to?.trim().toUpperCase();
  return a && b && a !== b && EU.has(a) && EU.has(b) ? { fromCountry: a, toCountry: b } : null;
}
