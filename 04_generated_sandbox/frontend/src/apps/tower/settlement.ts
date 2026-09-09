import type { MessageKey, Translate } from '../../shared/i18n';

/**
 * Paying the people the network owes — the state machine, and what a run actually did.
 *
 * The rule the whole screen rests on: NOTHING HERE MOVES MONEY. A run RAISES payouts, a payment rail
 * carries them, and only the rail's answer changes what the books say. In this sandbox that answer is a
 * person pressing Settle; in a live deployment it is the provider's callback; it is deliberately the
 * same door, so the console can never become a place where money is declared paid because somebody
 * pressed a button on a screen.
 */

export interface PayoutRow {
  payoutId: string;
  payeeDid?: string;
  amount?: number;
  currency?: string;
  day?: string;
  status: string;
  providerRef?: string;
}

export type PayoutAction = 'submit' | 'settle' | 'fail' | 'reverse';

/**
 * THE ONE HONEST NEXT STEP for each state, and never more than one path forward.
 *
 * A payout that has been raised can only be handed to the rail. One the rail has is either settled or
 * failed by the rail — those two are the rail speaking, not us. And a settled one can only be reversed,
 * because money that left and came back is a new fact rather than an undo.
 *
 * A state this build has never heard of gets NO buttons: offering an action against a status we cannot
 * reason about is how somebody advances a payment nobody understands.
 */
export const PAYOUT_ACTIONS: Record<string, Array<{ action: PayoutAction; labelKey: MessageKey; tone?: 'danger'; reasonKey?: MessageKey }>> = {
  requested: [{ action: 'submit', labelKey: 'tower.money.act.submit' }],
  submitted: [
    { action: 'settle', labelKey: 'tower.money.act.settle' },
    { action: 'fail', labelKey: 'tower.money.act.fail', tone: 'danger', reasonKey: 'tower.money.reason.failed' },
  ],
  settled: [{ action: 'reverse', labelKey: 'tower.money.act.reverse', tone: 'danger', reasonKey: 'tower.money.reason.reversed' }],
  failed: [],
  reversed: [],
};

/** The colour a state is read in. Nothing is green until the money has actually left. */
export function payoutTone(status: string): 'ok' | 'warn' | 'info' | 'quiet' {
  if (status === 'settled') return 'ok';
  if (status === 'failed' || status === 'reversed') return 'warn';
  if (status === 'submitted') return 'info';
  return 'quiet';
}

export interface RunResult {
  day?: string;
  raised?: unknown[];
  skipped?: Array<{ payeeDid?: string; reason?: string }>;
}

/**
 * What a run DID — and, above all, who it skipped and why.
 *
 * A run that quietly pays four of six people is how somebody discovers on Friday that they have not been
 * paid since Tuesday. So the skipped are named in the same sentence as the raised, and a run that raised
 * nothing at all says so rather than reporting a cheerful zero.
 */
export function runSummary(result: RunResult, t: Translate): string {
  const raised = result.raised?.length ?? 0;
  const skipped = result.skipped ?? [];
  const head = raised
    ? t('tower.money.runRaised', { n: raised, day: result.day ?? '' })
    : t('tower.money.runRaisedNone', { day: result.day ?? '' });
  if (!skipped.length) return head;
  const who = skipped.map((s) => `${(s.payeeDid ?? '?').slice(0, 12)}… — ${s.reason ?? '?'}`).join('; ');
  return `${head} ${t('tower.money.runSkipped', { n: skipped.length, who })}`;
}
