import type { MessageKey, Translate } from '../../shared/i18n';

/**
 * ROUND 18 — TWO BUSINESSES SAY ONE GS1 COMPANY PREFIX IS THEIRS, as staff decide it.
 *
 * Both licences side by side; one member of staff says whose the prefix is, what was checked and why; a different one
 * approves or sends it back. Staff wait for the businesses using the prefix to send theirs — a week at most.
 */
export interface Gs1PartyRow {
  entityId: string;
  name: string;
  licenceRef?: string;
  earlier?: string[];
  note?: string;
  sentAt?: string;
  digitNow?: number;
}

export type Gs1Side = 'claimant' | 'holders';

export interface Gs1DisputeRow {
  disputeId: string;
  companyPrefix: string;
  extensionDigit: number;
  state: 'open' | 'proposed' | 'decided' | 'withdrawn';
  openedAt: string;
  answerBy: string;
  mayDecide: boolean;
  claimant: Gs1PartyRow;
  holders: Gs1PartyRow[];
  proposal?: { to: Gs1Side; what: string; reason: string; by: string; at: string };
  sentBack?: { by: string; at: string; why: string };
  decided?: { to: Gs1Side; reason: string; proposedBy: string; by: string; at: string };
  withdrawnAt?: string;
}

export const GS1_STATE: Record<Gs1DisputeRow['state'], { key: MessageKey; tone: 'warn' | 'info' | 'ok' | 'quiet' }> = {
  open: { key: 'tower.gs1.state.open', tone: 'warn' },
  proposed: { key: 'tower.gs1.state.proposed', tone: 'info' },
  decided: { key: 'tower.gs1.state.decided', tone: 'ok' },
  withdrawn: { key: 'tower.gs1.state.withdrawn', tone: 'quiet' },
};

/** The licence to read first, then any it replaced: evidence is never deleted mid-case. */
export function licenceRefs(p: Gs1PartyRow): string[] {
  return [...(p.licenceRef ? [p.licenceRef] : []), ...(p.earlier ?? [])];
}

/** Whose the prefix is, by name. */
export function sideWords(row: Gs1DisputeRow, to: Gs1Side): string {
  return to === 'claimant' ? row.claimant.name : row.holders.map((h) => h.name).join(', ');
}

/** What this dispute waits on, in a sentence. */
export function gs1Step(row: Gs1DisputeRow, t: Translate, day: (iso: string) => string): string {
  if (row.state === 'withdrawn') return t('tower.gs1.step.withdrawn', { name: row.claimant.name });
  if (row.decided) return t('tower.gs1.step.decided', { whose: sideWords(row, row.decided.to), proposedBy: row.decided.proposedBy, by: row.decided.by, at: day(row.decided.at) });
  if (row.proposal) return t('tower.gs1.step.proposed', { whose: sideWords(row, row.proposal.to), by: row.proposal.by });
  if (!row.mayDecide) {
    const missing = row.holders.filter((h) => !h.licenceRef).map((h) => h.name);
    return t('tower.gs1.step.waiting', { names: missing.join(', '), by: day(row.answerBy) });
  }
  return t('tower.gs1.step.ready');
}

/** A second member of staff approves — never the one who proposed it. */
export function mayApprove(row: Gs1DisputeRow, me: string | undefined): boolean {
  return row.state === 'proposed' && Boolean(row.proposal) && row.proposal!.by !== me;
}

/** Disputes still to be decided. */
export function gs1Waiting(rows: Gs1DisputeRow[]): number {
  return rows.filter((r) => r.state === 'open' || r.state === 'proposed').length;
}

/**
 * The Businesses badge: businesses waiting for their check, and disputes over a prefix waiting to be decided. Null when
 * either was not read: a badge short of what waits says "up to date" when it is not.
 */
export function businessesWaiting(checks: number | null, disputes: Gs1DisputeRow[] | null): number | null {
  return checks === null || disputes === null ? null : checks + gs1Waiting(disputes);
}
