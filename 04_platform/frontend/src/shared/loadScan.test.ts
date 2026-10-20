import { describe, expect, it } from 'vitest';
import { isLoadLabel, kindLabel, loadLookupOf, parcelSsccOf, parseScan, ssccOfScan } from './scan';

/** Built the way the backend prints them (foundation/gs1 ssccOf): 4 + 6161234 + serial 7 + check digit. */
const SSCC = '461612340000000074';

describe('a load’s codes, met in any scan box (round 19)', () => {
  it('reads an SSCC in every form a scanner hands over — and only with its check digit right', () => {
    for (const raw of [SSCC, `00${SSCC}`, `(00) ${SSCC}`, `]C100${SSCC}`, `]C1\u001d00${SSCC}`, ` ${SSCC}\n`]) expect(ssccOfScan(raw)).toBe(SSCC);
    expect(ssccOfScan(`${SSCC.slice(0, 17)}6`)).toBeNull();
    // `00` + the first 16 digits — what a scanner has typed two keys before the end — is no SSCC: it waits for the rest.
    expect(ssccOfScan(`00${SSCC.slice(0, 16)}`)).toBeNull();
    for (const raw of ['PUD-123456', 'sbg:parcel:PUD-1', 'TOTE-042', '', null]) expect(ssccOfScan(raw)).toBeNull();
  });

  it('knows our label’s QR, a tracking key and a typed load code — but looks them up only in a box that looks for loads', () => {
    expect(isLoadLabel('https://seebuyget.com/send/?track=T-0A1B2C3D4E')).toBe(true);
    expect(isLoadLabel('T-0a1b2c3d4e')).toBe(true);
    expect(isLoadLabel('frt-12')).toBe(true);
    expect(isLoadLabel('PUD-123456')).toBe(false);
    // An SSCC is a load's in any box; a tracking key is shaped like a parcel's too, so only a load box reads it.
    expect(loadLookupOf(`]C100${SSCC}`, false)).toBe(`]C100${SSCC}`);
    expect(loadLookupOf('T-0A1B2C3D4E', false)).toBeNull();
    expect(loadLookupOf('T-0A1B2C3D4E', true)).toBe('T-0A1B2C3D4E');
    expect(loadLookupOf('PUD-123456', true)).toBeNull();
  });

  it('a parcel box still reads our own codes as before; a load label has a name', () => {
    expect(parseScan('sbg:parcel:PUD-1')).toMatchObject({ kind: 'parcel', value: 'PUD-1' });
    expect(parseScan('sbg:load:FRT-12')).toMatchObject({ kind: 'load', value: 'FRT-12' });
    expect(kindLabel('load')).toBe('load label');
  });
});

describe('a store parcel’s SSCC, met in a parcel’s box (round 32)', () => {
  it('is asked about as a parcel first in a box that expects a parcel — in every form a scanner hands it over — and nowhere else', () => {
    for (const raw of [SSCC, `00${SSCC}`, `(00) ${SSCC}`, `]C100${SSCC}`]) expect(parcelSsccOf(raw, 'parcel')).toBe(SSCC);
    for (const box of ['tote', 'vehicle', 'badge', 'collect', 'track', 'load'] as const) expect(parcelSsccOf(SSCC, box)).toBeNull();
    // Our own parcel code, a bag, a wrong check digit: not a GS1 barcode at all.
    for (const raw of ['PUD-123456', 'sbg:parcel:PUD-1', 'TOTE-042', `${SSCC.slice(0, 17)}5`]) expect(parcelSsccOf(raw, 'parcel')).toBeNull();
  });
});
