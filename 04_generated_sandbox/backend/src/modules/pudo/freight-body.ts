// FB0b — what BODY a load needs, and how much of that we actually know.
//
// The freight side of the body question. The vehicle has carried a truck subtype since S30
// (TRUCK_SUBTYPE_CATALOG — flatbed, skeletal, reefer, tipper…); the freight has only ever carried what
// EQUIPMENT it needs to be handled and what CAPABILITY the vehicle must have. So "how many kilometres of
// flatbed work were offered this year" has been unanswerable: the supply side of that sentence is recorded
// and the demand side is not.
//
// THE MODELLING RULE (user, 2026-08-30): the minter's body pick is ADVISORY. A shop clerk booking a walk-up
// freight cannot reliably name "skeletal" versus "flatbed", and a binding wrong pick would silently exclude
// the one operator who could have taken the load — the exact failure the open board exists to remove. So the
// freight stores FACTS, this module derives the body from them, and the minter's own pick rides alongside as
// a hint that is shown, compared and counted, but never used to filter.
//
// It follows the precedent already in cargo.types: NATURE_CAPABILITY does not store "needs a reefer", it
// stores FOP and derives cold-chain.

import { VehicleCapability } from './cargo.types';
import { TruckSubtype } from './fleet.config';
// BodyBasis/DerivedBody live in dispatch.types because they are WIRE types — they ride on a Freight, and the
// OpenAPI emitter only introspects the *.types.ts files. Declared here, DerivedBody emitted as an empty
// object and every client would have seen `{}` where the body is. The dependency runs one way only:
// dispatch.types knows nothing about this module.
import { BodyBasis, DerivedBody } from './dispatch.types';

/**
 * Why each body was chosen — the sentence the board shows under the load.
 *
 * A lookup rather than a field on the stored record, because each body maps 1:1 to the rung of the ladder
 * that produced it, and freezing an English sentence onto a durable record would put it beyond translation
 * and beyond correction.
 */
export const BODY_BECAUSE: Record<string, string> = {
  refrigerated: 'the cargo needs an unbroken cold chain',
  hazmat: 'the cargo is hazardous and needs a certified body',
  tipper: 'loose bulk — it tips or augers, it does not sit on a deck',
  lowboy: 'one indivisible piece too large to split — it has to start lower down',
  flatbed: 'too large or too heavy for a closed body — it loads from the side or above',
  box: 'palletised general cargo — a closed body is enough',
};

// A box/dry-van body is the cheap default for palletised general cargo, and these are the points at which a
// load stops fitting one. Rear-door height and internal length are what a load actually fails on, long before
// the payload rating does.
const BOX_MAX_HEIGHT_CM = 240;
const BOX_MAX_LENGTH_CM = 600;
const BOX_MAX_KG = 10_000;
// Beyond these an indivisible single piece is a low-loader job: it cannot be split, so the only way to get it
// under a bridge is to start it lower down.
const LOWBOY_MIN_KG = 20_000;
const LOWBOY_MIN_LENGTH_CM = 1_200;

/**
 * The one body this load canonically needs — deterministic, derived from the load's own recorded facts.
 *
 * ONE load resolves to ONE body on purpose. It is what makes "kilometres of flatbed offered against
 * kilometres of containers moved" a sentence with a meaning: if a load counted toward every body that could
 * possibly carry it, every corridor would show demand for everything and the comparison would say nothing.
 * Substitution — who ELSE can take a canonical-flatbed load — is a separate question, answered by the board
 * against a specific vehicle, not by folding four answers into the demand figure.
 *
 * The ladder is ordered by what CONSTRAINS hardest, so the first rung that fires wins:
 *   1. cold chain   — an insulated box is not a preference, the cargo spoils without it
 *   2. hazmat       — a certified body, likewise not negotiable
 *   3. loose bulk   — self-loading via tipping/silo; no handling gear, but it must not be a flat deck
 *   4. indivisible + very large/heavy — a low-loader, because it cannot be split to fit
 *   5. too big/heavy for a closed body — an open deck
 *   6. everything else — a dry van
 */
export function canonicalBody(load: {
  requiredCapabilities: VehicleCapability[];
  bulk: boolean;
  weightKg: number;
  dimensionsCm?: [number, number, number];
  indivisible?: boolean;
}): DerivedBody {
  const dims = load.dimensionsCm;
  const basis: BodyBasis = dims ? 'measured' : 'weight-only';
  const kg = Number.isFinite(load.weightKg) ? load.weightKg : 0;
  // Orientation-free: a load is judged on its longest and tallest extents however it was written down.
  const longest = dims ? Math.max(...dims) : 0;
  const tallest = dims ? Math.min(...dims) : 0; // the shortest extent is the one it can be laid down on

  if (load.requiredCapabilities.includes('coldChain')) return { body: 'refrigerated', basis };
  if (load.requiredCapabilities.includes('hazmat')) return { body: 'hazmat', basis };
  // Loose bulk (cement, sand, grain) self-loads and self-discharges. A tipper is the general dry-bulk body; a
  // hopper or a bulk tanker is a commodity-specific refinement the freight record cannot yet distinguish.
  if (load.bulk) return { body: 'tipper', basis };
  if (load.indivisible && (kg > LOWBOY_MIN_KG || longest > LOWBOY_MIN_LENGTH_CM)) return { body: 'lowboy', basis };
  if (kg > BOX_MAX_KG || longest > BOX_MAX_LENGTH_CM || tallest > BOX_MAX_HEIGHT_CM) return { body: 'flatbed', basis };
  return { body: 'box', basis };
}

/**
 * The body of a freight as it should be READ — the one stamped on the record when it was registered, or a
 * fresh derivation for a load that predates FB0b.
 *
 * The stamp is the point. A market series has to be reproducible: "kilometres of flatbed work offered in
 * 2026" must not silently change when someone tunes a threshold in this file in 2027. So the conclusion is
 * frozen at registration the same way a freight's price is frozen at claim, and only a record that never got
 * one is derived live — which, having no stored dimensions either, honestly reports itself as weight-only.
 */
export function bodyOf(f: {
  bodyDerived?: DerivedBody;
  requiredCapabilities: VehicleCapability[];
  bulk: boolean;
  weightKg: number;
  dimensionsCm?: [number, number, number];
  indivisible?: boolean;
}): DerivedBody {
  return f.bodyDerived ?? canonicalBody(f);
}

/**
 * Does the shipper's own exclusion rule out this body?
 *
 * Kept deliberately apart from everything else in this file. An exclusion is a PREFERENCE — theft risk, an
 * insurer's wording, a customer's own requirement — and the board has to be able to say "the shipper ruled out
 * open bodies" rather than dressing it up as physics. A preference can be renegotiated; an axle limit cannot,
 * and a board that shows them the same way teaches an operator to ignore both.
 */
export function excludedByShipper(body: TruckSubtype, excluded: TruckSubtype[] | undefined): boolean {
  return Boolean(excluded?.includes(body));
}
