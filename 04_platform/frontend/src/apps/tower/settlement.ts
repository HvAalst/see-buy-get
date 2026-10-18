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
  requestedBy?: { name: string };
  approvedBy?: { name: string };
}

/**
 * WHO, under a payout's state: who raised it and, once it went to the rail, who approved it — two different members of
 * staff. A raised one says plainly that somebody else approves it, so the person who raised it is not left wondering
 * why the button refuses them.
 */
export function payoutWho(row: Pick<PayoutRow, 'status' | 'requestedBy' | 'approvedBy'>, t: Translate): string | null {
  if (row.approvedBy) return t('tower.money.who.approved', { raised: row.requestedBy?.name ?? '—', approved: row.approvedBy.name });
  if (row.status === 'requested' && row.requestedBy) return t('tower.money.who.raised', { name: row.requestedBy.name });
  return null;
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

/* ------------------------------------------------------- and the money coming IN -- */

/**
 * A top-up or prepayment somebody has asked to make.
 *
 * The inbound mirror of PayoutRow, and it rests on the same rule read backwards: **nothing on this screen
 * creates money either.** A shop asks, a payment provider confirms, and only the confirmation moves the
 * books. Before 2026-09-22 the shop's own app created the entry, which made the held-cash figure at the
 * top of this screen a claim by the party who benefits from it.
 */
export interface FundingRow {
  fundingId: string;
  payerKind?: string;
  payerDid?: string;
  /** The shop or store by NAME. The console's standing rule: never an id where a name belongs. */
  payerName?: string;
  amount?: number;
  /** What actually arrived. Differs from `amount` when somebody paid less than they said they would. */
  confirmedAmount?: number;
  currency?: string;
  status: string;
  reference?: string;
  provider?: string;
  providerRef?: string;
  openedAt?: string;
  fee?: number;
}

/** Money that arrived with nobody's name on it — recorded, never posted. */
export interface UnmatchedRow {
  id: string;
  provider?: string;
  providerRef?: string;
  reference?: string;
  amount?: number;
  currency?: string;
  payerLabel?: string;
  at?: string;
  reason?: string;
}

export type FundingAction = 'confirm' | 'simulate' | 'expire' | 'reverse';

/**
 * THE ONE HONEST NEXT STEP, inbound.
 *
 * A request still waiting can be confirmed from a statement (a person naming a line they can point at),
 * stood in for by the sandbox's provider, or closed because nobody paid it. A confirmed payment can only
 * be reversed, because money that arrived and went back is a new fact rather than an undo.
 *
 * There is deliberately no "mark it paid". Both confirm paths demand a provider reference — without one
 * this console would be a place where money is created because somebody pressed a button, which is the
 * arrangement the funding rail exists to end.
 */
export const FUNDING_ACTIONS: Record<string, Array<{ action: FundingAction; labelKey: MessageKey; tone?: 'danger'; reasonKey?: MessageKey; needsRef?: boolean }>> = {
  awaiting: [
    { action: 'confirm', labelKey: 'tower.money.in.act.confirm', needsRef: true },
    { action: 'simulate', labelKey: 'tower.money.in.act.simulate', needsRef: true },
    { action: 'expire', labelKey: 'tower.money.in.act.expire', tone: 'danger', reasonKey: 'tower.money.in.reason.expired' },
  ],
  confirmed: [{ action: 'reverse', labelKey: 'tower.money.in.act.reverse', tone: 'danger', reasonKey: 'tower.money.in.reason.reversed' }],
  failed: [],
  expired: [],
  reversed: [],
};

/** The colour a state is read in. Nothing is green until a rail has confirmed the payment. */
export function fundingTone(status: string): 'ok' | 'warn' | 'info' | 'quiet' {
  if (status === 'confirmed') return 'ok';
  if (status === 'failed' || status === 'reversed') return 'warn';
  if (status === 'awaiting') return 'info';
  return 'quiet';
}

/**
 * What a confirmed payment actually says, in one line.
 *
 * Three facts belong together and are useless apart: what arrived, what the rail took, and — when they
 * differ — what was asked for. A shop that asked for 5,000 and paid 500 is the case this line exists to
 * make visible; showing only the asked-for amount is how a half-paid top-up looks settled.
 */
export function fundingLine(row: FundingRow, t: Translate): string {
  const money = (n?: number) => `${row.currency ?? ''} ${(n ?? 0).toFixed(2)}`.trim();
  if (row.status !== 'confirmed' && row.status !== 'reversed') return t('tower.money.in.asked', { amount: money(row.amount) });
  const parts = [t('tower.money.in.arrived', { amount: money(row.confirmedAmount) })];
  if (row.fee) parts.push(t('tower.money.in.fee', { amount: money(row.fee) }));
  if (row.confirmedAmount != null && row.amount != null && Math.abs(row.confirmedAmount - row.amount) > 0.001) {
    parts.push(t('tower.money.in.short', { amount: money(row.amount) }));
  }
  return parts.join(' · ');
}
