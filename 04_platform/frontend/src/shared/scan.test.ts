import { describe, expect, it } from 'vitest';
import { checkScan, kindLabel, parseScan } from './scan';

describe('parseScan', () => {
  it('splits a namespaced code into kind + value', () => {
    expect(parseScan('sbg:parcel:PUD-049410ED6B')).toMatchObject({ kind: 'parcel', value: 'PUD-049410ED6B' });
    expect(parseScan('sbg:tote:BAG-004')).toMatchObject({ kind: 'tote', value: 'BAG-004' });
    expect(parseScan('sbg:badge:DRV-7CFC59B2')).toMatchObject({ kind: 'badge', value: 'DRV-7CFC59B2' });
  });

  it('treats a bare code as a value with no kind (a pre-printed sticker roll)', () => {
    expect(parseScan('PUD-1')).toEqual({ kind: null, value: 'PUD-1', raw: 'PUD-1' });
    expect(parseScan('  BAG-9  ')).toMatchObject({ kind: null, value: 'BAG-9' });
  });

  it('is case-insensitive on the scheme and kind, and keeps a value that contains a colon', () => {
    expect(parseScan('SBG:PARCEL:PUD-1')).toMatchObject({ kind: 'parcel', value: 'PUD-1' });
    expect(parseScan('sbg:track:https://x/y:z')).toMatchObject({ kind: 'track', value: 'https://x/y:z' });
  });

  it('an unknown kind falls back to bare rather than rejecting a real-but-odd code', () => {
    expect(parseScan('sbg:whatever:X')).toMatchObject({ kind: null, value: 'sbg:whatever:X' });
  });
});

describe('checkScan', () => {
  it('accepts the right kind and any bare code', () => {
    expect(checkScan('sbg:parcel:PUD-1', 'parcel')).toEqual({ value: 'PUD-1', mismatch: false, scannedKind: 'parcel' });
    expect(checkScan('PUD-1', 'parcel')).toEqual({ value: 'PUD-1', mismatch: false, scannedKind: null });
  });

  it('rejects a namespaced code of the WRONG kind as a mismatch — the red beep', () => {
    const r = checkScan('sbg:vehicle:VEH-1', 'parcel');
    expect(r).toEqual({ value: null, mismatch: true, scannedKind: 'vehicle' });
  });

  it('an empty scan yields no value and no mismatch', () => {
    expect(checkScan('   ', 'tote')).toEqual({ value: null, mismatch: false, scannedKind: null });
  });
});

describe('kindLabel', () => {
  it('speaks each kind in plain words for the mismatch message', () => {
    expect(kindLabel('badge')).toBe('driver badge');
    expect(kindLabel('tote')).toBe('bag');
    expect(kindLabel(null)).toBe('code');
  });
});
