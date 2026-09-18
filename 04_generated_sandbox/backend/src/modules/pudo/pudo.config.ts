import { isPackaging, type Packaging } from './packaging';
// PUDO Light economic + operational constants (Compendium Ch 14–17). Hard-coding these here is a
// placeholder for the admin-editable config service the playbook mandates (Risk #55).

import { ParcelSize } from './pudo.types';
import { CargoLane } from './cargo.types';
import { currencyForJurisdiction } from '../../foundation/money/currency';

export const WHOLESALE = 1.6; // credit the platform consumes per shipped parcel
export const RETAIL = 2.0; // what the agent charges a cash customer (keeps the spread)
export const LABOUR_FEE = 0.4; // paid to the agent for handling a pre-paid drop / inbound intake
export const HANDOVER_FEE = 0.5; // paid to the agent for handing a batch to the bus
/**
 * What the destination shop earns, and WHEN — split in two, which is the point.
 *
 * It used to be one fee paid on release, and that quietly made the shop the only party in the network
 * whose entire pay depended on a stranger turning up. They received the parcel, scanned it, and gave up
 * one of the six or nine shelf slots that decide whether they can accept anything else — and if nobody
 * ever came, they earned nothing for any of it. The origin shop has always been paid at intake
 * (LABOUR_FEE); the destination shop was not, for no reason anybody chose.
 *
 * Splitting it moves no money into or out of the system: the sender already paid for a whole journey,
 * last leg included, so the two halves still sum to what the single fee was. What changes is that the
 * half covering work already done stops being contingent on somebody else's decision.
 *
 * Kept as literals rather than derived from each other, because round2 is not defined until further down
 * this file and a const arrow cannot be called from above itself.
 */
export const SHELVING_FEE = 0.15; // paid when the parcel lands on their shelf — that work is finished then
export const RELEASE_FEE = 0.15; // …and the rest when they actually hand it over
export const PICKUP_FEE = 0.3; // SHELVING_FEE + RELEASE_FEE — the whole destination leg, unchanged
export const LOCK_THRESHOLD = 1.6; // wallet below this → 'no money, no scan' lockout
// Trade credit for an APPROVED shop. A customer standing at the counter with cash in their hand must not
// be turned away because the shop's float ran dry — so the shop may keep scanning on credit, bounded to
// twenty parcels' worth, and the debt is settled out of its next top-up before anything else. Expressed
// in PARCELS because that is the unit a shopkeeper thinks in; the money follows from the wholesale rate.
export const TRADE_CREDIT_PARCELS = 20;
export const TRADE_CREDIT_LIMIT = Math.round(TRADE_CREDIT_PARCELS * WHOLESALE * 100) / 100;
export const VOID_WINDOW_MS = 5 * 60 * 1000; // 5-minute reverse-logistics window
// A parcel's RELEASE SECRET — the peer-send OTP read aloud by the destination agent, or the inbound
// buyer's collection code held in their app — is the only check between a stranger and someone else's
// parcel, so wrong attempts are counted per parcel and the secret is burned. Recover with an operator
// reissue (parcels/:id/reissue-release), which rotates the secret rather than merely unlocking it.
export const OTP_MAX_ATTEMPTS = 5;

// The printed label carries the parcel's creation DATE so a shopkeeper can see at a glance that a box
// has been sitting there a week. The server clock is UTC and the label has no locale, so the date is
// rendered at the network's operating offset — a parcel minted at 01:00 in Nairobi must not print
// yesterday. Swap this for a per-zone timezone when the network leaves East Africa.
export const LABEL_TZ_OFFSET_MIN = 180; // EAT (UTC+3)

// Bus-vs-truck heuristic + size→weight tiers (Heavy > 20 kg).
export const BUS_MAX_KG = 500;
export const SIZE_WEIGHT_KG: Record<ParcelSize, number> = { S: 1, M: 5, L: 15, HEAVY: 25 };

// Size auto-classification (Risk: "small for the vendor is large for the shipper"). The merchant enters
// real dimensions (cm) + weight (kg); the tier is DERIVED, not chosen, so a parcel can't be under-declared.
// A tier fits only if every (descending-sorted) dimension is within the limit AND the weight is within it.
export interface SizeLimit { size: ParcelSize; maxCm: [number, number, number]; maxKg: number; }
export const SIZE_LIMITS: SizeLimit[] = [
  { size: 'S', maxCm: [35, 25, 10], maxKg: 2 },
  { size: 'M', maxCm: [45, 35, 25], maxKg: 5 },
  { size: 'L', maxCm: [60, 50, 40], maxKg: 15 },
  { size: 'HEAVY', maxCm: [120, 80, 80], maxKg: 30 },
];
export const MAX_PARCEL_KG = 30; // beyond this it is bulk freight, not a PUDO parcel

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Derive the size tier from dimensions (cm) + weight (kg). Throws over the heavy ceiling. */
export function classifySize(dims: { l: number; w: number; h: number; kg: number }): ParcelSize {
  const desc = [dims.l, dims.w, dims.h].sort((a, b) => b - a);
  for (const lim of SIZE_LIMITS) {
    const limDesc = [...lim.maxCm].sort((a, b) => b - a);
    if (dims.kg <= lim.maxKg && desc.every((d, i) => d <= limDesc[i])) return lim.size;
  }
  return 'HEAVY';
}

// --- Open-data, participant-set pricing (the "fuel-pump" model) ---
// Each provider publishes its own rate (visible to vendors/agents/drivers to keep competition). A
// shipment is quoted from the route: node fees (per parcel, at each PUDO + MDP passed) + transport
// (per km × distance). GLOS holds no fiat — it REPORTS the agreed price to a per-country daughter
// company and bills the vendor prepaid. The 2% is that daughter company's reporting/handling margin.
export const DEFAULT_PUDO_PRICE_PER_PARCEL = 0.5; // a PUDO agent's default handling fee per parcel
export const DEFAULT_MDP_PRICE_PER_PARCEL = 0.3; // an MDP hub's default sort fee per parcel
export const DEFAULT_PRICE_PER_KM = 0.08; // a vehicle's default transport rate per km
export const PLATFORM_FEE_PCT = 0.02; // 2% daughter-co margin on top of provider costs
export const DEFAULT_VENDOR_COUNTRY = 'KE'; // which country daughter company settles a vendor
// The currency this network's money is denominated in, resolved from the country above rather than
// written twice. Every amount that leaves the system is stamped with it, so a figure is never just a
// number. When the per-jurisdiction sister companies become real entities, this constant is what they
// replace: the currency will come from the entity that owns the account, not from a deployment default.
export const NETWORK_CURRENCY = currencyForJurisdiction(DEFAULT_VENDOR_COUNTRY);
// The jurisdiction this deployment operates in — which sister company contracts its shops and hubs.
// Named separately from DEFAULT_VENDOR_COUNTRY because they answer different questions and will stop
// agreeing the moment a second country opens: a Kenyan shop can serve a Dutch vendor's parcel.
export const NETWORK_JURISDICTION = DEFAULT_VENDOR_COUNTRY;
/**
 * What a border post costs a load, in hours.
 *
 * The ETA is optimistic by decision (a leg is one continuous run at a nominal speed) and this does not
 * change that — a queue at a border is a DISCRETE event on a specific leg, not a refinement of how fast a
 * bus goes. Leaving it at zero made the one leg that genuinely stops read as the one that does not.
 *
 * One number for every crossing, deliberately: a per-post table is a thing that goes stale silently, and a
 * plainly-stated average is easier to argue with than a table nobody maintains.
 */
export const BORDER_DWELL_H = 4;
/**
 * How long a QUOTED price is held for, once a merchant has a name to redeem it by.
 *
 * Long enough for a real checkout — a buyer still has an address to type and a card to find — and short
 * enough that we are not underwriting a shop's advertised rate for the afternoon. A converted price is
 * capped tighter still by the rate behind it (see QuoteBookService.hold).
 */
export const QUOTE_TTL_MIN = 60;
export const round2cfg = round2;

/** Apply the platform's take to a base provider cost. `pct` is the SUM of the seller's three layers. */
export function withPlatformFee(base: number, pct: number = PLATFORM_FEE_PCT): number {
  return round2(base * (1 + pct));
}

/**
 * The handling lane a counter SIZE ends up on — the bridge between the two vocabularies.
 *
 * Sizes are what a shopkeeper says; classes and lanes are what the system routes on. The map is
 * deliberately coarse and derived from SIZE_LIMITS against CARGO_CLASSES: S and M fit the PUDO classes,
 * L and HEAVY need a hub to sort them. Note what is NOT here — `dedicated`. Anything over
 * MAX_PARCEL_KG stops being a parcel at all and becomes freight, which is priced on its own path, so no
 * parcel size can ever resolve to the dedicated lane. That is a fact about the network, not an omission.
 */
export const SIZE_LANE: Record<ParcelSize, CargoLane> = { S: 'pudo', M: 'pudo', L: 'mdp', HEAVY: 'mdp' };

// The margin is a KNOB each sister sets for its own market, not a constant of the network — the rate
// above is only the default a new sister starts on. Bounded so a mistyped rate cannot price a market out
// of existence or hand the margin away: a fee is a decision, and an implausible one is a typo.
export const MIN_PLATFORM_FEE_PCT = 0;
export const MAX_PLATFORM_FEE_PCT = 0.25;

/**
 * Tax. A different kind of number from the one above, and the bounds say so.
 *
 * The platform fee is a decision a sister makes; a tax rate is one it is TOLD. So there is no network
 * default worth having — the default is zero, meaning "this sister has not been told to charge anything
 * yet", which is the honest state of every sister until an operator sets one.
 *
 * The ceiling is loose on purpose. Standard rates run to the high twenties in some jurisdictions, so a
 * tight bound would be this file having an opinion about somebody else's law. It exists only to catch the
 * one mistake that matters: `16` typed where `0.16` was meant, which would charge sixteen hundred percent.
 */
/**
 * A sanity bound on a damage award, not a policy.
 *
 * There is no declared-value cover in this system yet, so what the network is actually liable for when
 * it breaks something is undefined — and this file is the wrong place to invent it. The ceiling exists
 * only to catch a mistyped figure before it reaches the books; the real limit arrives with insurance.
 */
export const MAX_CLAIM_AWARD = 1_000_000;

/** A premium is a CHARGE, so a mistyped one reaches somebody's money — bounded for the same reason the
 *  tax rate is. Generous, because insuring fragile goods over a bad road is legitimately expensive. */
export const MAX_PREMIUM_PCT = 0.25;

/**
 * The cover on one shipment: what it is worth, what the shipper paid to cover it, and the ceiling an
 * award is checked against.
 *
 * `limit` is the whole point. Before this existed the network's liability was undefined — an adjudicator
 * had a figure to type and nothing to check it against — so the sanity bound in `resolveDispute` was
 * doing work that a policy should do.
 */
export function coverFor(input: { declaredValue?: number; premiumPct: number; freeLimit: number }): { declaredValue: number; premium: number; limit: number } {
  const num = (n: unknown) => (Number.isFinite(Number(n)) ? Math.max(0, Number(n)) : 0);
  const declaredValue = round2(num(input.declaredValue));
  const freeLimit = round2(num(input.freeLimit));
  // Charged only on the part that is NOT already covered. Charging the whole declared value would bill
  // somebody for cover they already had, which is the kind of small dishonesty nobody forgives twice.
  const chargeable = Math.max(0, round2(declaredValue - freeLimit));
  return {
    declaredValue,
    premium: round2(chargeable * Math.max(0, num(input.premiumPct))),
    // Declaring LESS than the free limit does not reduce cover — the free limit is a floor, not a swap.
    limit: Math.max(freeLimit, declaredValue),
  };
}

export const MIN_TAX_PCT = 0;
export const MAX_TAX_PCT = 0.4;
/** What tax is called when a sister has not said. Neutral because the real name is jurisdictional — VAT
 *  in Kenya, VAT in Ethiopia, GST elsewhere — and inventing one for a sister would be putting a word on
 *  its receipts that its own authority may not use. */
export const DEFAULT_TAX_LABEL = 'Tax';

/**
 * The tax on a net price, and the gross a customer actually pays.
 *
 * EXCLUSIVE arithmetic — tax is the layer ON TOP of the sister's whole price, which is what the pricing
 * stack reserved this seam for: cost → the three layers → a net price → tax. `net` is untouched, so
 * everything already computed keeps its meaning and its value, and a zero rate returns the same numbers
 * that were there before this existed.
 *
 * A receipt that must DISPLAY the price tax-inclusive (which retail law requires in a good many places)
 * shows `gross` with `tax` named inside it. That is a presentation of these same two figures and needs no
 * second arithmetic — which is exactly why there is only one here.
 */
export function taxOn(net: number, ratePct: number): { net: number; tax: number; gross: number } {
  const base = round2(Number.isFinite(net) ? net : 0);
  const rate = Number.isFinite(ratePct) ? Math.max(0, ratePct) : 0;
  const tax = round2(base * rate);
  // Summed rather than multiplied out, so `net + tax === gross` holds exactly at two decimals. Computing
  // the gross independently is how a receipt ends up with three numbers that do not add up.
  return { net: base, tax, gross: round2(base + tax) };
}

// S34b — dynamic market-pulse tunables. The engine buckets the map into ~0.1° cells (a "market zone",
// mirroring the monitor heatmap), samples supply (live vehicles) vs demand (open freight) per cell, and
// derives a raw multiplier factor = 1 + K·(pressure − 1) that the freight price is flexed by — always then
// clamped to the individual vehicle's own [min,max] corridor. A thin cell (few open loads) stays neutral.
export const MARKET_CELL_DP = 1; // decimal places for the geo-cell key → 0.1° ≈ 11 km market zones
export const MARKET_MIN_DEMAND = 3; // a cell needs at least this many open loads before any surge/discount
export const MARKET_SURGE_K = 0.25; // sensitivity: factor = 1 + K·(demand/supply − 1)
export const MARKET_RAW_MIN = 0.7; // the engine's own factor floor (before the per-vehicle corridor clamp)
export const MARKET_RAW_MAX = 2.0; // …and ceiling — the market never asks for more than 2× off the base rate
export const MARKET_SUPPLY_STALE_MIN = 30; // a driver's GPS older than this no longer counts as live supply
export const MARKET_RECOMPUTE_MS = 120_000; // recompute the whole-map pulse every 2 minutes

/* ---- CL3: scarcity, derived. Thresholds for what may be CLAIMED from a sample, not what is hidden. ---- */

/**
 * Below this many loads, a figure is MARKED thin rather than withheld.
 *
 * The memory of the freight-board epic records this rule as durable and the constant was never actually
 * defined — the rule lived in review comments. Two loads is not a market, and a median with no n beside it
 * invites somebody to read a fluke as a trend. Marked, not hidden: withholding it tells a reader nothing,
 * and they are entitled to see a thin market described as one.
 */
export const THIN_MARKET_LOADS = 5;

/** A lane is QUIET when its posted loads fell to this share or less of the window before it. */
export const QUIET_LANE_RATIO = 0.5;

/* ---- CL4: mobilisation. What may be RATED from a record, and what counts as a scarce load. ---- */

/**
 * Below this many loads taken, a record shows its COUNTS and no rate.
 *
 * "An agent with three loads shows three loads, and no average. Not hidden, because hiding is a polish
 * that flatters; not averaged, because five stars from three loads is the same untruth wearing the
 * opposite sign. Newcomers are visible as newcomers, which is what they are."
 */
export const MOBILISATION_MIN_LOADS = 5;

/**
 * How many CONTAINERS a clearing agent's record needs before it states a typical time.
 *
 * Its own constant rather than a reuse of the loads figure above, deliberately: a container and a load are
 * different units of work at wildly different frequencies, and tying them together means a change to one
 * silently moves the other. The design note's own example is the floor here — "an agent with three
 * containers shows three containers, and no average."
 */
export const AGENT_MIN_CONTAINERS = 5;

/**
 * A load claimed after waiting THIS LONG was taken under scarcity — and the whole market said so.
 *
 * The honest local definition of "tight", and it needed care. The market series knows when the market as
 * a whole is stretching, but that is a window-level fact and re-deriving it for the moment each load was
 * posted would make a per-agent record depend on a recomputation of the entire market. This is the same
 * signal read off the load itself: if nobody took it for two days, trucks were scarce for that load, by
 * the revealed preference of everybody who passed on it. Taking it then is the thing being measured.
 */
export const TIGHT_WAIT_H = 48;

/** Time-to-claim is STRETCHING when the median is at least this much longer than the window before it. */
export const CLAIM_STRETCH_RATIO = 1.25;

// MDP tote-bag capacity (Compendium Ch 17 — Main Distribution Point sorting).
// A tote holds at most BAG_CAPACITY_UNITS of "fill". Per-size fill is tuned so the three field rules
// land exactly: 50 letters + 1 medium = 10, 10 mediums = 10, and a single >20 kg parcel = 10 (it
// fills a bag on its own — nothing shares with a heavy). Bulk goods never enter a tote (truck-direct).
export const BAG_CAPACITY_UNITS = 10;
export const SIZE_UNITS: Record<ParcelSize, number> = { S: 0.18, M: 1, L: 2, HEAVY: 10 };

/**
 * How much of a vehicle a parcel takes, as a multiplier on the per-km rate — DERIVED from SIZE_UNITS.
 *
 * It used to be its own table, `{ S: 0.4, M: 1, L: 1.6, HEAVY: 3 }`, and the two disagreed about the same
 * physical fact. A HEAVY consumes a whole bag (10 of 10 units — nothing shares with a heavy) and was
 * charged for three mediums' worth of road. The bag it denies to everything else was a cost the network
 * silently absorbed on every heavy parcel it moved, and small parcels were paying for it: an S takes 1.8%
 * of a bag and was charged 40% of a medium.
 *
 * So there is now ONE statement of how much room a parcel takes, and transport is allocated by the same
 * share that consumes the scarce thing. Transport is bought BY THE BAG, so a parcel's share of a bag is
 * exactly its share of that bag's cost — which is the standard volumetric allocation, with SIZE_UNITS as
 * the dimensional weight and BAG_CAPACITY_UNITS as the tote's.
 *
 * Normalised to M = 1 so the reference size's price is unchanged and the rest move around it. The effect
 * is a REDISTRIBUTION, not a rise: S 0.4 → 0.18, M 1 → 1, L 1.6 → 2, HEAVY 3 → 10.
 *
 * ONE HONEST CAVEAT. `SIZE_UNITS.HEAVY = 10` is not purely a measurement — it encodes the handling POLICY
 * that a heavy travels alone. That policy is what justifies charging a heavy for the whole bag, so if the
 * policy ever changes (heavies allowed to share), this factor must follow it down. They are one fact now,
 * which is the point: it cannot drift again without someone noticing.
 */
export const SIZE_TRANSPORT_FACTOR: Record<ParcelSize, number> = {
  S: round2(SIZE_UNITS.S / SIZE_UNITS.M),
  M: round2(SIZE_UNITS.M / SIZE_UNITS.M),
  L: round2(SIZE_UNITS.L / SIZE_UNITS.M),
  HEAVY: round2(SIZE_UNITS.HEAVY / SIZE_UNITS.M),
};

/** A parcel's share of one tote — the allocation key for anything bought by the bag and consumed by the
 *  parcel. `SIZE_TRANSPORT_FACTOR` is this same ratio expressed against a medium instead of a whole bag. */
export function bagShare(size: ParcelSize): number {
  return SIZE_UNITS[size] / BAG_CAPACITY_UNITS;
}
/**
 * ITEM 9 — what a parcel ACTUALLY takes, in the same medium-equivalents the bands are written in.
 *
 * `SIZE_TRANSPORT_FACTOR` is a step function: every box from 46 cm to 60 cm is charged the same two
 * mediums, and a box one centimetre over the M ceiling jumps from 1 to 2. That is the right answer when a
 * person is EYEBALLING a parcel across a counter — four tiers is what an eye can do, and a tier derived
 * from a limit table cannot be talked down. It is the wrong answer once a machine has been given real
 * centimetres, because the step throws the measurement away and pays a merchant to shade a number down to
 * duck under an edge.
 *
 * So the rule is not about who is standing there, it is about whether a MEASUREMENT EXISTS: measured →
 * continuous, declared → the band. The vendor mint and the Send wizard take real cm and get this; a
 * counter parcel entered as a picked tier keeps the band it was picked from.
 *
 * The formula is the standard dimensional weight, `max(kg, l·w·h / divisor)`, expressed against a medium
 * so it lands on the scale everything else already uses (M = 1).
 *
 * WHERE THE DIVISOR COMES FROM. Not from an industry table — carriers use 4000–6000 cm³/kg, and picking
 * one would be importing somebody else's commercial policy as though it were physics. It is
 * `MEDIUM_CM3 / MEDIUM_KG` = 7875, the density the M band ALREADY declares by saying a medium is at most
 * 45×35×25 cm and at most 5 kg. Both axes are therefore calibrated at the same point, which is what makes
 * the `max` between them a comparison rather than a coincidence — and re-tuning the bands re-tunes this
 * with them, instead of leaving two numbers to drift apart the way SIZE_UNITS and the old hand-written
 * transport table did.
 *
 * CAPPED AT A WHOLE BAG. Transport is bought BY THE BAG, so a parcel's share of a bag is its share of that
 * bag's cost, and nothing can consume more than all of it. At the heavy ceiling the raw figure is ~19.5
 * mediums of volume — true, but not chargeable, because one bag is the most the network can give it. The
 * cap is exactly `SIZE_TRANSPORT_FACTOR.HEAVY`, so a heavy still prices as it always has.
 */
const MEDIUM_LIMIT = SIZE_LIMITS.find((l) => l.size === 'M')!;
export const MEDIUM_CM3 = MEDIUM_LIMIT.maxCm[0] * MEDIUM_LIMIT.maxCm[1] * MEDIUM_LIMIT.maxCm[2];
export const MEDIUM_KG = MEDIUM_LIMIT.maxKg;
/** cm³ per kg — the density the M band declares, and the divisor the volumetric side is measured with. */
export const DIM_DIVISOR = Math.round(MEDIUM_CM3 / MEDIUM_KG);

/**
 * The continuous transport factor for a MEASURED parcel, or `undefined` when the measurement is unusable.
 *
 * Undefined rather than a guess, and the caller falls back to the band: a zero or a nonsense dimension is
 * a broken form field, not a free parcel, and this function sits directly upstream of a price.
 */
export function measuredFactor(dims: { l: number; w: number; h: number; kg: number }): number | undefined {
  const nums = [dims.l, dims.w, dims.h, dims.kg];
  if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n) && n > 0)) return undefined;
  const byVolume = (dims.l * dims.w * dims.h) / MEDIUM_CM3;
  const byWeight = dims.kg / MEDIUM_KG;
  return round2(Math.min(BAG_CAPACITY_UNITS, Math.max(byVolume, byWeight)));
}

export const TOTE_CODE_PREFIX = 'BAG';

// How many bags a shop can have STANDING ON ITS FLOOR at once — the other capacity, and until now the
// unmodelled one: BAG_CAPACITY_UNITS says what fits INSIDE a bag, nothing said how many bags fit in the
// shop. A kiosk has room for a couple; a hardware store can stage plenty. The shop declares it (like the
// shelf); this is what a shop that has never said gets, and it is deliberately modest — a small counter is
// the common case, and a shop that needs more can see the number and raise it.
export const DEFAULT_BAG_BAYS = 2;
export const MAX_BAG_BAYS = 20;

// Tote/MDP-path settlement (parallel to the direct-path LABOUR/HANDOVER/PICKUP fees).
export const TOTE_LOAD_FEE = 0.5; // paid to the driver who scans a bag onto their vehicle
export const MDP_SORT_FEE = 0.2; // MDP labour, per parcel sorted into its next-hop bag

// Agent-eligibility filter (Ch 18.1) + onboarding (18.3).
export const MIN_SLOTS = 6; // minimum shelf capacity (rows × cols)
export const MIN_OPEN_HOURS = 10; // average open hours/day across open days
export const MIN_ANDROID_VERSION = 10;
export const EQUIPMENT_DEPOSIT_USD = 50; // refundable starter-kit deposit

// Shelf grid: columns are colour-coded, rows numbered. Supports up to 10 columns.
export const SHELF_COLORS = ['Red', 'Orange', 'Amber', 'Green', 'Teal', 'Blue', 'Indigo', 'Violet', 'Pink', 'Brown'];
// How many small (S) parcels a consolidation ("bundle") slot may pool — letters/envelopes share one slot
// instead of each burning a whole one.
export const CONSOLIDATION_MAX_ITEMS = 12;

// Routing / leg ETA.
export const VEHICLE_SPEED_KMH: Record<'bus' | 'truck', number> = { bus: 40, truck: 55 };
export const DISPATCH_BUFFER_H = 1; // time until the next scheduled departure (simplified)
export const HANDOVER_BUFFER_H = 0.5;
// G2 — road distance ≈ straight-line × this. Real roads are ~30–40% longer than the crow flies; 1.35 is
// a sane country-wide average the sandbox Router applies over haversine (a real OSRM/Valhalla adapter is
// the production swap). Legs, ETAs and freight pricing all read the routed distance, not the great circle.
export const ROAD_CIRCUITY_FACTOR = 1.35;

// Dispatch marketplace (Ch 19 — opportunistic line-haul). A filling tote is published for drivers to
// claim once it is full OR has waited this long; suggestions auto-ignore if unanswered within the TTL.
export const TOTE_MAX_WAIT_H = 24; // max time a tote waits before it is offered even if not full

// The moving nudge (a load on the road you are ON, right now). Every one of these numbers exists to keep a
// pop-up rare enough to be worth reading: a driver who is pinged while parked, or twice in five minutes,
// turns notifications off — and then hears nothing at all, which is worse than never having built this.
export const NUDGE_RADIUS_KM = 3; // tighter than the publish-time ping: this one interrupts someone driving
// A rider who works a patch rather than a road says how big the patch is. 5 km is a working morning on a
// bajaj; 15 is generous for anything that is not a line-haul, and a line-haul driver declares a road instead.
export const DEFAULT_WORK_RADIUS_KM = 5;
export const MAX_WORK_RADIUS_KM = 15;
// A snooze on new offers cannot outlive the shift it was taken in, and 12 h is longer than any shift — so
// "until I resume" and "the rest of my day" are the same promise, and neither can strand a driver tomorrow.
export const MAX_SNOOZE_MIN = 12 * 60;
/**
 * The most a driver may refuse to be woken for.
 *
 * A floor is a silencer, and an unbounded silencer is a driver who types a number they meant as "quite a
 * lot", hears nothing for a week and blames the network. The bound is deliberately generous — it is not a
 * judgement about what work is worth, only a stop against a fat finger turning the phone off for good.
 */
export const MAX_NUDGE_MIN_EARN = 100_000;
export const NUDGE_COOLDOWN_MIN = 10; // at most one interruption per driver in this window
export const NUDGE_MIN_MOVE_KM = 0.4; // a parked phone's GPS jitters; only real movement asks the question
export const OFFER_TTL_MIN = 10; // a suggestion auto-ignores if the driver does not answer in time
// F1 — an early-CLAIMED scheduled freight not picked up by this long AFTER its pickup date is a no-show:
// it is released back to the marketplace (and the shipper rebated) so an early reservation can't strand it.
export const FREIGHT_NOSHOW_GRACE_H = 12;
// F3 — a consolidation consignment (durable dry commodity) posts to the marketplace once it is FULL or once
// it has waited this long unfilled, mirroring a tote's full-or-aged publish. Durable goods can sit while a
// truckload builds, so the aged window is generous. MAX target caps a single lot at a sane truckload.
export const CONSIGNMENT_MAX_WAIT_H = 96; // 4 days
export const MAX_CONSIGNMENT_TARGET_KG = 40_000;
export const DISPATCH_MAX_DETOUR_KM = 8; // a pickup may be at most this far off the planned A→B route
export const DISPATCH_MAX_PICKUP_MIN = 30; // and at most this many minutes from the driver's start

// Auto-flag time windows (Ch 14).
export const STAGNANT_INVENTORY_H = 48; // At_PUDO too long
export const GHOST_BUS_H = 6; // On_Bus too long
export const MDP_DWELL_H = 12; // At_MDP (awaiting sort/load) too long
export const CONNECTIVITY_LOSS_H = 2; // agent no-ping
/**
 * How long a parcel may wait on the destination shelf before somebody is told.
 *
 * The gap this closes: every state a parcel PASSES THROUGH was watched, and the one it can sit in
 * indefinitely was not. A parcel nobody collects held a shelf slot for ever, silently — and the shelf is
 * the scarce thing that decides whether a shop can accept anything new at all, so each one permanently
 * cost the network a slot in a shop that has six or nine of them.
 *
 * Days rather than hours, unlike the transit windows beside it. Those measure a thing going wrong; this
 * measures a person being busy, and three days is a weekend plus a working day — long enough not to
 * nag somebody who was always going to come on Monday.
 */
export const UNCOLLECTED_H = 72;
/**
 * …and when the RECEIVER is reminded, which is deliberately sooner.
 *
 * The reminder exists to prevent the flag, not to accompany it: by the time an operator sees a parcel it
 * has already cost the shop a slot for three days. One reminder, not a series — a parcel that has been
 * waiting a day is a nudge, and a parcel nagging somebody daily is an app they turn off.
 */
export const UNCOLLECTED_REMINDER_H = 24;
/**
 * How long a MINTED shipment may sit before somebody is told it never started.
 *
 * A vendor is billed at mint, so this is the merchant's money held against a shipment that may never be
 * dropped off. Nothing watched `Created`, so nothing said so. Long, because a store legitimately prints
 * labels ahead of a courier run — this is for the order that was forgotten, not the one packed early.
 */
export const NEVER_DROPPED_H = 48;
/**
 * What a shop is paid, per started day, for a shelf slot held past the free window.
 *
 * The free window (UNCOLLECTED_H) is bought and paid for: it is part of the journey the sender purchased.
 * Past it, the slot is being consumed by somebody's delay rather than by the shipment, and the shop is
 * carrying it. This is what that costs.
 *
 * THE SHOP IS PAID ON THIS CLOCK, by the network, whether or not anybody ever settles it. Recovery is a
 * separate question with three answers — the receiver pays it at the counter if they collect late, it is
 * added to the store's return cost if the store brings the parcel home, and the network absorbs it from a
 * provision when nobody answers at all. A shopkeeper waiting to find out whether they will be paid is the
 * same trust asymmetry we refuse everywhere else in this network.
 */
export const HOLDING_FEE_PER_DAY = 0.1;
/**
 * …and where it stops.
 *
 * Uncapped daily accrual turns a forgotten 3-unit parcel into a bill larger than the goods, and asking
 * somebody for more than a thing is worth is how you manufacture the abandonment you were trying to
 * prevent. Two ceilings, whichever binds first: a fortnight of days, and never more than the shipment
 * itself cost. Past that the network is carrying it, which is the honest place for the loss to sit.
 */
export const HOLDING_FEE_MAX_DAYS = 14;
/**
 * How much longer a receiver who answers gets — and how many of those are free.
 *
 * THE FIRST ONE IS FREE, deliberately. The common answer to a final notice is no answer, and silence
 * costs this network far more than a few extra shelf-days: it ends in a return nobody wanted or a box
 * nobody may lawfully touch. Charging somebody for telling us the truth ("I am ill, I will come Friday")
 * teaches them that saying nothing is cheaper. The second extension is priced, because by then it is no
 * longer information — it is storage.
 */
export const EXTENSION_H = 72;
export const FREE_EXTENSIONS = 1;

/**
 * What is owed for a parcel that has sat past its free window, at a given moment.
 *
 * Pure, and derived from the two stamps rather than accrued into a field on a timer: an accrual that ran
 * on a schedule would be wrong for every parcel between two ticks, and a shop reading its own screen
 * would see a different number from the counter about to charge somebody. Counted in STARTED days, which
 * is how storage is charged everywhere and how a person expects to be billed for one.
 */
export function holdingFeeFor(input: { unclaimedAt?: string; now?: number; shipmentCost?: number; settled?: number }): number {
  if (!input.unclaimedAt) return 0;
  const since = new Date(input.unclaimedAt).getTime();
  if (!Number.isFinite(since)) return 0;
  const elapsed = (input.now ?? Date.now()) - since;
  if (elapsed <= 0) return 0;
  const days = Math.min(Math.ceil(elapsed / 86_400_000), HOLDING_FEE_MAX_DAYS);
  // Never more than the journey itself cost. A parcel with no recorded cost is capped by the days alone.
  const ceiling = input.shipmentCost && input.shipmentCost > 0 ? input.shipmentCost : Number.POSITIVE_INFINITY;
  const accrued = Math.min(round2(days * HOLDING_FEE_PER_DAY), ceiling);
  return Math.max(0, round2(accrued - (input.settled ?? 0)));
}
/**
 * How long a store has to answer a return offer.
 *
 * Days, not the hour a checkout quote gets. A person has to read it, think about a box they cannot see,
 * and decide about their own money — and unlike a checkout, nothing is waiting on the other end of the
 * line. Long enough to survive a weekend; short enough that a stranded parcel's fate is not open ended.
 */
export const RETURN_OFFER_TTL_H = 7 * 24;
/** How often the uncollected sweep runs. Hourly is far finer than the day-scale thing it is watching,
 *  which is the point: the cost of a miss is a reminder a few hours late, and the cost of running is one
 *  pass over the shelf. */
export const UNCOLLECTED_SWEEP_MS = 60 * 60_000;
export const AGENT_ONLINE_H = 1; // counted "online" if pinged within this window

/**
 * FB5 — how a load is assumed to be PACKED when nobody says.
 *
 * A deployment setting, not a network constant, and that is the whole point (user, 2026-08-30): a tonne of
 * sugar is ordinarily poured into a food-grade bulk trailer in Holland and stacked in sacks on a flatbed in
 * Kenya. Neither is "the" default — each is the default WHERE IT IS. `bagged` is right for this deployment;
 * a European one sets GLOS_DEFAULT_PACKAGING=loose and gets tankers where this one gets flatbeds.
 *
 * It is a fallback for API callers only. Every screen that mints freight ASKS, because the person standing
 * at the load is the one who knows, and a default that is usually right is still wrong for the load in front
 * of them. An unrecognised value falls back rather than throwing: a typo in a deployment's environment must
 * not take the whole freight path down.
 */
export const DEFAULT_PACKAGING: Packaging = isPackaging(process.env.GLOS_DEFAULT_PACKAGING) ? process.env.GLOS_DEFAULT_PACKAGING : 'bagged';
