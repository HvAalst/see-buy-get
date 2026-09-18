import { Equipment } from './cargo.types';
import { TruckSubtype } from './fleet.config';

/**
 * WHAT KIND OF BOX IT IS — the one fact that makes an open top, a high-cube and a tank different bookings.
 *
 * The question that produced this file: *"how does booking an open top container differ from an extra high
 * 40ft container in our system? or a food grade 20ft liquid tank from a crude oil product tank container?"*
 * The answer was that it did not differ at all. A consignment carried a free-text goods description and a
 * free-text container number, and every box on earth produced the same record — then minted the same
 * generic road leg, to be offered to whatever truck was nearest.
 *
 * A CATALOGUE, SELECTED AND NEVER INVENTED, exactly as countries and Incoterms are. These are ISO 6346
 * size/type codes, and the discipline matters more than the completeness: we do NOT parse the standard
 * generically, because a parser would answer confidently about codes nobody here has ever booked and be
 * wrong in the corners. What is listed is what this network books, each with its real measurements, and
 * adding one is an edit to this table by somebody who has seen the box.
 *
 * WHAT IS DERIVED FROM THE CODE, and therefore never typed by a person: the external height (which is what
 * decides an over-height road movement), whether it has a roof, whether it is a tank, which bodies can
 * carry it and what has to lift it. A shop clerk guessing "skeletal or flatbed" is exactly the input FB0b
 * refused to build a market series on.
 *
 * WHAT CANNOT BE DERIVED, and so is DECLARED by the importer: what is actually inside. No code tells you
 * whether a 22T1 holds olive oil or gas oil, and that difference is the whole distance between a cleaning
 * certificate and a UN number. We carry the declaration; we never classify the goods.
 */
export interface ContainerTypeSpec {
  /** The ISO 6346 size/type code, as printed on the box: 45G1, 22U1, 22T1. */
  code: string;
  label: string;
  /** Nominal length, for a person reading it. The code's first character is the authority. */
  lengthFt: 20 | 40 | 45;
  /**
   * EXTERNAL height in metres — the number that decides whether it fits under a bridge.
   *
   * Standard is 8'6" (2.591 m) and a high-cube is 9'6" (2.896 m). That 30 cm is the difference between a
   * routine movement and one that has to be routed, and it was invisible to this system.
   */
  heightM: number;
  /** External width. 2.438 m for everything here; pallet-wide boxes would be their own entries. */
  widthM: number;
  kind: 'dry' | 'open' | 'tank' | 'reefer' | 'flat' | 'bulk';
  /**
   * NO FIXED ROOF: loaded from above by crane, not weatherproof, and the cargo may stand above the box —
   * which makes the container's own height a floor rather than the answer.
   */
  openTop: boolean;
  /** A reefer needs power on the road, which is a capability and not a preference. */
  needsPower: boolean;
  /** The bodies that can carry it. A box needs a chassis; nothing else will do. */
  bodies: TruckSubtype[];
  /** What has to lift it at an end that has no crane of its own. */
  equipment: Equipment[];
}

/** 2.438 m — 8 ft. Every box in this catalogue; a pallet-wide one would be its own entry. */
const W = 2.438;
/** 8'6" and 9'6" in metres. Named, because the 30 cm between them is the point of this file. */
const STANDARD_H = 2.591;
const HIGH_CUBE_H = 2.896;

/**
 * The boxes this network books. Ordered as somebody reading a list would expect, not by code.
 *
 * `skeletal` is the container chassis and `container_selfloader` the sidelifter, which can put a box on
 * the ground without a crane at either end — the difference between a delivery to a depot and a delivery
 * to a farm gate.
 */
export const CONTAINER_TYPES: ContainerTypeSpec[] = [
  { code: '22G1', label: '20ft general purpose', lengthFt: 20, heightM: STANDARD_H, widthM: W, kind: 'dry', openTop: false, needsPower: false, bodies: ['skeletal', 'container_selfloader', 'flatbed'], equipment: ['TLT', 'CRN'] },
  { code: '42G1', label: '40ft general purpose', lengthFt: 40, heightM: STANDARD_H, widthM: W, kind: 'dry', openTop: false, needsPower: false, bodies: ['skeletal', 'container_selfloader'], equipment: ['TLT', 'CRN'] },
  // THE ONE THE QUESTION NAMED. Same footprint as a 42G1, 30 cm taller, and that is a bridge question.
  { code: '45G1', label: '40ft high-cube', lengthFt: 40, heightM: HIGH_CUBE_H, widthM: W, kind: 'dry', openTop: false, needsPower: false, bodies: ['skeletal', 'container_selfloader'], equipment: ['TLT', 'CRN'] },
  { code: 'L5G1', label: '45ft high-cube', lengthFt: 45, heightM: HIGH_CUBE_H, widthM: W, kind: 'dry', openTop: false, needsPower: false, bodies: ['skeletal'], equipment: ['TLT', 'CRN'] },
  // OPEN TOPS. A tarpaulin, not a roof: craned from above, and the cargo may stand proud of the box.
  { code: '22U1', label: '20ft open top', lengthFt: 20, heightM: STANDARD_H, widthM: W, kind: 'open', openTop: true, needsPower: false, bodies: ['skeletal', 'container_selfloader', 'flatbed'], equipment: ['CRN'] },
  { code: '42U1', label: '40ft open top', lengthFt: 40, heightM: STANDARD_H, widthM: W, kind: 'open', openTop: true, needsPower: false, bodies: ['skeletal', 'container_selfloader'], equipment: ['CRN'] },
  // FLAT RACKS — no sides either, so anything over-width rides here and the permit conversation starts.
  { code: '22P1', label: '20ft flat rack', lengthFt: 20, heightM: 2.35, widthM: W, kind: 'flat', openTop: true, needsPower: false, bodies: ['skeletal', 'flatbed', 'lowboy'], equipment: ['CRN'] },
  { code: '42P1', label: '40ft flat rack', lengthFt: 40, heightM: 2.35, widthM: W, kind: 'flat', openTop: true, needsPower: false, bodies: ['skeletal', 'flatbed', 'lowboy'], equipment: ['CRN'] },
  // REEFERS. The power is the point: a box that loses it on the road is a total loss of cargo.
  { code: '22R1', label: '20ft refrigerated', lengthFt: 20, heightM: STANDARD_H, widthM: W, kind: 'reefer', openTop: false, needsPower: true, bodies: ['skeletal'], equipment: ['TLT', 'CRN'] },
  { code: '45R1', label: '40ft high-cube refrigerated', lengthFt: 40, heightM: HIGH_CUBE_H, widthM: W, kind: 'reefer', openTop: false, needsPower: true, bodies: ['skeletal'], equipment: ['TLT', 'CRN'] },
  /*
   * TANKS. The other half of the question, and the half where the CODE tells you almost nothing.
   *
   * 22T1 and 22T6 are both 20ft tanks; the digit is a test-pressure band, not a cargo. Whether the box
   * may carry food is decided by what it last held and by a cleaning certificate — see the consignment's
   * tank declaration. Two identical 22T1s, one carrying edible oil and one carrying gas oil, are two
   * entirely different movements, and nothing in this table can tell them apart. That is the point of
   * making the goods a DECLARATION rather than something we read out of a description.
   */
  { code: '22T1', label: '20ft tank (low pressure)', lengthFt: 20, heightM: 2.591, widthM: W, kind: 'tank', openTop: false, needsPower: false, bodies: ['skeletal'], equipment: ['TLT', 'CRN'] },
  { code: '22T6', label: '20ft tank (high pressure)', lengthFt: 20, heightM: 2.591, widthM: W, kind: 'tank', openTop: false, needsPower: false, bodies: ['skeletal'], equipment: ['TLT', 'CRN'] },
  // DRY BULK — discharged by gravity or air, never opened to the weather.
  { code: '22B1', label: '20ft dry bulk', lengthFt: 20, heightM: STANDARD_H, widthM: W, kind: 'bulk', openTop: false, needsPower: false, bodies: ['skeletal'], equipment: ['TLT', 'CRN'] },
];

export const CONTAINER_TYPE_CODES = CONTAINER_TYPES.map((c) => c.code);

export function containerType(code?: string): ContainerTypeSpec | undefined {
  if (!code) return undefined;
  const want = code.trim().toUpperCase();
  return CONTAINER_TYPES.find((c) => c.code === want);
}

/**
 * HOW TALL IT STANDS ON THIS DECK — the number the bridge map has been asking for since it was built.
 *
 * Both halves or nothing: a container height with no deck is not an answer, and the road map's
 * HEIGHT_UNKNOWN is the honest reply. "A 4.0 m load is 5.2 m on a flatbed and 4.4 m on a lowboy" is the
 * comment that has sat in dispatch since the constraint map shipped, explaining why no height was passed.
 *
 * AN OPEN TOP RETURNS UNDEFINED unless somebody has said how tall the cargo stands, and that refusal is
 * the whole reason this function exists rather than an addition inline. A box with no roof tells you the
 * height of the FLOOR the cargo sits on, not the height of the movement, and answering with the box's own
 * figure would clear a load standing a metre above it — the precise silent pass the hazard map refuses.
 */
export function standsOn(deckM: number | undefined, spec: ContainerTypeSpec | undefined, declaredCargoHeightM?: number): number | undefined {
  if (deckM == null || !spec) return undefined;
  if (spec.openTop) {
    return declaredCargoHeightM == null ? undefined : Math.round((deckM + declaredCargoHeightM) * 100) / 100;
  }
  return Math.round((deckM + spec.heightM) * 100) / 100;
}

/** True where the cargo stands above an open box, so the movement is out of gauge whatever the road says. */
export function outOfGauge(spec: ContainerTypeSpec | undefined, declaredCargoHeightM?: number): boolean {
  if (!spec?.openTop || declaredCargoHeightM == null) return false;
  return declaredCargoHeightM > spec.heightM;
}
