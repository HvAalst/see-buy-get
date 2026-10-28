/**
 * THE BOX ITSELF — its number, and the clock that runs on it. Pure functions, no state.
 *
 * CL7 taught the system what KIND of box a consignment is in (`container-type.ts`). This file is about the
 * other half of ISO 6346 and the consequence nobody had modelled: a container is **a shipping line's
 * property, on loan**, and the road leg we mint out of the terminal gate is what starts a clock on it.
 *
 * TWO THINGS LIVE HERE, and both are arithmetic rather than judgement:
 *
 *  1. THE CHECK DIGIT. `MSCU 123456 6` carries a mod-11 digit precisely so that a mistyped number is
 *     detectable. We accepted anything, and a wrong number is a box nobody can trace, a clock nobody can
 *     stop and a dispute nobody can settle. Same discipline as a UN number's shape: we check the
 *     arithmetic and never the choice — that the box EXISTS is the line's business, not ours.
 *
 *  2. THE CLOCK, SAID IN DATES AND NEVER IN MONEY. We do not compute somebody else's charge: the rate is
 *     in a contract we have never seen, the penalty lands on the importer, and a figure we invented would
 *     be relied on. So there is no rate, no currency and no amount anywhere in this file — only dates,
 *     whole days, and who said what.
 *
 * TWO CLOCKS, AND CONFUSING THEM WOULD PRODUCE A NUMBER NOBODY CAN ACT ON. **Demurrage** runs while the
 * box sits INSIDE the terminal unclaimed; **detention** runs while it is OUTSIDE and not yet returned.
 * Different parties can be at fault for each, so both are named or neither is.
 *
 * AND THREE ENDINGS, WHICH IS THE USER'S CORRECTION AND THE REASON THIS IS NOT A COUNTDOWN WITH ONE EXIT:
 *
 *   > "In the real world containers are demanded objects and are very often sold in the market and are
 *   > never returned."
 *
 * So `returned`, `bought` and `out` are the three, the clock stops on a RECORDED FACT, and a box that was
 * bought is never overdue. Never on a dismissal either: an alarm a person can wave away teaches them to
 * wave away the next one, and the next one is the detention bill this exists to prevent.
 */

const DAY_MS = 86_400_000;

/**
 * ISO 6346's letter values. The gaps are the whole trick: 11, 22 and 33 are skipped, because a value that
 * is a multiple of the modulus cannot be distinguished from zero and the check would miss a whole class of
 * single-letter typo.
 */
const LETTER_VALUES: Record<string, number> = {
  A: 10, B: 12, C: 13, D: 14, E: 15, F: 16, G: 17, H: 18, I: 19, J: 20,
  K: 21, L: 23, M: 24, N: 25, O: 26, P: 27, Q: 28, R: 29, S: 30, T: 31,
  U: 32, V: 34, W: 35, X: 36, Y: 37, Z: 38,
};

/**
 * The fourth letter is the equipment category, and the standard names three.
 *
 * `U` is a freight container, which is all we will see; `J` is detachable equipment belonging to one, and
 * `Z` is a trailer or chassis. Anything else is a typo in the one position where a typo is silent — an
 * owner code reads as plausible whatever its fourth letter is.
 */
const CATEGORIES: Record<string, string> = {
  U: 'freight container',
  J: 'detachable equipment',
  Z: 'trailer or chassis',
};

/** Strip the spaces and hyphens people type, and shout it, so one box is one key. */
export function normaliseContainerNo(raw: string): string {
  return String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * The mod-11 check digit for the first ten characters — four letters and six digits.
 *
 * Each character's value is multiplied by 2^position and the sum taken modulo 11. A remainder of 10 is
 * written as 0, which is the one part of the rule people get wrong and the reason this is a function
 * rather than four lines inlined at the call site.
 */
export function checkDigitFor(first10: string): number | undefined {
  const s = normaliseContainerNo(first10);
  if (!/^[A-Z]{4}[0-9]{6}$/.test(s)) return undefined;
  let sum = 0;
  for (let i = 0; i < 10; i += 1) {
    const ch = s[i];
    const value = i < 4 ? LETTER_VALUES[ch] : Number(ch);
    sum += value * 2 ** i;
  }
  return sum % 11 % 10;
}

export interface ContainerNoParse {
  /** The number as it should be written, normalised. Present even when the check digit is wrong. */
  containerNo: string;
  ownerCode?: string;
  /** What the fourth letter says this is: a freight container, detachable equipment, a chassis. */
  category?: string;
  serial?: string;
  /** The digit as typed. */
  check?: number;
  /** The digit the arithmetic says it should be. Differs from `check` exactly when something was mistyped. */
  expected?: number;
  ok: boolean;
  /** Why not, in the words the person who typed it needs. Absent when ok. */
  why?: string;
}

/**
 * Read a container number, and say what is wrong with it rather than whether it "looks valid".
 *
 * The shape and the check digit are two different failures with two different fixes, so they get two
 * different sentences: a number of the wrong length is a different mistake from a number of the right
 * length with one character wrong, and the second is the one the check digit exists to catch.
 */
export function parseContainerNo(raw: string): ContainerNoParse {
  const containerNo = normaliseContainerNo(raw);
  if (!containerNo) return { containerNo, ok: false, why: 'A container number is four letters, six digits and a check digit — MSCU1234566.' };
  if (!/^[A-Z]{4}[0-9]{7}$/.test(containerNo)) {
    return {
      containerNo,
      ok: false,
      why: `“${containerNo}” is not the shape of a container number: four letters, six digits, then one check digit — MSCU1234566.`,
    };
  }
  const ownerCode = containerNo.slice(0, 4);
  const serial = containerNo.slice(4, 10);
  const check = Number(containerNo[10]);
  const expected = checkDigitFor(containerNo.slice(0, 10))!;
  const category = CATEGORIES[ownerCode[3]];
  if (!category) {
    return {
      containerNo, ownerCode, serial, check, expected, ok: false,
      why: `The fourth letter of an owner code says what the equipment is — U for a container, J for detachable gear, Z for a chassis. “${ownerCode[3]}” is none of them, so check ${ownerCode}.`,
    };
  }
  if (check !== expected) {
    return {
      containerNo, ownerCode, category, serial, check, expected, ok: false,
      why: `The check digit does not add up: ${ownerCode} ${serial} checks to ${expected}, not ${check}. One character is mistyped — a number nobody can trace is a clock nobody can stop.`,
    };
  }
  return { containerNo, ownerCode, category, serial, check, expected, ok: true };
}

/* ------------------------------------------------------------------- the clock -- */

/** How a spell out of the terminal ends. `out` is not an ending; it is the absence of one. */
export const BOX_ENDINGS = ['returned', 'bought'] as const;
export type BoxEnding = (typeof BOX_ENDINGS)[number];

export const FREE_DAY_KINDS = ['demurrage', 'detention'] as const;
export type FreeDayKind = (typeof FREE_DAY_KINDS)[number];

/**
 * How many free days somebody says this box has — A CLAIM, never a finding.
 *
 * It comes from a contract between the importer and the line that we have never seen and will never see.
 * Carried, attributed and dated in the manner of an agent's advertisement, and the countdown that uses it
 * says whose number it is. Every claim is kept: a corrected figure is a second claim, not an edit.
 */
export interface FreeDaysClaim {
  kind: FreeDayKind;
  days: number;
  /** The company whose claim it is. */
  byEntityId: string;
  /** The person, by name, because a number with nobody's name on it gets treated as ours. */
  by: string;
  at: string;
}

export interface BoxTimes {
  /** When it landed at the terminal. RECORDED by a person — nothing tells us, and we do not guess. */
  arrivedAt?: string;
  /** When it left the terminal gate. DERIVED from the road leg's pickup, which is the event we already own. */
  outGatedAt?: string;
  ending?: { kind: BoxEnding; at: string; by: string; where?: string; note?: string };
  freeDays: FreeDaysClaim[];
}

export interface BoxClock {
  /** What is actually running. `stopped` has an ending; `unknown` has neither an arrival nor an out-gate. */
  kind: 'demurrage' | 'detention' | 'stopped' | 'unknown';
  /** What the running clock counts from. */
  since?: string;
  /** Whole days, floored. A part-day is not a day anybody is charged for and not a day we will invent. */
  daysElapsed?: number;
  /** The claim in force for the clock that is running, and whose it is. */
  freeDays?: number;
  freeDaysBy?: string;
  freeDaysAt?: string;
  /** DERIVED, never stored: a stored due-date goes stale in silence the moment the claim is corrected. */
  dueBackAt?: string;
  daysLeft?: number;
  overdue: boolean;
  /** How long it stood inside the terminal before the gate, where both dates are known. Closed, not running. */
  demurrageDays?: number;
  /** One sentence naming what is counted and whose numbers these are. The screen shows it verbatim. */
  basis: string;
}

const day = (iso: string) => new Date(iso).toISOString().slice(0, 10);
const elapsed = (fromIso: string, now: number) => Math.max(0, Math.floor((now - Date.parse(fromIso)) / DAY_MS));
const plusDays = (fromIso: string, days: number) => new Date(Date.parse(fromIso) + days * DAY_MS).toISOString();

/** The latest claim of a kind. Corrections arrive as new claims, so "latest" is the live one. */
function claimOf(times: Pick<BoxTimes, 'freeDays'>, kind: FreeDayKind): FreeDaysClaim | undefined {
  return times.freeDays
    .filter((c) => c.kind === kind)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    .pop();
}

/**
 * What the box's clock says right now — derived on every read, and it is the whole of Y1.
 *
 * THE ORDER OF THE BRANCHES IS THE DESIGN. An ending beats everything, because a box that has been
 * returned or bought cannot be late; the gate beats the arrival, because detention supersedes demurrage
 * the moment the box leaves; and the absence of a free-days claim produces no date at all rather than a
 * zero. A countdown to a date nobody gave us would be exactly the invented figure §3 of the design note
 * refuses.
 */
export function boxClock(times: BoxTimes, now: number): BoxClock {
  const demurrageDays = times.arrivedAt && times.outGatedAt ? elapsed(times.arrivedAt, Date.parse(times.outGatedAt)) : undefined;
  const stood = demurrageDays != null ? ` It stood ${demurrageDays} day${demurrageDays === 1 ? '' : 's'} inside the terminal before the gate.` : '';

  if (times.ending) {
    const from = times.outGatedAt ?? times.arrivedAt;
    const held = from ? elapsed(from, Date.parse(times.ending.at)) : undefined;
    if (times.ending.kind === 'bought') {
      return {
        kind: 'stopped',
        overdue: false,
        ...(demurrageDays != null ? { demurrageDays } : {}),
        basis: `Bought out of the line's fleet on ${day(times.ending.at)}, recorded by ${times.ending.by}. No return is owed and no clock runs — containers are traded goods, and this one was sold.`,
      };
    }
    return {
      kind: 'stopped',
      overdue: false,
      ...(demurrageDays != null ? { demurrageDays } : {}),
      basis: `Returned ${times.ending.where ? `to ${times.ending.where} ` : ''}on ${day(times.ending.at)}, recorded by ${times.ending.by}${held != null ? `, ${held} day${held === 1 ? '' : 's'} after it left the terminal` : ''}.${stood}`,
    };
  }

  const running: FreeDayKind | undefined = times.outGatedAt ? 'detention' : times.arrivedAt ? 'demurrage' : undefined;
  if (!running) {
    return {
      kind: 'unknown',
      overdue: false,
      basis: 'No clock is running: nobody has recorded this box arriving, and its road leg has not been picked up. The gate is what starts detention, and we do not guess at an arrival nobody reported.',
    };
  }

  const since = (running === 'detention' ? times.outGatedAt : times.arrivedAt)!;
  const daysElapsed = elapsed(since, now);
  const claim = claimOf(times, running);
  const where = running === 'detention' ? 'outside the terminal' : 'inside the terminal';
  const which = running === 'detention' ? 'Detention' : 'Demurrage';

  if (!claim) {
    return {
      kind: running,
      since,
      daysElapsed,
      overdue: false,
      ...(demurrageDays != null ? { demurrageDays } : {}),
      basis: `${which} has been running since ${day(since)} — ${daysElapsed} day${daysElapsed === 1 ? '' : 's'} ${where}. Nobody has said how many free days it was given, so there is no date to count to: the free days are in a contract with the line, and only the importer can tell us the figure.${stood}`,
    };
  }

  const dueBackAt = plusDays(since, claim.days);
  const daysLeft = claim.days - daysElapsed;
  return {
    kind: running,
    since,
    daysElapsed,
    freeDays: claim.days,
    freeDaysBy: claim.by,
    freeDaysAt: claim.at,
    dueBackAt,
    daysLeft,
    overdue: daysLeft < 0,
    ...(demurrageDays != null ? { demurrageDays } : {}),
    basis:
      daysLeft < 0
        ? `${which} ran out on ${day(dueBackAt)}: day ${daysElapsed} of ${claim.days} free days, ${-daysLeft} over. The ${claim.days} figure is ${claim.by}'s, from their contract with the line — we carry it and count, and what it costs is between them.${stood}`
        : `${which} since ${day(since)}: day ${daysElapsed} of the ${claim.days} free days ${claim.by} says it was given, due back ${day(dueBackAt)}. That figure is theirs, from a contract we have not seen.${stood}`,
  };
}

/* ------------------------------------------------------- the clock on an export -- */

/**
 * THE SAME BOX, THE OTHER WAY ROUND (the user, 2026-10-28: "1 and 2 are clear addition to what you built here").
 *
 * On an import the box lands inside the terminal first and leaves it second; on an export it leaves the line's
 * depot EMPTY first and enters the terminal LADEN second. So the two clocks run in the opposite order:
 *
 *   - **detention** from the empty out of the depot until the laden box is inside the terminal's gate — the box
 *     is outside, on loan to the exporter;
 *   - **demurrage** from that gate-in until it is loaded on board — the box waits inside the terminal.
 *
 * The rules are the import's and for the same reasons: dates and whole days, never money; the free days are a
 * CLAIM with a name on it (the exporter's, from its agreement with the line or its forwarder) and the latest
 * claim is the live one; no claim means no date at all, never a zero. Loading on board ends it — a RECORDED
 * fact, never a dismissal.
 */
export interface ExportBoxTimes {
  /** The empty left the depot: the empty load's pickup, or — when no load of ours fetched it — what the exporter recorded. */
  emptyOutAt?: string;
  /** The laden box inside the terminal's gate: the load to the terminal's delivery. */
  gatedInAt?: string;
  /** Loaded on board, as the exporter recorded it from its forwarder's or the line's word. */
  loaded?: { at: string; by: string };
  freeDays: FreeDaysClaim[];
}

export interface ExportBoxClock {
  /** What is running: `detention` outside, `demurrage` inside, `stopped` once loaded, `unknown` before the empty is out. */
  kind: 'detention' | 'demurrage' | 'stopped' | 'unknown';
  since?: string;
  daysElapsed?: number;
  freeDays?: number;
  freeDaysBy?: string;
  freeDaysAt?: string;
  /** DERIVED: since + the free days of the claim in force. Never stored, so a corrected claim moves it at once. */
  dueAt?: string;
  daysLeft?: number;
  overdue: boolean;
  /** Closed: the whole days it was outside, empty out to gate-in, once both are known. */
  detentionDays?: number;
  /** Closed: the whole days it waited inside, gate-in to loading, once loaded. */
  demurrageDays?: number;
  /** One sentence naming what is counted and whose figure it is — the handover file prints it. */
  basis: string;
}

export function exportBoxClock(times: ExportBoxTimes, now: number): ExportBoxClock {
  const detentionDays = times.emptyOutAt && times.gatedInAt ? elapsed(times.emptyOutAt, Date.parse(times.gatedInAt)) : undefined;
  const days = (n: number) => `${n} day${n === 1 ? '' : 's'}`;
  const outside = detentionDays != null ? ` It was ${days(detentionDays)} outside the terminal, from the empty out to the gate.` : '';

  if (times.loaded && times.gatedInAt) {
    const demurrageDays = elapsed(times.gatedInAt, Date.parse(times.loaded.at));
    return {
      kind: 'stopped',
      overdue: false,
      ...(detentionDays != null ? { detentionDays } : {}),
      demurrageDays,
      basis: `Loaded on board on ${day(times.loaded.at)}, recorded by ${times.loaded.by}: the box is the line's again and no clock runs.${outside} It waited ${days(demurrageDays)} inside the terminal.`,
    };
  }

  const running: FreeDayKind | undefined = times.gatedInAt ? 'demurrage' : times.emptyOutAt ? 'detention' : undefined;
  if (!running) {
    return {
      kind: 'unknown',
      overdue: false,
      basis: 'No clock runs on the box yet: as far as anyone has recorded, the empty has not left the depot. Its leaving is what starts detention, and we do not guess at it.',
    };
  }

  const since = (running === 'demurrage' ? times.gatedInAt : times.emptyOutAt)!;
  const daysElapsed = elapsed(since, now);
  const claim = claimOf({ freeDays: times.freeDays }, running);
  const which = running === 'detention' ? 'Detention (the box outside the terminal)' : 'Demurrage (the box waiting inside the terminal)';
  const until = running === 'detention' ? 'inside the gate' : 'loaded on board';
  const closed = running === 'demurrage' ? outside : '';

  if (!claim) {
    return {
      kind: running,
      since,
      daysElapsed,
      overdue: false,
      ...(detentionDays != null ? { detentionDays } : {}),
      basis: `${which} since ${day(since)}: ${days(daysElapsed)}. Nobody has said how many free days the line gives, so there is no date to count to — the figure is in the exporter's agreement with the line or its forwarder, and only the exporter can give it.${closed}`,
    };
  }

  const dueAt = plusDays(since, claim.days);
  const daysLeft = claim.days - daysElapsed;
  return {
    kind: running,
    since,
    daysElapsed,
    freeDays: claim.days,
    freeDaysBy: claim.by,
    freeDaysAt: claim.at,
    dueAt,
    daysLeft,
    overdue: daysLeft < 0,
    ...(detentionDays != null ? { detentionDays } : {}),
    basis:
      daysLeft < 0
        ? `${which}: the ${claim.days} free days ${claim.by} gave ran out on ${day(dueAt)}, ${days(-daysLeft)} ago. What a day over costs is between the exporter and the line — we count, and charge nothing.${closed}`
        : `${which} since ${day(since)}: day ${daysElapsed} of the ${claim.days} free days ${claim.by} gave, so it must be ${until} by ${day(dueAt)}. The figure is theirs, from an agreement we have not seen.${closed}`,
  };
}

/* --------------------------------------------------- the interchange record -- */

/** The two gates a box passes through with us: out of the terminal, and back in at a depot. */
export const INTERCHANGE_SIDES = ['out', 'in'] as const;
export type InterchangeSide = (typeof INTERCHANGE_SIDES)[number];

/** What somebody says about the box's condition. Two words, because a third invites a paragraph. */
export const CONDITION_STANCES = ['sound', 'damaged'] as const;
export type ConditionStance = (typeof CONDITION_STANCES)[number];

/**
 * ONE ACCOUNT OF THE BOX'S CONDITION AT A GATE — attributed, dated, and never erased.
 *
 * The same shape as a road hazard's account and a customs hold's, and for the same reason: two parties
 * are going to disagree about who put the hole in it, and the honest structure is both accounts standing
 * beside each other rather than one overwriting the other. Nothing adjudicates them. A reader weighs them.
 */
export interface InterchangeAccount {
  /** A person's name, or — for the account DERIVED from a leg — the leg that carries the photograph. */
  by: string;
  /** The company, where a party recorded it. Absent on the derived account: a leg is not a company. */
  byEntityId?: string;
  at: string;
  stance: ConditionStance;
  note?: string;
  /** Media ids. Readable only by the parties to this box — see `readableBoxPhoto`. */
  photoRefs: string[];
  /**
   * TRUE where this account was DERIVED from the leg's own photograph rather than typed by anybody.
   *
   * It matters to a reader: the driver's securement photo at the gate was taken to prove the load was
   * secured, and it is being read as evidence of the box's condition. That is a fair reading and it is
   * not the same as somebody standing there and saying "there is a hole in this".
   */
  derived?: boolean;
}

/**
 * When to warn, and it is deliberately not "when it is late".
 *
 * A warning after the date is the invoice arriving with extra steps — the two-weeks-at-customs story again.
 * Three days is far enough ahead to arrange a truck and close enough that it is still about this box.
 */
export const BOX_WARN_DAYS = 3;

/** True while the box is inside the window where somebody can still act. Overdue is a different message. */
export function boxDueSoon(clock: Pick<BoxClock, 'daysLeft'>): boolean {
  return clock.daysLeft != null && clock.daysLeft >= 0 && clock.daysLeft <= BOX_WARN_DAYS;
}
