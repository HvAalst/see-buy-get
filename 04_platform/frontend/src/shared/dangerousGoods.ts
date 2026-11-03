/**
 * DANGEROUS GOODS BY THEIR UN NUMBER, NAME AND CLASS — CMR box 9, asked at every door a load comes in by (the gaps check,
 * 2026-10-29; the Store's heavy order since 2026-11-03). The natures that are dangerous goods (ADR): chemical, biological,
 * flammable. Hazardous dust (cement, flour) contaminates but has no UN number.
 */
export const DANGEROUS_NATURES = ['HAZ-CHEM', 'HAZ-BIO', 'HAZ-FLAM'] as const;
export type DangerousNature = (typeof DANGEROUS_NATURES)[number];
export const isDangerousNature = (code: string | undefined): code is DangerousNature => (DANGEROUS_NATURES as readonly string[]).includes(code ?? '');

export interface DangerousGoodsFields {
  dgUn: string;
  dgName: string;
  dgClass: string;
  dgGroup: '' | 'I' | 'II' | 'III';
}

export const EMPTY_DANGEROUS: DangerousGoodsFields = { dgUn: '', dgName: '', dgClass: '', dgGroup: '' };

/** The dangerous goods as they were taken down, or nothing until all three are given. */
export function dangerousGoodsValue(f: DangerousGoodsFields): { unNumber: string; properShippingName: string; hazardClass: string; packingGroup?: 'I' | 'II' | 'III' } | undefined {
  const un = /^\s*(UN)?\s*(\d{4})\s*$/i.exec(f.dgUn)?.[2];
  if (!un || !f.dgName.trim() || !f.dgClass.trim()) return undefined;
  return { unNumber: `UN${un}`, properShippingName: f.dgName.trim(), hazardClass: f.dgClass.trim(), ...(f.dgGroup ? { packingGroup: f.dgGroup } : {}) };
}
