/**
 * ADDRESSED TO A NUMBER, KEPT BY AN ACCOUNT.
 *
 * A parcel, a diverted order and an invitation into a business are each addressed to a phone number: it is what the
 * sender, the store or the owner knew the person by. While a number stays with one person that is the same as
 * addressing the person. It stops being the same on the day an account moves to another number and the old one is
 * freed for whoever has it next: anything found by "the number it was addressed to is the number you sign in with"
 * then leaves the account it belonged to, and a day later turns up in a stranger's — a parcel with its collection
 * code beside it.
 *
 * So each of them has, beside the number, THE ACCOUNT IT BELONGS TO, from the moment one is certain:
 *
 *   - when it is made, if an account is settled on that number (`PersonService.settledAt`);
 *   - when an account moves off a number: whatever is still addressed to that number alone goes with the account
 *     (`PersonService.onNumberLeft`).
 *
 * And each is read by the one rule below: the account it belongs to and nobody else; until there is one, whoever
 * signs in with the number — which is how a parcel waits for somebody who has not signed up yet.
 *
 * WHERE THE ACCOUNT IS KEPT matters as much as the rule. A parcel is handed back whole to the shop that takes it in,
 * and a load goes whole to every driver who lists the board: an account's id ON either would tell a shop, for any
 * number it cares to type, whether that number has an account. So the parcel service and the order service keep it
 * beside their records (`receiverOf`, `senderOf`, `buyerOf`) and hand out only this pair, to code — never on a view.
 *
 * Four things are addressed to a number today: a parcel (each side), a store's order that went as freight, an
 * unanswered invitation into a business, and an ID dispute (whoever opened it).
 */
export interface Addressed {
  /** The peppered hash of the number it was addressed to. Never the number. */
  hash?: string;
  /** The account it belongs to, once one is certain. */
  owner?: string;
}

/** Somebody reading: their account, and the number they sign in with today. Without an account, the number alone. */
export interface Reader {
  phoneHash: string;
  personDid?: string;
}

/** Whether it is this reader's. An account's is its own whatever number is asked with; a number's is the number's. */
export function isFor(a: Addressed, who: Reader | undefined): boolean {
  if (!who) return false;
  if (a.owner) return a.owner === who.personDid;
  return Boolean(a.hash) && a.hash === who.phoneHash;
}

/** The account to tell about it, where there is one: the one it belongs to, else the one on that number today. */
export function accountFor<P>(a: Addressed, persons: { findByDid(did: string): P | undefined; findByHash(hash: string): P | undefined }): P | undefined {
  if (a.owner) return persons.findByDid(a.owner);
  return a.hash ? persons.findByHash(a.hash) : undefined;
}

/** Still addressed to that number and to no account: what an account moving off the number takes with it. */
export function waitsAt(a: Addressed, hash: string): boolean {
  return !a.owner && Boolean(hash) && a.hash === hash;
}

/** A reader known by a number alone, as the hand-built callers and the specs before accounts existed still ask. */
export function readerOf(who: Reader | string): Reader {
  return typeof who === 'string' ? { phoneHash: who } : who;
}
