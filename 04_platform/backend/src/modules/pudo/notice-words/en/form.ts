/**
 * 2026-11-27 — a form the server refuses, said plainly (foundation/http/validation.pipe.ts): an app asking in another language
 * is told the first problem in these words; English callers keep the validator's own words, as before. {field} is the field as
 * the form names it. The other languages beside it (../<lang>/form.ts).
 */
export const EN_FORM = {
  'refuse.form.email': 'Enter a valid email address ({field}).',
  'refuse.form.missing': 'Something asked for is missing: {field}.',
  'refuse.form.tooLong': '{field} is too long.',
  'refuse.form.tooShort': '{field} is too short.',
  'refuse.form.tooMany': '{field} has too many items.',
  'refuse.form.tooFew': '{field} has too few items.',
  'refuse.form.number': '{field} must be a number.',
  'refuse.form.tooSmall': '{field} is too small.',
  'refuse.form.tooLarge': '{field} is too large.',
  'refuse.form.choice': '{field} is not one of the choices.',
  'refuse.form.date': '{field} must be a date.',
  'refuse.form.format': '{field} is not written the way it is asked.',
  'refuse.form.yesNo': '{field} must be yes or no.',
  'refuse.form.other': 'Something in the form is not right: {field}.',
} as const;
