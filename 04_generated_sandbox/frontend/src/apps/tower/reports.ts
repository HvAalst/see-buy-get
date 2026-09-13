import type { MessageKey } from '../../shared/i18n';

/**
 * CV1 — REPORTED MESSAGES, as the operator reads them.
 *
 * A conversation is readable only by its two parties. What reaches the network is what one of them chose to
 * report: a single message, kept with a copy of exactly what was said. Nothing here removes anything — a
 * thread is append-only — so this is a list to act on (warn, suspend, or dismiss by knowing), not a delete key.
 */

export interface ReportRow {
  reportId: string;
  conversationId: string;
  seq: number;
  byDid: string;
  reportedDid: string;
  reason: 'spam' | 'abuse' | 'scam';
  snapshot: { seq: number; kind: 'text' | 'quick'; body?: string; quick?: string; at: string };
  at: string;
}

/** The reason in the operator's words. A scam leads, because it is the one where somebody may lose money. */
export const REASON_KEY: Record<ReportRow['reason'], MessageKey> = {
  scam: 'tower.reports.reason.scam',
  abuse: 'tower.reports.reason.abuse',
  spam: 'tower.reports.reason.spam',
};

const REASON_RANK: Record<ReportRow['reason'], number> = { scam: 0, abuse: 1, spam: 2 };

/** Scams first, then abuse, then spam; newest first within each. */
export function reportsInOrder(rows: ReportRow[]): ReportRow[] {
  return [...rows].sort((a, b) => REASON_RANK[a.reason] - REASON_RANK[b.reason] || b.at.localeCompare(a.at));
}

/** What was said. A quick reply is a key, and a report of one shows the key rather than inventing a sentence. */
export function reportedText(row: ReportRow): string {
  return row.snapshot.kind === 'quick' ? `[${row.snapshot.quick ?? ''}]` : row.snapshot.body ?? '';
}

/** How many people one party has been reported by — the difference between a bad day and a pattern. */
export function reportsAgainst(rows: ReportRow[], did: string): number {
  return new Set(rows.filter((r) => r.reportedDid === did).map((r) => r.byDid)).size;
}

/**
 * CV3 — A DISPUTE REPORT a party shared: the messages they chose, as a fixed copy with a fingerprint.
 * The operator sees the parties' identities, because acting on a dispute means knowing who is in it.
 */
export interface DisputeReportRow {
  reportId: string;
  conversationId: string;
  freightId: string;
  freightCode: string;
  posterDid: string;
  askerDid: string;
  byDid: string;
  sharedBy: 'poster' | 'asker';
  note?: string;
  messages: Array<{
    seq: number;
    from: 'poster' | 'asker';
    kind: string;
    body?: string;
    quick?: string;
    price?: number;
    decision?: 'accepted' | 'declined';
    settlement?: { amount: number; method: string; when: string };
    /** CV4 — a voice message the party included; the operator may play exactly this one. */
    voiceId?: string;
    durationSec?: number;
    at: string;
  }>;
  /** sha256 over the shared messages. Named so the server's credential mask (which strips `hash`) leaves it. */
  fingerprint: string;
  createdAt: string;
}

/** One shared message as a line an operator can read, whatever kind it was. */
export function disputeLine(m: DisputeReportRow['messages'][number]): string {
  if (m.kind === 'quick') return `[${m.quick ?? ''}]`;
  if (m.kind === 'proposal') return `Offered ${m.price?.toFixed(2) ?? '?'}${m.body ? ` — “${m.body}”` : ''}`;
  if (m.kind === 'decision') return `${m.decision === 'accepted' ? 'Accepted' : 'Declined'} ${m.price?.toFixed(2) ?? '?'}`;
  if (m.kind === 'settlement' && m.settlement) return `Settle ${m.settlement.amount.toFixed(2)} by ${m.settlement.method.replace('_', ' ')}, ${m.settlement.when.replace('_', ' ')}${m.body ? ` — “${m.body}”` : ''}`;
  if (m.kind === 'settlement_agreed') return 'Agreed to the settlement';
  if (m.kind === 'voice') {
    const s = Math.max(0, Math.round(m.durationSec ?? 0));
    return `Voice message (${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')})`;
  }
  return m.body ?? '';
}

/** The first characters of a fingerprint — enough to compare two copies by eye. */
export function shortHash(fingerprint: string | undefined): string {
  // A missing fingerprint shows as a dash rather than taking the whole screen down with it.
  return fingerprint ? fingerprint.slice(0, 12) : '—';
}

/** Enough of an identity to tell two apart on screen, not a whole one. */
export function shortId(did: string): string {
  return did.length > 18 ? `${did.slice(0, 10)}…${did.slice(-6)}` : did;
}
