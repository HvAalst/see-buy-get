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

/**
 * 2026-11-09 — A GLOBAL LOCATION NUMBER (GLN): 13 digits naming a company or one of its places, the last the check digit.
 * Like a prefix, it is GS1's to give and the holder's to use — we check its shape, never whose it is. Refused: a number
 * from a range GS1 keeps for something else (restricted circulation 020–029, 040–049 and 200–299; coupons 050–059 and
 * 981–999; general manager numbers and demonstrations 951–952; GTIN-8 offices 960–969; ISSN 977; ISBN 978–979; refund
 * receipts 980).
 */
export type GlnProblem = 'digits' | 'check' | 'range';

const GLN_NOT_FROM = [[20, 29], [40, 59], [200, 299], [951, 952], [960, 969], [977, 999]] as const;

export function glnProblem(raw: string | undefined | null): GlnProblem | undefined {
  const digits = String(raw ?? '').replace(/[\s-]/g, '');
  if (!/^\d{13}$/.test(digits)) return 'digits';
  if (gs1CheckDigit(digits.slice(0, 12)) !== Number(digits[12])) return 'check';
  // The first three digits say the range: "020" is 20.
  const three = Number(digits.slice(0, 3));
  if (GLN_NOT_FROM.some(([lo, hi]) => three >= lo && three <= hi)) return 'range';
  return undefined;
}

/** The 13 digits of a GLN as typed — spaces and dashes dropped — or nothing when it is not one. */
export function cleanGln(raw: string | undefined | null): string | undefined {
  return glnProblem(raw) ? undefined : String(raw).replace(/[\s-]/g, '');
}

/**
 * 2026-11-09 — A GLN WE GIVE, under SeeBuyGet's own prefix: the prefix, the location reference padded to 12 digits, then the
 * check digit. Only ever under a prefix GS1 licensed to the one giving it (the owner: "we should get our own GS1 prefix").
 */
export function glnOf(prefix: string, reference: number): string {
  if (!cleanPrefix(prefix) || cleanPrefix(prefix) !== prefix) throw new Error('not a GS1 company prefix');
  const room = 12 - prefix.length;
  if (!Number.isInteger(reference) || reference < 0 || reference >= 10 ** room) throw new Error('location reference out of range');
  const body = `${prefix}${room ? String(reference).padStart(room, '0') : ''}`;
  return `${body}${gs1CheckDigit(body)}`;
}

/** How many GLNs one prefix holds: 10^(12 − prefix length). A 12-digit prefix holds one, its own. */
export function glnCapacity(prefix: string): number {
  return 10 ** Math.max(0, 12 - prefix.length);
}

/**
 * 2026-11-09 — A GLOBAL RETURNABLE ASSET IDENTIFIER (GRAI, application identifier 8003): one reusable thing that travels and
 * comes back — for us, a bag. A filler 0, the company prefix and the asset type (12 digits together), the check digit, then
 * the one asset's serial, up to 16 characters. The asset type says what kind of thing it is; the serial, which one. Its
 * owner's to give, under its own prefix: our bags under SeeBuyGet's.
 */
export function graiOf(prefix: string, assetType: number, serial: string): string {
  if (!cleanPrefix(prefix) || cleanPrefix(prefix) !== prefix) throw new Error('not a GS1 company prefix');
  const room = 12 - prefix.length;
  if (!Number.isInteger(assetType) || assetType < 0 || assetType >= 10 ** room) throw new Error('asset type out of range');
  if (!GRAI_SERIAL.test(serial)) throw new Error('a GRAI serial is 1 to 16 capital letters, digits and dashes');
  const body = `0${prefix}${room ? String(assetType).padStart(room, '0') : ''}`;
  return `${body}${gs1CheckDigit(body)}${serial}`;
}

/** What our GRAI serials may be: what a bag's own code is made of, all inside GS1's character set 82. */
const GRAI_SERIAL = /^[A-Z0-9-]{1,16}$/;

/** Is this a GRAI: a 0, 12 digits and their check digit, then a serial. */
export function isGrai(s: string | undefined | null): boolean {
  return typeof s === 'string' && /^0\d{13}/.test(s) && gs1CheckDigit(s.slice(0, 13)) === Number(s[13]) && GRAI_SERIAL.test(s.slice(14));
}

/** A GRAI in any form a scanner or a person hands over: `]C18003…`, `(8003)…`, `8003…`, or bare. */
export function graiFromScan(raw: string | undefined | null): string | undefined {
  const s = String(raw ?? '').replace(/^\]C1/, '').replace(/[\s\u001d]/g, '').replace(/^\(8003\)/, '');
  const grai = /^80030\d{13}/.test(s) ? s.slice(4) : s;
  return isGrai(grai) ? grai : undefined;
}

/** The GRAI as GS1 writes it for a person. */
export function graiHumanReadable(grai: string): string {
  return `(8003) ${grai}`;
}

/** Why a GLN was refused, in words a person can act on. */
export function glnRefusal(problem: GlnProblem): string {
  if (problem === 'digits') return 'A GLN is 13 digits';
  if (problem === 'check') return 'That GLN’s last digit does not match the rest: check it against your GS1 papers';
  return 'That number is from a range GS1 keeps for something other than locations: it is not a GLN';
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

/**
 * 2026-11-09 — A GLOBAL SHIPMENT IDENTIFICATION NUMBER (GSIN, application identifier 402): one number for a whole shipment —
 * every package a shipper hands over together under one despatch — 17 digits: the company prefix, the shipper's reference
 * and the check digit. The shipper's to give, under its own prefix, like an SSCC; customs accept it as the shipment's
 * Unique Consignment Reference (the World Customs Organization's UCR), so it must never name a second shipment.
 *
 * Here the reference begins with the extension digit the shipper set aside for us — so a GSIN we give is never also one
 * its own systems give — and carries on with our serial: prefix, digit, serial, check.
 */
export function gsinOf(prefix: string, extension: number, serial: number): string {
  if (!cleanPrefix(prefix) || cleanPrefix(prefix) !== prefix) throw new Error('not a GS1 company prefix');
  if (!Number.isInteger(extension) || extension < 0 || extension > 9) throw new Error('an extension digit is 0 to 9');
  const room = 15 - prefix.length;
  if (!Number.isInteger(serial) || serial < 0 || serial >= 10 ** room) throw new Error('serial out of range');
  const body = `${prefix}${extension}${String(serial).padStart(room, '0')}`;
  return `${body}${gs1CheckDigit(body)}`;
}

/** How many GSINs one prefix and extension digit hold: 10^(15 − prefix length). */
export function gsinCapacity(prefix: string): number {
  return 10 ** (15 - prefix.length);
}

/** Is this a GSIN: 17 digits whose last is the check digit of the rest. */
export function isGsin(s: string | undefined | null): boolean {
  return typeof s === 'string' && /^\d{17}$/.test(s) && gs1CheckDigit(s.slice(0, 16)) === Number(s[16]);
}

/** A GSIN in any form a scanner or a person hands over: `]C1402…`, `(402)…`, `402…`, or bare. */
export function gsinFromScan(raw: string | undefined | null): string | undefined {
  const s = String(raw ?? '').replace(/^\]C1/, '').replace(/[\s\u001d-]/g, '').replace(/^\(402\)/, '');
  const digits = /^402\d{17}$/.test(s) ? s.slice(3) : s;
  return isGsin(digits) ? digits : undefined;
}

/** The GSIN as GS1 writes it for a person: its application identifier in brackets, then the number. */
export function gsinHumanReadable(gsin: string): string {
  return `(402) ${gsin}`;
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
/** In subset C, the switch to subset B: what letters are written in. */
const CODE_B = 100;
const STOP = 106;

/** For the tests: the symbol table, so its shape (11 modules each, all distinct) can be asserted. */
export const CODE128_PATTERNS: readonly string[] = CODE128;

/**
 * The symbol values of a GS1-128 barcode for an all-digit element string (an even count of digits, as `00` + an SSCC
 * is): Start C, FNC1 (which is what makes Code 128 a GS1-128), the digits two at a time, the check symbol, the stop.
 */
export function gs1_128Values(elementDigits: string, tail = ''): number[] {
  if (!/^\d+$/.test(elementDigits) || elementDigits.length % 2 !== 0) throw new Error('GS1-128 here takes an even count of digits');
  // 2026-11-09 — a last element string's letters (a GRAI's serial) after the digits, in subset B: nothing follows it.
  if (tail && !/^[ -~]+$/.test(tail)) throw new Error('GS1-128 here takes printable characters after the digits');
  const data = [FNC1];
  for (let i = 0; i < elementDigits.length; i += 2) data.push(Number(elementDigits.slice(i, i + 2)));
  if (tail) data.push(CODE_B, ...[...tail].map((c) => c.charCodeAt(0) - 32));
  const check = data.reduce((sum, v, i) => sum + v * (i + 1), START_C) % 103;
  return [START_C, ...data, check, STOP];
}

/** The bar and space widths, in modules, starting with a bar: what is drawn. */
export function gs1_128Widths(elementDigits: string, tail = ''): number[] {
  return gs1_128Values(elementDigits, tail).flatMap((v) => [...CODE128[v]].map(Number));
}

/**
 * The barcode as SVG rectangles inside a `<g>`, the quiet zone included (ten modules each side, as GS1-128 requires).
 * `moduleWidth` and `height` are in the caller's units. At 0.5 mm a module — inside GS1's 0.495–1.016 mm range for a
 * logistics label — an SSCC is 88 mm wide with its quiet zones, which fits a 100 mm label.
 */
export function gs1_128SvgGroup(elementDigits: string, x: number, y: number, moduleWidth: number, height: number, tail = ''): string {
  const widths = gs1_128Widths(elementDigits, tail);
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
export function gs1_128Width(elementDigits: string, moduleWidth: number, tail = ''): number {
  return (gs1_128Widths(elementDigits, tail).reduce((a, b) => a + b, 0) + 20) * moduleWidth;
}

const round = (n: number) => Math.round(n * 1000) / 1000;
