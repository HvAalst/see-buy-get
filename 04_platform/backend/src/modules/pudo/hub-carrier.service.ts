import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { GlosError } from '../../foundation/http/glos-error';
import { PersistentMap } from '../../foundation/store/persistent-map';
import {
  HUB_CARRIER_CM,
  HUB_CARRIER_EMPTY_KG,
  HUB_CARRIER_KG,
  HUB_CARRIER_KINDS,
  HUB_CARRIER_MAX_KINDS,
  type HubCarrier,
  type HubCarrierInput,
  type HubCarriersView,
  type HubCarrierView,
} from './hub-carrier.types';
import { MdpService } from './mdp.service';
import { BAG_CAPACITY_UNITS, MEDIUM_CM3, MEDIUM_KG } from './pudo.config';

/** Said on every screen that shows a hub's carriers. */
export const HUB_CARRIERS_BASIS =
  'Each kind is the hub’s own word: its size and what it may carry, as the hub measured them. What it holds is worked out from those — in parcels of size M, the lesser of its space and its rating — never typed in.';

/**
 * WHAT A CARRIER HOLDS, WORKED OUT (the derivation the user's carriers were reasoned to, 2026-09-03): in parcels of size M,
 * the lesser of its space and its rating — a carrier is divided BY the medium parcel, as a parcel is divided INTO it. Space
 * binds for almost everything we carry: a Euro pallet loaded to 1.5 m holds about 36 by space and 200 by weight.
 */
export function carrierHolds(c: Pick<HubCarrier, 'lengthCm' | 'widthCm' | 'heightCm' | 'maxKg'>): { holds: number; bags: number; boundBy: 'space' | 'weight' } {
  const bySpace = (c.lengthCm * c.widthCm * c.heightCm) / MEDIUM_CM3;
  const byWeight = c.maxKg / MEDIUM_KG;
  const holds = Math.floor(Math.min(bySpace, byWeight) * 10) / 10;
  return { holds, bags: Math.floor(holds / BAG_CAPACITY_UNITS), boundBy: bySpace <= byWeight ? 'space' : 'weight' };
}

@Injectable()
export class HubCarrierService {
  private readonly lists = new PersistentMap<string, HubCarrier[]>('hub-carriers');

  constructor(private readonly mdps: MdpService) {}

  /** The kinds a hub keeps, as it wrote them. */
  of(mdpId: string): HubCarrier[] {
    return this.lists.get(mdpId) ?? [];
  }

  /** One kind on a hub's list, or nothing. */
  kindOf(mdpId: string, carrierId: string): HubCarrier | undefined {
    return this.of(mdpId).find((c) => c.carrierId === carrierId);
  }

  viewOf(mdpId: string): HubCarriersView {
    this.mdps.require(mdpId); // 404 if unknown
    return { mdpId, carriers: this.of(mdpId).map((c) => this.view(c)), basis: HUB_CARRIERS_BASIS };
  }

  /**
   * THE HUB WRITES ITS LIST, WHOLE: what is sent is the list. Every kind is checked before anything is written — a list
   * half taken is a list nobody wrote — and a kind that would hold less than one parcel is refused by name: it is a
   * mistake in the tape measure, not a carrier.
   */
  set(mdpId: string, input: HubCarrierInput[], by: string, now: number = Date.now()): HubCarriersView {
    this.mdps.require(mdpId);
    if (!Array.isArray(input)) throw new GlosError('INVALID_INPUT', 'Send the list of your carriers', { field: 'carriers' });
    if (input.length > HUB_CARRIER_MAX_KINDS) throw new GlosError('INVALID_INPUT', `Keep at most ${HUB_CARRIER_MAX_KINDS} kinds`, { field: 'carriers' });
    const before = new Map(this.of(mdpId).map((c) => [c.carrierId, c]));
    const at = new Date(now).toISOString();
    const names = new Set<string>();
    const next: HubCarrier[] = input.map((item, i) => {
      const field = (f: string) => ({ field: `carriers.${i}.${f}` });
      const name = String(item.name ?? '').trim();
      if (!name) throw new GlosError('FIELD_REQUIRED', 'Give each kind a name, as your people call it', field('name'));
      if (names.has(name.toLowerCase())) throw new GlosError('INVALID_INPUT', `Two kinds are called “${name}”: give each its own name`, field('name'));
      names.add(name.toLowerCase());
      if (!HUB_CARRIER_KINDS.includes(item.kind)) throw new GlosError('INVALID_INPUT', 'Say whether it is a pallet, a cage, a crate or something else', field('kind'));
      for (const f of ['lengthCm', 'widthCm', 'heightCm'] as const) {
        const v = item[f];
        if (!Number.isInteger(v) || v < HUB_CARRIER_CM.min || v > HUB_CARRIER_CM.max) throw new GlosError('INVALID_INPUT', `Say ${name}’s ${f === 'lengthCm' ? 'length' : f === 'widthCm' ? 'width' : 'loaded height'} in whole centimetres, from ${HUB_CARRIER_CM.min} to ${HUB_CARRIER_CM.max}`, field(f));
      }
      if (!Number.isInteger(item.maxKg) || item.maxKg < HUB_CARRIER_KG.min || item.maxKg > HUB_CARRIER_KG.max) throw new GlosError('INVALID_INPUT', `Say what ${name} may carry in whole kilograms, from ${HUB_CARRIER_KG.min} to ${HUB_CARRIER_KG.max}`, field('maxKg'));
      if (carrierHolds(item).holds < 1) throw new GlosError('INVALID_INPUT', `${name} would hold less than one parcel of size M: check its size and what it may carry`, field('maxKg'));
      if (item.emptyKg != null && (!Number.isInteger(item.emptyKg) || item.emptyKg < HUB_CARRIER_EMPTY_KG.min || item.emptyKg > HUB_CARRIER_EMPTY_KG.max)) throw new GlosError('INVALID_INPUT', `Say what ${name} weighs empty in whole kilograms, from ${HUB_CARRIER_EMPTY_KG.min} to ${HUB_CARRIER_EMPTY_KG.max} — or leave it out`, field('emptyKg'));
      const kept = item.carrierId ? before.get(item.carrierId) : undefined;
      if (item.carrierId && !kept) throw new GlosError('NOT_FOUND', `${name} is not on your list any more: add it as a new kind`, field('carrierId'));
      const same = kept && kept.kind === item.kind && kept.name === name && kept.lengthCm === item.lengthCm && kept.widthCm === item.widthCm && kept.heightCm === item.heightCm && kept.maxKg === item.maxKg && kept.emptyKg === (item.emptyKg ?? undefined);
      return {
        carrierId: kept?.carrierId ?? `hc_${randomBytes(6).toString('hex')}`,
        kind: item.kind,
        name: name.slice(0, 40),
        lengthCm: item.lengthCm,
        widthCm: item.widthCm,
        heightCm: item.heightCm,
        maxKg: item.maxKg,
        ...(item.emptyKg != null ? { emptyKg: item.emptyKg } : {}),
        // A kind sent back unchanged keeps when and by whom it was said.
        saidAt: same ? kept.saidAt : at,
        saidBy: same ? kept.saidBy : by,
      };
    });
    if (next.length) this.lists.set(mdpId, next);
    else this.lists.delete(mdpId);
    return this.viewOf(mdpId);
  }

  private view(c: HubCarrier): HubCarrierView {
    return {
      carrierId: c.carrierId,
      kind: c.kind,
      name: c.name,
      lengthCm: c.lengthCm,
      widthCm: c.widthCm,
      heightCm: c.heightCm,
      maxKg: c.maxKg,
      ...(c.emptyKg != null ? { emptyKg: c.emptyKg } : {}),
      ...carrierHolds(c),
      saidAt: c.saidAt,
      saidBy: c.saidBy,
    };
  }
}
