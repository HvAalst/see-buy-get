/**
 * THE AIR WAYBILL NUMBER'S OWN CHECK, before anything is sent: eleven digits, the airline's three and eight more, the last
 * the remainder of the seven before it divided by 7. Said on the field as it is typed; the server checks it again.
 */
export function awbState(typed: string): 'empty' | 'short' | 'ok' | 'wrong' {
  const digits = typed.replace(/[\s-]/g, '');
  if (!digits) return 'empty';
  if (!/^\d{11}$/.test(digits)) return 'short';
  return Number(digits.slice(3, 10)) % 7 === Number(digits[10]) ? 'ok' : 'wrong';
}
