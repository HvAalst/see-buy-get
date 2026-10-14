import { describe, expect, it } from 'vitest';
import { retentionIsUrgent, retentionLines, routeLine, shortPrint } from './words';
import type { RetentionStatement } from '../../lib/sbg/personas/archive';
import type { ArchivedNoteRow } from '../../lib/sbg/personas/archive';
import type { Translate } from '../i18n';

/** A translator that shows which key fired and what it was given — the assertion is about choice, not prose. */
const t = ((key: string, vars?: Record<string, unknown>) =>
  vars ? `${key}(${Object.entries(vars).map(([k, v]) => `${k}=${String(v)}`).join(',')})` : key) as unknown as Translate;

describe('what the archive says about retention', () => {
  const open: RetentionStatement = { documentDays: 365, evidenceDays: 90, proof: 'permanent' };
  const finished: RetentionStatement = {
    documentDays: 365,
    documentUntil: '2027-09-25T00:00:00.000Z',
    proof: 'permanent',
    evidenceDays: 90,
    evidenceUntil: '2027-01-01T00:00:00.000Z',
    claimWindowUntil: '2027-10-01T00:00:00.000Z',
    exportBefore: '2027-01-01T00:00:00.000Z',
  };

  it('ALWAYS ends on the proof line, in both states — it is the difference between gone and unverifiable', () => {
    // Every other line is about a date. This one is the answer to "so what happens after that", and a
    // reader who does not reach it is left thinking deletion means the record simply vanished.
    for (const s of [open, finished]) {
      const lines = retentionLines(s, t);
      expect(lines[lines.length - 1]).toBe('archive.retention.proof');
    }
  });

  it('says nothing has started counting while the load is still open', () => {
    // A date invented for a load that has not finished would be a promise about a clock nobody started.
    const lines = retentionLines(open, t);
    expect(lines.join(' ')).toContain('archive.retention.open');
    expect(lines.join(' ')).not.toContain('claimGap');
  });

  it('WARNS THAT THE PHOTOGRAPHS GO BEFORE THE CLAIM WINDOW DOES — the line that changes what somebody does', () => {
    // Ninety days of evidence against a year in which a claim can still be brought. Saying only the first
    // two sentences would leave a reader reassured and wrong.
    const said = retentionLines(finished, t).join(' ');
    expect(said).toContain('archive.retention.until');
    expect(said).toContain('archive.retention.claimGap');
  });

  it('leaves the warning out when the evidence actually outlives the claim window', () => {
    const covered: RetentionStatement = { ...finished, exportBefore: undefined };
    expect(retentionLines(covered, t).join(' ')).not.toContain('claimGap');
  });

  it('calls it urgent only inside the last month, and never for a clock that has not started', () => {
    const now = Date.parse('2026-12-20T00:00:00.000Z');
    expect(retentionIsUrgent(finished, now)).toBe(true);
    expect(retentionIsUrgent(finished, Date.parse('2026-06-01T00:00:00.000Z'))).toBe(false);
    expect(retentionIsUrgent(open, now)).toBe(false);
  });
});

describe('a row', () => {
  const row = { from: 'Nairobi', to: 'Mombasa', plate: 'KDA 777N', grossKg: 800 } as ArchivedNoteRow;

  it('reads as a journey, a truck and a weight', () => {
    expect(routeLine(row)).toBe('Nairobi → Mombasa · KDA 777N · 800 kg');
  });

  it('skips a vehicle nobody recorded rather than printing an empty gap', () => {
    expect(routeLine({ ...row, plate: undefined })).toBe('Nairobi → Mombasa · 800 kg');
  });
});

describe('a fingerprint', () => {
  it('shortens to something two people can read across a table', () => {
    expect(shortPrint('9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08')).toBe('9f86d081');
  });
});
