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
export const PRESENCE_CAPABILITIES = ['merchantOfRecord', 'holdFloat', 'cashOnDelivery', 'claims', 'tax', 'payouts', 'takeIn'] as const;
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
  @ApiProperty() setAt: string;
}

/** What a country's standing permits right now, level and overrides resolved together. */
export class ResolvedPresence {
  @ApiProperty() jurisdiction: string;
  @ApiProperty({ enum: PRESENCE_LEVELS }) level: PresenceLevel;
  @ApiProperty() capabilities: PresenceCapabilities;
  /** True where a transacting sister actually exists. Established cannot be claimed without one. */
  @ApiProperty() hasEntity: boolean;
  /** Whether this country was ever recorded, or is simply unknown — which resolves to `observed`. */
  @ApiProperty() recorded: boolean;
  @ApiPropertyOptional() note?: string;
  @ApiPropertyOptional() setBy?: string;
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
  observed: { merchantOfRecord: false, holdFloat: false, cashOnDelivery: false, claims: false, tax: false, payouts: false, takeIn: false },
  matched: { merchantOfRecord: false, holdFloat: false, cashOnDelivery: false, claims: false, tax: false, payouts: false, takeIn: true },
  // A partner contracts and pays; we still hold nothing ourselves, and a payout here is the partner's
  // to make. What changes from `matched` is that somebody local IS answerable.
  partnered: { merchantOfRecord: false, holdFloat: false, cashOnDelivery: false, claims: false, tax: false, payouts: false, takeIn: true },
  established: { merchantOfRecord: true, holdFloat: true, cashOnDelivery: true, claims: true, tax: true, payouts: true, takeIn: true },
};
