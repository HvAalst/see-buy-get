import { Freight } from './dispatch.types';
import { MOBILISATION_MIN_LOADS, TIGHT_WAIT_H } from './pudo.config';
import { nearestPlace } from './geo-gazetteer';

/**
 * CL4 — MOBILISATION: can they find a truck when trucks are scarce?
 *
 * Pure functions over plain records, like the market series: no clock, no store, no service, so a figure
 * somebody's livelihood is judged on can be reproduced exactly from the loads it came from.
 *
 * THE MEASURE EXISTS BECAUSE THE OTHER HALF CANNOT BE MEASURED HONESTLY. Scoring a party on elapsed time
 * at a border systematically advertises whoever pays bribes, and absence of a seizure is not evidence of
 * compliance — a clean record there is an unfalsifiable positive. Mobilisation is the half the platform
 * already watches, and it happens to be the half a shipper needs on the day a government requisitions the
 * national truck fleet.
 *
 * FOUR RULES, and every one of them is about not flattering a record.
 *
 *  1. HAND-BACKS NET OFF, and this is not a detail. A count of loads claimed is gamed by claiming quickly
 *     and handing back later — which FP8 made possible and, to its credit, recorded. A measure that
 *     ignores them rewards precisely the behaviour it exists to detect. `kept` is the honest numerator.
 *  2. A THIN RECORD SHOWS AS THIN. Under MOBILISATION_MIN_LOADS there are counts and NO rate: three loads
 *     shows three loads and no average. Not hidden, because hiding is the polish this measure refused;
 *     not averaged, because five stars from three loads is the same untruth wearing the opposite sign.
 *     Newcomers read as newcomers, which is what they are.
 *  3. WHAT HAPPENED, INCLUDING THE BAD. Hand-backs and undelivered loads are counted and published, not
 *     quietly dropped. A record that can only flatter protects nobody from somebody genuinely unreliable,
 *     and the lessons from bad experiences are what harden a market.
 *  4. PER LANE AND PER COMMODITY CLASS. A party moving dry goods on one corridor is not comparable to one
 *     moving perishables across three, and one blended figure hides exactly that.
 *
 * AND IT IS NEVER A SINGLE SCORE. Blending is what makes bribery look like competence; there is no
 * weighted total in this file and there must not be one.
 */

/** One lane or one commodity class, counted the same way as the whole. */
export interface MobilisationSlice {
  /** 'Nairobi → Mombasa' for a lane; 'P4' for a class. */
  key: string;
  claimed: number;
  handedBack: number;
  kept: number;
  delivered: number;
}

export interface Mobilisation {
  /** Loads this party took at all — including the ones they later gave back. */
  claimed: number;
  /** Taken, then handed back. Published, because it is what happened. */
  handedBack: number;
  /** Taken and NOT handed back. The honest numerator for anything that follows. */
  kept: number;
  /** Kept and delivered. */
  delivered: number;
  /** Kept, still running — neither delivered nor handed back. Not a failure, and not a success yet. */
  inFlight: number;
  /** Of the loads they kept, how many had been waiting long enough that trucks were plainly scarce. */
  tightKept: number;
  /** …and how many of THOSE they delivered. The answer to the question the measure exists for. */
  tightDelivered: number;
  /** kept / claimed — null while the record is thin. */
  keptRate: number | null;
  /** delivered / kept — null while the record is thin. */
  deliveredRate: number | null;
  /** True when there are too few loads to rate. The counts above are still real and still shown. */
  thin: boolean;
  /** How many loads the rates would need. Carried so a screen can say so without knowing the config. */
  ratesNeed: number;
  lanes: MobilisationSlice[];
  classes: MobilisationSlice[];
}

const HOUR_MS = 3_600_000;

/** A lane end we cannot name honestly — the never-infer rule, as the market series applies it. */
const UNKNOWN_PLACE = 'unknown';

function placeName(point?: { lat: number; lng: number }): string {
  if (!point) return UNKNOWN_PLACE;
  return nearestPlace(point)?.name ?? UNKNOWN_PLACE;
}

/** Add one load's outcome into a slice, creating it on first sight. */
function tally(into: Map<string, MobilisationSlice>, key: string, outcome: { handedBack: boolean; delivered: boolean }): void {
  let row = into.get(key);
  if (!row) {
    row = { key, claimed: 0, handedBack: 0, kept: 0, delivered: 0 };
    into.set(key, row);
  }
  row.claimed += 1;
  if (outcome.handedBack) row.handedBack += 1;
  else {
    row.kept += 1;
    if (outcome.delivered) row.delivered += 1;
  }
}

const bySize = (a: MobilisationSlice, b: MobilisationSlice) => b.claimed - a.claimed || b.delivered - a.delivered || a.key.localeCompare(b.key);

/**
 * WAS THIS LOAD TAKEN UNDER SCARCITY?
 *
 * Read off the load itself: how long it sat on the market before this party took it. A load nobody else
 * would touch for two days was a load trucks were scarce for, by the revealed preference of everybody who
 * passed on it — and taking it then is precisely the capability being measured.
 *
 * Deliberately NOT derived from the market-wide series. That is a window-level fact, and making a
 * per-party record depend on re-deriving the whole market at the moment each load was posted would mean a
 * figure nobody could reproduce from the loads in front of them.
 */
export function waitedHours(f: Pick<Freight, 'createdAt' | 'claimedAt'>): number | null {
  if (!f.createdAt || !f.claimedAt) return null;
  const posted = Date.parse(f.createdAt);
  const claimed = Date.parse(f.claimedAt);
  if (!Number.isFinite(posted) || !Number.isFinite(claimed) || claimed < posted) return null;
  return (claimed - posted) / HOUR_MS;
}

/**
 * Build one party's record from the loads they touched.
 *
 * `didsOf` is what makes this work for a FLEET as well as for one driver: a fleet mobilises through the
 * drivers it fields, so its record is the loads any of them took. The caller decides whose DIDs those are
 * — this file never looks up a registry, so it cannot accidentally count somebody twice.
 */
export function mobilisationOf(freights: Freight[], dids: string[], now: number = Date.now()): Mobilisation {
  const mine = new Set(dids.filter(Boolean));
  return mobilisationWhere(
    freights,
    (f) => Boolean(f.claimedBy && mine.has(f.claimedBy)),
    (h) => mine.has(h.driverDid),
    now,
  );
}

/** One hand-back, as a load keeps it. */
export type HandBack = NonNullable<Freight['handBacks']>[number];

/**
 * A CARRIER's record: the loads taken FOR it — by whoever was driving for it then, wherever they drive now.
 *
 * Membership was how a fleet's record was built ("the loads any of its drivers took"), and membership is a fact
 * about today. The day a driver can move fleets, that rule hands their whole record to the new fleet and takes it
 * away from the one they did the work for. `carrierOf` answers whose job a load was (fixed at the claim — see
 * DispatchService.carrierOf) and `handBackCarrierOf` whose a hand-back was, so neither moves with the driver.
 */
export function mobilisationForCarrier(
  freights: Freight[],
  carrierDid: string,
  carrierOf: (f: Freight) => string | undefined,
  handBackCarrierOf: (h: HandBack) => string | undefined,
  driverDid?: string,
  now: number = Date.now(),
): Mobilisation {
  return mobilisationWhere(
    freights,
    (f) => Boolean(f.claimedBy) && carrierOf(f) === carrierDid && (!driverDid || f.claimedBy === driverDid),
    (h) => handBackCarrierOf(h) === carrierDid && (!driverDid || h.driverDid === driverDid),
    now,
  );
}

function mobilisationWhere(freights: Freight[], holdsIt: (f: Freight) => boolean, gaveItBack: (h: HandBack) => boolean, now: number): Mobilisation {
  const lanes = new Map<string, MobilisationSlice>();
  const classes = new Map<string, MobilisationSlice>();

  let claimed = 0;
  let handedBack = 0;
  let delivered = 0;
  let inFlight = 0;
  let tightKept = 0;
  let tightDelivered = 0;

  for (const f of freights) {
    // Did anybody of ours take this load? A hand-back is still a claim: they had it, then gave it up, and
    // dropping those rows would erase exactly the behaviour rule 1 exists to catch.
    const gaveBack = (f.handBacks ?? []).some(gaveItBack);
    const holds = holdsIt(f);
    if (!gaveBack && !holds) continue;

    claimed += 1;
    // Somebody who handed a load back and later re-took it holds it now; the hand-back is history, and
    // counting them on both sides of the same load would make one load into two facts.
    const wasHandedBack = gaveBack && !holds;
    const wasDelivered = holds && Boolean(f.deliveredAt);
    if (wasHandedBack) handedBack += 1;
    else if (wasDelivered) delivered += 1;
    else inFlight += 1;

    if (!wasHandedBack) {
      const waited = waitedHours(f);
      if (waited != null && waited >= TIGHT_WAIT_H) {
        tightKept += 1;
        if (wasDelivered) tightDelivered += 1;
      }
    }

    const outcome = { handedBack: wasHandedBack, delivered: wasDelivered };
    tally(lanes, `${placeName(f.pickupLocation)} → ${placeName(f.destLocation)}`, outcome);
    tally(classes, f.cargoClass || 'unknown', outcome);
  }

  const kept = claimed - handedBack;
  // THE THIN RULE. Counts always; rates only when there are enough loads for a rate to mean anything.
  const thin = claimed < MOBILISATION_MIN_LOADS;
  const rate = (num: number, den: number) => (thin || den <= 0 ? null : Math.round((num / den) * 100) / 100);

  return {
    claimed,
    handedBack,
    kept,
    delivered,
    inFlight,
    tightKept,
    tightDelivered,
    keptRate: rate(kept, claimed),
    deliveredRate: rate(delivered, kept),
    thin,
    ratesNeed: MOBILISATION_MIN_LOADS,
    lanes: [...lanes.values()].sort(bySize),
    classes: [...classes.values()].sort(bySize),
  };
}

/**
 * WHAT WE MEASURED, in the words that go BESIDE the figure rather than in a footnote.
 *
 * This measure's failure mode is being read as a general endorsement. It says whether a party finds and
 * moves trucks. It says nothing about filing accuracy, honesty at a border, or care with paperwork — and
 * §6 explains why the last of those can never be measured by elapsed time. A reader who takes a strong
 * mobilisation record for a clean one has been misled, and the only defence is saying so on the page.
 */
export const MOBILISATION_MEASURED =
  'We measured whether they find and move trucks: loads taken, loads given back, and loads delivered. We did not measure paperwork, filing accuracy or conduct at a border — a record here is not a character reference.';
