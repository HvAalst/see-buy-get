/**
 * A FLAG IS A CASE (the user, 2026-10-18: "flags as cases").
 *
 * The automatic flags — a parcel stagnant at a shop, a ghost bus, a shop gone silent — were worked out afresh on every
 * read: no severity, nobody's, no history, and nothing happened when nobody acted. With dozens of shops nobody could tell
 * which stuck parcel somebody was already chasing. Now each flag opens a CASE that a member of staff takes, notes, and
 * closes with a reason; one nobody takes rises and is marked escalated; one whose condition goes away closes itself and
 * says so. Its history is kept, never rewritten.
 */

export const FLAG_KINDS = ['Stagnant_Inventory', 'Ghost_Bus', 'Stuck_At_MDP', 'Uncollected', 'Never_Dropped_Off', 'Connectivity_Loss', 'Blocked_Corridor', 'Buyer_Dispute', 'Short_Shipped', 'Temp_Breach', 'Not_Seen', 'Pilot_Off_Target', 'Tamper_Hold', 'Held_By_Authority'] as const;
export type FlagKind = (typeof FLAG_KINDS)[number];

export const CASE_SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;
export type CaseSeverity = (typeof CASE_SEVERITIES)[number];

/**
 * How bad each kind is. Critical: goods are at risk now (a cold chain broken, a bus nobody can account for). High: a
 * parcel or a lane is stuck and somebody will notice. Medium: a customer or a shop is waiting. Low: it costs money or a
 * shelf slot, slowly.
 */
export const CASE_SEVERITY: Record<FlagKind, CaseSeverity> = {
  Temp_Breach: 'critical',
  // Round 35 — a unit held under the tamper protocol: nobody takes it over until operations has looked. Escalates in 1 h.
  Tamper_Hold: 'critical',
  // A load held by the police, customs or another authority, as its driver said: somebody calls the driver. Clears itself
  // when the driver says it was let go.
  Held_By_Authority: 'critical',
  Ghost_Bus: 'critical',
  Short_Shipped: 'high',
  // A week with no scan: the search before a parcel is declared lost.
  Not_Seen: 'high',
  // A pilot number off target in the week just ended: "a name attached to it before lunch" — high escalates in 4 h.
  Pilot_Off_Target: 'high',
  Stuck_At_MDP: 'high',
  Blocked_Corridor: 'high',
  Buyer_Dispute: 'medium',
  Stagnant_Inventory: 'medium',
  Connectivity_Loss: 'medium',
  Uncollected: 'low',
  Never_Dropped_Off: 'low',
};

/**
 * Kinds whose case, once a person has closed it, never opens again for the same thing: what it is about cannot change.
 * A pilot number of a frozen week is that week's for ever; the next week's has a case of its own.
 */
export const CLOSED_FOR_GOOD: ReadonlySet<FlagKind> = new Set<FlagKind>(['Pilot_Off_Target']);

/**
 * Round 35 — kinds whose case closes only by the act it was opened for, done from it (a hold released, with its reason):
 * never put to rest while what it is about still stands, and never quieted afterwards — a new hold is a new case at once.
 */
export const CLOSED_BY_ITS_ACT: ReadonlySet<FlagKind> = new Set<FlagKind>(['Tamper_Hold']);

/** How long a case may wait for somebody to take it before it is escalated, by severity (hours). */
export const ESCALATE_AFTER_H: Record<CaseSeverity, number> = { critical: 1, high: 4, medium: 24, low: 72 };

/** The longest a case may be put to rest while its condition still holds (hours). */
export const MAX_RECHECK_H = 168;

export type CaseState = 'open' | 'taken' | 'done' | 'cleared';
/** Which cases a list shows: the live ones (open and taken), the taken ones, or the closed ones (done and cleared). */
export type CaseList = 'live' | 'taken' | 'closed';
export type CaseAct = 'opened' | 'opened_again' | 'taken' | 'let_go' | 'note' | 'escalated' | 'done' | 'cleared';

export class CaseEvent {
  at: string;
  act: CaseAct;
  /** Who, by name; absent for what the network did by itself (opened, escalated, cleared). */
  by?: string;
  /** The words: a note, the reason a case was put to rest, or what the flag said. */
  text?: string;
}

export class FlagCase {
  caseId: string;
  /** `kind:subject` — one live case per flag. */
  key: string;
  kind: FlagKind;
  /** What the flag is about: a parcel, a shop, a corridor, a load. */
  subject: string;
  /** What the flag says now, kept up to date while the case is live. */
  detail: string;
  severity: CaseSeverity;
  state: CaseState;
  openedAt: string;
  ageHours?: number;
  /** Who has it, while it is taken. */
  owner?: { name: string; key?: string };
  escalatedAt?: string;
  /** Put to rest with a reason until then: no new case for this flag before it, whatever the flag says. */
  quietUntil?: string;
  closedAt?: string;
  /** The case this one follows, when a flag that was put to rest was still there afterwards. */
  follows?: string;
  history: CaseEvent[];
}

/** One line of the cases list, as the console reads it. */
export class FlagCaseView extends FlagCase {
  /** Hours since it opened. */
  openHours: number;
}

/** How many cases of one kind: all of them, how many nobody has taken, and how many of those were escalated. */
export class FlagCaseKindCount {
  kind: FlagKind;
  severity: CaseSeverity;
  count: number;
  waiting: number;
  escalated: number;
}

/**
 * The cases list: at most a page of cases, the most pressing first, and the counts of ALL of them — how many there are
 * (of the kind asked for), how many live ones nobody has taken, and how many of each kind.
 */
export class FlagCaseList {
  items: FlagCaseView[];
  /** How many there are of what was asked for; more than items when the list was cut. */
  total: number;
  waiting: number;
  kinds: FlagCaseKindCount[];
}
