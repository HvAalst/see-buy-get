import type { MessageKey, Translate } from '../../shared/i18n';

/**
 * The operator's DECISION queues — claims, disposal, shop approvals.
 *
 * What these three have in common, and why they share a module: each is a list of situations that stop
 * dead until a person decides, and in each one somebody is waiting. Everything here is about saying what
 * a decision costs and what it is checked against BEFORE it is made, because on this side of the console
 * the alternative is finding out from a refusal.
 *
 * They are migrated from the legacy vanilla tower, which is why the rules read as inherited rather than
 * invented: they were paid for once already.
 */

/* -------------------------------------------------------------------- claims -- */

/** One open damage claim, as the queue reports it. Untyped in the contract, so stated here. */
export interface ClaimRow {
  parcelId: string;
  raisedAt?: string;
  origin?: 'buyer' | 'counter' | string;
  reason?: string;
  vendorId?: string;
  shipmentCost?: number;
  currency?: string;
  /** What an award is actually checked against, and where that ceiling comes from. */
  coverLimit?: number;
  declaredValue?: number;
  awardCap: number;
  capBasis: 'declared' | 'free-limit' | 'sanity-bound';
  evidence?: string[];
}

export type ClaimDecision = 'upheld' | 'partly_upheld' | 'rejected';

/** Whole days a case has been open — the number that decides how loudly a row asks to be looked at. */
export function daysWaiting(since: string | undefined, now: number): number | null {
  const ms = Date.parse(since ?? '');
  if (Number.isNaN(ms)) return null;
  return Math.max(0, Math.floor((now - ms) / 86_400_000));
}

/** Three days is where a claim stops being "in hand" and starts being "somebody has been left waiting". */
export const CLAIM_SLOW_DAYS = 3;

/**
 * What this shipment is covered for, and WHERE THAT NUMBER CAME FROM.
 *
 * Two figures on one row, and the difference between them is the whole point. The shipping price is the
 * first money an adjudicator's eye lands on and it is not a cap — so it is labelled as not one. The cover
 * limit IS the cap, and whether it was declared or is simply what the sister carries for free changes
 * what there is to say to the claimant.
 */
export function coverLine(row: ClaimRow, t: Translate): string {
  // A price nobody recorded is NOT zero. A walk-up parcel paid for in cash carries no shipmentCost, and
  // "sold for 0.00" tells an adjudicator this shipment was free — which is a fact, and the wrong one.
  const shipping = row.shipmentCost == null ? t('tower.claims.priceNotRecorded') : t('tower.claims.shippingSoldFor', { amount: amount(row.shipmentCost, row.currency) });
  if (row.capBasis === 'sanity-bound') return `${shipping} · ${t('tower.claims.noCover')}`;
  const basis = row.capBasis === 'declared' ? t('tower.claims.becauseDeclared') : t('tower.claims.becauseFreeLimit');
  return `${shipping} · ${t('tower.claims.coveredTo', { amount: amount(row.awardCap, row.currency), basis })}`;
}

/**
 * May this decision be submitted, and if not, why not?
 *
 * EVERY decision carries a reason, INCLUDING a rejection: a person whose goods arrived broken is owed an
 * explanation even when they are not owed money, and the claimant is shown this text. Checked here as
 * well as on the server, because the server's refusal would cost a round trip to say the one thing the
 * operator can see for themselves.
 */
export function claimBlocker(decision: ClaimDecision, award: string, note: string, row: ClaimRow, t: Translate): string | null {
  if (!note.trim()) return t('tower.claims.needReason');
  if (decision === 'rejected') return null; // nothing is paid, so there is no figure to check
  const value = Number(award.trim());
  if (!award.trim() || !Number.isFinite(value) || value <= 0) return t('tower.claims.needAward');
  if (value > row.awardCap) {
    return row.capBasis === 'sanity-bound'
      ? t('tower.claims.overBound', { max: amount(row.awardCap, row.currency) })
      : t('tower.claims.overCover', { max: amount(row.awardCap, row.currency) });
  }
  return null;
}

/* ------------------------------------------------------------------ disposal -- */

/** One parcel nobody claimed and nobody is paying to recover. */
export interface DisposalRow {
  parcelId: string;
  heldDays: number;
  declaredValue?: number;
  owedToShop?: number;
  agentDid?: string;
  currency?: string;
}

/** A fortnight of shelf: past this, a real slot in a real shop has been dead for a long time. */
export const DISPOSAL_LONG_DAYS = 14;

/**
 * What closing this row does, in the order it matters.
 *
 * A shop is holding a box it cannot sell the slot of, and it is OWED for having held it. Closing pays
 * them — from the network, because nobody else is going to, and a shortfall settling quietly on a
 * shopkeeper who did the work and had no say in any of it is the asymmetry this network refuses
 * everywhere else. The screen says the amount before the button is pressed, never after.
 */
export function disposalCost(row: DisposalRow, t: Translate): string {
  return t('tower.disposal.closingPays', { amount: amount(row.owedToShop ?? 0, row.currency) });
}

/* ----------------------------------------------------------------- approvals -- */

/** A shop waiting to be let onto the network. */
export interface ApprovalRow {
  did: string;
  shopName?: string;
  zone?: string;
  shelf?: { rows?: number; cols?: number };
  requirements?: { androidVersion?: string; tradingLicence?: string };
  kyc?: { idCopyRef?: string; tradingLicenceRef?: string; shopPhotoRefs?: string[] };
}

/** How much shelf this shop is offering — the capacity the network is actually buying. */
export function shelfSlots(row: ApprovalRow): number {
  return (row.shelf?.rows ?? 0) * (row.shelf?.cols ?? 0);
}

/** The documents attached, or an honest nothing. A decision on no documents is a different decision. */
export function documentsOf(row: ApprovalRow): string[] {
  const k = row.kyc;
  if (!k) return [];
  return [k.idCopyRef, k.tradingLicenceRef, ...(k.shopPhotoRefs ?? [])].filter((x): x is string => Boolean(x));
}

/* --------------------------------------------------------------------- money -- */

export function money(n: number | undefined): string {
  return (n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * A figure with the money it is denominated in — and NOTHING pretending to be that money when it is not
 * known. A bare "1,000,000.00" beside a currency that never arrived reads as this network's own unit,
 * which is a thing it does not have: every sister settles in its own.
 */
export function amount(n: number | undefined, currency: string | undefined): string {
  return currency ? `${money(n)} ${currency}` : money(n);
}

/** The masthead's live line for the whole console: everything actually waiting on a person. */
export function waitingLine(counts: { hazards: number | null; claims: number | null; disposal: number | null; approvals: number | null }, t: Translate): string {
  const known = [counts.hazards, counts.claims, counts.disposal, counts.approvals].filter((n): n is number => n !== null);
  // Nothing read yet is not the same as nothing waiting, and a console must not say the second while it
  // means the first.
  if (!known.length) return t('tower.work.unknown');
  const total = known.reduce((a, b) => a + b, 0);
  return total === 0 ? t('tower.work.clearAll') : t('tower.work.waitingAll', { n: total });
}

export const QUEUE_LABEL: Record<'claims' | 'disposal' | 'approvals', MessageKey> = {
  claims: 'tower.nav.claims',
  disposal: 'tower.nav.disposal',
  approvals: 'tower.nav.approvals',
};
