import type { EN_FORM } from '../en/form';

export const SW_FORM: Record<keyof typeof EN_FORM, string> = {
  'refuse.form.email': 'Weka barua pepe halali ({field}).',
  'refuse.form.missing': 'Kuna kinachohitajika kisichopo: {field}.',
  'refuse.form.tooLong': '{field} ni ndefu mno.',
  'refuse.form.tooShort': '{field} ni fupi mno.',
  'refuse.form.tooMany': '{field} ina vitu vingi mno.',
  'refuse.form.tooFew': '{field} ina vitu vichache mno.',
  'refuse.form.number': '{field} lazima iwe nambari.',
  'refuse.form.tooSmall': '{field} ni ndogo mno.',
  'refuse.form.tooLarge': '{field} ni kubwa mno.',
  'refuse.form.choice': '{field} si miongoni mwa chaguo.',
  'refuse.form.date': '{field} lazima iwe tarehe.',
  'refuse.form.format': '{field} haijaandikwa kama inavyotakiwa.',
  'refuse.form.yesNo': '{field} lazima iwe ndiyo au hapana.',
  'refuse.form.other': 'Kuna kitu kisicho sahihi kwenye fomu: {field}.',
};
