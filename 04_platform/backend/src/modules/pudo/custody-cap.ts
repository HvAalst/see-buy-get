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

/** The words of a refusal: how many they hold, the limit, and how it grows — so the person knows what to do. */
export function capWords(s: CustodyStanding, who: string): string {
  const verb = s.kind === 'shop' ? 'holds' : 'carries';
  const noun = s.kind === 'shop' ? 'shop' : 'independent rider';
  return `${who} ${verb} ${s.holds} ${s.holds === 1 ? 'parcel' : 'parcels'}; a new ${noun} ${verb} at most ${s.cap} here for now. It grows by one with each parcel handed on (${s.completed} so far) and lifts after ${s.liftedAfter}.`;
}
