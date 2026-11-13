import { Injectable, Optional } from '@nestjs/common';
import { GlosError } from '../../foundation/http/glos-error';
import { MdpService } from './mdp.service';
import { NotificationService } from './notification.service';
import { ParcelService } from './parcel.service';
import type { ParcelWeightFound } from './pudo.types';
import { scaleCounts } from './site-tools';
import { VendorService } from './vendor.service';

/** The difference that is a difference: more than 200 g, and more than a twentieth of what was said. */
export function weightDiffers(saidKg: number, foundKg: number): boolean {
  return Math.abs(foundKg - saidKg) > Math.max(0.2, saidKg * 0.05);
}

export interface WeightCheckView {
  parcelId: string;
  foundKg: number;
  saidKg: number;
  /** More than a difference of scales: recorded against the parcel, and its sender told. */
  differs: boolean;
}

/**
 * 2026-11-13 — A WEIGHT FOUND LATER (the owner: "shop and hub tools", plan T2: "a difference found later at a hub is recorded with
 * both sides heard, and the sender is told"). A hub whose scale counts weighs a parcel on its floor: the same as was said, and
 * nothing is kept; a difference, and it is recorded against the parcel — the weight, where, and what the sender said — and the
 * sender is told on the bell, a person or a store. The sender answers once, and the answer is shown beside it (rule: both sides
 * heard). Nothing is re-priced after the fact: the price was settled at the counter.
 */
@Injectable()
export class WeightCheckService {
  constructor(
    private readonly parcels: ParcelService,
    private readonly mdps: MdpService,
    private readonly vendors: VendorService,
    @Optional() private readonly notifications?: NotificationService,
  ) {}

  atHub(mdpId: string, parcelId: string, kg: number, now: number = Date.now()): WeightCheckView {
    const hub = this.mdps.require(mdpId);
    if (!scaleCounts(hub.tools, this.mdps.countryOf(hub), now)) {
      throw new GlosError('INVALID_STATE', 'Your scale is a guide: only a weight taken on a scale approved for trade — in Kenya stamped and in date — is kept against a parcel. Say your scale under Your tools');
    }
    const parcel = this.parcels.get(parcelId);
    if (parcel.status !== 'At_MDP') throw new GlosError('INVALID_STATE', `${parcelId} is not at a hub: weigh it while it stands on your floor`);
    const found = Math.round(kg * 100) / 100;
    const said = parcel.weightKg;
    if (!weightDiffers(said, found)) return { parcelId, foundKg: found, saidKg: said, differs: false };
    const record: ParcelWeightFound = { kg: found, at: new Date(now).toISOString(), by: hub.did, siteName: hub.name, saidKg: said };
    this.parcels.recordWeightFound(parcelId, record);
    this.tellSender(parcelId, record);
    return { parcelId, foundKg: found, saidKg: said, differs: true };
  }

  /** The sender's answer — once: shown beside what was found. */
  answer(parcelId: string, text: string, now: number = Date.now()): ParcelWeightFound {
    const said = text.trim().slice(0, 500);
    if (!said) throw new GlosError('FIELD_REQUIRED', 'Say your side', { field: 'text' });
    return this.parcels.answerWeightFound(parcelId, said, now);
  }

  private storeOf(vendorId: string) {
    try {
      return this.vendors.get(vendorId);
    } catch {
      return undefined;
    }
  }

  /** The sender, on the bell: a person by the account the parcel is kept by, a store by its own. */
  private tellSender(parcelId: string, found: ParcelWeightFound): void {
    if (!this.notifications) return;
    const parcel = this.parcels.get(parcelId);
    const heavier = found.kg > found.saidKg;
    const title = heavier ? 'A parcel you sent weighs more than you said' : 'A parcel you sent weighs less than you said';
    const body = `${found.siteName} weighed ${parcelId} at ${found.kg} kg on an approved scale; you said ${found.saidKg} kg. It is kept with the parcel, and you can answer beside it.`;
    const store = parcel.vendorId ? this.storeOf(parcel.vendorId) : undefined;
    const to = store ? store.did : this.parcels.senderOf(parcel).owner;
    if (!to) return; // a person not yet certain of an account: the parcel shows it when they open it
    void this.notifications.notify(to, { kind: 'parcel_weight', title, body, link: store ? '/' : `/?parcel=${parcelId}`, tag: `weight:${parcelId}`, data: { parcelId } }).catch(() => undefined);
  }
}
