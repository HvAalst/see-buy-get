import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * HOW ESTABLISHED THE NETWORK IS IN ONE COUNTRY — and what that permits.
 *
 * GLOS is only an operating system if other people's logistics run ON it, which means running in
 * countries where we hold no company, no account and no tax registration. The matching, the custody
 * chain and the proof do not need a bank; the money does. So presence is a PRIVILEGE LEVEL, the way an
 * operating system has them: one kernel everywhere, and privileged calls refused by name.
 *
 *   OBSERVED     we know the geography and nothing else. Nothing transacts.
 *   MATCHED      identity, routes, matching, custody, proof, measurement — and no money of ours at all.
 *                Prices are indicative; a quote here cannot be redeemed, because redeeming one is a
 *                promise to perform and to be paid.
 *   PARTNERED    a local carrier or forwarder is the contracting party and we are their software. Our
 *                ledger records what is OWED, never what is HELD.
 *   ESTABLISHED  a sister company exists: Merchant of Record, float, tax, claims, payouts.
 *
 * The point of running Matched is not charity and not a trial. Lock the ledger and keep the twin, and
 * the day a sister is registered we arrive with a year of measured leg times, earned reputations and
 * demand we counted rather than forecast.
 */
export const PRESENCE_LEVELS = ['observed', 'matched', 'partnered', 'established'] as const;
export type PresenceLevel = (typeof PRESENCE_LEVELS)[number];

/**
 * The capabilities a level grants, each one separately switchable.
 *
 * They are separate because they arrive on different days: a country can pay local suppliers long
 * before it collects tax, and collect tax long before anybody will underwrite a claim there. A single
 * flag would force the slowest of them to hold back the rest.
 */
export const PRESENCE_CAPABILITIES = ['merchantOfRecord', 'holdFloat', 'cashOnDelivery', 'claims', 'tax', 'payouts', 'takeIn', 'fieldEvidence'] as const;
export type PresenceCapability = (typeof PRESENCE_CAPABILITIES)[number];

export class PresenceCapabilities {
  /** May we contract with, and charge, a consumer here? Without it there is no redeemable quote. */
  @ApiProperty() merchantOfRecord: boolean;
  /** May a shop's prepaid float sit with us? Holding other people's money is the regulated part. */
  @ApiProperty() holdFloat: boolean;
  /** May cash we are answerable for pass across a counter? */
  @ApiProperty() cashOnDelivery: boolean;
  /** Is there a provision that can actually pay an award? Where there is not, cover is ZERO by
   *  construction — never "unset", and never a limit nobody can honour. */
  @ApiProperty() claims: boolean;
  /** Do we collect and remit here? */
  @ApiProperty() tax: boolean;
  /** May money leave to a local supplier, in local currency? */
  @ApiProperty() payouts: boolean;
  /** May a shop here take goods into custody at all — and under whose promise? See `TakeInPromise`. */
  @ApiProperty() takeIn: boolean;
  /**
   * CL5 — MAY WE HOLD A PHOTOGRAPH OF AN OFFICIAL DOCUMENT HERE?
   *
   * The only capability NO level grants. Every other one arrives with the level that earns it; this one
   * arrives only when somebody switches it on for a named country, which under CA2 is a proposal by one
   * person and an approval by a different one.
   *
   * The user settled the question this slice was blocked on: "cl5 is by default off because it's correct
   * that we cant just hold photographs of official documents." Quite so. A photograph of a customs entry
   * or an inspection notice may itself be a controlled record in the jurisdiction it came from, and being
   * ESTABLISHED in a country is no answer to that — it is a different question, asked of a lawyer, about
   * that country. So the default is off at established too, and nothing but a deliberate act turns it on.
   *
   * THIS IS THE FIRST OF TWO GATES. The second belongs to the person holding the camera, and neither
   * substitutes for the other — see FieldObservationService.
   */
  @ApiProperty() fieldEvidence: boolean;
}

/**
 * WHO ANSWERS FOR THESE GOODS — the thing the counter says out loud before accepting them.
 *
 *   ours    a sister is on the hook. The shopkeeper is our agent and the cover is our cover.
 *   theirs  a carrier-priced bilateral job: the shop acts as THAT CARRIER's agent, the carrier prices
 *           it, is paid for it and answers for it. We record custody and prove it — and say so.
 *   none    nobody can answer, so nothing may be taken in.
 *
 * The shape this exists to forbid is the third one built by accident: our brand on the counter, our
 * screens, our release codes, and no one behind the promise. A shopkeeper cannot consent to a risk the
 * screen never named.
 */
export const TAKE_IN_PROMISES = ['ours', 'theirs', 'none'] as const;
export type TakeInPromise = (typeof TAKE_IN_PROMISES)[number];

/** One country's standing, and who last changed it. */
/**
 * CL1 — WHICH TRADE TERMS THIS COUNTRY ALLOWS, held as two sets because the terms are not symmetric about a
 * border. EXW burdens the buyer with export clearance where the goods START; DDP burdens the seller with
 * import clearance where they END. One list would have to be true of both directions at once, so it would
 * be wrong in one of them.
 *
 * Both empty by default. A term is SELECTED from the catalogue of eleven, never invented, exactly as a
 * country is selected rather than created.
 */
export class IncotermSets {
  /** Permitted where this country is the ORIGIN of the load. */
  @ApiProperty({ type: [String] }) origin: string[];
  /** Permitted where this country is the DESTINATION. */
  @ApiProperty({ type: [String] }) destination: string[];
}

export class Presence {
  @ApiProperty() jurisdiction: string;
  @ApiProperty({ enum: PRESENCE_LEVELS }) level: PresenceLevel;
  /**
   * Capabilities held DOWN or lifted UP against the level's defaults — only the ones deliberately
   * overridden, so a level change still moves everything that was never argued about.
   */
  @ApiPropertyOptional() overrides?: Partial<Record<PresenceCapability, boolean>>;
  /** Why this was set. Kept because a country's standing is a decision, not configuration drift. */
  @ApiPropertyOptional() note?: string;
  @ApiPropertyOptional() setBy?: string;
  /** CA2 — the second person, on a change that raised the country. Absent on a lowering, which one person may make. */
  @ApiPropertyOptional() approvedBy?: string;
  @ApiProperty() setAt: string;
  /** CL1 — the trade terms switched on here, per direction. Absent means none, which is the default. */
  @ApiPropertyOptional({ type: IncotermSets }) incoterms?: { origin?: string[]; destination?: string[] };
}

/**
 * CA2 — TWO PEOPLE SWITCH A COUNTRY ON (user, 2026-09-13: "an important rule").
 *
 * A change that RAISES a country — any capability it would gain — is a proposal until a different named person
 * approves it. Until then nothing behaves differently. A proposal nobody decides expires, and the expiry is kept
 * like any other outcome. A lowering is applied at once by one person, recorded: refusing money is the safe
 * direction, and a lapsed licence must not wait for a second signature.
 */
export const PROPOSAL_STATUSES = ['pending', 'approved', 'declined', 'expired'] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export class PresenceProposal {
  @ApiProperty() proposalId: string;
  @ApiProperty() jurisdiction: string;
  /** CL1 — the terms this proposal would switch on, as words a second person can read. */
  @ApiPropertyOptional({ type: [String] }) termGains?: string[];
  /** CL1 — the full sets as proposed, applied verbatim on approval. */
  @ApiPropertyOptional({ type: IncotermSets }) incoterms?: { origin?: string[]; destination?: string[] };
  @ApiProperty({ enum: PRESENCE_LEVELS }) level: PresenceLevel;
  @ApiPropertyOptional() overrides?: Partial<Record<PresenceCapability, boolean>>;
  @ApiPropertyOptional() note?: string;
  /** What the country would be able to do that it cannot now — the reason this needs a second person. */
  @ApiProperty({ enum: PRESENCE_CAPABILITIES, isArray: true }) gains: PresenceCapability[];
  @ApiProperty() proposedBy: string;
  @ApiProperty() proposedAt: string;
  @ApiProperty() expiresAt: string;
  @ApiProperty({ enum: PROPOSAL_STATUSES }) status: ProposalStatus;
  @ApiPropertyOptional() decidedBy?: string;
  @ApiPropertyOptional() decidedAt?: string;
  /** Why it was declined. Required there, because a refusal nobody can read cannot be argued with. */
  @ApiPropertyOptional() reason?: string;
  /** On a listing, for whoever reads it: THEY proposed this one, so they are not the one to approve it. Never stored. */
  @ApiPropertyOptional() mine?: boolean;
}

/**
 * CA5 — A CAPABILITY SWITCHED OFF BY A LAPSED PAPER.
 *
 * A licence or policy is recorded with what it supports. The day after it expires, that capability is off in its
 * country, whatever the level grants — and the standing says which paper did it, so nobody has to guess why a
 * country stopped charging customers.
 */
export class CapabilityLapse {
  @ApiProperty({ enum: PRESENCE_CAPABILITIES }) capability: PresenceCapability;
  @ApiProperty() entityId: string;
  @ApiProperty({ enum: ['licence', 'insurance'] }) source: 'licence' | 'insurance';
  @ApiProperty() kind: string;
  /** The licence or policy number. */
  @ApiProperty() reference: string;
  /** The last day it was good for (YYYY-MM-DD). */
  @ApiProperty() expiredAt: string;
}

/** What a country's standing permits right now, level and overrides resolved together. */
export class ResolvedPresence {
  @ApiProperty() jurisdiction: string;
  @ApiProperty({ enum: PRESENCE_LEVELS }) level: PresenceLevel;
  @ApiProperty() capabilities: PresenceCapabilities;
  /** True where a transacting sister actually exists. Established cannot be claimed without one. */
  @ApiProperty() hasEntity: boolean;
  /** CA5 — capabilities switched off because a licence or policy lapsed, each naming the paper that did it. */
  @ApiProperty({ type: [CapabilityLapse] }) lapses: CapabilityLapse[];
  /** Whether this country was ever recorded, or is simply unknown — which resolves to `observed`. */
  @ApiProperty() recorded: boolean;
  /** CL1 — the trade terms allowed here, per direction. Always present, empty where none are switched on. */
  @ApiProperty({ type: IncotermSets }) incoterms: IncotermSets;
  @ApiPropertyOptional() note?: string;
  @ApiPropertyOptional() setBy?: string;
  /** CA2 — the second person who approved the change that raised this country. */
  @ApiPropertyOptional() approvedBy?: string;
  @ApiPropertyOptional() setAt?: string;
}

/**
 * What each level grants before anybody overrides anything.
 *
 * MATCHED grants `takeIn` and nothing else that touches money, which is the whole argument of this
 * design: goods can move and be proved to have moved without a single one of our shillings being
 * involved. What the take-in is PROMISED under is a separate question, answered per shipment.
 */
export const LEVEL_DEFAULTS: Record<PresenceLevel, PresenceCapabilities> = {
  observed: { merchantOfRecord: false, holdFloat: false, cashOnDelivery: false, claims: false, tax: false, payouts: false, takeIn: false, fieldEvidence: false },
  matched: { merchantOfRecord: false, holdFloat: false, cashOnDelivery: false, claims: false, tax: false, payouts: false, takeIn: true, fieldEvidence: false },
  // A partner contracts and pays; we still hold nothing ourselves, and a payout here is the partner's
  // to make. What changes from `matched` is that somebody local IS answerable.
  partnered: { merchantOfRecord: false, holdFloat: false, cashOnDelivery: false, claims: false, tax: false, payouts: false, takeIn: true, fieldEvidence: false },
  // NOT even here. Being established in a country answers whether we may transact in it. It does not
  // answer whether that country's law lets us keep a photograph of one of its documents.
  established: { merchantOfRecord: true, holdFloat: true, cashOnDelivery: true, claims: true, tax: true, payouts: true, takeIn: true, fieldEvidence: false },
};
