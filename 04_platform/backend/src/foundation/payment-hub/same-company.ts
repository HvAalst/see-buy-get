/**
 * 2026-11-26 — IS THE MOLLIE ACCOUNT THE PARTNER'S OWN COMPANY'S? (the weakness after the counters' Mollie payments, fixed as
 * recommended: any member of a partner could connect a Mollie account, a personal one too, and the counters' money would go there.)
 * Mollie says which organization an account is — its registration number and its VAT number; the partner's record says its own
 * registration number. Compared as letters and digits only, a country prefix dropped (BG 123456789 is 123456789):
 *
 * - `yes`: the registration number, or the VAT number, is the partner's.
 * - `no`: Mollie's registration number is another one — the account is not used, whatever the VAT number says.
 * - `unknown`: one side gave none, or only a VAT number that differs (in some countries it is another number than the registration,
 *   the Netherlands' among them) — used, and our staff are asked to check it against the partner's contract.
 */
export type SameCompany = 'yes' | 'no' | 'unknown';

export function normaliseRegistration(v: string | undefined): string | undefined {
  const s = (v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!s) return undefined;
  return /^[A-Z]{2}\d+[A-Z0-9]*$/.test(s) ? s.slice(2) : s;
}

export function sameCompany(expected: string | undefined, org: { registrationNumber?: string; vatNumber?: string } | undefined): SameCompany {
  const own = normaliseRegistration(expected);
  const reg = normaliseRegistration(org?.registrationNumber);
  const vat = normaliseRegistration(org?.vatNumber);
  if (!own || (!reg && !vat)) return 'unknown';
  if (own === reg || own === vat) return 'yes';
  return reg ? 'no' : 'unknown';
}
