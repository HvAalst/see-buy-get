import type { Translate } from '../../shared/i18n';
import type { DisputeTone, Gs1DisputeView } from '../../shared/gs1';

/**
 * ROUND 18 — A GS1 PREFIX TWO BUSINESSES SAY IS THEIRS ("Refuse the same digit"; "Only when disputed").
 *
 * A prefix is shared only under different extension digits. A business refused the digit another prints under — or a
 * prefix staff decided is another's — may say the prefix is its own, with its GS1 licence; the businesses using it are
 * told and send theirs; two members of SeeBuyGet staff decide, and both read the reason.
 */
// Round 29 — what a store reads of a dispute too: kept in one place, re-exported for the business's screens.
export { PREFIX_TAKEN, maySendLicence, mayTakeBack, stillWorthShowing, type DisputeTone, type Gs1DisputeView } from '../../shared/gs1';

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
    const vars = { prefix, names: d.holderNames.join(', '), n: d.holderNames.length, by: day(d.answerBy) };
    return { text: client ? t('business.gs1.d.claimantOpenClient', { ...vars, client }) : t('business.gs1.d.claimantOpen', vars), tone: 'idle' };
  }
  if (d.licenceSent) return { text: client ? t('business.gs1.d.holderSentClient', { prefix, client, claimant: d.claimantName }) : t('business.gs1.d.holderSent', { prefix, claimant: d.claimantName }), tone: 'idle' };
  return { text: client ? t('business.gs1.d.holderAskClient', { prefix, client, claimant: d.claimantName, by: day(d.answerBy) }) : t('business.gs1.d.holderAsk', { prefix, claimant: d.claimantName, by: day(d.answerBy) }), tone: 'warn' };
}
