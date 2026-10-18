/**
 * GS1 — THE GLOBAL CODE ON A PACKAGE, BESIDE OUR OWN.
 *
 * Our labels carry our own code: a QR a SeeBuyGet counter scans. A receiving warehouse, a retailer's dock or another
 * carrier scans something else — the GS1-128 barcode carrying a Serial Shipping Container Code (SSCC), the one
 * identifier for a logistic unit that every warehouse system in the world reads. So a package can carry both: ours,
 * and the global one, on the same label ("dual").
 *
 * WHOSE NUMBER IT IS. An SSCC is built from a GS1 company prefix, and GS1 licenses that prefix to a company. The
 * shipper builds the package, so the code is the shipper's, under its own prefix — never one we make up. A prefix we
 * invented would print barcodes that belong to some real company somewhere, and a warehouse would book the goods
 * against it.
 *
 * THE PARTS (GS1 General Specifications, the SSCC): one extension digit, the company prefix, a serial reference, and a
 * check digit — 18 digits. The extension digit is the company's to use: we print under the one the shipper sets aside
 * for us, so a code is never also given by the shipper's own systems.
 *
 * Pure: no clock, no store. The serial counter lives with the shipper (shipper-codes.service.ts).
 */

/** A GS1 company prefix is 6 to 12 digits; the serial reference is what is left of the 16 after it. */
export const GS1_PREFIX_MIN = 6;
export const GS1_PREFIX_MAX = 12;

/** The digits of a prefix as typed — spaces and dashes dropped — or nothing when it is not one. */
export function cleanPrefix(raw: string | undefined | null): string | undefined {
  const digits = String(raw ?? '').replace(/[\s-]/g, '');
  return /^\d+$/.test(digits) && digits.length >= GS1_PREFIX_MIN && digits.length <= GS1_PREFIX_MAX ? digits : undefined;
}

/** How many serial numbers one prefix and extension digit hold: 10^(16 − prefix length). */
export function serialCapacity(prefix: string): number {
  return 10 ** (16 - prefix.length);
}

/**
 * The GS1 check digit (mod 10): from the right, the digits are weighted 3, 1, 3, 1… The same rule for a GTIN, a GLN and
 * an SSCC, so this is checked against published GTINs as well as SSCCs.
 */
export function gs1CheckDigit(digits: string): number {
  if (!/^\d+$/.test(digits)) throw new Error('GS1 check digit needs digits');
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    const d = digits.charCodeAt(digits.length - 1 - i) - 48;
    sum += d * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10;
}

/** The SSCC for one serial under a prefix and extension digit: 18 digits, the last one the check digit. */
export function ssccOf(prefix: string, extension: number, serial: number): string {
  if (!cleanPrefix(prefix) || cleanPrefix(prefix) !== prefix) throw new Error('not a GS1 company prefix');
  if (!Number.isInteger(extension) || extension < 0 || extension > 9) throw new Error('an extension digit is 0 to 9');
  const room = 16 - prefix.length;
  if (!Number.isInteger(serial) || serial < 0 || serial >= 10 ** room) throw new Error('serial out of range');
  const body = `${extension}${prefix}${String(serial).padStart(room, '0')}`;
  return `${body}${gs1CheckDigit(body)}`;
}

/** Is this an SSCC: 18 digits whose last is the check digit of the rest. */
export function isSscc(s: string | undefined | null): boolean {
  return typeof s === 'string' && /^\d{18}$/.test(s) && gs1CheckDigit(s.slice(0, 17)) === Number(s[17]);
}

/** The line printed under the barcode, the way GS1 writes it: the application identifier in brackets, then the data. */
export function ssccHumanReadable(sscc: string): string {
  return `(00) ${sscc}`;
}

/** The same 18 digits spaced for a person to read aloud: extension, prefix, serial, check. */
export function ssccSpaced(sscc: string, prefixLength: number): string {
  return `${sscc[0]} ${sscc.slice(1, 1 + prefixLength)} ${sscc.slice(1 + prefixLength, 17)} ${sscc[17]}`;
}

/**
 * What a scanner hands over, read as an SSCC when it is one: the bare 18 digits, the element string `00` + 18, the
 * bracketed `(00)` form, or a scanner's symbology prefix `]C1` in front of any of them.
 */
export function ssccFromScan(raw: string | undefined | null): string | undefined {
  const s = String(raw ?? '').replace(/^\]C1/, '').replace(/[\s\u001d]/g, '').replace(/^\(00\)/, '');
  const digits = /^00\d{18}$/.test(s) ? s.slice(2) : s;
  return isSscc(digits) ? digits : undefined;
}

/* ------------------------------------------------------------------ GS1-128 (Code 128) -- */

/**
 * Code 128's 107 symbols as bar–space widths in modules (ISO/IEC 15417). Each symbol is 11 modules; the stop is 13.
 * Indexed by symbol value: 0–102 data, 103–105 the three starts, 106 the stop.
 */
const CODE128 = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
] as const;

const START_C = 105;
const FNC1 = 102;
const STOP = 106;

/** For the tests: the symbol table, so its shape (11 modules each, all distinct) can be asserted. */
export const CODE128_PATTERNS: readonly string[] = CODE128;

/**
 * The symbol values of a GS1-128 barcode for an all-digit element string (an even count of digits, as `00` + an SSCC
 * is): Start C, FNC1 (which is what makes Code 128 a GS1-128), the digits two at a time, the check symbol, the stop.
 */
export function gs1_128Values(elementDigits: string): number[] {
  if (!/^\d+$/.test(elementDigits) || elementDigits.length % 2 !== 0) throw new Error('GS1-128 here takes an even count of digits');
  const data = [FNC1];
  for (let i = 0; i < elementDigits.length; i += 2) data.push(Number(elementDigits.slice(i, i + 2)));
  const check = data.reduce((sum, v, i) => sum + v * (i + 1), START_C) % 103;
  return [START_C, ...data, check, STOP];
}

/** The bar and space widths, in modules, starting with a bar: what is drawn. */
export function gs1_128Widths(elementDigits: string): number[] {
  return gs1_128Values(elementDigits).flatMap((v) => [...CODE128[v]].map(Number));
}

/**
 * The barcode as SVG rectangles inside a `<g>`, the quiet zone included (ten modules each side, as GS1-128 requires).
 * `moduleWidth` and `height` are in the caller's units. At 0.5 mm a module — inside GS1's 0.495–1.016 mm range for a
 * logistics label — an SSCC is 88 mm wide with its quiet zones, which fits a 100 mm label.
 */
export function gs1_128SvgGroup(elementDigits: string, x: number, y: number, moduleWidth: number, height: number): string {
  const widths = gs1_128Widths(elementDigits);
  let at = x + 10 * moduleWidth;
  const bars: string[] = [];
  widths.forEach((w, i) => {
    const width = w * moduleWidth;
    if (i % 2 === 0) bars.push(`<rect x="${round(at)}" y="${round(y)}" width="${round(width)}" height="${round(height)}"/>`);
    at += width;
  });
  return `<g fill="#000">${bars.join('')}</g>`;
}

/** The full width the barcode needs, quiet zones included, in the same units as `moduleWidth`. */
export function gs1_128Width(elementDigits: string, moduleWidth: number): number {
  return (gs1_128Widths(elementDigits).reduce((a, b) => a + b, 0) + 20) * moduleWidth;
}

const round = (n: number) => Math.round(n * 1000) / 1000;
