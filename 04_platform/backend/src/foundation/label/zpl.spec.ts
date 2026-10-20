import { gs1_128Width } from '../gs1/gs1';
import { DOTS_PER_MM, zplBox, zplField, zplGs1_128, zplLabel, zplQr, zplText } from './zpl';
import { parcelLabelZpl } from '../../modules/pudo/parcel-label';

/**
 * ZPL (round 27): what a thermal label printer reads — in its dots, its own barcodes, and nothing in a field it could take
 * for a command.
 */
describe('a label for a thermal printer', () => {
  it('is one 100 × 150 mm label at 203 dpi, its fields in UTF-8, printed once', () => {
    expect(zplLabel(['^FO8,8^FDx^FS'])).toBe(['^XA', '^CI28', '^PW800', '^LL1200', '^LH0,0', '^FO8,8^FDx^FS', '^PQ1', '^XZ'].join('\n'));
    expect(DOTS_PER_MM).toBe(8);
  });

  it('never lets a field speak to the printer: a caret, a tilde, the escape and a backslash are written as bytes', () => {
    expect(zplField('Mama ^Sarah~ _shop_ \\ yard')).toBe('Mama _5ESarah_7E _5Fshop_5F _5C yard');
    // …and the few characters the printer's font has no shape for, in ones it has.
    expect(zplField('Nairobi → Nakuru – 2·3 ‘a’ “b” …')).toBe('Nairobi > Nakuru - 2-3 \'a\' "b" ...');
    expect(zplText(4, 22, 3.4, 'Kisumu ^Corner~')).toBe('^FO32,154^A0N,27,27^FH_^FDKisumu _5ECorner_7E^FS');
  });

  it('places text by its baseline, as the printed labels do; right-aligned within the label; white on a black bar', () => {
    expect(zplText(96, 8.4, 5.2, 'Package 1 of 3', { reverse: true, right: true })).toBe('^FO0,34^FB768,1,0,R,0^A0N,42,42^FR^FH_^FDPackage 1 of 3^FS');
    expect(zplText(4, 40, 5, 'Nakuru depot', { wide: true })).toBe('^FO32,288^A0N,40,46^FH_^FDNakuru depot^FS');
    expect(zplBox(0, 0, 100, 12)).toBe('^FO0,0^GB800,96,96^FS');
    expect(zplBox(4, 28.85, 92, 0.3)).toBe('^FO32,231^GB736,2,2^FS');
  });

  it('lets the printer draw the QR (error correction Q) and the GS1-128 barcode — subset C and FNC1 first — centred', () => {
    expect(zplQr(4, 16, 10, 'sbg:parcel:P-1')).toBe('^FO32,128^BQN,2,10^FH_^FDQA,sbg:parcel:P-1^FS');
    const sscc = '361234567000000017';
    const symbol = gs1_128Width(`00${sscc}`, 4) - 80;
    expect(zplGs1_128(113, 0.5, 28, `00${sscc}`)).toBe(`^BY4^FO${Math.round((800 - symbol) / 2)},904^BCN,224,N,N,N^FD>;>800${sscc}^FS`);
    expect(() => zplGs1_128(113, 0.5, 28, '123')).toThrow(/even run of digits/);
  });
});

describe('a parcel’s label for a thermal printer', () => {
  const parcel = { parcelId: 'QR-7', destZone: 'Westlands', trackingKey: 'T-AB12CD34', direction: 'outbound' as const };

  it('carries the parcel’s QR, where it goes, the day it was taken in and the public tracking key', () => {
    const zpl = parcelLabelZpl(parcel, '20 Oct 2026', 'Riverside Corner');
    expect(zpl).toContain('^BQN,2,10^FH_^FDQA,sbg:parcel:QR-7^FS');
    expect(zpl).toContain('^FDRiverside Corner^FS');
    expect(zpl).toContain('^FDWestlands^FS');
    expect(zpl).toContain('^FDCreated 20 Oct 2026^FS');
    expect(zpl).toContain('^FDT-AB12CD34^FS');
    expect(zpl).toContain('^FDParcel^FS');
    expect(zpl).not.toContain('Customs papers');
  });

  it('says the zone where no shop is named, the papers in the pouch across a border, and pre-paid for a store’s order', () => {
    expect(parcelLabelZpl(parcel, '20 Oct 2026')).toContain('^FO368,200^A0N,40,46^FH_^FDWestlands^FS');
    expect(parcelLabelZpl({ ...parcel, customs: { declaredValue: 1, currency: 'KES' } as never }, '20 Oct 2026')).toContain('^FDCustoms papers in the pouch^FS');
    const prepaid = parcelLabelZpl({ ...parcel, direction: 'inbound' }, '20 Oct 2026');
    expect(prepaid).toContain('^FDPre-paid^FS');
    expect(prepaid).toContain('^FDPre-paid - sbg:parcel:QR-7^FS');
  });
});
