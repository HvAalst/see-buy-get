/**
 * Two names are one person when they differ only in case and spacing — "Amina  O" cannot second "amina o".
 * Used wherever a rule needs TWO people: switching a country on, verifying a document somebody else uploaded.
 */
export function samePerson(a: string | undefined, b: string | undefined): boolean {
  const n = (s: string | undefined) => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  return Boolean(n(a)) && n(a) === n(b);
}
