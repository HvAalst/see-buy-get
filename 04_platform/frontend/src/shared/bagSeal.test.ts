import { describe, expect, it } from 'vitest';
import { bagFindings, closeReady, closureBody, EMPTY_BAG_CLOSE, EMPTY_BAG_RECEIPT, receiptBody, receiptReady, reportBody, reportReady } from './bagSeal';

describe('a bag closed on our own seal, and received by it (round 36)', () => {
  it('starts on the coded seal, and closes with its number and a photograph — or a photograph alone', () => {
    expect(EMPTY_BAG_CLOSE.kind).toBe('seal');
    expect(closeReady({ ...EMPTY_BAG_CLOSE, photoRef: 'med_1' })).toBe(false);
    expect(closeReady({ ...EMPTY_BAG_CLOSE, seal: ' 0012345 ' })).toBe(false);
    expect(closeReady({ kind: 'seal', seal: '0012345', photoRef: 'med_1' })).toBe(true);
    expect(closureBody({ kind: 'seal', seal: ' 0012345 ', photoRef: 'med_1' })).toEqual({ seal: '0012345', photoRef: 'med_1' });
    // Without a seal, a number typed earlier is not sent.
    expect(closeReady({ kind: 'photo', seal: '', photoRef: 'med_1' })).toBe(true);
    expect(closureBody({ kind: 'photo', seal: '0012345', photoRef: 'med_1' })).toEqual({ photoRef: 'med_1' });
  });

  it('receives with a photograph and a word on how it is; a sealed bag as closed with the number read off it', () => {
    expect(receiptReady({ ...EMPTY_BAG_RECEIPT, photoRef: 'med_2' }, 'seal')).toBe(false);
    expect(receiptReady({ sealNumber: '', photoRef: 'med_2', asClosed: true }, 'seal')).toBe(false);
    expect(receiptReady({ sealNumber: '0012345', photoRef: 'med_2', asClosed: true }, 'seal')).toBe(true);
    expect(receiptReady({ sealNumber: '', photoRef: 'med_2', asClosed: true }, 'photo')).toBe(true);
    // Not as closed: sent as it is — the server says report it first, or takes it as found after a release.
    expect(receiptReady({ sealNumber: '', photoRef: 'med_2', asClosed: false }, 'seal')).toBe(true);
    expect(receiptBody({ sealNumber: ' 0012345 ', photoRef: 'med_2', asClosed: true })).toEqual({ sealNumber: '0012345', photoRef: 'med_2', asClosed: true });
    expect(receiptBody({ sealNumber: '', photoRef: 'med_2', asClosed: false })).toEqual({ photoRef: 'med_2', asClosed: false });
  });

  it('reports a seal only on a sealed bag, a number read only for a seal not the one', () => {
    expect(bagFindings('seal')).toEqual(['seal_not_as_written', 'seal_broken', 'wrap_cut']);
    expect(bagFindings('photo')).toEqual(['wrap_cut']);
    expect(reportReady({ finding: 'seal_not_as_written', numberRead: '', photoRef: 'med_3', note: '' })).toBe(false);
    expect(reportReady({ finding: 'wrap_cut', numberRead: '', photoRef: 'med_3', note: '' })).toBe(true);
    expect(reportBody({ finding: 'wrap_cut', numberRead: '99', photoRef: 'med_3', note: ' zip pulled ' })).toEqual({ finding: 'wrap_cut', photoRefs: ['med_3'], note: 'zip pulled' });
  });
});
