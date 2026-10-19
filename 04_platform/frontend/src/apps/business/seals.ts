import type { SealClass, SealView } from '../../shared/seals';

/**
 * A SEAL, AS THE SHIPPER WRITES IT on its load before pickup (round 15: "shipper writes driver matches according to iso
 * 17712 including the required photographs etc"): the number as printed, its ISO 17712 class, the maker marked on it, who
 * closed it, and the three photographs — the load open, blocked and braced; the doors closed with the vehicle's or
 * container's number and the seal in view; the seal close up, its whole number readable.
 */
export interface SealForm {
  number: string;
  sealClass: SealClass | '';
  maker: string;
  appliedBy: 'sender' | 'customs';
  loadedOpen: string;
  closedWithSeal: string;
  sealCloseUp: string;
}

export const EMPTY_SEAL: SealForm = { number: '', sealClass: '', maker: '', appliedBy: 'sender', loadedOpen: '', closedWithSeal: '', sealCloseUp: '' };

export type SealPhoto = 'loadedOpen' | 'closedWithSeal' | 'sealCloseUp';
export const SEAL_PHOTOS: SealPhoto[] = ['loadedOpen', 'closedWithSeal', 'sealCloseUp'];

export interface SealsView {
  freightId: string;
  seals: SealView[];
  editable: boolean;
}

/** What is still missing before the seal can be written, in the order the form asks it. */
export function sealGaps(f: SealForm): Array<'number' | 'sealClass' | SealPhoto> {
  return [...(f.number.trim() ? [] : ['number' as const]), ...(f.sealClass ? [] : ['sealClass' as const]), ...SEAL_PHOTOS.filter((p) => !f[p])];
}

/** The form as the server reads it. */
export function sealBody(f: SealForm): Record<string, unknown> {
  return {
    number: f.number.trim(),
    sealClass: f.sealClass,
    ...(f.maker.trim() ? { maker: f.maker.trim() } : {}),
    appliedBy: f.appliedBy,
    photos: { loadedOpen: f.loadedOpen, closedWithSeal: f.closedWithSeal, sealCloseUp: f.sealCloseUp },
  };
}
