import type { EN_FORM } from '../en/form';

export const AM_FORM: Record<keyof typeof EN_FORM, string> = {
  'refuse.form.email': 'ትክክለኛ የኢሜይል አድራሻ ያስገቡ ({field})።',
  'refuse.form.missing': 'የተጠየቀ ነገር ጎድሏል፦ {field}።',
  'refuse.form.tooLong': '{field} በጣም ረጅም ነው።',
  'refuse.form.tooShort': '{field} በጣም አጭር ነው።',
  'refuse.form.tooMany': '{field} በጣም ብዙ ንጥሎች አሉት።',
  'refuse.form.tooFew': '{field} በጣም ጥቂት ንጥሎች አሉት።',
  'refuse.form.number': '{field} ቁጥር መሆን አለበት።',
  'refuse.form.tooSmall': '{field} በጣም ትንሽ ነው።',
  'refuse.form.tooLarge': '{field} በጣም ትልቅ ነው።',
  'refuse.form.choice': '{field} ከምርጫዎቹ አንዱ አይደለም።',
  'refuse.form.date': '{field} ቀን መሆን አለበት።',
  'refuse.form.format': '{field} እንደተጠየቀው አልተጻፈም።',
  'refuse.form.yesNo': '{field} አዎ ወይም አይደለም መሆን አለበት።',
  'refuse.form.other': 'በቅጹ ውስጥ የሆነ ነገር ትክክል አይደለም፦ {field}።',
};
