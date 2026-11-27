import type { EN_FORM } from '../en/form';

export const BG_FORM: Record<keyof typeof EN_FORM, string> = {
  'refuse.form.email': 'Въведете валиден имейл адрес ({field}).',
  'refuse.form.missing': 'Липсва нещо от поисканото: {field}.',
  'refuse.form.tooLong': '{field} е твърде дълго.',
  'refuse.form.tooShort': '{field} е твърде кратко.',
  'refuse.form.tooMany': '{field} има твърде много елементи.',
  'refuse.form.tooFew': '{field} има твърде малко елементи.',
  'refuse.form.number': '{field} трябва да бъде число.',
  'refuse.form.tooSmall': '{field} е твърде малко.',
  'refuse.form.tooLarge': '{field} е твърде голямо.',
  'refuse.form.choice': '{field} не е сред възможните избори.',
  'refuse.form.date': '{field} трябва да бъде дата.',
  'refuse.form.format': '{field} не е написано по поискания начин.',
  'refuse.form.yesNo': '{field} трябва да бъде да или не.',
  'refuse.form.other': 'Нещо във формуляра не е наред: {field}.',
};
