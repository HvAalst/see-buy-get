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

export type EntityKind = 'group' | 'sister';

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
export interface ResolvedRates {
  costOfRiskPct: number;
  profitOnRiskPct: number;
  marginPct: number;
  /** What the customer's price is actually built with — the three, added. */
  totalPct: number;
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
  /** Sisters point at the group they belong to. */
  parentEntityId?: string;
  createdAt: string;
}

/** Only a sister may be named as the collector or performer on a transaction. */
export function canTransact(entity: Entity): boolean {
  return entity.kind === 'sister';
}

/** Only a sister may hold a settlement account. The group's isolation is exactly this. */
export function canHoldCustody(entity: Entity): boolean {
  return entity.kind === 'sister';
}
