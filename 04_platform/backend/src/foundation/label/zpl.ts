import { gs1_128Width } from '../gs1/gs1';

/**
 * ZPL — WHAT A THERMAL LABEL PRINTER READS (round 27, the user: "Thermal labels (ZPL)"; "Every label we print").
 *
 * The counters' and docks' label printers — the 100 × 150 mm thermal kind most couriers use — print ZPL straight, with no
 * page to open and no A4 sheet to cut. Written here in millimetres and turned into the printer's dots: 203 dpi, so 8 dots
 * a millimetre. The printer draws the QR and the GS1-128 barcode itself (^BQ, ^BC): nothing is rasterised here.
 *
 * Every field is UTF-8 (^CI28) and escaped (^FH): a caret or a tilde in a shop's name must not be read as a command.
 * The few characters the printer's built-in font has no shape for are said in ones it has.
 */

export const DOTS_PER_MM = 8;
export const LABEL_W_MM = 100;
export const LABEL_H_MM = 150;

const dots = (mm: number): number => Math.round(mm * DOTS_PER_MM);

/** A field's text, as the printer reads it: escaped, in characters its font draws. */
export function zplField(s: string): string {
  const plain = s.replace(/[→]/g, '>').replace(/[–—]/g, '-').replace(/[·•]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, '...');
  // ^FH_ — an underscore and two hex digits stand for one byte; what the printer would read as a command is written so.
  return plain.replace(/[_^~\\]/g, (c) => `_${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`);
}

export interface ZplTextOptions {
  /** The text stands right of `x` (x is then its right edge). */
  right?: boolean;
  /** White on black: printed over a filled box. */
  reverse?: boolean;
  /** Wider letters, for what is read from across a room. */
  wide?: boolean;
}

/** A line of text whose BASELINE is at `baselineMm`, as the SVG labels place theirs — `sizeMm` tall. */
export function zplText(xMm: number, baselineMm: number, sizeMm: number, text: string, o: ZplTextOptions = {}): string {
  const h = dots(sizeMm);
  const top = dots(baselineMm - sizeMm * 0.8);
  const font = `^A0N,${h},${o.wide ? Math.round(h * 1.15) : h}`;
  const block = o.right ? `^FO0,${top}^FB${dots(xMm)},1,0,R,0` : `^FO${dots(xMm)},${top}`;
  return `${block}${font}${o.reverse ? '^FR' : ''}^FH_^FD${zplField(text)}^FS`;
}

/** A filled box (or a rule, when thin). */
export function zplBox(xMm: number, yMm: number, wMm: number, hMm: number): string {
  const w = Math.max(1, dots(wMm));
  const h = Math.max(1, dots(hMm));
  return `^FO${dots(xMm)},${dots(yMm)}^GB${w},${h},${Math.min(w, h)}^FS`;
}

/** A QR code whose top-left is at (x, y): `magnification` dots a module, error correction Q, as our printed QRs. */
export function zplQr(xMm: number, yMm: number, magnification: number, data: string): string {
  return `^FO${dots(xMm)},${dots(yMm)}^BQN,2,${magnification}^FH_^FDQA,${zplField(data)}^FS`;
}

/**
 * A GS1-128 barcode of `elementDigits` (an AI and its data, e.g. `00` + an SSCC), centred across the label's width,
 * `moduleMm` a bar module and `heightMm` tall, its top at `yMm`. Subset C from the start (>;) and FNC1 first (>8) — what
 * makes it GS1-128 rather than plain Code 128, the same symbol the printed labels draw (gs1.ts).
 */
export function zplGs1_128(yMm: number, moduleMm: number, heightMm: number, elementDigits: string): string {
  if (!/^\d+$/.test(elementDigits) || elementDigits.length % 2) throw new Error('GS1-128 here takes an even run of digits');
  const module = Math.max(1, dots(moduleMm));
  // gs1_128Width counts ten modules of quiet space each side; the field starts at the first bar.
  const symbol = gs1_128Width(elementDigits, module) - 20 * module;
  const left = Math.max(0, Math.round((dots(LABEL_W_MM) - symbol) / 2));
  return `^BY${module}^FO${left},${dots(yMm)}^BCN,${dots(heightMm)},N,N,N^FD>;>8${elementDigits}^FS`;
}

/** One label: 100 × 150 mm at 203 dpi, its fields in UTF-8, printed once. */
export function zplLabel(fields: string[]): string {
  return ['^XA', '^CI28', `^PW${dots(LABEL_W_MM)}`, `^LL${dots(LABEL_H_MM)}`, '^LH0,0', ...fields, '^PQ1', '^XZ'].join('\n');
}

/**
 * A label sent as what a printer reads: typed as text only once there is a label to send. Set on the route instead, the
 * type went out on a refusal too, and the JSON problem every other refusal is read as arrived as text.
 */
export function zplOut(res: { setHeader(name: string, value: string): unknown }, zpl: string): string {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  return zpl;
}
