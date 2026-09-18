import { Equipment } from './cargo.types';
import { TruckSubtype } from './fleet.config';

/**
 * WHAT KIND OF BOX IT IS — every ISO 6346 size/type code, not a shortlist of them.
 *
 * The question that produced this file: *"how does booking an open top container differ from an extra high
 * 40ft container in our system? or a food grade 20ft liquid tank from a crude oil product tank container?"*
 * The answer was that it did not differ at all: every box on earth produced the same record and minted the
 * same generic road leg, to be offered to whatever truck was nearest.
 *
 * THE FIRST ATTEMPT WAS A SHORTLIST, AND IT WAS WRONG. Twenty-five boxes somebody had seen, plus a way to
 * declare anything missing — which made the catalogue's own incompleteness into a second door, and treated
 * the trader with a 30ft, a pallet-wide or a livestock carrier as an exception to a table that should have
 * held them. "List them all rather," which is right, and it is also POSSIBLE: ISO 6346 does not enumerate
 * containers, it DECOMPOSES a code into three published tables.
 *
 *   4  5  G1   →   length 4 = 40ft   ·   height/width 5 = 9'6" at 8'0" wide   ·   type G1 = general purpose
 *
 * So this file holds those three tables in full and resolves any code built from them. It is still
 * SELECTED AND NEVER INVENTED, the way countries and Incoterms are — the tables ARE the standard,
 * transcribed — and a correction is an edit to one row rather than a patch to a parser's guesswork.
 *
 * WHAT WE STILL DO NOT ASSERT, and this is the important half:
 *
 *  - FOUR SIZE CODES ARE OPEN RANGES. `6`, `F` and `P` mean "taller than 2896 mm" and `9` means "shorter
 *    than 1219 mm". The standard itself declines to say how tall, so we do too: the height comes back
 *    undefined, the road leg has no height to pass, and the hazard map answers HEIGHT_UNKNOWN until
 *    somebody measures the thing. Inventing 2.9 m for a code that means "more than 2.9 m" would be the
 *    exact silent pass the whole bridge check exists to refuse.
 *  - TANK PRESSURE BANDS. T0–T9 encode test pressures, and we hold the GROUP (non-dangerous liquids,
 *    dangerous liquids, gases) rather than a figure in bar. A wrong bar figure is worse than none, and we
 *    certify no tanks: what makes one fit for a cargo is its papers, which live on the consignment.
 *  - WHAT IS INSIDE. No code distinguishes a 22T1 of olive oil from a 22T1 of gas oil. That is declared.
 */

/** The kinds a code resolves to — what actually changes how a box is carried. Ours, not the standard's. */
export const CONTAINER_KINDS = ['dry', 'vented', 'bulk', 'named', 'tank', 'reefer', 'insulated', 'open', 'flat', 'air'] as const;
export type ContainerKind = (typeof CONTAINER_KINDS)[number];

export interface ContainerTypeSpec {
  /** The code as printed on the box: 45G1, 22U1, 22T1, 29P0. */
  code: string;
  /** Built from the three tables, so it reads the way somebody would say it out loud. */
  label: string;
  /** Nominal external length in metres, from the first character. */
  lengthM: number;
  /** For a person: 20, 40, 45… Absent for the lengths with no round-foot name. */
  lengthFt?: number;
  /**
   * EXTERNAL height in metres — the number that decides whether it fits under a bridge.
   *
   * UNDEFINED for the codes that mean "taller than" or "shorter than" a bound. The standard does not say,
   * so neither do we, and the consequence is honest: no height to pass, and the map says it does not know.
   */
  heightM?: number;
  /** External width in metres. Undefined where the code means only "wider than" a bound. */
  widthM?: number;
  /** True where the code names a pallet-wide box — the 2.5 m class rather than 8'0". */
  palletWide: boolean;
  kind: ContainerKind;
  /** No fixed roof: craned from above, not weatherproof, and the cargo may stand above the box. */
  openTop: boolean;
  /** Needs power or a clip-on unit on the road. A box that loses it is a total loss of cargo. */
  needsPower: boolean;
  /** The bodies that can carry it. Every box needs a chassis; the length decides what else. */
  bodies: TruckSubtype[];
  /** What has to lift it at an end with no crane of its own. */
  equipment: Equipment[];
  /** The standard's own grouping, carried because that is what a depot and a line will call it. */
  group: string;
}

/**
 * TABLE 1 — LENGTH. The first character, in millimetres of external length.
 *
 * `ft` is only for reading aloud: several of these have no round-foot name, and the millimetre figure is
 * the authority in every case.
 */
const LENGTH_CODES: Record<string, { mm: number; ft?: number }> = {
  '1': { mm: 2991, ft: 10 },
  '2': { mm: 6058, ft: 20 },
  '3': { mm: 9125, ft: 30 },
  '4': { mm: 12192, ft: 40 },
  B: { mm: 7150 },
  C: { mm: 7315, ft: 24 },
  D: { mm: 7430 },
  E: { mm: 7820 },
  F: { mm: 8100 },
  G: { mm: 12500, ft: 41 },
  H: { mm: 13106, ft: 43 },
  K: { mm: 13600 },
  L: { mm: 13716, ft: 45 },
  M: { mm: 14630, ft: 48 },
  N: { mm: 14935, ft: 49 },
  P: { mm: 16154, ft: 53 },
};

/**
 * TABLE 2 — HEIGHT AND WIDTH. The second character.
 *
 * `heightMm` absent means the code is an OPEN RANGE — "taller than" or "shorter than". That is the
 * standard's own refusal to be specific, and it travels all the way to the bridge check as
 * HEIGHT_UNKNOWN rather than being filled in with a plausible number.
 */
const HEIGHT_CODES: Record<string, { heightMm?: number; widthMm?: number; palletWide: boolean; note?: string }> = {
  '0': { heightMm: 2438, widthMm: 2438, palletWide: false },
  '2': { heightMm: 2591, widthMm: 2438, palletWide: false },
  '4': { heightMm: 2743, widthMm: 2438, palletWide: false },
  '5': { heightMm: 2896, widthMm: 2438, palletWide: false },
  '6': { widthMm: 2438, palletWide: false, note: 'taller than 2896 mm' },
  '8': { heightMm: 1295, widthMm: 2438, palletWide: false },
  '9': { widthMm: 2438, palletWide: false, note: 'shorter than 1219 mm' },
  // The pallet-wide family: wider than 2438 mm, so the width itself is a bound rather than a figure.
  C: { heightMm: 2591, palletWide: true },
  D: { heightMm: 2743, palletWide: true },
  E: { heightMm: 2896, palletWide: true },
  F: { palletWide: true, note: 'taller than 2896 mm, pallet-wide' },
  L: { heightMm: 2591, palletWide: true },
  M: { heightMm: 2743, palletWide: true },
  N: { heightMm: 2896, palletWide: true },
  P: { palletWide: true, note: 'taller than 2896 mm, pallet-wide' },
};

/**
 * TABLE 3 — TYPE. The third and fourth characters, in full.
 *
 * `kind` is ours rather than the standard's: it is the shape of the question a road leg has to answer —
 * does this need a crane, does it need power, is it a tank, is the roof open. The standard's own group
 * travels beside it in `group`.
 */
const TYPE_CODES: Record<string, { group: string; what: string; kind: ContainerKind; openTop?: boolean; needsPower?: boolean }> = {
  // GENERAL PURPOSE, no ventilation.
  G0: { group: 'general purpose', what: 'openings at one or both ends', kind: 'dry' },
  G1: { group: 'general purpose', what: 'passive vents at the top of the cargo space', kind: 'dry' },
  G2: { group: 'general purpose', what: 'openings at the ends and at one or both sides', kind: 'dry' },
  G3: { group: 'general purpose', what: 'full openings at one or both sides', kind: 'dry' },
  /*
   * VENTILATED — and the absence of these from the first shortlist was its worst omission. A 22V0 is the
   * box East African coffee and cocoa leave in: vents low and high, so a hygroscopic crop breathes
   * instead of sweating into its own sacks. It looks like a dry box and is a different booking.
   */
  V0: { group: 'ventilated', what: 'passive vents at the lower and upper parts of the cargo space', kind: 'vented' },
  V2: { group: 'ventilated', what: 'mechanical ventilation, fitted inside', kind: 'vented' },
  V4: { group: 'ventilated', what: 'mechanical ventilation, fitted outside', kind: 'vented' },
  // DRY BULK — discharged by gravity, tipping or air, never opened to the weather.
  B0: { group: 'dry bulk', what: 'closed', kind: 'bulk' },
  B1: { group: 'dry bulk', what: 'airtight', kind: 'bulk' },
  B3: { group: 'dry bulk', what: 'horizontal discharge, pressurised', kind: 'bulk' },
  B4: { group: 'dry bulk', what: 'horizontal discharge, higher pressure', kind: 'bulk' },
  B5: { group: 'dry bulk', what: 'tipping discharge, pressurised', kind: 'bulk' },
  B6: { group: 'dry bulk', what: 'tipping discharge, higher pressure', kind: 'bulk' },
  // NAMED CARGO. Three of them, and each is its own world of paperwork: livestock is a permit and a vet,
  // a car is a chassis number and a duty question, live fish is oxygen and time.
  S0: { group: 'named cargo', what: 'livestock carrier', kind: 'named' },
  S1: { group: 'named cargo', what: 'automobile carrier', kind: 'named' },
  S2: { group: 'named cargo', what: 'live fish carrier', kind: 'named', needsPower: true },
  /*
   * TANKS. The group is held and the test pressure is NOT: a wrong figure in bar is worse than none, and
   * we certify no tanks. What makes a tank fit for a cargo is its last cargoes and a cleaning
   * certificate, which live on the consignment as the importer's declaration — because 22T1 and 22T1 are
   * the same code whether the tank holds olive oil or gas oil.
   */
  T0: { group: 'tank (non-dangerous liquids)', what: 'lowest test pressure band', kind: 'tank' },
  T1: { group: 'tank (non-dangerous liquids)', what: 'low test pressure band', kind: 'tank' },
  T2: { group: 'tank (non-dangerous liquids)', what: 'higher test pressure band', kind: 'tank' },
  T3: { group: 'tank (dangerous liquids)', what: 'low test pressure band', kind: 'tank' },
  T4: { group: 'tank (dangerous liquids)', what: 'higher test pressure band', kind: 'tank' },
  T5: { group: 'tank (dangerous liquids)', what: 'highest liquid test pressure band', kind: 'tank' },
  T6: { group: 'tank (gases)', what: 'low test pressure band', kind: 'tank' },
  T7: { group: 'tank (gases)', what: 'higher test pressure band', kind: 'tank' },
  T8: { group: 'tank (gases)', what: 'highest test pressure band', kind: 'tank' },
  T9: { group: 'tank (gases)', what: 'test pressure not assigned by the standard', kind: 'tank' },
  // THERMAL, mechanically refrigerated. The power is the point.
  R0: { group: 'refrigerated', what: 'mechanically refrigerated', kind: 'reefer', needsPower: true },
  R1: { group: 'refrigerated', what: 'mechanically refrigerated and heated', kind: 'reefer', needsPower: true },
  R2: { group: 'refrigerated', what: 'mechanically refrigerated, self-powered', kind: 'reefer', needsPower: true },
  R3: { group: 'refrigerated', what: 'mechanically refrigerated and heated, self-powered', kind: 'reefer', needsPower: true },
  // THERMAL with REMOVABLE equipment — the porthole box. It needs a unit clipped on, which a yard either
  // has or does not, so it is a capability question rather than a preference.
  H0: { group: 'thermal, removable equipment', what: 'refrigerated or heated, equipment fitted outside', kind: 'reefer', needsPower: true },
  H1: { group: 'thermal, removable equipment', what: 'refrigerated or heated, equipment fitted inside', kind: 'reefer', needsPower: true },
  H2: { group: 'thermal, removable equipment', what: 'heated, equipment fitted outside', kind: 'reefer', needsPower: true },
  // THERMAL, insulated only: no machinery at all, so nothing to plug in and nothing to fail.
  H5: { group: 'insulated', what: 'insulated', kind: 'insulated' },
  H6: { group: 'insulated', what: 'insulated, higher heat transfer', kind: 'insulated' },
  // OPEN TOP. A tarpaulin or a removable roof, never a fixed one: craned from above, and the cargo may
  // stand proud of the box — which makes the container's own height a floor rather than the answer.
  U0: { group: 'open top', what: 'openings at one or both ends', kind: 'open', openTop: true },
  U1: { group: 'open top', what: 'removable top member in the end frames', kind: 'open', openTop: true },
  U2: { group: 'open top', what: 'openings at the ends and at one or both sides', kind: 'open', openTop: true },
  U3: { group: 'open top', what: 'openings at the ends and sides, removable top member', kind: 'open', openTop: true },
  U4: { group: 'open top', what: 'end openings and partial side openings', kind: 'open', openTop: true },
  U5: { group: 'open top', what: 'no side or end doors', kind: 'open', openTop: true },
  // PLATFORMS AND FLAT RACKS. No sides, so anything over-width rides here and the permit conversation
  // starts; a folding end is what makes the empty return leg affordable.
  P0: { group: 'platform', what: 'bare platform (bolster)', kind: 'flat', openTop: true },
  P1: { group: 'flat rack', what: 'two complete and fixed ends', kind: 'flat', openTop: true },
  P2: { group: 'flat rack', what: 'fixed posts', kind: 'flat', openTop: true },
  P3: { group: 'flat rack', what: 'folding complete end structure', kind: 'flat', openTop: true },
  P4: { group: 'flat rack', what: 'folding posts', kind: 'flat', openTop: true },
  P5: { group: 'platform', what: 'open top and open ends (skeletal)', kind: 'flat', openTop: true },
  // AIR/SURFACE — the lightweight box built for an aircraft hold, which is a different world again.
  A0: { group: 'air/surface', what: 'air/surface container', kind: 'air' },
};

/** What can carry a box of this length, and what has to lift it. Derived, so no row repeats itself. */
function carriage(lengthMm: number, openTop: boolean): { bodies: TruckSubtype[]; equipment: Equipment[] } {
  const bodies: TruckSubtype[] = ['skeletal'];
  // A sidelifter handles the 20–40ft family, and it is the difference between a delivery to a depot and
  // one to a farm gate: it puts the box on the ground with no crane at either end.
  if (lengthMm <= 12192) bodies.push('container_selfloader');
  // A short box will sit on an ordinary flatbed; a 40ft will not.
  if (lengthMm <= 7500) bodies.push('flatbed');
  // Anything with no roof may be carrying something over-height, which is a lowboy conversation.
  if (openTop) bodies.push('lowboy');
  // A closed box can be top-lifted by its corner castings. An open one is CRANED: there is no roof to
  // grip, and that changes which yards can handle it at all.
  return { bodies, equipment: openTop ? ['CRN'] : ['TLT', 'CRN'] };
}

const m = (mm: number) => Math.round(mm) / 1000;

/**
 * RESOLVE A CODE — by decomposition, which is how the standard is actually built.
 *
 * Three lookups and a refusal. A code whose characters are not in the tables is not "unlisted", it is
 * INVALID, and saying so is more useful than carrying it as a label: `45GI` is a typo for `45G1`, and a
 * system that shrugged and accepted it would lose the height, the body and the bridge check in silence.
 */
export function containerType(code?: string): ContainerTypeSpec | undefined {
  const want = code?.trim().toUpperCase();
  if (!want || want.length !== 4) return undefined;
  const length = LENGTH_CODES[want[0]];
  const size = HEIGHT_CODES[want[1]];
  const type = TYPE_CODES[want.slice(2)];
  if (!length || !size || !type) return undefined;

  const openTop = type.openTop ?? false;
  const { bodies, equipment } = carriage(length.mm, openTop);
  const heightM = size.heightMm != null ? m(size.heightMm) : undefined;
  const feet = length.ft ? `${length.ft}ft` : `${m(length.mm).toFixed(2)} m`;
  const tall = heightM != null ? `${heightM.toFixed(3)} m` : (size.note ?? 'height not stated by the code');

  return {
    code: want,
    label: `${feet}, ${tall}${size.palletWide ? ', pallet-wide' : ''} — ${type.group} (${type.what})`,
    lengthM: m(length.mm),
    ...(length.ft ? { lengthFt: length.ft } : {}),
    ...(heightM != null ? { heightM } : {}),
    ...(size.widthMm != null ? { widthM: m(size.widthMm) } : {}),
    palletWide: size.palletWide,
    kind: type.kind,
    openTop,
    needsPower: type.needsPower ?? false,
    bodies,
    equipment,
    group: type.group,
  };
}

/** Every code the tables can build. Thousands, so this exists for a test and never for a dropdown. */
export function allContainerCodes(): string[] {
  const out: string[] = [];
  for (const l of Object.keys(LENGTH_CODES)) for (const h of Object.keys(HEIGHT_CODES)) for (const t of Object.keys(TYPE_CODES)) out.push(`${l}${h}${t}`);
  return out;
}

/**
 * THE ONES A PICKER OFFERS FIRST — a suggestion list, not the boundary of what is accepted.
 *
 * The tables accept every valid code, which is thousands of combinations and an unusable dropdown. So a
 * screen offers these and takes anything that resolves. COMPLETENESS LIVES IN WHAT WE ACCEPT; curation
 * only in what we SUGGEST, and confusing the two is exactly what made the first version of this file a
 * shortlist with an escape hatch bolted onto it.
 */
export const COMMON_CONTAINER_CODES = [
  '22G1',
  '25G1',
  '42G1',
  '45G1',
  'L5G1',
  '22V0',
  '42V0',
  '22U1',
  '42U1',
  '45U1',
  '22P1',
  '42P1',
  '22P3',
  '42P3',
  '22P0',
  '29P0',
  '22R1',
  '42R1',
  '45R1',
  'L5R1',
  '22T1',
  '22T4',
  '22T7',
  '22B1',
  '22S0',
  '42S1',
  '22H5',
];

/** The suggestion list, resolved. Anything the tables accept is equally valid — see the comment above. */
export const CONTAINER_TYPES: ContainerTypeSpec[] = COMMON_CONTAINER_CODES.map((c) => containerType(c)).filter((c): c is ContainerTypeSpec => Boolean(c));

/**
 * HOW TALL IT STANDS ON THIS DECK — the number the bridge map has been asking for since it was built.
 *
 * Both halves or nothing: a container height with no deck is not an answer, and the road map's
 * HEIGHT_UNKNOWN is the honest reply. "A 4.0 m load is 5.2 m on a flatbed and 4.4 m on a lowboy" is the
 * comment that has sat in dispatch since the constraint map shipped, explaining why no height was passed.
 *
 * THREE REFUSALS LIVE HERE, and each is a silent pass avoided:
 *  - no deck, so no sum;
 *  - AN OPEN BOX with no declared cargo height, because its own figure is the FLOOR the cargo sits on and
 *    answering with it would clear a load standing a metre above it;
 *  - A CODE WHOSE HEIGHT IS AN OPEN RANGE ("taller than 2896 mm"), where the standard itself declines to
 *    say. A measured figure stands in for it; an invented one must not.
 */
export function standsOn(deckM: number | undefined, spec: ContainerTypeSpec | undefined, declaredCargoHeightM?: number): number | undefined {
  if (deckM == null || !spec) return undefined;
  if (spec.openTop) {
    return declaredCargoHeightM == null ? undefined : Math.round((deckM + declaredCargoHeightM) * 100) / 100;
  }
  // A closed box's cargo cannot be taller than the box, so a declared figure only stands in where the
  // CODE would not say — which is the open-range case, and there somebody who measured it knows better.
  const boxH = spec.heightM ?? declaredCargoHeightM;
  if (boxH == null) return undefined;
  return Math.round((deckM + boxH) * 100) / 100;
}

/** True where the cargo stands above an open box, so the movement is out of gauge whatever the road says. */
export function outOfGauge(spec: ContainerTypeSpec | undefined, declaredCargoHeightM?: number): boolean {
  if (!spec?.openTop || declaredCargoHeightM == null || spec.heightM == null) return false;
  return declaredCargoHeightM > spec.heightM;
}

/** Does this code leave its own height unstated? Then somebody has to measure the box. */
export function heightUnstated(spec: ContainerTypeSpec | undefined): boolean {
  return spec != null && spec.heightM == null;
}
