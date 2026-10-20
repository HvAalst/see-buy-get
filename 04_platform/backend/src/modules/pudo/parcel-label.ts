import { ssccHumanReadable, ssccSpaced } from '../../foundation/gs1/gs1';
import { zplBox, zplGs1_128, zplLabel, zplQr, zplText } from '../../foundation/label/zpl';
import type { Parcel } from './pudo.types';

/**
 * Round 27 — A PARCEL'S LABEL FOR A THERMAL PRINTER (ZPL, 100 × 150 mm at 203 dpi): what the counter's label says —
 * the parcel's QR, where it goes, the day it was taken in, the papers in the pouch across a border, the public tracking
 * key — laid out for the label printers couriers use. Never the release code: a parcel does not carry its own key.
 *
 * Round 29 — a store's parcel with its SSCC (the store's GS1 prefix) carries GS1's part at the foot, as a business's
 * package label does: the code as a person reads it, and as the printer's own GS1-128.
 */
export function parcelLabelZpl(parcel: Pick<Parcel, 'parcelId' | 'destZone' | 'customs' | 'trackingKey' | 'direction' | 'sscc'>, created: string, destShop?: string, prefixLength = 7): string {
  const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
  const qrPayload = `sbg:parcel:${parcel.parcelId}`;
  const f: string[] = [];
  f.push(zplBox(0, 0, 100, 12));
  f.push(zplText(4, 8.2, 5, 'SeeBuyGet', { reverse: true }));
  f.push(zplText(96, 8.4, 5.2, parcel.direction === 'inbound' ? 'Pre-paid' : 'Parcel', { reverse: true, right: true }));
  // The parcel's own QR, as big as the label lets a scanner find it from arm's length.
  f.push(zplQr(4, 16, 10, qrPayload));
  f.push(zplText(46, 22, 2.6, 'TO'));
  f.push(zplText(46, 29, 5, cut(destShop ?? parcel.destZone, 16), { wide: true }));
  f.push(zplText(46, 35, 3.6, cut(parcel.destZone, 24)));
  f.push(zplText(46, 42, 3, `Created ${created}`));
  // A parcel crossing a border carries its papers: said where the counter and the border post look first (round 13).
  if (parcel.customs) f.push(zplText(46, 49, 3, 'Customs papers in the pouch'));
  f.push(zplBox(0, 59.75, 100, 0.5));
  f.push(zplText(4, 67, 2.6, 'PARCEL'));
  f.push(zplText(4, 76, 6, cut(parcel.parcelId, 24), { wide: true }));
  f.push(zplBox(0, 83.75, 100, 0.5));
  f.push(zplText(4, 92, 3.6, 'Track this parcel:'));
  f.push(zplText(4, 104, 8, parcel.trackingKey ?? '', { wide: true }));
  f.push(zplBox(0, 109.75, 100, 0.5));
  if (parcel.sscc) {
    // GS1's part, where a receiving warehouse looks for it: the QR already carries what the footer would say.
    f.push(zplText(4, 115, 2.8, 'SSCC'));
    f.push(zplText(4, 121, 4.4, ssccSpaced(parcel.sscc, prefixLength)));
    f.push(zplGs1_128(123, 0.5, 20, `00${parcel.sscc}`));
    const readable = ssccHumanReadable(parcel.sscc);
    f.push(zplText((100 - readable.length * 3.2 * 0.6) / 2, 147, 3.2, readable));
  } else {
    f.push(zplText(4, 117, 3, `${parcel.direction === 'inbound' ? 'Pre-paid · ' : ''}${qrPayload}`));
  }
  return zplLabel(f);
}
