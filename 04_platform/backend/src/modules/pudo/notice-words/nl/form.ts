import type { EN_FORM } from '../en/form';

export const NL_FORM: Record<keyof typeof EN_FORM, string> = {
  'refuse.form.email': 'Vul een geldig e-mailadres in ({field}).',
  'refuse.form.missing': 'Er ontbreekt iets wat gevraagd is: {field}.',
  'refuse.form.tooLong': '{field} is te lang.',
  'refuse.form.tooShort': '{field} is te kort.',
  'refuse.form.tooMany': '{field} heeft te veel items.',
  'refuse.form.tooFew': '{field} heeft te weinig items.',
  'refuse.form.number': '{field} moet een getal zijn.',
  'refuse.form.tooSmall': '{field} is te klein.',
  'refuse.form.tooLarge': '{field} is te groot.',
  'refuse.form.choice': '{field} is geen van de keuzes.',
  'refuse.form.date': '{field} moet een datum zijn.',
  'refuse.form.format': '{field} is niet geschreven zoals gevraagd.',
  'refuse.form.yesNo': '{field} moet ja of nee zijn.',
  'refuse.form.other': 'Er klopt iets niet in het formulier: {field}.',
};
