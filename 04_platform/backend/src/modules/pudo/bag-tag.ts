import { gs1_128SvgGroup, gs1_128Width, graiHumanReadable } from '../../foundation/gs1/gs1';
import { qrSvgGroup } from '../../foundation/label/qr';
import { zplBox, zplGs1_128, zplLabel, zplQr, zplText } from '../../foundation/label/zpl';

/**
 * 2026-11-09 — A BAG'S TAG, laminated into its pocket for the rest of its life (the owner: "continue the GRAI as you
 * proposed"). Our QR and the bag's code, as every bag tag had — and, once SeeBuyGet's GS1 prefix is on the server, the
 * bag's GRAI (application identifier 8003) as GS1 writes it and as a GS1-128 barcode, so any GS1 scanner reads it as
 * SeeBuyGet's bag and which one. What is in the bag on a trip is never on the tag: the bag outlives every trip.
 */
export interface BagTagInput {
  code: string;
  grai?: string;
}

/** The tag is 100 mm wide; 80 mm tall with the GRAI, 52 without. */
const W = 100;
/** A GRAI's bar module: 0.33 mm, so its barcode (about 84 mm with its quiet zones) fits the tag's width. */
const MODULE = 0.33;

const esc = (s: string) => s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c] as string);

/** The QR's payload: what every bag scan box reads, the same the tag always carried. */
export const bagQrPayload = (code: string) => `sbg:tote:${code}`;

/** The GS1-128 element string of a GRAI: its digits (AI 8003, the filler, prefix, asset type, check), then its serial. */
function graiElement(grai: string): { digits: string; tail: string } {
  return { digits: `8003${grai.slice(0, 14)}`, tail: grai.slice(14) };
}

export function bagTagSvg(input: BagTagInput): string {
  const h = input.grai ? 80 : 52;
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${h}mm" viewBox="0 0 ${W} ${h}">`,
    `<rect width="${W}" height="${h}" fill="#fff" stroke="#111" stroke-width="0.4"/>`,
    `<rect width="${W}" height="11" fill="#0B1F5C"/>`,
    `<text x="4" y="7.8" font-family="Arial" font-size="5" font-weight="700" fill="#fff">SeeBuyGet bag</text>`,
    qrSvgGroup(bagQrPayload(input.code), 3, 13, 36),
    `<text x="42" y="27" font-family="monospace" font-size="9" font-weight="700" fill="#111">${esc(input.code)}</text>`,
    `<text x="42" y="34" font-family="Arial" font-size="3" fill="#555">Scan the code, or type it</text>`,
    `<text x="42" y="39" font-family="Arial" font-size="3" fill="#555">Return it to any SeeBuyGet hub</text>`,
  ];
  if (input.grai) {
    const { digits, tail } = graiElement(input.grai);
    const left = (W - gs1_128Width(digits, MODULE, tail)) / 2;
    parts.push(
      `<line x1="0" y1="51" x2="${W}" y2="51" stroke="#111" stroke-width="0.4"/>`,
      `<text x="4" y="56" font-family="Arial" font-size="2.8" fill="#555" letter-spacing="0.3">RETURNABLE ASSET (GRAI)</text>`,
      gs1_128SvgGroup(digits, left, 58, MODULE, 13, tail),
      `<text x="${W / 2}" y="76.5" font-family="monospace" font-size="3.4" text-anchor="middle">${esc(graiHumanReadable(input.grai))}</text>`,
    );
  }
  parts.push('</svg>');
  return parts.join('');
}

/** The same tag for a thermal label printer (100 × 150 mm, as every label we print). */
export function bagTagZpl(input: BagTagInput): string {
  const f: string[] = [];
  f.push(zplBox(0, 0, W, 11));
  f.push(zplText(4, 7.8, 5, 'SeeBuyGet bag', { reverse: true }));
  f.push(zplQr(4, 14, 6, bagQrPayload(input.code)));
  f.push(zplText(46, 27, 9, input.code, { wide: true }));
  f.push(zplText(46, 34, 3, 'Scan the code, or type it'));
  f.push(zplText(46, 39, 3, 'Return it to any SeeBuyGet hub'));
  if (input.grai) {
    const { digits, tail } = graiElement(input.grai);
    f.push(zplBox(0, 50.75, W, 0.5));
    f.push(zplText(4, 56, 2.8, 'RETURNABLE ASSET (GRAI)'));
    f.push(zplGs1_128(58, MODULE, 13, digits, tail));
    const readable = graiHumanReadable(input.grai);
    f.push(zplText((W - readable.length * 3.4 * 0.6) / 2, 76.5, 3.4, readable));
  }
  return zplLabel(f);
}
