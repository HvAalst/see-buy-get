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
 *
 * 2026-11-09 — GLOBAL LOCATION NUMBERS (GLN). The sender's and the receiver's, where they gave one, beside their names;
 * and the SHIP-TO (application identifier 410: the place it is delivered to, or the receiver where it named no place) as
 * a GS1-128 barcode of its own above the SSCC — what a receiving dock scans to know the goods are for it. With one, our
 * part of the label is drawn smaller and the SSCC's bars shorter, so both fit.
 */
export interface PackageLabelInput {
  loadCode: string;
  description: string;
  trackingKey?: string;
  trackingUrl?: string;
  from: { name: string; place: string; country?: string; gln?: string };
  to: { name: string; place: string; country?: string; gln?: string };
  /** 2026-11-09 — where it is delivered, by GLN (AI 410): a barcode of its own above the SSCC. */
  shipToGln?: string;
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
  if (input.from.gln) parts.push(t(W - 4, 18, 2.6, `GLN ${e(input.from.gln)}`, 'fill="#555" font-family="monospace" text-anchor="end"'));
  parts.push(t(4, 22, 3.4, cut(input.from.name, 44), 'font-weight="600"'));
  parts.push(t(4, 26, 3, cut(placeLine(input.from), 52)));
  parts.push(`<line x1="4" y1="29" x2="${W - 4}" y2="29" stroke="#bbb" stroke-width="0.3"/>`);
  parts.push(t(4, 34, 2.6, 'TO', 'fill="#555" letter-spacing="0.3"'));
  if (input.to.gln) parts.push(t(W - 4, 34, 2.6, `GLN ${e(input.to.gln)}`, 'fill="#555" font-family="monospace" text-anchor="end"'));
  parts.push(t(4, 40, 5, cut(input.to.name, 30), 'font-weight="700"'));
  // A load with no named receiver is addressed to the place itself: the place is then said once, with its country.
  parts.push(t(4, 46, 3.6, cut(input.to.name === input.to.place ? (input.to.country ?? '') : placeLine(input.to), 44)));
  parts.push(`<line x1="0" y1="50" x2="${W}" y2="50" stroke="#111" stroke-width="0.5"/>`);
  const sscc = input.codes[no - 1];
  const L = layoutOf(input, sscc);
  // Ours: the QR to the load's tracking page, the load's code, and what is in it.
  if (input.trackingUrl) parts.push(qrSvgGroup(input.trackingUrl, 4, 53, L.qr));
  const x = input.trackingUrl ? L.qr + 8 : 4;
  parts.push(t(x, L.y[0], 2.6, 'LOAD', 'fill="#555" letter-spacing="0.3"'));
  parts.push(t(x, L.y[1], L.code, e(input.loadCode), 'font-family="monospace" font-weight="700"'));
  if (input.trackingKey) parts.push(t(x, L.y[2], 3.2, `Track: ${e(input.trackingKey)}`, 'font-family="monospace"'));
  parts.push(t(x, L.y[3], 3, cut(input.description, 34)));
  parts.push(t(x, L.y[4], 3, `Load gross ${input.grossKg.toLocaleString('en')} kg`));
  const marks = input.marks.join(' · ');
  if (marks) parts.push(t(4, L.marks, 3.4, cut(marks, 50), 'font-weight="700"'));
  if (no === 1 && input.papers) parts.push(t(4, L.papers, 3, cut(input.papers, 58), 'font-weight="600"'));
  // GS1's: where it is delivered (AI 410), where the receiver gave its GLN.
  if (L.shipTo && input.shipToGln) {
    const digits = `410${input.shipToGln}`;
    parts.push(`<line x1="0" y1="${L.shipTo.line}" x2="${W}" y2="${L.shipTo.line}" stroke="#111" stroke-width="0.5"/>`);
    parts.push(t(4, L.shipTo.line + 4, 2.8, 'SHIP TO (GLN)', 'fill="#555" letter-spacing="0.3"'));
    parts.push(gs1_128SvgGroup(digits, (W - gs1_128Width(digits, MODULE)) / 2, L.shipTo.bars, MODULE, L.shipTo.height));
    parts.push(t(W / 2, L.shipTo.bars + L.shipTo.height + 3.6, 3.2, e(glnHumanReadable(input.shipToGln)), 'font-family="monospace" text-anchor="middle"'));
  }
  // GS1's: the package's SSCC, as a person reads it and as a scanner does.
  if (sscc) {
    const digits = `00${sscc}`;
    const width = gs1_128Width(digits, MODULE);
    const left = (W - width) / 2;
    parts.push(`<line x1="0" y1="${L.sscc.line}" x2="${W}" y2="${L.sscc.line}" stroke="#111" stroke-width="0.5"/>`);
    parts.push(t(4, L.sscc.title, 2.8, 'SSCC', 'fill="#555" letter-spacing="0.3"'));
    parts.push(t(L.sscc.textRight ? W - 4 : 4, L.sscc.text, L.sscc.textSize, e(ssccSpaced(sscc, input.companyPrefixLength ?? 7)), `font-family="monospace" font-weight="700"${L.sscc.textRight ? ' text-anchor="end"' : ''}`));
    parts.push(gs1_128SvgGroup(digits, left, L.sscc.bars, MODULE, L.sscc.height));
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
  if (input.from.gln) f.push(zplText(W - 4, 18, 2.6, `GLN ${input.from.gln}`, { right: true }));
  f.push(zplText(4, 22, 3.4, cut(input.from.name, 44)));
  f.push(zplText(4, 26, 3, cut(placeLine(input.from), 52)));
  f.push(zplBox(4, 28.85, W - 8, 0.3));
  f.push(zplText(4, 34, 2.6, 'TO'));
  if (input.to.gln) f.push(zplText(W - 4, 34, 2.6, `GLN ${input.to.gln}`, { right: true }));
  f.push(zplText(4, 40, 5, cut(input.to.name, 30), { wide: true }));
  f.push(zplText(4, 46, 3.6, cut(input.to.name === input.to.place ? (input.to.country ?? '') : placeLine(input.to), 44)));
  f.push(zplBox(0, 49.75, W, 0.5));
  const sscc = input.codes[no - 1];
  const L = layoutOf(input, sscc);
  if (input.trackingUrl) f.push(zplQr(4, 53, L.qr === 30 ? 6 : 5, input.trackingUrl));
  const x = input.trackingUrl ? L.qr + 8 : 4;
  f.push(zplText(x, L.y[0], 2.6, 'LOAD'));
  f.push(zplText(x, L.y[1], L.code, input.loadCode, { wide: true }));
  if (input.trackingKey) f.push(zplText(x, L.y[2], 3.2, `Track: ${input.trackingKey}`));
  f.push(zplText(x, L.y[3], 3, cut(input.description, 34)));
  f.push(zplText(x, L.y[4], 3, `Load gross ${input.grossKg.toLocaleString('en')} kg`));
  const marks = input.marks.join(' · ');
  if (marks) f.push(zplText(4, L.marks, 3.4, cut(marks, 50)));
  if (no === 1 && input.papers) f.push(zplText(4, L.papers, 3, cut(input.papers, 58)));
  if (L.shipTo && input.shipToGln) {
    f.push(zplBox(0, L.shipTo.line - 0.25, W, 0.5));
    f.push(zplText(4, L.shipTo.line + 4, 2.8, 'SHIP TO (GLN)'));
    f.push(zplGs1_128(L.shipTo.bars, MODULE, L.shipTo.height, `410${input.shipToGln}`));
    const readable = glnHumanReadable(input.shipToGln);
    f.push(zplText((W - readable.length * 3.2 * 0.6) / 2, L.shipTo.bars + L.shipTo.height + 3.6, 3.2, readable));
  }
  if (sscc) {
    f.push(zplBox(0, L.sscc.line - 0.25, W, 0.5));
    f.push(zplText(4, L.sscc.title, 2.8, 'SSCC'));
    f.push(zplText(L.sscc.textRight ? W - 4 : 4, L.sscc.text, L.sscc.textSize, ssccSpaced(sscc, input.companyPrefixLength ?? 7), L.sscc.textRight ? { right: true } : {}));
    f.push(zplGs1_128(L.sscc.bars, MODULE, L.sscc.height, `00${sscc}`));
    const readable = ssccHumanReadable(sscc);
    // Centred as the printed label centres it: the printer's font is about 0.6 of its height a character wide.
    f.push(zplText((W - readable.length * 3.6 * 0.6) / 2, 146, 3.6, readable));
  }
  return zplLabel(f);
}

/** The ship-to line under its barcode, the way GS1 writes it. */
export function glnHumanReadable(gln: string): string {
  return `(410) ${gln}`;
}

/**
 * Where everything sits on a label, in millimetres from the top. Without a ship-to GLN, the label as it always was. With
 * one: our part smaller (a 26 mm QR, the lines closer), the ship-to barcode under it, and the SSCC's bars 22 mm, not 28.
 * With a ship-to and no SSCC, the ship-to's bars are the tall ones.
 */
function layoutOf(input: PackageLabelInput, sscc: string | undefined) {
  if (!input.shipToGln) {
    return { qr: 30, code: 6, y: [58, 65, 71, 76.5, 81.5], marks: 89, papers: 94.5, shipTo: undefined, sscc: { line: 98, title: 104, text: 110.5, textSize: 5, textRight: false, bars: 113, height: 28 } };
  }
  return {
    qr: 26,
    code: 5.5,
    y: [56, 62.5, 67.5, 72.5, 77],
    marks: 82.5,
    papers: 87,
    shipTo: { line: 89.5, bars: 95, height: sscc ? 12 : 36 },
    sscc: { line: 112, title: 116.5, text: 117, textSize: 4.4, textRight: true, bars: 119.5, height: 22 },
  };
}

function placeLine(p: { place: string; country?: string }): string {
  return p.country ? `${p.place}, ${p.country}` : p.place;
}
