import type { SbgError } from '../lib/sbg';

/**
 * WHICH OF THEIR DETAILS IS ALREADY REGISTERED — so a screen can say what is expected next.
 *
 * A duplicate used to reach every screen as "Something went wrong. Try again.", which is the one thing the person
 * must not do: trying again with the same details is refused again, and trying with different ones makes a second
 * identity. The server now names the field it matched (`params.field`); this reads it, and never parses English.
 */
export const DUPLICATE_FIELDS = ['nationalId', 'phone', 'licence', 'device', 'email'] as const;
export type DuplicateField = (typeof DUPLICATE_FIELDS)[number];

/** The detail a DUPLICATE refusal names, or nothing for any other error (or a duplicate of something else). */
export function duplicateField(error: SbgError | null | undefined): DuplicateField | undefined {
  if (!error || error.code !== 'DUPLICATE') return undefined;
  const field = error.params?.field;
  return typeof field === 'string' && (DUPLICATE_FIELDS as readonly string[]).includes(field) ? (field as DuplicateField) : undefined;
}

/** A national ID or a licence number: somebody's identity document, as opposed to a phone or an email they sign in with. */
export function isIdentityDocument(field: DuplicateField | undefined): boolean {
  return field === 'nationalId' || field === 'licence';
}
