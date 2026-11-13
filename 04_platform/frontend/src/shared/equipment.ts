import type { MessageKey, Translate } from './i18n';

/**
 * LOADING EQUIPMENT (2026-11-13 — the owner: "build loading equipment"): what a vehicle carries for loading and unloading
 * besides handling by hand, said alike by the Fleet app (its vehicles) and the Driver app (a driver's own). Mirrors the
 * server's EQUIPMENT tuple and EQUIPMENT_FITS (backend fleet.config.ts): a van takes a tail-lift, a pallet jack, a sack
 * barrow, ramps and straps; a truck any of them; a bike or a motorbike none. 'MAN' (by hand) is always assumed, never listed.
 */
export type Equipment = 'HTR' | 'PLT' | 'FLT' | 'TLT' | 'CRN' | 'RMP' | 'STR' | 'ROL';

const KEYS: Array<{ key: Equipment; labelKey: MessageKey; detailKey: MessageKey }> = [
  { key: 'HTR', labelKey: 'equipment.htr', detailKey: 'equipment.htrWhy' },
  { key: 'PLT', labelKey: 'equipment.plt', detailKey: 'equipment.pltWhy' },
  { key: 'TLT', labelKey: 'equipment.tlt', detailKey: 'equipment.tltWhy' },
  { key: 'FLT', labelKey: 'equipment.flt', detailKey: 'equipment.fltWhy' },
  { key: 'CRN', labelKey: 'equipment.crn', detailKey: 'equipment.crnWhy' },
  { key: 'RMP', labelKey: 'equipment.rmp', detailKey: 'equipment.rmpWhy' },
  { key: 'STR', labelKey: 'equipment.str', detailKey: 'equipment.strWhy' },
  // 2026-11-01 — a roller floor: built-up airline pallets and containers, rolled on and off whole.
  { key: 'ROL', labelKey: 'equipment.rol', detailKey: 'equipment.rolWhy' },
];

/** What each kind of vehicle can carry — the server refuses anything else by name. */
export const EQUIPMENT_FITS: Record<string, readonly Equipment[]> = {
  bike: [],
  motorcycle: [],
  tuktuk: ['HTR', 'STR'],
  car: ['HTR', 'STR'],
  van: ['HTR', 'PLT', 'TLT', 'RMP', 'STR'],
  bus: ['HTR', 'STR'],
  truck: ['HTR', 'PLT', 'FLT', 'TLT', 'CRN', 'RMP', 'STR', 'ROL'],
};

/** The pieces a vehicle of this kind can carry; every piece where no kind is given (a form before its kind is picked). */
export function equipmentFits(vehicleClass?: string): readonly Equipment[] {
  return vehicleClass == null ? KEYS.map((k) => k.key) : (EQUIPMENT_FITS[vehicleClass] ?? []);
}

/** The pieces it can carry with their labels, in the active language. */
export function equipmentOptions(t: Translate, vehicleClass?: string): Array<{ key: Equipment; label: string }> {
  const fits = equipmentFits(vehicleClass);
  return KEYS.filter((k) => fits.includes(k.key)).map((e) => ({ key: e.key, label: t(e.labelKey) }));
}

/** The same with the sentence each picture is captioned by, for the help sheet. */
export function equipmentHelp(t: Translate, vehicleClass?: string): Array<{ key: Equipment; label: string; detail: string }> {
  const fits = equipmentFits(vehicleClass);
  return KEYS.filter((k) => fits.includes(k.key)).map((e) => ({ key: e.key, label: t(e.labelKey), detail: t(e.detailKey) }));
}

/** What it carries, in words, in the list's own order: "Tail-lift (hydraulic), Slings / straps"; nothing when by hand only. */
export function equipmentWords(list: readonly string[] | undefined, t: Translate): string {
  const have = new Set(list ?? []);
  return KEYS.filter((k) => have.has(k.key)).map((k) => t(k.labelKey)).join(', ');
}

/** Only the pieces this kind can carry, by hand left out: what is sent back to the server. */
export function equipmentToSend(list: readonly string[], vehicleClass: string): Equipment[] {
  const fits = equipmentFits(vehicleClass);
  return KEYS.map((k) => k.key).filter((k) => list.includes(k) && fits.includes(k));
}
