// Heavy-cargo follow-up (S33) — the safety gate on the dedicated-freight lifecycle. Every marketplace freight
// is dedicated (P4+), so every freight passes a LOAD-SAFETY check + a securement photo before it leaves the
// pickup, and an UNLOAD check before it is marked delivered. The exact items switch on the cargo's shape
// (bulk vs discrete) and nature (hazmat / fragile / cold-chain). Pure data + functions — no state, trivially
// testable, and the SAME item list the backend enforces is sent to the driver app so the checklist it shows is
// exactly the checklist it must pass.

import { CargoNature, NATURE_CAPABILITY, VehicleCapability } from './cargo.types';

/** One confirmable line on a safety checklist. `key` is what the driver app sends back as confirmed; `label`
 *  is the plain-language line shown to the driver. */
export interface SafetyItem {
  key: string;
  label: string;
}

// The LOAD-safety checklist a driver confirms before a freight leaves the pickup: a base every heavy load
// needs, plus items switched on by the cargo.
const LOAD_BASE: SafetyItem[] = [
  { key: 'distributed', label: 'Load spread evenly — not front- or side-heavy' },
  { key: 'secured', label: 'Strapped or restrained — nothing can shift in transit' },
  { key: 'within_limit', label: 'Total weight is within the vehicle limit' },
  { key: 'closed', label: 'Doors, tailgate or cover closed and latched' },
];
const LOAD_DISCRETE: SafetyItem = { key: 'stacked', label: 'Palletised or stacked so it cannot topple' };
const LOAD_BULK: SafetyItem = { key: 'contained', label: 'Bulk fully contained — no spill or blow-out' };
const LOAD_HAZMAT: SafetyItem = { key: 'hazmat_placard', label: 'Hazard placards shown; no leaks or damaged packaging' };
const LOAD_FRAGILE: SafetyItem = { key: 'cushioned', label: 'Fragile items cushioned and kept upright' };
const LOAD_COLD: SafetyItem = { key: 'reefer_set', label: 'Refrigeration running at the required temperature' };

// The UNLOAD checklist a driver confirms before a freight is marked delivered.
const UNLOAD_BASE: SafetyItem[] = [
  { key: 'correct_site', label: 'Delivered to the correct site' },
  { key: 'intact', label: 'Cargo intact — no damage in transit' },
  { key: 'handed_over', label: 'Handed to the recipient (or their agent)' },
  { key: 'gear_safe', label: 'Unloading gear used safely; the area is clear' },
];

/** Attributes of a freight that decide which safety items apply. */
export interface CargoSafetyContext {
  bulk: boolean;
  fragile: boolean;
  requiredCapabilities: VehicleCapability[];
}

/** The load-safety items THIS freight requires, in display order. */
export function loadSafetyItems(ctx: CargoSafetyContext): SafetyItem[] {
  const items = [...LOAD_BASE];
  items.push(ctx.bulk ? LOAD_BULK : LOAD_DISCRETE);
  if (ctx.requiredCapabilities.includes('hazmat')) items.push(LOAD_HAZMAT);
  if (ctx.fragile) items.push(LOAD_FRAGILE);
  if (ctx.requiredCapabilities.includes('coldChain')) items.push(LOAD_COLD);
  return items;
}

/** The unload items a freight requires (a fixed base set — the same for every dedicated freight). */
export function unloadSafetyItems(): SafetyItem[] {
  return [...UNLOAD_BASE];
}

/** The keys a driver must confirm at load / at unload — the enforcement side of the item lists above. */
export function requiredLoadKeys(ctx: CargoSafetyContext): string[] {
  return loadSafetyItems(ctx).map((i) => i.key);
}
export function requiredUnloadKeys(): string[] {
  return unloadSafetyItems().map((i) => i.key);
}

/** The confirmed-key subset that is still MISSING from what a checklist requires (empty = complete). */
export function missingKeys(required: string[], confirmed: string[] | undefined): string[] {
  const done = new Set(confirmed ?? []);
  return required.filter((k) => !done.has(k));
}

// --- S33b: temperature monitoring for cold-chain freight ---

/** A safe temperature band (°C, inclusive). */
export interface TempBand {
  minC: number;
  maxC: number;
}

/** One logged temperature reading for a cold-chain freight, stamped with its own breach verdict. */
export interface TempReading {
  celsius: number;
  at: string;
  by?: string;
  breach: boolean;
  /** Round 24 — when SeeBuyGet heard of it, where later than `at`: read with no signal, dated by the driver's phone. */
  receivedAt?: string;
}

// The chilled cold-chain band (fresh produce, dairy, pharma). The codebase's FIRST numeric temperature concept
// — cargo.types.ts flagged the per-parcel temp field as deferred; this fills it. A single band for now; a
// frozen band / a shipper-set per-freight range is a later refinement.
export const COLD_CHAIN_BAND: TempBand = { minC: 2, maxC: 8 };

/** The safe temperature band a freight must stay in, or null when its cargo is not temperature-controlled.
 *  Driven by the same nature→capability mapping vehicle matching uses (FOP → coldChain), so a monitored
 *  freight is exactly one that had to be carried on a reefer. */
export function tempBand(natureCode: CargoNature): TempBand | null {
  return NATURE_CAPABILITY[natureCode] === 'coldChain' ? COLD_CHAIN_BAND : null;
}

/** True when a reading is outside the safe band (a cold-chain breach). */
export function isTempBreach(celsius: number, band: TempBand): boolean {
  return celsius < band.minC || celsius > band.maxC;
}
