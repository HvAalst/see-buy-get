// Cargo taxonomy (S30) — the step from parcel logistics to multimodal freight orchestration. Three axes:
//   1. CargoClass  P0–P6  — weight + dimensions → a handling lane (PUDO / MDP / dedicated transport).
//   2. CargoNature GEN…HUM — a commodity's primary nature → the incompatibility matrix + a required vehicle
//      capability (perishable → cold chain, hazardous → hazmat).
//   3. Equipment   MAN…STR — what a load needs to be handled at each end (a class → the equipment set).
// Pure data + types; CargoService is the thin injectable that reads them. Nothing here is persisted.

/** Cargo class by weight + dimensions. P0–P1 flow the PUDO pipeline, P2–P3 the MDP pipeline, P4+ require
 *  dedicated transport (they can never enter a tote or a chaos shelf). */
export const CARGO_CLASS_CODES = ['P0', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6'] as const;
export type CargoClass = (typeof CARGO_CLASS_CODES)[number];

/** The handling lane a class is eligible for. A runtime tuple so a DTO can `@IsIn` against it. */
export const CARGO_LANES = ['pudo', 'mdp', 'dedicated'] as const;
export type CargoLane = (typeof CARGO_LANES)[number];

/** A commodity's primary cargo nature — the axis the incompatibility matrix and capability rules run on.
 *  A runtime tuple so a DTO can `@IsIn` against it (single source of truth). */
/**
 * THE NATURES THAT ARE DANGEROUS GOODS in the sense of the road rules (ADR) and the CMR note's box 9: chemical, biological
 * and flammable. Hazardous dust (cement, flour) contaminates but is not classed dangerous goods, and has no UN number.
 * A load of one of these natures carries its UN number, proper shipping name and class from every door it comes in by
 * (the gaps check, 2026-10-29) — the note prints them and the driver’s papers need them.
 */
export const DANGEROUS_GOODS_NATURES = ['HAZ-CHEM', 'HAZ-BIO', 'HAZ-FLAM'] as const;

/** Why a load cannot be posted as it stands — dangerous goods with no UN number — or undefined. */
export function dangerousGoodsGap(nature: string | undefined, dangerousGoods: unknown): string | undefined {
  if (!nature || !(DANGEROUS_GOODS_NATURES as readonly string[]).includes(nature) || dangerousGoods) return undefined;
  return 'These goods are declared dangerous: give their UN number, proper shipping name and class, as on their safety data sheet — the consignment note prints them and the driver’s papers need them.';
}

export const CARGO_NATURES = [
  'GEN', // General dry — non-sensitive, non-hazardous (furniture, clothing, books, tools)
  'FOD', // Food — dry, packaged (rice, pasta, sealed spices)
  'FOP', // Food — perishable, needs temperature control (fresh produce, dairy, meat, frozen)
  'HAZ-CHEM', // Hazardous — chemical (paint, bleach, pesticides, solvents)
  'HAZ-DUST', // Hazardous — dust/powder that contaminates (cement, bulk flour, ash, plaster)
  'HAZ-BIO', // Hazardous — biological (medical waste, lab samples, live animals)
  'HAZ-FLAM', // Hazardous — flammable (LPG, fuel, fireworks)
  'FRG', // Fragile — breakable, non-hazardous (glassware, ceramics, electronics)
  'ODR', // Odorous — strong smell that transfers (perfume, fish, rubber)
  'HUM', // Humanitarian / pharma — medicines, vaccines, aid (chain-of-custody, often cold)
] as const;
export type CargoNature = (typeof CARGO_NATURES)[number];

/** Load/unload equipment codes. A vehicle/site declares what it carries or has on hand; a cargo class
 *  declares what it needs (enforced from S31/S32 — S30 only defines the lookup). */
export const EQUIPMENT = ['MAN', 'HTR', 'PLT', 'FLT', 'TLT', 'CRN', 'RMP', 'STR'] as const;
export type Equipment = (typeof EQUIPMENT)[number];

/** The pairwise verdict from the compatibility matrix. */
export type Compatibility = 'OK' | 'SEGREGATE' | 'INCOMPATIBLE';

/** A boolean handling capability a Vehicle already carries (derived from its truck subtype). A cargo nature
 *  can require one — the enforcement side of the currently-dead vehicle flags.
 *
 *  The list is the runtime half of the type, so a capability the API publishes can never drift from one the
 *  code knows about (`satisfies` pins them together in both directions). */
export const VEHICLE_CAPABILITIES = ['coldChain', 'hazmat', 'carriesBulk', 'allowsFragile'] as const;
export type VehicleCapability = (typeof VEHICLE_CAPABILITIES)[number];

export interface CargoClassSpec {
  cargoClass: CargoClass;
  /** Upper weight bound (kg); the band is (previous.maxKg, maxKg]. P6 is unbounded. */
  maxKg: number;
  /** Max dimensions (cm, any orientation). A within-weight but oversized load bumps to a higher class. */
  maxCm: [number, number, number];
  lane: CargoLane;
  /** Equipment that can handle this class — a vehicle/site needs AT LEAST ONE (any-of). */
  equipment: Equipment[];
}

/** The cargo-class hierarchy: weight bands + dimensional ceilings + the eligible lane. Ascending; the first
 *  band a load fits (by BOTH weight and dims) is its class. */
export const CARGO_CLASSES: CargoClassSpec[] = [
  { cargoClass: 'P0', maxKg: 2, maxCm: [30, 30, 15], lane: 'pudo', equipment: ['MAN'] },
  { cargoClass: 'P1', maxKg: 15, maxCm: [60, 40, 40], lane: 'pudo', equipment: ['MAN'] },
  { cargoClass: 'P2', maxKg: 30, maxCm: [100, 60, 60], lane: 'mdp', equipment: ['MAN'] },
  { cargoClass: 'P3', maxKg: 80, maxCm: [120, 80, 80], lane: 'mdp', equipment: ['HTR'] },
  { cargoClass: 'P4', maxKg: 250, maxCm: [120, 100, 180], lane: 'dedicated', equipment: ['HTR', 'PLT', 'TLT', 'RMP'] },
  { cargoClass: 'P5', maxKg: 1000, maxCm: [120, 100, 220], lane: 'dedicated', equipment: ['PLT', 'FLT', 'TLT', 'RMP', 'STR'] },
  { cargoClass: 'P6', maxKg: Infinity, maxCm: [Infinity, Infinity, Infinity], lane: 'dedicated', equipment: ['FLT', 'CRN', 'STR'] },
];

/** A cargo nature's required vehicle capability (perishable → cold chain; hazardous chemical/bio/flammable →
 *  hazmat-capable). HAZ-DUST needs no special vehicle — a closed body suffices; its risk is CONTAMINATION,
 *  handled entirely by the incompatibility matrix. GEN/FOD/FRG/ODR/HUM need none. */
export const NATURE_CAPABILITY: Partial<Record<CargoNature, VehicleCapability>> = {
  FOP: 'coldChain',
  'HAZ-CHEM': 'hazmat',
  'HAZ-BIO': 'hazmat',
  'HAZ-FLAM': 'hazmat',
};

// The incompatibility matrix, as rows in CARGO_NATURES order. '.'=OK, 'S'=SEGREGATE (may share a vehicle in
// separate sealed containers — a distinct parcel IS such a container), 'X'=INCOMPATIBLE (never the same
// vehicle without a bulkhead). Symmetric by construction (asserted in the tests).
// Base is the spec's formal matrix (§3.2), with the PRACTICAL prose values (§3.3, §5) applied to the cells
// where the two disagreed — a deliberate product decision to favour the softer, real-world behaviour:
//   ODR×FOD, ODR×FOP → SEGREGATE  (perfume/fish may ride with food when each is its own sealed package)
//   HAZ-DUST×HAZ-DUST → SEGREGATE (two cement bags — a "DUST LOAD" on a closed vehicle)
//   HAZ-FLAM×HAZ-FLAM → SEGREGATE (two gas cylinders consolidate on a hazmat vehicle)
// HAZ-BIO×HAZ-BIO stays INCOMPATIBLE (biologicals are a dedicated-container class, §3.1).
// NOTE: '*' cells in the source encode a temperature sub-rule (FOP+FOP / HUM+FOP must share a temp range)
// that needs a per-parcel temperature field this slice does not yet carry — encoded at the base value, later.
type Cell = '.' | 'S' | 'X';
const MATRIX_ROWS: Record<CargoNature, Cell[]> = {
  //            GEN  FOD  FOP  CHEM DUST BIO  FLAM FRG  ODR  HUM
  GEN: /*    */ ['.', '.', 'S', 'X', 'X', 'X', 'X', 'S', 'S', '.'],
  FOD: /*    */ ['.', '.', 'S', 'X', 'X', 'X', 'X', 'S', 'S', 'S'],
  FOP: /*    */ ['S', 'S', '.', 'X', 'X', 'X', 'X', 'S', 'S', 'S'],
  'HAZ-CHEM': ['X', 'X', 'X', 'S', 'X', 'X', 'X', 'X', 'X', 'X'],
  'HAZ-DUST': ['X', 'X', 'X', 'X', 'S', 'X', 'X', 'X', 'X', 'X'],
  'HAZ-BIO': /**/ ['X', 'X', 'X', 'X', 'X', 'X', 'X', 'X', 'X', 'X'],
  'HAZ-FLAM': ['X', 'X', 'X', 'X', 'X', 'X', 'S', 'X', 'X', 'X'],
  FRG: /*    */ ['S', 'S', 'S', 'X', 'X', 'X', 'X', '.', 'S', 'S'],
  ODR: /*    */ ['S', 'S', 'S', 'X', 'X', 'X', 'X', 'S', 'S', 'X'],
  HUM: /*    */ ['.', 'S', 'S', 'X', 'X', 'X', 'X', 'S', 'X', '.'],
};

const CELL_TO_COMPAT: Record<Cell, Compatibility> = { '.': 'OK', S: 'SEGREGATE', X: 'INCOMPATIBLE' };

/** The compatibility matrix as a symmetric lookup: COMPAT_MATRIX[a][b] === COMPAT_MATRIX[b][a]. */
export const COMPAT_MATRIX: Record<CargoNature, Record<CargoNature, Compatibility>> = (() => {
  const out = {} as Record<CargoNature, Record<CargoNature, Compatibility>>;
  CARGO_NATURES.forEach((row) => {
    out[row] = {} as Record<CargoNature, Compatibility>;
    CARGO_NATURES.forEach((col, j) => {
      out[row][col] = CELL_TO_COMPAT[MATRIX_ROWS[row][j]];
    });
  });
  return out;
})();
