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
   */
  feePct?: number;
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
