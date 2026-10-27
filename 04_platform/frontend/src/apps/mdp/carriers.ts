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
export type CarrierMovesView = components['schemas']['CarrierMovesView'];
export type CarrierMoveView = components['schemas']['CarrierMoveView'];
export type CarrierWayBack = CarrierMoveView['wayBack'];
/** The three ways back the owning hub says as its carriers go (the user, 2026-10-27). */
export const CARRIER_WAYS_BACK: readonly CarrierWayBack[] = ['with_driver', 'left', 'return_job'];

export const CARRIER_KINDS: readonly CarrierKind[] = ['pallet', 'cage', 'crate', 'other'];
/** As the server keeps them (hub-carrier.types.ts): checked here so a mistake is said where it was typed. */
export const CARRIER_MAX_KINDS = 6;
const CM = { min: 20, max: 300 };
const KG = { min: 10, max: 3000 };
const EMPTY_KG = { min: 1, max: 500 };

/** One kind as the sheet edits it: the boxes hold what was typed. */
export interface CarrierForm {
  carrierId?: string;
  kind: CarrierKind;
  name: string;
  lengthCm: string;
  widthCm: string;
  heightCm: string;
  maxKg: string;
  /** What one weighs empty: optional. */
  emptyKg: string;
}

export function carrierForm(c?: HubCarrierView): CarrierForm {
  return c
    ? { carrierId: c.carrierId, kind: c.kind, name: c.name, lengthCm: String(c.lengthCm), widthCm: String(c.widthCm), heightCm: String(c.heightCm), maxKg: String(c.maxKg), emptyKg: c.emptyKg != null ? String(c.emptyKg) : '' }
    : { kind: 'pallet', name: '', lengthCm: '', widthCm: '', heightCm: '', maxKg: '', emptyKg: '' };
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
  const emptyKg = f.emptyKg.trim() ? whole(f.emptyKg, EMPTY_KG) : undefined;
  if (emptyKg === null) return { error: 'mdp.carriers.err.empty' };
  return { input: { ...(f.carrierId ? { carrierId: f.carrierId } : {}), kind: f.kind, name, lengthCm, widthCm, heightCm, maxKg, ...(emptyKg != null ? { emptyKg } : {}) } };
}

/** The list as it is sent back whole: every kind kept as it is, one changed, added or taken off. */
export function listWith(list: HubCarrierView[], change: { put?: HubCarrierInput; drop?: string }): HubCarrierInput[] {
  const kept = list
    .filter((c) => c.carrierId !== change.drop)
    .map((c) => (change.put?.carrierId && c.carrierId === change.put.carrierId ? change.put : { carrierId: c.carrierId, kind: c.kind, name: c.name, lengthCm: c.lengthCm, widthCm: c.widthCm, heightCm: c.heightCm, maxKg: c.maxKg, ...(c.emptyKg != null ? { emptyKg: c.emptyKg } : {}) }));
  return change.put && !change.put.carrierId ? [...kept, change.put] : kept;
}

/** "Pallet · 120 × 80 cm, loaded to 150 cm · carries up to 1,000 kg". */
export function carrierSizeLine(c: HubCarrierView, t: Translate): string {
  const size = t('mdp.carriers.size', { kind: t(`mdp.carriers.kind.${c.kind}` as never), length: c.lengthCm, width: c.widthCm, height: c.heightCm, kg: c.maxKg.toLocaleString('en') });
  return c.emptyKg != null ? `${size} · ${t('mdp.carriers.emptyKg', { kg: c.emptyKg })}` : size;
}

/**
 * A MOVE, AS A HUB READS IT: `away`, its own carriers — where they went, with whom, how they come back and where that stands;
 * `here`, another hub's come to it — from where, with whom, and what their hub said to do with them.
 */
export function moveLine(m: CarrierMoveView, side: 'away' | 'here', t: Translate): string {
  const driver = m.driverName ?? t('mdp.moves.theDriver');
  if (side === 'here') {
    if (m.state === 'kept' || m.state === 'returning') return m.job ? t('mdp.moves.keptJob', { hub: m.ownerName, code: m.job.code }) : t('mdp.moves.keptFor', { hub: m.ownerName });
    return `${t('mdp.moves.fromWith', { hub: m.ownerName, driver })} ${t(`mdp.moves.way.${m.wayBack}` as never)}`;
  }
  switch (m.state) {
    case 'on_the_way':
      return `${t('mdp.moves.state.on_the_way', { hub: m.toName, driver })} ${t(`mdp.moves.wayShort.${m.wayBack}` as never)}`;
    case 'with_driver':
      return t('mdp.moves.state.with_driver', { hub: m.toName, driver, n: m.doneCount ?? m.count, count: m.count });
    case 'left':
      return t('mdp.moves.state.left', { hub: m.toName });
    case 'kept':
      return t('mdp.moves.state.kept', { hub: m.toName });
    case 'returning':
      return t('mdp.moves.state.returning', { code: m.job?.code ?? '', status: t(`mdp.moves.jobStatus.${m.job?.status ?? 'available'}` as never) });
    case 'home':
      return t('mdp.moves.state.home', { when: (m.homeAt ?? '').slice(0, 10) });
  }
}

/** Carriers going with a driver, as the server takes them — or the words key of what is missing. */
export function sendBody(f: { carrierId: string; count: string; toMdpId: string; badge: string; wayBack: CarrierWayBack }): { body: { carrierId: string; count: number; toMdpId: string; driverBadgeId: string; wayBack: CarrierWayBack } } | { error: string } {
  const count = Number(f.count.trim());
  if (!/^\d+$/.test(f.count.trim()) || count < 1 || count > 50) return { error: 'mdp.moves.err.count' };
  if (!f.toMdpId) return { error: 'mdp.moves.err.to' };
  if (f.badge.trim().length < 2) return { error: 'mdp.moves.err.pass' };
  return { body: { carrierId: f.carrierId, count, toMdpId: f.toMdpId, driverBadgeId: f.badge.trim(), wayBack: f.wayBack } };
}

/** "Holds about 36 parcels of size M — 3 full bags. Its space decides." — worked out by the server, never here. */
export function carrierHoldsLine(c: HubCarrierView, t: Translate): string {
  return `${t('mdp.carriers.holds', { holds: Math.floor(c.holds), bags: c.bags })} ${t(`mdp.carriers.boundBy.${c.boundBy}` as never)}`;
}
