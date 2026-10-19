/*
 * A STORE PARCEL'S PAPERS ABROAD, IN THE STORE APP (backend parcel-invoice.types.ts; the user, round 13: per item "As
 * shippers do"; the buyer "shop or address as per the decision of both sender and receiver. Address entered is address
 * carried"; "The store, with the label"). The commercial invoice a shipment crossing a border goes with: filled in on the
 * price step, signed by its declaration, printed with the label.
 */

export interface PapersLine {
  description: string;
  quantity: string;
  netKg: string;
  unitValue: string;
  /** Where the goods were made: two letters, like KE. */
  originCountry: string;
  /** The store's own HS code, where it has one. Never suggested. */
  hsCode: string;
}

export interface PapersForm {
  number: string;
  currency: string;
  buyerName: string;
  /** The address the store and the buyer settled on, as entered. Empty: the shop they collect from. */
  buyerAddress: string;
  lines: PapersLine[];
  /** The declaration, agreed: this is the signature. */
  declared: boolean;
}

export const EMPTY_LINE: PapersLine = { description: '', quantity: '1', netKg: '', unitValue: '', originCountry: '', hsCode: '' };

export const EMPTY_PAPERS: PapersForm = { number: '', currency: '', buyerName: '', buyerAddress: '', lines: [{ ...EMPTY_LINE }], declared: false };

/** The longest address carried: longer is refused, never cut (an address entered is the address carried). */
export const MAX_ADDRESS = 300;

/** What is still missing or wrong, as keys a screen says in words: `number`, `line.0.netKg`, `declared`… Empty when ready. */
export function papersGaps(p: PapersForm): string[] {
  const gaps: string[] = [];
  if (!p.number.trim()) gaps.push('number');
  if (!/^[A-Za-z]{3}$/.test(p.currency.trim())) gaps.push('currency');
  if (!p.buyerName.trim()) gaps.push('buyerName');
  if (p.buyerAddress.length > MAX_ADDRESS) gaps.push('buyerAddress');
  if (!p.lines.length) gaps.push('lines');
  p.lines.forEach((l, i) => {
    if (!l.description.trim()) gaps.push(`line.${i}.description`);
    if (!(Number.isInteger(Number(l.quantity)) && Number(l.quantity) >= 1)) gaps.push(`line.${i}.quantity`);
    if (!(Number(l.netKg) > 0)) gaps.push(`line.${i}.netKg`);
    if (l.unitValue.trim() === '' || !(Number(l.unitValue) >= 0)) gaps.push(`line.${i}.unitValue`);
    if (!/^[A-Za-z]{2}$/.test(l.originCountry.trim())) gaps.push(`line.${i}.originCountry`);
    if (l.hsCode.trim() && !/^\d{6,10}$/.test(l.hsCode.replace(/[\s.]/g, ''))) gaps.push(`line.${i}.hsCode`);
  });
  if (!p.declared) gaps.push('declared');
  return gaps;
}

/** What the form sends: the invoice exactly as the store typed it — the address untouched, an HS code only where given. */
export function papersBody(p: PapersForm): Record<string, unknown> {
  return {
    number: p.number.trim(),
    currency: p.currency.trim().toUpperCase(),
    importer: { name: p.buyerName.trim(), ...(p.buyerAddress.trim() ? { address: p.buyerAddress } : {}) },
    lines: p.lines.map((l) => ({
      description: l.description.trim(),
      quantity: Number(l.quantity),
      netKg: Number(l.netKg),
      unitValue: Number(l.unitValue),
      originCountry: l.originCountry.trim().toUpperCase(),
      ...(l.hsCode.trim() ? { hsCode: l.hsCode.trim() } : {}),
    })),
    declare: p.declared,
  };
}

/** The goods' value and net weight, as the invoice will add them up. */
export function papersTotals(p: PapersForm): { value: number; netKg: number } {
  const sum = (f: (l: PapersLine) => number) => p.lines.reduce((s, l) => s + (Number.isFinite(f(l)) ? f(l) : 0), 0);
  return { value: Math.round(sum((l) => Number(l.quantity) * Number(l.unitValue)) * 100) / 100, netKg: Math.round(sum((l) => Number(l.netKg)) * 1000) / 1000 };
}
