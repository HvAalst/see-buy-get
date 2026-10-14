// FB5 — HOW A LOAD IS PRESENTED FOR HANDLING, which is not a property of the commodity.
//
// The correction that produced this module (user, 2026-08-30):
//
//   "Sugar in Holland is loaded in bulk in a dedicated food grade bulk trailer, cement alike in a non food
//    trailer and unloaded with air pressure. In Africa it's loaded in bags on a flatbed."
//
// Sugar is sugar on both continents. What changes is the PACKAGING, and packaging is what decides the body
// and the handling kit — not the goods. The old model had a single `bulk: boolean` that tried to carry this,
// and it had drifted into meaning two opposite things in two different files:
//
//   fleet.config  VehicleClassSpec.carriesBulk  "bulk cargo (sugar/cement bags) — trucks only"   ← BAGS
//   freight-body  BODY_BECAUSE.tipper           "loose bulk — it tips or augers, it does not…"   ← LOOSE
//
// Those are opposite handling regimes: one is lifted off a deck by hand or forklift, the other is blown out
// with air pressure and touches nobody. A boolean cannot hold both, and the consequence was not academic —
// bagged cement derived to a tipper and reported requiring NO handling equipment, which is the "you would
// need a forklift" signal going silent on the loads that need it most.
//
// So the freight records how it is PACKED, the body and the kit are derived from that, and nobody has to
// guess a continent from a commodity.

import { CargoNature } from './cargo.types';
import { TruckSubtype } from './fleet.config';

/**
 * How the goods are presented — seven, because the user asked for the distinctions a forwarder actually
 * makes, and because drums, bales and IBCs each secure and lift differently from a pallet.
 *
 * The test for belonging on this list is not "is it a kind of container" but "does it change the BODY or the
 * KIT". Anything that changes neither belongs in the description, not here.
 */
export const PACKAGING = ['loose', 'bagged', 'palletised', 'drummed', 'baled', 'ibc', 'piece'] as const;
export type Packaging = (typeof PACKAGING)[number];

/**
 * Only LOOSE goods load and discharge themselves — poured, blown, augered, tipped. Everything else has to be
 * lifted, and something has to do the lifting.
 *
 * This is the single most consequential line in the module. It replaces `bulk` in the requiredEquipment
 * decision, and it is the reason bagged cement now correctly asks for hands or a forklift where it used to
 * ask for nothing at all.
 */
export function selfLoading(packaging: Packaging): boolean {
  return packaging === 'loose';
}

/**
 * The body LOOSE goods need, which depends entirely on what is being poured.
 *
 * Loose is the only packaging where the commodity really does decide the body, because the discharge
 * mechanism is part of the body: powder is blown, grain is augered, liquid is pumped, aggregate is tipped.
 *
 * A KNOWN GAP, stated rather than papered over: the nature vocabulary cannot tell grain from sugar from
 * milk — they are all FOD/FOP — so `grain_hopper` and `water_bowser` are not reachable from here even though
 * the catalogue has them. Food-grade bulk is answered with `food_tanker`, which is the body the user named
 * for Dutch sugar. Narrowing it needs a finer nature, not a cleverer rule here.
 */
function looseBody(nature: CargoNature): TruckSubtype {
  switch (nature) {
    case 'HAZ-FLAM':
      return 'fuel_tanker'; // flammable liquid in bulk
    case 'HAZ-DUST':
      return 'bulk_tanker'; // cement, flour, ash — a sealed silo discharged with air pressure
    case 'FOD':
    case 'FOP':
      return 'food_tanker'; // food-grade bulk: the trailer may carry nothing else
    default:
      return 'tipper'; // sand, gravel, spoil — it tips
  }
}

/**
 * The body PACKAGED goods need. Size still decides among the open options (that ladder lives in
 * freight-body), so this answers only the question packaging alone can settle: open deck, or closed body.
 *
 * Sacks and bales ride a deck and are tarped — a closed box cannot be side-loaded by six people with a
 * conveyor, which is how a bagged load is actually put on. Pallets, drums and IBCs are forklift work into a
 * closed body, which is also what keeps them dry.
 */
export function packagedPrefersOpenDeck(packaging: Packaging): boolean {
  return packaging === 'bagged' || packaging === 'baled';
}

/** The body a load needs on packaging grounds alone, before size is considered. Null for `piece`, which is
 *  decided entirely by its measurements, and for `loose`, which is answered by `looseBody`. */
export function bodyForPackaging(packaging: Packaging, nature: CargoNature): TruckSubtype | null {
  if (packaging === 'loose') return looseBody(nature);
  if (packaging === 'piece') return null; // ask the tape measure, not the wrapping
  return packagedPrefersOpenDeck(packaging) ? 'flatbed' : 'box';
}

/**
 * Why this body — the sentence the board shows under a load, keyed by packaging rather than by body.
 *
 * Separate from BODY_BECAUSE (which explains a body chosen on SIZE) because the same body arrives for
 * completely different reasons: a flatbed for sacks is not a flatbed for a six-metre girder, and an operator
 * reading the board deserves the real reason.
 */
export const PACKAGING_BECAUSE: Record<Packaging, string> = {
  loose: 'poured, blown or tipped — it is not lifted, and it must not sit on a flat deck',
  bagged: 'sacks worked on and off a deck by hand, conveyor or forklift',
  palletised: 'forklift work into a closed body',
  drummed: 'drums lifted into a closed body and strapped upright',
  baled: 'bales strapped to an open deck and sheeted',
  ibc: 'IBC cubes forklifted into a closed body',
  piece: 'one piece, sized and secured on its own terms',
};

/** Is this a value the API accepts? Used to reject junk without importing the whole enum machinery. */
export function isPackaging(v: unknown): v is Packaging {
  return typeof v === 'string' && (PACKAGING as readonly string[]).includes(v);
}

/**
 * Read the packaging off a record that may predate this field.
 *
 * A freight written before FB5 carries only the ambiguous `bulk`, so it is read as the meaning the DERIVATION
 * used at the time — `true` was taken as loose. That keeps a historical record consistent with the body that
 * was stamped on it, which matters because those stamps are frozen and feed the market series.
 *
 * It is a READ shim, deliberately not a backfill: rewriting the stamps would change history, and leaving the
 * old records readable under the rule they were written by is the honest half of the trade.
 */
export function packagingOf(f: { packaging?: Packaging; bulk?: boolean }): Packaging {
  if (f.packaging && isPackaging(f.packaging)) return f.packaging;
  return f.bulk ? 'loose' : 'palletised';
}
