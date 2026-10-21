/**
 * Round 38 — A CUSTODY CAP FOR THE NEW AND THE INFORMAL (the user: "Count cap that grows"). A new shop holds at most so many
 * parcels at once, a new independent rider carries at most so many; each limit grows by one with every parcel handed on,
 * and lifts once so many have been. Each country's company sets the two numbers (EntityService.custodyCapsFor); a company
 * that has not set them caps nobody. A fleet's drivers are not capped here: the fleet was vetted, and answers for them.
 *
 * Identity is recurrence (next-work-informal-carrier-trust): the limit is earned by hand-overs completed, never bought
 * with money held back from the people least able to lend it.
 */

/** A company's cap for one kind of partner: what a new one holds or carries, and after how many hand-overs there is none. */
export interface CustodyCapRule {
  start: number;
  liftedAfter: number;
}

/** Where a capped partner stands: what they hold now, the most they may, and what lifts it. Absent where nothing caps them. */
export interface CustodyStanding {
  kind: 'shop' | 'rider';
  holds: number;
  cap: number;
  completed: number;
  liftedAfter: number;
  /** Round 39 — a light courier whose ID nobody has seen yet: held at the starting number, growing only once it is. */
  idUnseen?: boolean;
}

/** The most they may hold now: the start, one more for each hand-over completed — none at all once the cap is lifted. */
export function capNow(rule: CustodyCapRule, completed: number): number | undefined {
  if (completed >= rule.liftedAfter) return undefined;
  return rule.start + completed;
}

/** Where they stand, or nothing when no cap applies to them now. */
export function standingOf(kind: CustodyStanding['kind'], rule: CustodyCapRule | undefined, holds: number, completed: number): CustodyStanding | undefined {
  if (!rule) return undefined;
  const cap = capNow(rule, completed);
  return cap === undefined ? undefined : { kind, holds, cap, completed, liftedAfter: rule.liftedAfter };
}

/**
 * Round 39 — WHERE A RIDER STANDS WHOSE ID NOBODY HAS SEEN (the user: "Ride at once, smaller cap"): at the starting
 * number, whatever they have handed on — it neither grows nor lifts until a member of staff has seen a photo of their ID.
 */
export function unseenStanding(rule: CustodyCapRule | undefined, holds: number, completed: number): CustodyStanding | undefined {
  if (!rule) return undefined;
  return { kind: 'rider', holds, cap: rule.start, completed, liftedAfter: rule.liftedAfter, idUnseen: true };
}

/** The words of a refusal: how many they hold, the limit, and how it grows — so the person knows what to do. */
export function capWords(s: CustodyStanding, who: string): string {
  const verb = s.kind === 'shop' ? 'holds' : 'carries';
  const noun = s.kind === 'shop' ? 'shop' : 'independent rider';
  if (s.idUnseen) {
    return `${who} ${verb} ${s.holds} ${s.holds === 1 ? 'parcel' : 'parcels'}; a rider whose ID has not been seen yet carries at most ${s.cap} here. Send a photo of your ID card from the Driver app’s home screen: once SeeBuyGet has seen it, the limit grows with each parcel handed on.`;
  }
  return `${who} ${verb} ${s.holds} ${s.holds === 1 ? 'parcel' : 'parcels'}; a new ${noun} ${verb} at most ${s.cap} here for now. It grows by one with each parcel handed on (${s.completed} so far) and lifts after ${s.liftedAfter}.`;
}
