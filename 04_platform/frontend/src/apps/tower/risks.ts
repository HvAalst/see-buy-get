import type { MessageKey } from '../../shared/i18n';

/**
 * Round 39 — THE RISK REGISTER, as the console reads it (the user: "Staff rate, high asks seals"): every corridor and hub,
 * rated low, medium or high per threat, looked at again each quarter; incidents propose a raise and a person decides. A
 * HIGH rating asks for seals and no night running — the server enforces it; this screen says it.
 */
export type RiskThreat = 'pilferage' | 'hijacking' | 'unrest' | 'extortion';
export type RiskLevel = 'low' | 'medium' | 'high';
export type RiskSubject = 'corridor' | 'hub';

export const RISK_THREATS: readonly RiskThreat[] = ['pilferage', 'hijacking', 'unrest', 'extortion'];
export const RISK_LEVELS: readonly RiskLevel[] = ['low', 'medium', 'high'];

export const THREAT_KEY: Record<RiskThreat, MessageKey> = { pilferage: 'tower.risks.threat.pilferage', hijacking: 'tower.risks.threat.hijacking', unrest: 'tower.risks.threat.unrest', extortion: 'tower.risks.threat.extortion' };
export const LEVEL_KEY: Record<RiskLevel, MessageKey> = { low: 'tower.risks.level.low', medium: 'tower.risks.level.medium', high: 'tower.risks.level.high' };

export interface RiskCell {
  threat: RiskThreat;
  level?: RiskLevel;
  why?: string;
  ratedBy?: string;
  ratedAt?: string;
  reviewBy?: string;
  overdue: boolean;
}

export interface RiskRow {
  subject: RiskSubject;
  id: string;
  name: string;
  ratings: RiskCell[];
  high: boolean;
}

export interface RiskProposalRow {
  proposalId: string;
  subject: RiskSubject;
  id: string;
  name: string;
  threat: RiskThreat;
  from?: RiskLevel;
  to: RiskLevel;
  because: string;
  ref?: string;
  at: string;
}

export interface RiskRegisterView {
  rows: RiskRow[];
  proposals: RiskProposalRow[];
  overdue: number;
}

/** The number beside the screen: what waits for a person — proposals, and ratings past their quarter. Null while unread. */
export function riskWaiting(v: RiskRegisterView | null | undefined): number | null {
  if (!v) return null;
  return v.proposals.length + v.overdue;
}

/** How a level is drawn: high warns, medium informs, low is calm, none is quiet. */
export function levelTone(level: RiskLevel | undefined): string {
  return level === 'high' ? 'ctag--warn' : level === 'medium' ? 'ctag--info' : level === 'low' ? 'ctag--ok' : 'ctag--quiet';
}

/** What the editor sends: only the threats whose level it changed. */
export function riskChanges(row: Pick<RiskRow, 'ratings'>, chosen: Partial<Record<RiskThreat, RiskLevel>>): Array<{ threat: RiskThreat; level: RiskLevel }> {
  return RISK_THREATS.flatMap((threat) => {
    const next = chosen[threat];
    const now = row.ratings.find((c) => c.threat === threat)?.level;
    return next && next !== now ? [{ threat, level: next }] : [];
  });
}
