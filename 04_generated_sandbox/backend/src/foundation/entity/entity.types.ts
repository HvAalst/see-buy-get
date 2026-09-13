import type { CompanyRecord } from './company-record.types';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

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

/** CA7 — a partner is a local company that contracts where we are Partnered: recorded like ours, never a party to our books. */
export type EntityKind = 'group' | 'sister' | 'partner';

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
  /** Revoked logins are KEPT: "who changed this rate in March" must stay answerable after they leave. */
  revokedAt?: string;
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
  @ApiProperty({ enum: ['rates', 'tax', 'cover', 'fee', 'created', 'record', 'activated'] })
  what: 'rates' | 'tax' | 'cover' | 'fee' | 'created' | 'record' | 'activated';
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
  @ApiProperty({ enum: ['group', 'sister', 'partner'] })
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
  /** Sisters point at the group they belong to. */
  parentEntityId?: string;
  /**
   * CA3 — a company created from the console starts as a DRAFT: recorded, documented, and able to do nothing at all
   * until its record is ready and two people approve the country up to it. Absent means active (the seeds).
   */
  status?: 'draft' | 'active';
  /** CA3 — the legal record: form, registration, representatives, owners, tax numbers, bank, licences, insurance. */
  record?: CompanyRecord;
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
