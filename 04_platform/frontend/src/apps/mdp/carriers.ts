import type { components } from '../../lib/sbg/schema';
import type { Translate } from '../../shared/i18n';

/**
 * WHAT A HUB MOVES BAGS ON BETWEEN HUBS (D11; the user, 2026-10-27) — its pallets, roll cages and crates. The hub says what
 * each is, its size and what it may carry; the server works out how many parcels it holds and sends it in the view, so
 * this file only words it and checks a form's shape before it is sent.
 */
export type HubCarrierView = components['schemas']['HubCarrierView'];
export type HubCarriersView = components['schemas']['HubCarriersView'];
export type HubCarrierInput = components['schemas']['HubCarrierInput'];
export type CarrierKind = HubCarrierView['kind'];

export const CARRIER_KINDS: readonly CarrierKind[] = ['pallet', 'cage', 'crate', 'other'];
/** As the server keeps them (hub-carrier.types.ts): checked here so a mistake is said where it was typed. */
export const CARRIER_MAX_KINDS = 6;
const CM = { min: 20, max: 300 };
const KG = { min: 10, max: 3000 };

/** One kind as the sheet edits it: the boxes hold what was typed. */
export interface CarrierForm {
  carrierId?: string;
  kind: CarrierKind;
  name: string;
  lengthCm: string;
  widthCm: string;
  heightCm: string;
  maxKg: string;
}

export function carrierForm(c?: HubCarrierView): CarrierForm {
  return c
    ? { carrierId: c.carrierId, kind: c.kind, name: c.name, lengthCm: String(c.lengthCm), widthCm: String(c.widthCm), heightCm: String(c.heightCm), maxKg: String(c.maxKg) }
    : { kind: 'pallet', name: '', lengthCm: '', widthCm: '', heightCm: '', maxKg: '' };
}

const whole = (s: string, b: { min: number; max: number }) => {
  const v = Number(s.trim());
  return /^\d+$/.test(s.trim()) && v >= b.min && v <= b.max ? v : null;
};

/** The form as the server takes it — or the words key of what is wrong with it. */
export function carrierInput(f: CarrierForm): { input: HubCarrierInput } | { error: string } {
  const name = f.name.trim();
  if (!name) return { error: 'mdp.carriers.err.name' };
  const lengthCm = whole(f.lengthCm, CM);
  const widthCm = whole(f.widthCm, CM);
  const heightCm = whole(f.heightCm, CM);
  if (lengthCm === null || widthCm === null || heightCm === null) return { error: 'mdp.carriers.err.cm' };
  const maxKg = whole(f.maxKg, KG);
  if (maxKg === null) return { error: 'mdp.carriers.err.kg' };
  return { input: { ...(f.carrierId ? { carrierId: f.carrierId } : {}), kind: f.kind, name, lengthCm, widthCm, heightCm, maxKg } };
}

/** The list as it is sent back whole: every kind kept as it is, one changed, added or taken off. */
export function listWith(list: HubCarrierView[], change: { put?: HubCarrierInput; drop?: string }): HubCarrierInput[] {
  const kept = list
    .filter((c) => c.carrierId !== change.drop)
    .map((c) => (change.put?.carrierId && c.carrierId === change.put.carrierId ? change.put : { carrierId: c.carrierId, kind: c.kind, name: c.name, lengthCm: c.lengthCm, widthCm: c.widthCm, heightCm: c.heightCm, maxKg: c.maxKg }));
  return change.put && !change.put.carrierId ? [...kept, change.put] : kept;
}

/** "Pallet · 120 × 80 cm, loaded to 150 cm · carries up to 1,000 kg". */
export function carrierSizeLine(c: HubCarrierView, t: Translate): string {
  return t('mdp.carriers.size', { kind: t(`mdp.carriers.kind.${c.kind}` as never), length: c.lengthCm, width: c.widthCm, height: c.heightCm, kg: c.maxKg.toLocaleString('en') });
}

/** "Holds about 36 parcels of size M — 3 full bags. Its space decides." — worked out by the server, never here. */
export function carrierHoldsLine(c: HubCarrierView, t: Translate): string {
  return `${t('mdp.carriers.holds', { holds: Math.floor(c.holds), bags: c.bags })} ${t(`mdp.carriers.boundBy.${c.boundBy}` as never)}`;
}
