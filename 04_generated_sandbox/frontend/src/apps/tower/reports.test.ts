import { describe, expect, it } from 'vitest';
import { reportedText, reportsAgainst, reportsInOrder, shortId, type ReportRow } from './reports';

const row = (over: Partial<ReportRow> = {}): ReportRow => ({
  reportId: 'rpt_1',
  conversationId: 'cv_1',
  seq: 1,
  byDid: 'did:shop:a',
  reportedDid: 'did:drv:x',
  reason: 'spam',
  snapshot: { seq: 1, kind: 'text', body: 'hello', at: '2026-09-13T08:00:00Z' },
  at: '2026-09-13T08:05:00Z',
  ...over,
});

describe('CV1 — reported messages', () => {
  it('puts scams first, then abuse, then spam — newest first within each', () => {
    const rows = [
      row({ reportId: 'spam-new', at: '2026-09-13T10:00:00Z' }),
      row({ reportId: 'scam-old', reason: 'scam', at: '2026-09-12T10:00:00Z' }),
      row({ reportId: 'abuse', reason: 'abuse' }),
      row({ reportId: 'scam-new', reason: 'scam', at: '2026-09-13T11:00:00Z' }),
    ];
    expect(reportsInOrder(rows).map((r) => r.reportId)).toEqual(['scam-new', 'scam-old', 'abuse', 'spam-new']);
  });

  it('shows what was said, and a quick reply as its key rather than an invented sentence', () => {
    expect(reportedText(row())).toBe('hello');
    expect(reportedText(row({ snapshot: { seq: 2, kind: 'quick', quick: 'paid', at: '2026-09-13T08:00:00Z' } }))).toBe('[paid]');
  });

  it('counts the PEOPLE who reported someone, so one angry reporter is not a pattern', () => {
    const rows = [row(), row({ reportId: 'rpt_2', seq: 2 }), row({ reportId: 'rpt_3', byDid: 'did:shop:b' })];
    expect(reportsAgainst(rows, 'did:drv:x')).toBe(2);
    expect(reportsAgainst(rows, 'did:drv:nobody')).toBe(0);
  });

  it('shortens an identity without losing its ends', () => {
    expect(shortId('did:glos:3d46bb4bdecd67dc0337e0d91c40e288')).toBe('did:glos:3…40e288');
    expect(shortId('did:drv:x')).toBe('did:drv:x');
  });
});
