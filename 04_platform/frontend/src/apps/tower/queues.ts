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
  /** `none`: the company that carried it has stated no cover, so it pays nothing itself and nothing can be awarded. */
  capBasis: 'declared' | 'free-limit' | 'none';
  evidence?: string[];
}

export type ClaimDecision = 'upheld' | 'partly_upheld' | 'rejected';

/** FP3b — one open FREIGHT claim, as the queue reports it. Same decision, different cover: a freight declares no value,
 *  so the cap is the cover the billing company has stated — and NOTHING where it has stated none, or nobody of ours billed it. */
export interface FreightClaimRow {
  freightId: string;
  code: string;
  description: string;
  destLabel: string;
  kind: 'damaged' | 'short' | 'not_received';
  reason: string;
  raisedAt: string;
  raisedBy: string;
  senderName: string;
  carrierName?: string;
  carriage?: number;
  currency?: string;
  coverable: boolean;
  awardCap: number;
  capBasis: 'free-limit' | 'none';
  /** FP8 — what the network paid the carrier for the haul; an upheld award is taken back from them up to this. */
  carrierPaid?: number;
  /** CL1 — the agreed term, who it gives standing to, and why. Absent where no term was recorded. */
  incoterm?: string;
  claimant?: 'sender' | 'receiver';
  standingWhy?: string;
  evidence: string[];
  attempts: number;
  receiverName?: string;
}

/** FP8 — what an upheld award costs the carrier: taken back from what they were paid for the haul, never more. Only
 *  where the network paid them — a haul settled between the parties has nothing on our books to take back. */
export function carrierBearsLine(row: FreightClaimRow, t: Translate): string | null {
  if (!row.coverable || !row.carrierPaid || row.carrierPaid <= 0) return null;
  return t('tower.claims.carrierBears', { amount: amount(row.carrierPaid, row.currency) });
}

/** What a decision is checked against — the part of a row claimBlocker reads, shared by parcels and freight. */
export type ClaimCap = { awardCap: number; capBasis: ClaimRow['capBasis'] | FreightClaimRow['capBasis']; currency?: string; parcelId?: string };

/** FP3b — what a freight claim is covered for: the cover the billing company stated, that it stated none, or that nobody of ours billed the load. */
export function freightCoverLine(row: FreightClaimRow, t: Translate): string {
  if (!row.coverable) return t('tower.claims.freightNoBooks');
  if (row.awardCap > 0) return t('tower.claims.freightCovered', { amount: amount(row.carriage, row.currency), cover: amount(row.awardCap, row.currency) });
  return t('tower.claims.freightBilled', { amount: amount(row.carriage, row.currency) });
}

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
  if (row.capBasis === 'none') return `${shipping} · ${t('tower.claims.noCover')}`;
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
export function claimBlocker(decision: ClaimDecision, award: string, note: string, row: ClaimCap, t: Translate): string | null {
  if (!note.trim()) return t('tower.claims.needReason');
  if (decision === 'rejected') return null; // nothing is paid, so there is no figure to check
  // A PARCEL whose company has stated no cover: it pays nothing from its own books, so there is nothing to award and
  // nothing to uphold — the damage claim report is the answer. Only a claim left open from before can reach here.
  if (row.capBasis === 'none' && row.parcelId) return t('tower.claims.noAwardWithoutCover');
  // FP3b — a load nobody was billed for: upholding it records that the sender was right and that the money is
  // between the parties. Any figure typed here would be a promise from books that do not exist.
  if (row.capBasis === 'none') return award.trim() && Number(award.trim()) > 0 ? t('tower.claims.freightNoAward') : null;
  const value = Number(award.trim());
  if (!award.trim() || !Number.isFinite(value) || value <= 0) return t('tower.claims.needAward');
  if (value > row.awardCap) return t('tower.claims.overCover', { max: amount(row.awardCap, row.currency) });
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
  /** The shop holding it, by name — resolved by the server, because a screen cannot name what it was not sent. */
  shopName?: string;
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
  requirements?: { androidVersion?: string | number; tradingLicence?: string; reliablePower?: boolean; criminalRecordClear?: boolean };
  openingHours?: Record<string, { open: string; close: string } | null | undefined>;
  kyc?: { idCopyRef?: string; tradingLicenceRef?: string; shopPhotoRefs?: string[] };
}

/**
 * The applicant's own answers to the franchise requirements, in one line for the reviewer: the phone, the power, the
 * hours and the declared record. Read beside the photographs, which are what staff actually check.
 */
export function answersLine(row: Pick<ApprovalRow, 'requirements' | 'openingHours'>, t: Translate): string {
  const r = row.requirements ?? {};
  const days = Object.values(row.openingHours ?? {}).filter((d): d is { open: string; close: string } => Boolean(d));
  const same = days.length > 0 && days.every((d) => d.open === days[0].open && d.close === days[0].close);
  const hours = !days.length ? t('tower.approvals.hoursNone') : same ? t('tower.approvals.hours', { from: days[0].open, to: days[0].close }) : t('tower.approvals.hoursVary');
  return [
    t('tower.approvals.android', { version: r.androidVersion ?? '—' }),
    t(r.reliablePower ? 'tower.approvals.powerYes' : 'tower.approvals.powerNo'),
    hours,
    t('tower.approvals.licence', { licence: r.tradingLicence || '—' }),
    t(r.criminalRecordClear ? 'tower.approvals.recordDeclared' : 'tower.approvals.recordNot'),
  ].join(' · ');
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

/* ----------------------------------------------------------- driver applications -- */

/**
 * A heavy-registry driver waiting to be vetted.
 *
 * `GET fleet/drivers/kyc-queue` had existed on the server all along with no console reading it, so a
 * driver who uploaded an ID and a licence copy waited in KYC_PENDING with no screen able to look at
 * either. The documents are the whole substance of the decision: what is being judged is whether this
 * person may legally drive, and that cannot be judged off a typed date.
 */
export interface DriverApplication {
  did: string;
  displayName: string;
  registry: string;
  jurisdiction?: string;
  criminalRecordClear: boolean;
  licence?: { number?: string; expiresAt?: string };
  /** The media ids the driver submitted. Whether bytes exist behind them is the media route's answer. */
  kyc?: { idCopyRef?: string; licenceCopyRef?: string; submittedAt?: string };
  /**
   * A driver in no fleet ASKING TO RIDE FOR THEMSELVES on something heavy: what they asked for, and their own two
   * photographs. Approving it makes them a courier with that vehicle; the record check is staff's own, every time.
   */
  courierAsk?: { country: string; vehicleClass: string; plate: string; truckSubtype?: string; idCopyRef: string; licenceCopyRef: string; askedAt: string };
}

/** The papers on a row: an ask's own photographs when it is an ask, else what was sent for vetting — the licence first. */
export function applicationPapers(row: Pick<DriverApplication, 'kyc' | 'courierAsk'>): string[] {
  const from = row.courierAsk ?? row.kyc;
  return [from?.licenceCopyRef, from?.idCopyRef].filter((x): x is string => Boolean(x));
}

/** Staff tick the record check on every ask: a fleet's word was for the fleet's driver, not the network's courier. */
export function needsRecordTick(row: Pick<DriverApplication, 'criminalRecordClear' | 'courierAsk'>): boolean {
  return !row.criminalRecordClear || Boolean(row.courierAsk);
}

/* ------------------------------------------------------------- stalled sign-ups -- */

/**
 * A shop that started joining and STOPPED. Not a queue row.
 *
 * The distinction is the whole point of this list: an application waits on US, and one of these waits
 * on THEM — for their own documents, or for their own first top-up. It exists because a network that
 * grows by shops joining cannot afford "signed up and went quiet" to be invisible, and it is counted
 * nowhere and badged nowhere, because nothing in it is waiting on network staff.
 */
export interface StalledRow {
  did: string;
  shopName: string;
  zone: string;
  status: string;
  /** When they registered. */
  since: string;
  reason: 'needs-documents' | 'needs-first-top-up' | 'was-rejected';
  /** Which documents are missing — empty for a shop that sent them all and never funded its float. */
  missing: string[];
  /** What we told them was wrong, on a shop we REJECTED rather than one that never sent anything. */
  rejectedWhy?: string;
  /** Whether the applicant has been told about the state they are in. False is the loose end: somebody
   *  is waiting on a message that was never sent. Absent on a server that predates the field. */
  told?: boolean;
}

/**
 * How long they have been stuck, in whole days.
 *
 * Rounded DOWN, so a shop that registered this morning reads as 0 rather than as 1. This number is the
 * argument for picking up a phone, and an argument must never be able to overstate its own case.
 */
export function stuckDays(since: string, now = Date.now()): number {
  const from = Date.parse(since);
  if (Number.isNaN(from)) return 0;
  return Math.max(0, Math.floor((now - from) / 86_400_000));
}

/** What to tell whoever answers: why they are stuck. */
export const STALLED_REASON: Record<StalledRow['reason'], MessageKey> = {
  'needs-documents': 'tower.stalled.reason.documents',
  'needs-first-top-up': 'tower.stalled.reason.topup',
  // A shop WE turned down is not a shop that never sent anything: what you say on the phone differs, and
  // only one of the two is our own doing. They read as one row until the rejection was recorded.
  'was-rejected': 'tower.stalled.reason.rejected',
};

/**
 * The three documents a draft shop can be short of, NAMED rather than counted.
 *
 * "2 missing" is a number somebody has to ring the shop to decode; "trading licence and photos" is the
 * sentence they were going to have to say anyway.
 */
export const STALLED_DOC: Record<string, MessageKey> = {
  id: 'tower.stalled.doc.id',
  licence: 'tower.stalled.doc.licence',
  photos: 'tower.stalled.doc.photos',
};

/**
 * What this shop still owes us, as a sentence somebody can read down a phone.
 *
 * "2 missing" is a number the caller has to ring the shop to decode; "an ID and photos of the shop" is
 * the thing they were going to have to say anyway. A document the server names and this console does
 * not is passed through as it arrived rather than dropped: an unknown word is fixable, a silent gap is
 * a shop told they are done when they are not.
 */
export function missingWords(missing: string[], t: Translate): string {
  return missing.map((m) => (STALLED_DOC[m] ? t(STALLED_DOC[m]) : m)).join(', ');
}

/**
 * "Stuck for" as words.
 *
 * A key PAIR for the plural, which is the house rule (`t()` does no pluralising). The console's other
 * day counts can never print a 1 — they only reach days past 48 hours — and this one starts at zero, so
 * it is the one place that has to say it properly.
 */
export function stuckLabel(days: number, t: Translate): string {
  if (days === 0) return t('tower.stalled.today');
  return days === 1 ? t('tower.stalled.daysOne', { count: days }) : t('tower.stalled.daysMany', { count: days });
}

/* ------------------------------------------------------------- damage claim reports -- */

/** One damage claim report, as the list reports it: made the moment a problem was reported, and decided by nobody. */
export interface DamageReportRow {
  parcelId: string;
  number: string;
  madeAt: string;
  origin: 'buyer' | 'counter';
  reason: string;
  from: string;
  to: string;
  store?: string;
  heldBy?: string;
  links: number;
  opened: number;
  /** Where it was emailed the moment it was made: the insurer the store names on its shipping policy. */
  insurer?: { insurer: string; sentTo: string; at: string };
  /** Notes the receiver added after handover, beside the report. */
  notes?: number;
}

/** A report's row in words: who reported it, where the parcel was, and whether it was handed on — emailed to the store's insurer, or by a link. */
export function reportRowWords(row: DamageReportRow, t: Translate): { by: string; hands: string; handedOn: string } {
  const links = row.links === 0 && row.opened === 0 ? t('tower.reports.noLink') : t('tower.reports.links', { links: row.links, opened: row.opened });
  return {
    by: t(row.origin === 'counter' ? 'tower.reports.byShop' : 'tower.reports.byReceiver'),
    hands: row.heldBy ? t('tower.reports.heldBy', { name: row.heldBy }) : t('tower.reports.handedOver'),
    handedOn: [row.insurer ? `${t('tower.reports.emailedTo', { insurer: row.insurer.insurer, address: row.insurer.sentTo })} ${links}` : links, row.notes ? t('tower.reports.notes', { count: row.notes }) : ''].filter(Boolean).join(' '),
  };
}
