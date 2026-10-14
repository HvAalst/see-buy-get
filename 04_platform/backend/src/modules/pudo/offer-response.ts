// The fee-response curve — how often work at a given price is actually taken.
//
// A colleague of the user's, 2026-09-03: *"below some fee nobody takes the hop, and that number decides how
// dense the node network has to be."* Nobody could answer it, and the reason was never that the data was
// missing — every offer this network has ever made carries what it would pay and what the driver did about
// it. It was simply never read.
//
// This does not answer the question. It builds the only instrument that could: what share of offers at each
// price were taken, with enough of the working shown that a thin or flattering reading cannot hide inside it.
//
// Pure functions over plain records — no clock, no store, no service. Everything the aggregation depends on
// is an argument, so a number somebody sets a price against can be reproduced exactly. Same discipline as
// `market-series.ts`, and for the same reason.
//
// FOUR RULES, all of them about not flattering the data.
//
//  1. A REFUSAL AND A SILENCE ARE DIFFERENT FACTS. Declining is an answer; letting an offer lapse is a
//     phone in a pocket, a driver already carrying something, a notification never delivered. Folding
//     lapses into refusals would make every fee look worse than it is and would quietly turn "we do not
//     know" into "they said no". Take-up is computed over ANSWERED offers alone; the unanswered are
//     counted, reported beside them, and never blended in.
//  2. A COUNT ALWAYS RIDES WITH A RATE. No bare percentage anywhere, and no percentage at all once the
//     answered denominator is thin — a 100% take-up over two offers is a coin toss with a decimal point.
//  3. A BAND NOBODY WAS OFFERED IS ABSENT, NOT ZERO. No offers at a price is "we never asked", which is a
//     different sentence from "nobody wanted it", and printing 0% would invent a finding out of silence.
//  4. NO HEADLINE NUMBER. It is tempting to publish "the minimum viable fee is X" — one number, exactly
//     what was asked for. It would be a fluke dressed as a finding: this reads a live in-memory window,
//     the bands are a legibility choice rather than a natural unit, and a threshold read off sparse data
//     moves every time somebody restarts the process. The curve is reported and the reader draws the line.

import { Offer } from './dispatch.types';

/**
 * The price ladder, in network currency.
 *
 * Arbitrary in the way any bucketing is arbitrary — chosen so a human can read the rows, and kept in ONE
 * place so retuning it is a single edit rather than an archaeology exercise. It is deliberately coarse at
 * the bottom, where a bag's handling fee and a short hop live, and open-ended at the top.
 */
export const FEE_BANDS = [0, 1, 2, 5, 10, 20, 50] as const;

/** How many ANSWERED offers a band needs before its take-up is worth printing. Below this the band still
 *  reports its counts — the reader can see there was something there — but no percentage is computed. */
export const MIN_ANSWERS = 5;

/** What the driver did, once we stop pretending silence is an answer. */
export type OfferOutcome = 'claimed' | 'declined' | 'unanswered' | 'open';

export interface FeeBand {
  /** Inclusive lower bound. */
  from: number;
  /** Exclusive upper bound; absent on the open-ended top band. */
  to?: number;
  offered: number;
  claimed: number;
  declined: number;
  /** Lapsed without an answer. NEVER added into `declined` — see rule 1. */
  unanswered: number;
  /** claimed + declined: the only denominator a take-up rate may be computed over. */
  answered: number;
  /** claimed / answered, as a percentage. ABSENT when the band is thin (rule 2). */
  takeUpPct?: number;
  /** Marked, not hidden (rule 2): there was work here, and there was not enough of it to conclude from. */
  thin: boolean;
}

export interface OfferResponse {
  bands: FeeBand[];
  claimed: number;
  declined: number;
  unanswered: number;
  answered: number;
  /**
   * The window the answer actually covers — read off the offers themselves, not from the request.
   *
   * It matters more here than it looks: offers live in memory and do not survive a restart, so this is
   * frequently "since this morning" rather than the period somebody asked for. Reporting the real edges is
   * how a reader finds that out, instead of trusting a range we never had the data to fill.
   */
  observedFrom?: string;
  observedTo?: string;
  /** Offers whose clock has not run out yet — excluded from every figure above, because they have not
   *  happened. Reported so the reader can see what is still in flight rather than wonder where it went. */
  stillOpen: number;
}

/** Which band a fee falls in — the index into FEE_BANDS, or null when there is no fee to place. */
export function bandIndexOf(earn: number | undefined): number | null {
  if (earn == null || !Number.isFinite(earn) || earn < 0) return null;
  let i = 0;
  while (i + 1 < FEE_BANDS.length && earn >= FEE_BANDS[i + 1]) i += 1;
  return i;
}

/**
 * What a driver did about an offer, classified by status AND by the clock.
 *
 * The clock matters because a lapsed offer is only marked `expired` when something happens to read it —
 * `activeOffersFor` flips it lazily. Classifying on the stored status alone would make these figures depend
 * on whether anybody happened to open the app, which is not a property a measurement may have.
 */
export function outcomeOf(offer: Offer, until: number): OfferOutcome {
  if (offer.status === 'claimed') return 'claimed';
  if (offer.status === 'ignored') return 'declined';
  if (offer.status === 'expired') return 'unanswered';
  return new Date(offer.expiresAt).getTime() <= until ? 'unanswered' : 'open';
}

/**
 * Build the curve.
 *
 * `offers` is every offer in the window; `until` is the instant the reading is taken at, which decides
 * whether a still-pending offer has run out of time or is genuinely still in flight.
 */
export function buildOfferResponse(offers: Offer[], until: number): OfferResponse {
  const counts = FEE_BANDS.map(() => ({ claimed: 0, declined: 0, unanswered: 0 }));
  let stillOpen = 0;
  let earliest: string | undefined;
  let latest: string | undefined;

  for (const offer of offers) {
    const outcome = outcomeOf(offer, until);
    if (outcome === 'open') {
      stillOpen += 1;
      continue;
    }
    const band = bandIndexOf(offer.earn);
    // An offer we cannot price is not evidence about any price. Counted nowhere rather than dropped into
    // the bottom band, which would read as "cheap work nobody took" — the exact inference rule 1 forbids.
    if (band == null) continue;
    counts[band][outcome] += 1;
    if (!earliest || offer.createdAt < earliest) earliest = offer.createdAt;
    if (!latest || offer.createdAt > latest) latest = offer.createdAt;
  }

  const bands: FeeBand[] = [];
  for (let i = 0; i < FEE_BANDS.length; i += 1) {
    const c = counts[i];
    const offered = c.claimed + c.declined + c.unanswered;
    if (offered === 0) continue; // rule 3: never asked is not the same as never taken
    const answered = c.claimed + c.declined;
    const thin = answered < MIN_ANSWERS;
    bands.push({
      from: FEE_BANDS[i],
      to: i + 1 < FEE_BANDS.length ? FEE_BANDS[i + 1] : undefined,
      offered,
      claimed: c.claimed,
      declined: c.declined,
      unanswered: c.unanswered,
      answered,
      // Suppressed while thin, and suppressed outright at zero — there is no rate over no answers.
      takeUpPct: thin || answered === 0 ? undefined : Math.round((c.claimed / answered) * 1000) / 10,
      thin,
    });
  }

  const total = (k: 'claimed' | 'declined' | 'unanswered') => counts.reduce((n, c) => n + c[k], 0);
  const claimed = total('claimed');
  const declined = total('declined');
  return {
    bands,
    claimed,
    declined,
    unanswered: total('unanswered'),
    answered: claimed + declined,
    observedFrom: earliest,
    observedTo: latest,
    stillOpen,
  };
}
