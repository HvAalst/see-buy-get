import type { Translate } from '../../shared/i18n';

/**
 * ROUND 18 — A GS1 PREFIX TWO BUSINESSES SAY IS THEIRS ("Refuse the same digit"; "Only when disputed").
 *
 * A prefix is shared only under different extension digits. A business refused the digit another prints under — or a
 * prefix staff decided is another's — may say the prefix is its own, with its GS1 licence; the businesses using it are
 * told and send theirs; two members of SeeBuyGet staff decide, and both read the reason.
 */
export interface Gs1DisputeView {
  disputeId: string;
  companyPrefix: string;
  extensionDigit: number;
  side: 'claimant' | 'holder';
  state: 'open' | 'proposed' | 'decided' | 'withdrawn';
  openedAt: string;
  answerBy: string;
  claimantName: string;
  holderNames: string[];
  licenceSent: boolean;
  /** Round 20 — the client this business stands for in it. */
  forClient?: string;
  decided?: { mine: boolean; reason: string; at: string };
  withdrawnAt?: string;
}

/** The refusal a business may answer with its licence. */
export const PREFIX_TAKEN = 'GS1_PREFIX_TAKEN';

export type DisputeTone = 'ok' | 'warn' | 'danger' | 'idle';

const alive = (d: Gs1DisputeView) => d.state === 'open' || d.state === 'proposed';

/** Where a dispute stands for this business, in a sentence — and how loudly to say it. */
export function disputeLine(d: Gs1DisputeView, t: Translate, day: (iso: string) => string): { text: string; tone: DisputeTone } {
  const prefix = d.companyPrefix;
  // Round 20 — said for a client, every sentence is the CLIENT's: the prefix is theirs, or not, never the forwarder's.
  const client = d.forClient;
  if (d.state === 'withdrawn') return { text: t('business.gs1.d.withdrawn', { prefix }), tone: 'idle' };
  if (d.decided) {
    const reason = d.decided.reason;
    if (d.decided.mine) return { text: client ? t('business.gs1.d.decidedMineClient', { prefix, client, reason }) : t('business.gs1.d.decidedMine', { prefix, reason }), tone: 'ok' };
    if (d.side === 'claimant') return { text: client ? t('business.gs1.d.decidedNotClaimantClient', { prefix, client, reason }) : t('business.gs1.d.decidedNotClaimant', { prefix, reason }), tone: 'danger' };
    return { text: client ? t('business.gs1.d.decidedNotHolderClient', { prefix, client, claimant: d.claimantName, reason }) : t('business.gs1.d.decidedNotHolder', { prefix, claimant: d.claimantName, reason }), tone: 'danger' };
  }
  if (d.side === 'claimant') {
    const vars = { prefix, names: d.holderNames.join(', '), by: day(d.answerBy) };
    return { text: client ? t('business.gs1.d.claimantOpenClient', { ...vars, client }) : t('business.gs1.d.claimantOpen', vars), tone: 'idle' };
  }
  if (d.licenceSent) return { text: client ? t('business.gs1.d.holderSentClient', { prefix, client, claimant: d.claimantName }) : t('business.gs1.d.holderSent', { prefix, claimant: d.claimantName }), tone: 'idle' };
  return { text: client ? t('business.gs1.d.holderAskClient', { prefix, client, claimant: d.claimantName, by: day(d.answerBy) }) : t('business.gs1.d.holderAsk', { prefix, claimant: d.claimantName, by: day(d.answerBy) }), tone: 'warn' };
}

/** The business using the prefix can still send its licence — or a clearer one. */
export function maySendLicence(d: Gs1DisputeView): boolean {
  return d.side === 'holder' && alive(d);
}

/** The business that opened it can take it back while nothing is decided. */
export function mayTakeBack(d: Gs1DisputeView): boolean {
  return d.side === 'claimant' && alive(d);
}

/** Over for a month: no longer worth a line on the panel. */
export function stillWorthShowing(d: Gs1DisputeView, now: number): boolean {
  const over = d.decided?.at ?? d.withdrawnAt;
  return !over || now - Date.parse(over) < 30 * 86_400_000;
}
