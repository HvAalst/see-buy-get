import { describe, expect, it } from 'vitest';
import { disputeLine, reportedText, reportsAgainst, reportsInOrder, shortHash, shortId, type ReportRow } from './reports';

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

  it('CV3 — reads every kind of shared message as a line, and shortens a fingerprint for comparing by eye', () => {
    const at = '2026-09-13T08:00:00Z';
    expect(disputeLine({ seq: 1, from: 'driver', kind: 'text', body: 'Gate was shut', at })).toBe('Gate was shut');
    expect(disputeLine({ seq: 2, from: 'driver', kind: 'proposal', price: 4500, body: 'empty past you', at })).toBe('Offered 4500.00 — “empty past you”');
    expect(disputeLine({ seq: 3, from: 'poster', kind: 'decision', decision: 'accepted', price: 4500, at })).toBe('Accepted 4500.00');
    expect(disputeLine({ seq: 4, from: 'poster', kind: 'settlement', settlement: { amount: 4500, method: 'mobile_money', when: 'on_delivery' }, at })).toBe('Settle 4500.00 by mobile money, on delivery');
    expect(shortHash('a'.repeat(64))).toBe('aaaaaaaaaaaa');
    expect(shortHash(undefined)).toBe('—');
    expect(disputeLine({ seq: 5, from: 'driver', kind: 'voice', voiceId: 'vn_1', durationSec: 67, at })).toBe('Voice message (1:07)');
  });

  it('shortens an identity without losing its ends', () => {
    expect(shortId('did:glos:3d46bb4bdecd67dc0337e0d91c40e288')).toBe('did:glos:3…40e288');
    expect(shortId('did:drv:x')).toBe('did:drv:x');
  });
});
