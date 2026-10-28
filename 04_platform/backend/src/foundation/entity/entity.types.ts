import type { CompanyRecord } from './company-record.types';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AMOUNT_KEYS, type AmountKey } from '../../modules/pudo/amount-keys';

/**
 * The legal entities the network is operated by — the structure the money model hangs on.
 *
 * A SISTER is a per-jurisdiction company acting as Merchant of Record there: it sells delivery to
 * customers, buys capacity from agents and drivers, holds the settlement account, and carries that
 * country's tax registration. The GROUP (the mother) owns the licence and the software, charges its
 * sisters a fee, and consolidates their books.
 *
 * The isolation rule, which the type deliberately makes visible: the group NEVER holds custody and is
 * never a counterparty on a customer transaction. If it were, an entity that is not registered in a
 * jurisdiction would become a party to transactions there — precisely the exposure that having separate
 * sisters exists to prevent, and one problem in one country would reach every other. Hence `currency`
 * and `jurisdiction` are optional here: a company that settles nothing needs neither.
 */

/**
 * CA7 — a partner is a local company that contracts where we are Partnered: recorded like ours, never a party to our books.
 *
 * B1 — a BUSINESS is a customer: a shipper, an importer, an expeditor, a clearing agent or a container yard. It signs
 * itself up, its people sign in with their own phone and PIN, and it is never a party to our books either. It used to be
 * recorded as a `partner`, which put a customer in the same drawer as the company that stands in for us in a country —
 * so an importer in Ethiopia made `partnerFor('ET')` answer with the importer.
 */
export type EntityKind = 'group' | 'sister' | 'partner' | 'business';

/** What a business says it does. Its own claim: it decides which screens it is shown, never what it is allowed. */
export const BUSINESS_ACTIVITIES = ['shipper', 'importer', 'expeditor', 'clearing_agent', 'depot', 'receiver'] as const;
export type BusinessActivity = (typeof BUSINESS_ACTIVITIES)[number];

/**
 * WHETHER SEEBUYGET HAS CHECKED WHO THIS IS — two members of staff, from its papers.
 *
 * `unverified` nobody has asked · `asked` the business asked and staff have not looked · `checking` one member of staff
 * approved and a second, different one has to · `verified` · `refused` with the reason, until the business asks again.
 */
export const VERIFICATION_STATES = ['unverified', 'asked', 'checking', 'verified', 'refused'] as const;
export type VerificationState = (typeof VERIFICATION_STATES)[number];

export interface BusinessVerification {
  state: VerificationState;
  askedAt?: string;
  askedBy?: string;
  /** The first member of staff to approve, by name and by the key their sessions answer to. */
  firstBy?: string;
  firstById?: string;
  firstAt?: string;
  verifiedBy?: string;
  verifiedAt?: string;
  refusedBy?: string;
  refusedAt?: string;
  reason?: string;
}

/** A business's own facts. Its name lives on the entity, like every company's. */
export interface BusinessProfile {
  activities: BusinessActivity[];
  /** Its number at the company registry of its country. What staff check the certificate against. */
  registrationNo: string;
  taxNo?: string;
  /** Where the business is, in its own words: the sender's address on its consignment notes (CMR Art. 6(1)(b)). */
  address?: string;
  createdBy: string;
  createdByPersonDid: string;
  verification: BusinessVerification;
}

/**
 * MAY THIS COMPANY BE SHOWN TO STRANGERS — given a public address, listed in a finder?
 *
 * A business names itself when it signs up, so until two people have checked its papers the name is only a claim. A
 * handle falls out of the name and is never taken back, so issuing one to an unchecked "FedEx" would hand the real one's
 * address to whoever typed it first.
 */
export function listedPublicly(entity: Entity): boolean {
  return entity.kind !== 'business' || entity.business?.verification.state === 'verified';
}

/**
 * What a sister charges on top of what a shipment COST it, in three layers it decides separately.
 *
 * The separation is the whole point, and it is a management-accounting one rather than a customer-facing
 * one — a buyer sees a price, a merchant sees one platform fee, and only we see this:
 *
 *  - COST OF RISK    what carrying the exposure actually costs — an insurance premium, or the provision
 *                    standing in for one. A cost, and it should track a real bill.
 *  - PROFIT ON RISK  what the sister earns for CHOOSING to carry it. This is where a specialised or
 *                    custom investment is paid back — a food-grade tanker, a flatbed with its own
 *                    forklift — and it is the pricing answer to the question the market series asks.
 *  - MARGIN          the general company layer, on everything.
 *
 * Blended into one number, none of these questions can be asked: a sister earning well cannot tell whether
 * it is because the market is good or because it is carrying risk nobody is paying for.
 *
 * ADDITIVE, never compounding. All three apply to the same cost base and are summed. Applied in sequence
 * 5 + 5 + 5 comes to 15.76%, and a knob whose effect an admin cannot predict is not a knob worth having.
 *
 * Every layer is optional and absent means ZERO, except margin, which falls back through `feePct` to the
 * network default — so a sister that has never touched any of this prices exactly as it did before.
 */
export interface RateStack {
  costOfRiskPct?: number;
  profitOnRiskPct?: number;
  marginPct?: number;
}

/** The resolved stack for one shipment: every layer stated, and their sum. */
export class ResolvedRates {
  costOfRiskPct: number;
  profitOnRiskPct: number;
  marginPct: number;
  /** What the customer's price is actually built with — the three, added. */
  totalPct: number;
}

/**
 * What a sister collects on top of its own price, on behalf of a tax authority.
 *
 * DELIBERATELY NOT A FOURTH LAYER OF `RateStack`, and the distinction is the whole reason this is a
 * separate type. Every layer of that stack is money the sister EARNS; this is money it never owns for a
 * moment. It is held, and it is handed over. Folding it in would put a liability through a revenue account
 * — which is the one thing `PAYABLE_TAX` was declared to prevent, and it would make every margin figure in
 * the business wrong by exactly the tax rate.
 *
 * It also sits at a different point in the arithmetic: the three layers are charged ON the cost base and
 * summed with each other; tax is charged on the sister's whole price INCLUDING those layers, because what
 * is taxed is the sale, not the profit.
 */
/**
 * WHAT A SHOP PAYS TO PUT MONEY IN — and the reasoning is the point, because the obvious alternative is
 * worse in a way that is hard to see.
 *
 * Moving money costs us: the provider takes a cut of every top-up, and that cut is largely PER PAYMENT
 * rather than per shilling. The tempting recovery is to bake it into the parcel price, where nobody has
 * to be told about it. That overcharges the shop that tops up 20,000 once a month in order to subsidise
 * the shop that tops up 500 eleven times, and it gives nobody any reason to do the cheaper thing. A
 * visible fee inverts both: the cost lands on the behaviour that causes it, and topping up sensibly is
 * rewarded in a way a shopkeeper can see and act on. (Decided 2026-08-18.)
 *
 * FLAT, NOT A PERCENTAGE, because what it recovers is a per-transaction cost. A percentage would charge
 * twice as much for a top-up that costs us the same to carry, which is a different fee wearing this one's
 * name.
 *
 * FREE ABOVE A THRESHOLD, which is what stops it being friction at the worst possible moment: a shop that
 * has run dry mid-morning and needs to scan again tops up properly once, free, rather than being charged
 * for being short. It is also what the airtime and mobile-money distributors around us already do, so it
 * is a shape a shopkeeper recognises.
 *
 * A SISTER'S KNOB, not a constant. What a payment costs in Nairobi is not what it costs in Addis, and a
 * number that has to be right everywhere is a number that is wrong nearly everywhere. Absent means NO
 * FEE — a charge nobody decided must never appear on a shopkeeper's screen.
 */
export class TopUpFeeRule {
  /**
   * Top up this much or more and it costs nothing. In the sister's own currency, like every other figure
   * it holds. Zero would make the fee unreachable, which is a confusing way to write "no fee" — leave the
   * whole rule off instead.
   */
  @ApiProperty()
  freeAbove: number;
  /** The flat charge below that threshold, in the same currency. */
  @ApiProperty()
  amount: number;
}

export interface TaxRule {
  /** As a fraction — 0.16 is sixteen percent. Zero is a real and complete answer, and it is the default. */
  ratePct: number;
  /**
   * What the authority calls it where this sister is registered — 'VAT', 'GST', 'IVA'.
   *
   * A receipt has to name the tax it charges, and the name is jurisdictional. The network cannot supply a
   * default that is true everywhere, so it supplies a neutral one and a sister that charges anything is
   * expected to say what it is charging.
   */
  label?: string;
}

/**
 * The tax that applies to one shipment, resolved.
 *
 * `registration` rides along because a receipt that charges tax must say who is collecting it. Absent
 * exactly when the rate is zero — a sister charging nothing is not required to identify itself as a
 * collector of anything, and `setTax` refuses a non-zero rate without one.
 */
export class ResolvedTax {
  ratePct: number;
  label: string;
  registration?: string;
}

/**
 * What this sister covers when it breaks something, and what it charges to cover more.
 *
 * Every carrier in the world works this way, and the reason is worth stating: a network that promises
 * unlimited liability on a parcel it never looked inside is promising something it cannot price. So there
 * is a limit that applies to everything for free, and above it the shipper says what the goods are worth
 * and pays for the difference.
 *
 * This is the piece that makes a damage award defensible. Until it existed the network's liability was
 * genuinely undefined — an adjudicator had a number to type and nothing to check it against.
 *
 * NOT part of the rate stack, and not tax. The stack's three layers are charged on the shipping cost; a
 * premium is charged on the value of somebody's GOODS, which is a different base entirely. And like the
 * cost-of-risk layer it accrues to the claims provision rather than to revenue — it is money collected
 * against a promise, not money earned for a service already performed.
 */
export interface InsuranceRule {
  /** Charged on the declared value ABOVE `freeLimit`, as a fraction. Zero means declaring is free, which
   *  is a legitimate market position and the default. */
  premiumPct?: number;
  /** Covered on every shipment without anybody declaring anything, in the sister's own currency. Zero
   *  means no cover at all unless it is bought — the honest default for a network that has never priced
   *  this, because a free limit invented here would be a promise nobody costed. */
  freeLimit?: number;
}

/** The cover that applies to one shipment, resolved. */
export class ResolvedInsurance {
  premiumPct: number;
  freeLimit: number;
}

/**
 * WHICH OF A CARRIER'S OWN PAPERS THIS SISTER REFUSES TO TRADE WITHOUT.
 *
 * A fleet's transport-operator licence and its goods-in-transit cover are recorded, dated and shown to
 * everybody whatever is set here. This decides only the CONSEQUENCE of one having lapsed: whether the
 * fleet may still be sold new work, or whether it is merely a red row somebody has to act on.
 *
 * ENFORCING NOTHING IS THE DEFAULT, and deliberately so. Every fleet already on the network was onboarded
 * without an expiry date, so a switch thrown for everyone would refuse data that was legal when it was
 * given and empty the board overnight. The sister turns it on when it has the dates to turn it on with.
 *
 * It is the SISTER'S call because the sister is the merchant of record where the fleet works: it carries
 * the regulatory exposure, and an operator licence is a real instrument in some jurisdictions and an
 * unverifiable formality in others. A fleet standing in a country with no sister (the presence ladder's
 * matched state) therefore enforces nothing, which is the honest answer — nobody is there to carry it.
 *
 * Kinds are PLAIN STRINGS because this is foundation and the paper taxonomy belongs to the pudo module,
 * exactly as `ratesByLane` holds a lane vocabulary it refuses to learn. The caller validates the keys.
 */
export interface CarrierPapersRule {
  /** Paper kinds (`operator_licence`, `carrier_insurance`). Empty or absent enforces none. */
  enforce?: string[];
}

/**
 * Round 38 — WHERE A SEAL IS REQUIRED, said by each country's company (the user: "Each country decides"): on loads taken over
 * in its country that cross a border, on container legs, or both. Absent requires none, which is where every company starts.
 */
export interface SealRulesRule {
  crossBorder?: boolean;
  containers?: boolean;
}

/** Round 38 — a count cap for one kind of new partner: what a new one holds or carries at once, and after how many hand-overs there is none. */
export class CustodyCap {
  start: number;
  liftedAfter: number;
}

/**
 * Round 38 — THE CUSTODY CAP for new shops and new independent riders, set by each country's company (the user: "Count cap
 * that grows"). Absent caps nobody, which is where every company starts.
 */
export class ResolvedCustodyCaps {
  @ApiPropertyOptional({ type: CustodyCap }) shop?: CustodyCap;
  @ApiPropertyOptional({ type: CustodyCap }) rider?: CustodyCap;
}

/** Where a sister requires a seal, resolved: both always said, false for a company that has not decided. */
export class ResolvedSealRules {
  crossBorder: boolean;
  containers: boolean;
}

/** What a sister enforces against its carriers, resolved. */
export class ResolvedCarrierPapers {
  @ApiProperty({ type: [String] }) enforce: string[];
}

/**
 * A person who administers a company, as stored. The salt and the hash never leave this file's module.
 */
export interface EntityAdmin {
  adminId: string;
  /** The login, lower-cased. One person, one company: administering two is two logins, deliberately —
   *  a single credential that reaches two companies is a credential neither company controls. */
  email: string;
  /** What the audit trail records. Established at creation, carried in the token, never self-asserted. */
  name: string;
  entityId: string;
  salt: string;
  hash: string;
  createdAt: string;
  lastSeenAt?: string;
  /** When this administrator last changed their password. */
  passwordChangedAt?: string;
  /** Revoked logins are KEPT: "who changed this rate in March" must stay answerable after they leave. */
  revokedAt?: string;
}

/** A person who works for the NETWORK (operator rights), with a login of their own. */
export interface OperatorAccount {
  operatorId: string;
  /** The login, lower-cased. */
  email: string;
  /** What every decision they make is recorded against. Set at creation, carried in the token. */
  name: string;
  /** Both EMPTY until the person has chosen a password by the link emailed to them: nothing signs in with an empty one. */
  salt: string;
  hash: string;
  /** The link to choose a password: the fingerprint of its token (never the token), and until when it works. */
  welcome?: { hash: string; sentAt: string; until: string };
  /** The setup key asked to take this sign-in away. Everybody on staff was told; a day later it can finish. */
  removal?: { askedAt: string };
  createdAt: string;
  /** Who asked for it — a member of staff's name — or the setup key, which made it alone. */
  createdBy: string;
  /** The second member of staff, who approved it. Absent on an account the setup key made. */
  approvedBy?: string;
  lastSeenAt?: string;
  passwordChangedAt?: string;
  /** Revoked logins are KEPT: a decision still needs the name of whoever made it. */
  revokedAt?: string;
  revokedBy?: string;
  /** The authenticator secret, sealed under the vault key. Present = two-step sign-in is on. */
  totpSecret?: string;
  totpEnabledAt?: string;
  /** The last time-step a code was accepted for — the same code never opens a second session. */
  totpLastStep?: number;
  /** A secret offered for setting up, waiting for its first code. Sealed. */
  totpPending?: { secret: string; at: string };
  totpMisses?: number;
  totpLockedUntil?: string;
  /** A reset one member of staff asked for; a second, different one completes it. */
  totpReset?: { by: string; byId: string; at: string };
  /** Round 38 — the roles this person holds (staff-roles.ts). Absent on an account from before roles: all four. */
  roles?: string[];
}

/** A staff account as the console reads it — no salt, no hash, ever. */
export class OperatorAccountView {
  operatorId: string;
  email: string;
  name: string;
  createdAt: string;
  /** Whether this account signs in with a code from an authenticator app as well as its password. */
  twoStep: boolean;
  /** Round 38 — the roles this person holds: support, vetting, money, admin. */
  @ApiProperty({ type: [String], enum: ['support', 'vetting', 'money', 'admin'] }) roles: string[];
  @ApiPropertyOptional()
  lastSeenAt?: string;
  @ApiPropertyOptional()
  passwordChangedAt?: string;
  @ApiPropertyOptional()
  revokedAt?: string;
  /** A reset of their two-step sign-in, asked for by this member of staff and waiting for a second. */
  @ApiPropertyOptional()
  twoStepResetAskedBy?: string;
  /** They have not chosen a password yet: until when the link emailed to them works (it may be past). */
  @ApiPropertyOptional()
  passwordLinkUntil?: string;
  /** The setup key asked to take this sign-in away: from when it can finish, unless a member of staff stops it. */
  @ApiPropertyOptional()
  removalFrom?: string;
}

/** A staff account just approved, or sent its link again: whether the email went. Never a password — there is none. */
export class StaffInvited extends OperatorAccountView {
  /** Whether the email with the link was handed over. When not, it is tried again; a new link can also be sent. */
  sent: boolean;
  /** IN A SANDBOX ONLY, where no email leaves: the link that was written, so the laptop can be walked through. */
  @ApiPropertyOptional()
  link?: string;
}

/**
 * A STAFF ACCOUNT ONE MEMBER OF STAFF ASKED FOR. It is not an account: no password exists and nobody can sign in
 * with it until a second, different member of staff approves. Kept after it is decided — who asked for an account
 * that was refused is worth knowing later.
 */
export interface StaffProposal {
  proposalId: string;
  /** The login asked for, lower-cased. */
  email: string;
  name: string;
  askedBy: string;
  /** Which ACCOUNT asked. Two people are told apart by this, never by their names. */
  askedById: string;
  askedAt: string;
  state: 'asked' | 'approved' | 'declined';
  decidedBy?: string;
  decidedAt?: string;
  /** Why it was declined. */
  reason?: string;
  /** The account it became — or, for a change of roles, the account whose roles change. */
  operatorId?: string;
  /** Round 38 — the roles asked for: the new account's, or the ones an existing account is to hold instead. */
  roles?: string[];
  /** Round 38 — `roles`: a change of an existing account's roles, not a new account. */
  kind?: 'roles';
}

/** A staff account that was asked for and waits for a second member of staff, as the console reads it. */
export class StaffProposalView {
  proposalId: string;
  email: string;
  name: string;
  askedBy: string;
  askedAt: string;
  /** When it stops waiting. Asked for again after that, it waits again. */
  until: string;
  /** Asked for by whoever is reading this: they can take it back, and cannot approve it. */
  mine: boolean;
  /** The one who asked is the only one able to sign in, so there is no second member of staff: the setup key approves. */
  forSetupKey: boolean;
  /** Round 38 — the roles asked for. */
  @ApiProperty({ type: [String], enum: ['support', 'vetting', 'money', 'admin'] }) roles: string[];
  /** Round 38 — 'roles': a change of an existing member of staff's roles, not a new account. */
  @ApiPropertyOptional({ enum: ['roles'] }) kind?: 'roles';
  /** Round 38 — a change of an existing member of staff's roles; their roles now, to read beside the ones asked for. */
  @ApiPropertyOptional({ type: [String], enum: ['support', 'vetting', 'money', 'admin'] }) rolesNow?: string[];
  /** Round 38 — a change of roles: whose. */
  @ApiPropertyOptional() operatorId?: string;
  /** Round 38 — a change of the reader's OWN roles: theirs to read, never to approve or decline. */
  @ApiPropertyOptional() aboutYou?: boolean;
}

/** Who can sign in as network staff, and who has been asked for. */
export class StaffAccountList {
  items: OperatorAccountView[];
  waiting: StaffProposalView[];
  /**
   * Said to the SETUP KEY outside a sandbox: this list, and setting staff up from it, is all it reaches. The console
   * shows that and nothing else, rather than a screen of refusals.
   */
  @ApiPropertyOptional()
  setupOnly?: boolean;
}

/** An administrator as anybody may read them — no salt, no hash, no password, ever. */
export class EntityAdminView {
  adminId: string;
  email: string;
  name: string;
  entityId: string;
  createdAt: string;
  @ApiPropertyOptional()
  lastSeenAt?: string;
  @ApiPropertyOptional()
  revokedAt?: string;
}

/**
 * ONE change to what a company charges, kept forever.
 *
 * The point of giving companies their own administrators is that a commercial decision has a person
 * behind it. That is only true if the decision is recorded with the person on it — otherwise the network
 * has simply widened who may change a price. Records the RESOLVED figures either side of the change
 * rather than the raw override, because "what does this lane charge now" is the question anybody reads
 * this to answer, and an override is only half of that answer.
 */
export class EntityChange {
  at: string;
  /** The name the token carried, or the DID when a machine did it. Never a string from a request body. */
  by: string;
  @ApiProperty({ enum: ['rates', 'tax', 'cover', 'fee', 'topUpFee', 'amounts', 'carrierPapers', 'sealRules', 'custodyCaps', 'created', 'record', 'activated', 'verification'] })
  what: 'rates' | 'tax' | 'cover' | 'fee' | 'topUpFee' | 'amounts' | 'carrierPapers' | 'sealRules' | 'custodyCaps' | 'created' | 'record' | 'activated' | 'verification';
  /** The lane it applies to; absent means the company's default for everything. */
  @ApiPropertyOptional()
  lane?: string;
  /** The resolved figures before and after, as a short readable line ("2.00% → 3.50%"). */
  from: string;
  to: string;
}

export class EntityChanges {
  entityId: string;
  @ApiProperty({ type: [EntityChange] })
  items: EntityChange[];
}

/**
 * Where a resolved number ACTUALLY came from.
 *
 * The screen that turns these knobs cannot be honest without this. Every one of them resolves through a
 * chain of fallbacks, so a lane showing 2% may be a rate somebody chose for that lane, a rate the sister
 * chose for everything, the single pre-layers number read as a margin, or the network's own default. They
 * look identical, and they behave completely differently when you edit them: clearing an inherited value
 * does nothing visible, and typing the value it already shows silently converts an inheritance into a
 * decision somebody now owns.
 */
export type RateOrigin = 'lane' | 'sister' | 'legacy-fee' | 'network';

/** Tax and cover resolve WHOLE rather than layer by layer, so their provenance is one answer, not three. */
export type RuleOrigin = 'lane' | 'sister' | 'none';

export class RateOrigins {
  @ApiProperty({ enum: ['lane', 'sister', 'legacy-fee', 'network'] })
  costOfRiskPct: RateOrigin;
  @ApiProperty({ enum: ['lane', 'sister', 'legacy-fee', 'network'] })
  profitOnRiskPct: RateOrigin;
  @ApiProperty({ enum: ['lane', 'sister', 'legacy-fee', 'network'] })
  marginPct: RateOrigin;
}

/** What one sister charges on one lane of work — every knob resolved, and where each answer came from. */
export class LanePricing {
  /** The lane this row is about; null is the sister's default for everything it does. */
  @ApiPropertyOptional()
  lane?: string;
  rates: ResolvedRates;
  rateOrigin: RateOrigins;
  tax: ResolvedTax;
  @ApiProperty({ enum: ['lane', 'sister', 'none'] })
  taxOrigin: RuleOrigin;
  insurance: ResolvedInsurance;
  @ApiProperty({ enum: ['lane', 'sister', 'none'] })
  insuranceOrigin: RuleOrigin;
}

/**
 * The bounds the SERVICE enforces, published so a form cannot invent its own.
 *
 * A client that validates money against numbers it holds privately is a client that will one day accept
 * what the server refuses, or refuse what the server would have taken — and the operator gets to find out
 * which after they press save.
 */
/**
 * One line of a company's list of amounts (modules/pudo/amounts.ts), as the screen that sets it reads it: the figure
 * in force, whether THIS company set it, and what every company starts from — so "not set" can be said as a number.
 */
export class CompanyAmount {
  @ApiProperty({ enum: AMOUNT_KEYS })
  key: AmountKey;
  /** The figure in force, in the company's own currency. */
  amount: number;
  /** Whether this company set it. False: it is the figure every company starts from. */
  own: boolean;
  /** What every company starts from. */
  startsAt: number;
}

export class PricingBounds {
  minRatePct: number;
  /** The ceiling on ONE layer, and on the three of them added together — they are the same number. */
  maxRatePct: number;
  minTaxPct: number;
  maxTaxPct: number;
  maxPremiumPct: number;
}

/**
 * Everything an operator needs in order to see and set what one sister charges.
 *
 * A read model rather than four endpoints per lane: the screen's whole job is comparing lanes against each
 * other and against the default they fall back to, and twelve round trips to draw one table is not a
 * screen. It also keeps the resolution — the part that decides real prices — on the server, where it is
 * tested, instead of being restated in a console.
 */
export class EntityPricing {
  entityId: string;
  name: string;
  @ApiProperty({ enum: ['group', 'sister', 'partner', 'business'] })
  kind: EntityKind;
  @ApiPropertyOptional()
  jurisdiction?: string;
  @ApiPropertyOptional()
  currency?: string;
  /**
   * Whether this entity may be a party to a transaction at all. The group may not — it is the merchant of
   * record nowhere — so its knobs are not editable, and the screen has to say why rather than fail on save.
   */
  transacting: boolean;
  /** The number this sister collects tax under. Sister-wide: a registration is not a per-lane fact. */
  @ApiPropertyOptional()
  taxRegistration?: string;
  /**
   * What this sister charges a shop or a store to put money in. Sister-wide, like the registration above
   * and for the same reason: a top-up is not a lane of work, so there is nothing for it to vary by.
   *
   * ABSENT MEANS NO FEE, and the console has to say so in those words rather than showing zeroes — a
   * threshold of 0 against a charge of 0 reads like a decision somebody made, and nobody made it.
   */
  @ApiPropertyOptional({ type: TopUpFeeRule })
  topUpFee?: TopUpFeeRule;
  /**
   * What a parcel costs and what each step pays here, every line of it, in this company's currency. Company-wide
   * like the top-up fee: a wage for shelving a parcel does not vary by lane of work.
   */
  @ApiProperty({ type: [CompanyAmount] })
  amounts: CompanyAmount[];
  /**
   * Which of a carrier's own papers this sister refuses to trade without. Sister-wide, like the top-up
   * fee: a transport licence is not a lane of work. Always present, and EMPTY for nearly everybody —
   * the console says "nothing enforced" in words, because an empty list is a decision that shows.
   */
  carrierPapers: ResolvedCarrierPapers;
  /** Round 38 — where this company requires a seal on loads taken over in its country. Company-wide; both false until decided. */
  sealRules: ResolvedSealRules;
  /** Round 38 — the custody cap for new shops and new independent riders here. Company-wide; absent caps nobody. */
  @ApiProperty({ type: ResolvedCustodyCaps }) custodyCaps: ResolvedCustodyCaps;
  /** The sister's default first, then one row per lane. */
  @ApiProperty({ type: [LanePricing] })
  lanes: LanePricing[];
  bounds: PricingBounds;
  /** The most recent changes to this company's terms, newest first. Empty until somebody turns a knob. */
  @ApiProperty({ type: [EntityChange] })
  recentChanges: EntityChange[];
  /** Whether the CALLER may change these, as opposed to only read them — see EntityService.mayAdminister. */
  editable: boolean;
}

export class Entity {
  entityId: string; // stable human key ('sbg', 'sbg-ke') — the domain handle
  did: string; // real GLOS DID, so an entity is a first-class actor like any other
  kind: EntityKind;
  name: string;
  /** ISO-3166-alpha-2. Required for a sister (it is what makes it the merchant of record there);
   *  absent on the group, whose country of incorporation nothing in the system depends on. */
  jurisdiction?: string;
  /** The currency this entity settles in, derived from its jurisdiction. A group has none: it holds
   *  no custody account, so there is no balance for a currency to describe. */
  currency?: string;
  /**
   * The margin this sister charges on top of provider costs, as a fraction (0.02 = 2%). A knob each
   * market turns for itself rather than a constant of the network — Nairobi and Amsterdam do not have to
   * price alike. Absent means "the network default"; read it through EntityService.feePctOf(), never
   * off the record, so a sister created before the knob existed still answers.
   *
   * SUPERSEDED BY `rates` and kept as its input: a sister that only ever set this one number is read as
   * having set that number as its MARGIN. It is not migrated on write, because a value that rewrites
   * itself the first time anything reads it makes the record's history unreadable.
   */
  feePct?: number;
  /**
   * What this sister charges, in the three layers a business actually decides separately.
   *
   * One blended percentage cannot answer "are we earning because the market is good, or because we are
   * carrying risk nobody is paying us for?" — and that is the question the knobs exist to answer.
   */
  rates?: RateStack;
  /**
   * Per-lane overrides, keyed by the CALLER'S vocabulary (today a CargoLane: pudo | mdp | dedicated).
   *
   * A plain string map because the lane taxonomy belongs to the pudo module and this is foundation — the
   * books must not learn what a parcel is in order to hold a number. The caller validates the key; this
   * only ever validates the rates.
   *
   * Absent lane → the sister's own `rates` → `feePct` as a margin → the network default. Four steps, each
   * one a real state some sister is in.
   */
  ratesByLane?: Record<string, RateStack>;
  /**
   * The registration this sister collects tax under — its VAT/TIN/GST number in its own country.
   *
   * Not the same thing as being incorporated there, which `jurisdiction` already says: a company can be
   * registered to trade and not registered to collect, and below a turnover threshold that is the normal
   * state. So this is separate, and absent means "not registered to collect" rather than "unknown".
   */
  taxRegistration?: string;
  /**
   * What this sister charges in tax on everything it sells. Absent means none — the network default, and
   * the state every sister is in until an operator deliberately says otherwise.
   */
  tax?: TaxRule;
  /**
   * What a shop or store pays this sister to put money in. Absent means nothing — see TopUpFeeRule for
   * why the cost is recovered here rather than folded into a parcel price. Read it through
   * `EntityService.topUpFeeFor()`, never off the record, so a sister created before the knob still answers.
   */
  topUpFee?: TopUpFeeRule;
  /**
   * What a parcel costs and what each step pays, where this company has set its own figure. A key that is absent
   * stands at what every company starts from. Read it through `EntityService.amountsFor()`, never off the record.
   */
  amounts?: Partial<Record<AmountKey, number>>;
  /**
   * Per-lane tax overrides, keyed by the caller's vocabulary exactly as `ratesByLane` is.
   *
   * Here for a reason narrower than it looks: tax rates vary by what is SUPPLIED, and lane is the only
   * supply-type axis this system has. A jurisdiction that zero-rates one kind of transport and standard-
   * rates another can express that; everyone else sets one rate and never touches this.
   */
  taxByLane?: Record<string, TaxRule>;
  /**
   * What this sister covers when it breaks something, and what it charges to cover more.
   *
   * Absent means the network default — no free cover and no premium charged, which is where every sister
   * starts. Read it through EntityService.insuranceFor(), never off the record.
   */
  insurance?: InsuranceRule;
  insuranceByLane?: Record<string, InsuranceRule>;
  /**
   * Which of a CARRIER'S own papers this sister will not trade without. Absent enforces nothing, which
   * is where every sister starts. Read it through EntityService.carrierPapersFor(), never off the record.
   */
  carrierPapers?: CarrierPapersRule;
  /** Round 38 — where a seal is required on loads taken over here. Read it through EntityService.sealRulesFor(), never off the record. */
  sealRules?: SealRulesRule;
  /** Round 38 — the custody cap for new shops and new independent riders. Read it through EntityService.custodyCapsFor(). */
  custodyCaps?: { shop?: CustodyCap; rider?: CustodyCap };
  /** Sisters point at the group they belong to. */
  parentEntityId?: string;
  /**
   * CA3 — a company created from the console starts as a DRAFT: recorded, documented, and able to do nothing at all
   * until its record is ready and two people approve the country up to it. Absent means active (the seeds).
   */
  status?: 'draft' | 'active';
  /** CA3 — the legal record: form, registration, representatives, owners, tax numbers, bank, licences, insurance. */
  record?: CompanyRecord;
  /** B1 — present exactly when `kind` is `business`. */
  business?: BusinessProfile;
  createdAt: string;
}

/** Only a sister may be named as the collector or performer on a transaction. */
export function canTransact(entity: Entity): boolean {
  return entity.kind === 'sister' && entity.status !== 'draft';
}

/** Only a sister may hold a settlement account. The group's isolation is exactly this. */
export function canHoldCustody(entity: Entity): boolean {
  return entity.kind === 'sister' && entity.status !== 'draft';
}
