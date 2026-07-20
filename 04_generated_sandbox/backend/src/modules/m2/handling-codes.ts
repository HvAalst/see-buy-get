// Standardized handling-code library (M2-030), aligned in spirit with IATA/IMO. Each code maps
// to the capability VC and/or equipment it implies — used to build the Job Requirement Vector.

export interface HandlingCodeDef {
  code: string;
  label: string;
  requiresVC?: string;
  equipment?: string;
}

export const HANDLING_CODES: Record<string, HandlingCodeDef> = {
  // Temperature
  TEMP_2_8C: { code: 'TEMP_2_8C', label: 'Keep cold 2–8°C', requiresVC: 'cold-chain', equipment: 'reefer' },
  TEMP_FROZEN: { code: 'TEMP_FROZEN', label: 'Keep frozen', requiresVC: 'cold-chain', equipment: 'reefer' },
  PERISHABLE: { code: 'PERISHABLE', label: 'Perishable' },
  KEEP_DRY: { code: 'KEEP_DRY', label: 'Keep dry' },
  // Orientation & stacking
  THIS_WAY_UP: { code: 'THIS_WAY_UP', label: 'This way up' },
  NO_STACK: { code: 'NO_STACK', label: 'Do not stack' },
  STACK_MAX_2: { code: 'STACK_MAX_2', label: 'Max 2 high' },
  // Shock / vibration
  FRAGILE: { code: 'FRAGILE', label: 'Fragile', requiresVC: 'fragile-handling' },
  SHOCK_SENSITIVE: { code: 'SHOCK_SENSITIVE', label: 'Shock sensitive', requiresVC: 'fragile-handling' },
  // Dangerous goods (IMO/IATA classes)
  DG_CLASS_1: { code: 'DG_CLASS_1', label: 'Explosives (class 1)', requiresVC: 'dg-certified', equipment: 'dg-container' },
  DG_CLASS_2: { code: 'DG_CLASS_2', label: 'Gases (class 2)', requiresVC: 'dg-certified', equipment: 'dg-container' },
  DG_CLASS_3: { code: 'DG_CLASS_3', label: 'Flammable liquids (class 3)', requiresVC: 'dg-certified', equipment: 'dg-container' },
  DG_CLASS_6: { code: 'DG_CLASS_6', label: 'Toxic (class 6)', requiresVC: 'dg-certified', equipment: 'dg-container' },
  DG_CLASS_7: { code: 'DG_CLASS_7', label: 'Radioactive (class 7)', requiresVC: 'dg-certified', equipment: 'dg-container' },
  DG_CLASS_9: { code: 'DG_CLASS_9', label: 'Miscellaneous DG (class 9)', requiresVC: 'dg-certified', equipment: 'dg-container' },
  // Security
  HIGH_VALUE: { code: 'HIGH_VALUE', label: 'High value', requiresVC: 'secure-transport' },
  SECURITY_SEAL: { code: 'SECURITY_SEAL', label: 'Security seal required', requiresVC: 'secure-transport' },
};

export function isKnownHandlingCode(code: string): boolean {
  return code in HANDLING_CODES;
}

/** Derive the mandatory VCs + equipment implied by a set of handling codes. */
export function deriveRequirements(codes: string[]): { mandatoryVCs: string[]; equipment: string[] } {
  const vcs = new Set<string>();
  const equipment = new Set<string>();
  for (const code of codes) {
    const def = HANDLING_CODES[code];
    if (def?.requiresVC) vcs.add(def.requiresVC);
    if (def?.equipment) equipment.add(def.equipment);
  }
  return { mandatoryVCs: [...vcs], equipment: [...equipment] };
}
