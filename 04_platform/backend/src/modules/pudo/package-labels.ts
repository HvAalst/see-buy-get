import { gs1_128SvgGroup, gs1_128Width, ssccHumanReadable, ssccSpaced } from '../../foundation/gs1/gs1';
import { qrSvgGroup } from '../../foundation/label/qr';
import { zplBox, zplGs1_128, zplLabel, zplQr, zplText } from '../../foundation/label/zpl';
import { escapeHtml } from '../../foundation/mail/mail.blocks';

/**
 * A LOAD'S PACKAGE LABELS — ours and the global one on the same label.
 *
 * One label a package, 100 × 150 mm (the logistics label size every label printer takes, and a quarter of an A4 page
 * otherwise). The top is ours: who it is from and for, the load's code and our QR, which opens the load's tracking page.
 * The bottom is GS1's: the package's SSCC as a GS1-128 barcode, when the shipper holds a GS1 company prefix — what a
 * receiving warehouse scans into its own system. Without one, the label is ours alone.
 *
 * Drawn as one SVG a label, in millimetres, so it prints the same size on any printer. Pure: given what to print.
 */
export interface PackageLabelInput {
  loadCode: string;
  description: string;
  trackingKey?: string;
  trackingUrl?: string;
  from: { name: string; place: string; country?: string };
  to: { name: string; place: string; country?: string };
  /** The number of packages; absent, one label for the whole load. */
  packages?: number;
  /** One SSCC a package, in package order, when the shipper's GS1 prefix gave them. */
  codes: string[];
  companyPrefixLength?: number;
  grossKg: number;
  /** Handling words: "Fragile", "Keep 2 °C to 8 °C", "Dangerous goods". */
  marks: string[];
  /** Printed on package 1: the papers in the pouch on it. */
  papers?: string;
}

const W = 100;
const H = 150;
const MODULE = 0.5; // mm: inside GS1's 0.495–1.016 mm for a logistics label

export function packageLabelsHtml(input: PackageLabelInput): string {
  const count = Math.max(1, input.packages ?? 1);
  const labels = Array.from({ length: count }, (_, i) => labelSvg(input, i + 1, count)).join('\n');
  const e = escapeHtml;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Package labels — ${e(input.loadCode)}</title>
<style>
  @page { size: ${W}mm ${H}mm; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #e9ecef; }
  .label { display: block; width: ${W}mm; height: ${H}mm; margin: 6mm auto; background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,.2); }
  @media print { body { background: #fff; } .label { margin: 0; box-shadow: none; break-after: page; } .label:last-child { break-after: auto; } }
</style></head><body>
${labels}
</body></html>`;
}

function labelSvg(input: PackageLabelInput, no: number, count: number): string {
  const e = escapeHtml;
  const t = (x: number, y: number, size: number, body: string, extra = '') => `<text x="${x}" y="${y}" font-size="${size}" ${extra}>${body}</text>`;
  const cut = (s: string, n: number) => e(s.length > n ? `${s.slice(0, n - 1)}…` : s);
  const parts: string[] = [];
  // Header: whose label, and which package of how many.
  parts.push(`<rect x="0" y="0" width="${W}" height="12" fill="#0B1F5C"/>`);
  parts.push(t(4, 8.2, 5, 'SeeBuyGet', 'fill="#fff" font-weight="700"'));
  parts.push(t(W - 4, 8.4, 5.2, `Package ${no} of ${count}`, 'fill="#fff" font-weight="700" text-anchor="end"'));
  // From and to: the destination is what a sorter reads first, so it is the bigger.
  parts.push(t(4, 18, 2.6, 'FROM', 'fill="#555" letter-spacing="0.3"'));
  parts.push(t(4, 22, 3.4, cut(input.from.name, 44), 'font-weight="600"'));
  parts.push(t(4, 26, 3, cut(placeLine(input.from), 52)));
  parts.push(`<line x1="4" y1="29" x2="${W - 4}" y2="29" stroke="#bbb" stroke-width="0.3"/>`);
  parts.push(t(4, 34, 2.6, 'TO', 'fill="#555" letter-spacing="0.3"'));
  parts.push(t(4, 40, 5, cut(input.to.name, 30), 'font-weight="700"'));
  // A load with no named receiver is addressed to the place itself: the place is then said once, with its country.
  parts.push(t(4, 46, 3.6, cut(input.to.name === input.to.place ? (input.to.country ?? '') : placeLine(input.to), 44)));
  parts.push(`<line x1="0" y1="50" x2="${W}" y2="50" stroke="#111" stroke-width="0.5"/>`);
  // Ours: the QR to the load's tracking page, the load's code, and what is in it.
  if (input.trackingUrl) parts.push(qrSvgGroup(input.trackingUrl, 4, 53, 30));
  const x = input.trackingUrl ? 38 : 4;
  parts.push(t(x, 58, 2.6, 'LOAD', 'fill="#555" letter-spacing="0.3"'));
  parts.push(t(x, 65, 6, e(input.loadCode), 'font-family="monospace" font-weight="700"'));
  if (input.trackingKey) parts.push(t(x, 71, 3.2, `Track: ${e(input.trackingKey)}`, 'font-family="monospace"'));
  parts.push(t(x, 76.5, 3, cut(input.description, 34)));
  parts.push(t(x, 81.5, 3, `Load gross ${input.grossKg.toLocaleString('en')} kg`));
  const marks = input.marks.join(' · ');
  if (marks) parts.push(t(4, 89, 3.4, cut(marks, 50), 'font-weight="700"'));
  if (no === 1 && input.papers) parts.push(t(4, 94.5, 3, cut(input.papers, 58), 'font-weight="600"'));
  // GS1's: the package's SSCC, as a person reads it and as a scanner does.
  const sscc = input.codes[no - 1];
  if (sscc) {
    const digits = `00${sscc}`;
    const width = gs1_128Width(digits, MODULE);
    const left = (W - width) / 2;
    parts.push(`<line x1="0" y1="98" x2="${W}" y2="98" stroke="#111" stroke-width="0.5"/>`);
    parts.push(t(4, 104, 2.8, 'SSCC', 'fill="#555" letter-spacing="0.3"'));
    parts.push(t(4, 110.5, 5, e(ssccSpaced(sscc, input.companyPrefixLength ?? 7)), 'font-family="monospace" font-weight="700"'));
    parts.push(gs1_128SvgGroup(digits, left, 113, MODULE, 28));
    parts.push(t(W / 2, 146, 3.6, e(ssccHumanReadable(sscc)), 'font-family="monospace" text-anchor="middle"'));
  }
  return `<svg class="label" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}mm" height="${H}mm" font-family="Arial, Helvetica, sans-serif" fill="#111" role="img" aria-label="Package ${no} of ${count}, load ${e(input.loadCode)}${sscc ? `, SSCC ${sscc}` : ''}">${parts.join('')}</svg>`;
}

/**
 * Round 27 — THE SAME LABELS FOR A THERMAL PRINTER (ZPL): one label a package, every field where the printed page has it,
 * the QR and the GS1-128 barcode drawn by the printer itself. Sent to the printer as it is, one label after another.
 */
export function packageLabelsZpl(input: PackageLabelInput): string {
  const count = Math.max(1, input.packages ?? 1);
  return Array.from({ length: count }, (_, i) => labelZpl(input, i + 1, count)).join('\n');
}

function labelZpl(input: PackageLabelInput, no: number, count: number): string {
  const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
  const f: string[] = [];
  f.push(zplBox(0, 0, W, 12));
  f.push(zplText(4, 8.2, 5, 'SeeBuyGet', { reverse: true }));
  f.push(zplText(W - 4, 8.4, 5.2, `Package ${no} of ${count}`, { reverse: true, right: true }));
  f.push(zplText(4, 18, 2.6, 'FROM'));
  f.push(zplText(4, 22, 3.4, cut(input.from.name, 44)));
  f.push(zplText(4, 26, 3, cut(placeLine(input.from), 52)));
  f.push(zplBox(4, 28.85, W - 8, 0.3));
  f.push(zplText(4, 34, 2.6, 'TO'));
  f.push(zplText(4, 40, 5, cut(input.to.name, 30), { wide: true }));
  f.push(zplText(4, 46, 3.6, cut(input.to.name === input.to.place ? (input.to.country ?? '') : placeLine(input.to), 44)));
  f.push(zplBox(0, 49.75, W, 0.5));
  if (input.trackingUrl) f.push(zplQr(4, 53, 6, input.trackingUrl));
  const x = input.trackingUrl ? 38 : 4;
  f.push(zplText(x, 58, 2.6, 'LOAD'));
  f.push(zplText(x, 65, 6, input.loadCode, { wide: true }));
  if (input.trackingKey) f.push(zplText(x, 71, 3.2, `Track: ${input.trackingKey}`));
  f.push(zplText(x, 76.5, 3, cut(input.description, 34)));
  f.push(zplText(x, 81.5, 3, `Load gross ${input.grossKg.toLocaleString('en')} kg`));
  const marks = input.marks.join(' · ');
  if (marks) f.push(zplText(4, 89, 3.4, cut(marks, 50)));
  if (no === 1 && input.papers) f.push(zplText(4, 94.5, 3, cut(input.papers, 58)));
  const sscc = input.codes[no - 1];
  if (sscc) {
    f.push(zplBox(0, 97.75, W, 0.5));
    f.push(zplText(4, 104, 2.8, 'SSCC'));
    f.push(zplText(4, 110.5, 5, ssccSpaced(sscc, input.companyPrefixLength ?? 7)));
    f.push(zplGs1_128(113, MODULE, 28, `00${sscc}`));
    const readable = ssccHumanReadable(sscc);
    // Centred as the printed label centres it: the printer's font is about 0.6 of its height a character wide.
    f.push(zplText((W - readable.length * 3.6 * 0.6) / 2, 146, 3.6, readable));
  }
  return zplLabel(f);
}

function placeLine(p: { place: string; country?: string }): string {
  return p.country ? `${p.place}, ${p.country}` : p.place;
}
