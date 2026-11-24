import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { GlosError } from '../../foundation/http/glos-error';
import { PersistentMap } from '../../foundation/store/persistent-map';
import type { BagClosure } from './bag-closure.types';
import { DriverService } from './driver.service';
import { FleetService } from './fleet.service';
import { MediaService } from './media.service';
import type { Step } from './observed-at';
import type { Tote } from './pudo.types';
import { MAX_TRANSFER_EXCEPTIONS, TRANSFER_NOTE_MAX, TRANSFER_NOTE_MIN, type HubTransfer, type HubTransferException, type HubTransferInput } from './hub-transfer.types';

/** Where a bag is handed over: the hub, its account (who owns the photographs), its name and its country. */
export interface TransferHub {
  mdpId: string;
  did: string;
  name: string;
  country: string;
}

/**
 * 2026-11-24 — A BAG HANDED OVER AT A HUB ACROSS A BORDER (hub-transfer.types.ts; corridor compliance, slice 4). Each act is
 * checked whole before anything is kept, as the bag's own seal is (BagClosureService): what to keep is handed back.
 *
 * It imports none of the services that carry bags (MdpService calls it; the GPS watch registers to hear of a handover), so no
 * import goes round in a circle.
 */
@Injectable()
export class HubTransferService {
  private readonly transfers = new PersistentMap<string, HubTransfer>('pudo-hub-transfers');
  /** A parcel taken over at a hub from another country, until it leaves that hub on a coded seal: parcelId → transferId. */
  private readonly waiting = new PersistentMap<string, string>('pudo-hub-transfer-parcels');
  private readonly afterRelease: Array<(driverDid: string) => void> = [];

  constructor(
    private readonly fleet: FleetService,
    private readonly drivers: DriverService,
    private readonly media: MediaService,
  ) {}

  /** The GPS watch hears of a driver who handed a bag over, to close a watch nothing aboard asks for any more. */
  onRelease(fn: (driverDid: string) => void): void {
    this.afterRelease.push(fn);
  }

  /** Whether a bag arriving at a hub came from another country: the handover by name applies to it, and to nothing else. */
  crosses(fromCountry: string | undefined, hubCountry: string | undefined): boolean {
    return Boolean(fromCountry && hubCountry && fromCountry !== hubCountry);
  }

  /**
   * TAKING OVER A BAG FROM ANOTHER COUNTRY: the pass on the phone of the driver carrying it, the person receiving it by name,
   * and what is wrong with it, each with words and, where taken, a photograph of the hub's own. Refused before anything is
   * kept; the record is written with the receipt of its seal.
   */
  checkDrop(hub: TransferHub, tote: Tote, from: { country: string; place?: string }, clerk: string | undefined, input: HubTransferInput | undefined): (step: Step, closure: BagClosure | undefined) => HubTransfer {
    // 2026-11-24 — taken over by a person, by name (the owner: "as recommended"): the hub's people sign in under their own name;
    // the hub's own sign-in names nobody.
    if (!clerk?.trim()) {
      throw new GlosError('FORBIDDEN', `Bag ${tote.code} comes from another country: a person signed in under their own name takes it over. The hub’s owner adds its people in the Hub app, under People, and each signs in by name`);
    }
    const shown = input?.driverBadgeId?.trim();
    if (!shown) {
      throw new GlosError('FIELD_REQUIRED', `Bag ${tote.code} comes from another country: scan the pass on the driver’s phone (“Show my badge”), so the driver who brought it hands it over by name`, { field: 'driverBadgeId' });
    }
    const badgeId = this.fleet.badgeShown(shown);
    const driver = this.fleet.resolveBadge(badgeId);
    if (!driver) throw new GlosError('DRIVER_PASS_WRONG', 'That pass is of no driver on a shift now: ask the driver to open “Show my badge” in their app, and scan that');
    if (tote.carriedBy && driver.driverDid !== tote.carriedBy) {
      throw new GlosError('FORBIDDEN', `That pass is not the driver carrying bag ${tote.code}: the driver who brought it hands it over`);
    }
    const said = input?.exceptions ?? [];
    if (said.length > MAX_TRANSFER_EXCEPTIONS) {
      throw new GlosError('VALIDATION_FAILED', `Say at most ${MAX_TRANSFER_EXCEPTIONS} things wrong with a bag: with more, report the bag instead`, { field: 'exceptions' });
    }
    const transferId = `htr_${randomBytes(8).toString('hex')}`;
    const link = { type: 'bag' as const, id: transferId };
    const exceptions = said.map((e, i) => {
      const note = typeof e?.note === 'string' ? e.note.trim().replace(/\s+/g, ' ') : '';
      if (note.length < TRANSFER_NOTE_MIN || note.length > TRANSFER_NOTE_MAX) {
        throw new GlosError('VALIDATION_FAILED', `Say in words what is wrong with the bag, in ${TRANSFER_NOTE_MIN} to ${TRANSFER_NOTE_MAX} characters`, { field: `exceptions.${i}.note` });
      }
      if (e.photoRef) this.media.requireHeld(e.photoRef, hub.did, link, `exceptions.${i}.photoRef`);
      return { note, ...(e.photoRef ? { photoRef: e.photoRef } : {}) };
    });
    const by = clerk.trim().replace(/\s+/g, ' ');
    const driverRecord = this.driverOf(driver.driverDid);
    return (step, closure) => {
      const receipt = closure?.receipt;
      const record: HubTransfer = {
        transferId,
        mdpId: hub.mdpId,
        hubName: hub.name,
        country: hub.country,
        bagCode: tote.code,
        fromCountry: from.country,
        ...(from.place ? { fromPlace: from.place } : {}),
        parcels: [...tote.parcels],
        released: { driverDid: driver.driverDid, ...(driverRecord?.name ? { driverName: driverRecord.name } : {}), badgeId, ...(driverRecord?.fleetDid ? { fleetDid: driverRecord.fleetDid } : {}), at: step.at },
        received: {
          by,
          at: step.at,
          ...(closure ? { sealKind: closure.kind } : {}),
          ...(closure?.number ? { sealNumber: closure.number } : {}),
          ...(receipt?.numberRead ? { numberRead: receipt.numberRead } : {}),
          ...(receipt?.photoRef ? { photoRef: receipt.photoRef } : {}),
          ...(receipt ? { asClosed: receipt.asClosed } : {}),
        },
        exceptions: exceptions.map((e): HubTransferException => ({ ...e, at: step.at, by })),
        passedOnWhole: false,
        onward: [],
      };
      this.transfers.set(transferId, record);
      for (const e of exceptions) if (e.photoRef) this.media.adopt(e.photoRef, hub.did, link, 'seal');
      for (const p of record.parcels) this.waiting.set(p, transferId);
      return record;
    };
  }

  /** The bag was passed on unopened to a hub further on: it is resealed here before it goes (the hub closes it on a coded seal). */
  passedOnWhole(transferId: string): void {
    const t = this.transfers.get(transferId);
    if (t) this.transfers.set(transferId, { ...t, passedOnWhole: true });
  }

  /** Told once the bag is off the driver's vehicle: the GPS watch closes where nothing aboard asks for it any more. */
  released(driverDid: string): void {
    for (const fn of this.afterRelease) {
      try {
        fn(driverDid);
      } catch {
        // the watch is the watch's: a handover is never undone by it
      }
    }
  }

  /** Whether a bag at a hub holds parcels taken over there from another country, and so leaves only on a coded seal. */
  needsCodedSeal(hubId: string, parcels: string[]): boolean {
    return parcels.some((p) => this.transfers.get(this.waiting.get(p) ?? '')?.mdpId === hubId);
  }

  /** Closing such a bag: a coded seal, its number typed, or it is refused before anything is kept. */
  assertSeal(hubId: string, tote: Tote, closure: { seal?: string } | undefined): void {
    if (!this.needsCodedSeal(hubId, tote.parcels)) return;
    if (typeof closure?.seal === 'string' && closure.seal.trim()) return;
    throw new GlosError('FIELD_REQUIRED', `Bag ${tote.code} holds parcels handed over here from another country: it leaves on a coded seal. Put one on, type its number and photograph the bag with the seal in view`, { field: 'closure.seal' });
  }

  /** Loading such a bag: it was closed on a coded seal here, or it does not go. Asked before anything is written. */
  assertLoad(hubId: string, tote: Tote, closure: BagClosure | undefined): void {
    if (!this.needsCodedSeal(hubId, tote.parcels)) return;
    if (closure?.kind === 'seal') return;
    throw new GlosError('BAG_NOT_CLOSED', `Bag ${tote.code} holds parcels handed over here from another country: close it on a coded seal, its number typed and photographed, before it goes`);
  }

  /**
   * THE RECORD CLOSED: the bag that takes such parcels on from the hub, its coded seal and photograph, and the driver whose pass
   * took it. Kept on every handover its parcels came from; the parcels no longer wait.
   */
  noteOnward(hubId: string, tote: Tote, closure: BagClosure | undefined, by: { badgeId: string; driverDid?: string }, at: string): HubTransfer[] {
    const byTransfer = new Map<string, string[]>();
    for (const p of tote.parcels) {
      const id = this.waiting.get(p);
      if (!id || this.transfers.get(id)?.mdpId !== hubId) continue;
      byTransfer.set(id, [...(byTransfer.get(id) ?? []), p]);
    }
    const driverRecord = by.driverDid ? this.driverOf(by.driverDid) : undefined;
    const out: HubTransfer[] = [];
    for (const [id, parcels] of byTransfer) {
      const t = this.transfers.get(id)!;
      const onward = {
        kind: 'bag' as const,
        bagCode: tote.code,
        parcels,
        ...(closure?.number ? { sealNumber: closure.number } : {}),
        ...(closure ? { closureId: closure.closureId, photoRef: closure.photoRef, closedAt: closure.closedAt } : {}),
        ...(by.driverDid ? { driverDid: by.driverDid } : {}),
        ...(driverRecord?.name ? { driverName: driverRecord.name } : {}),
        badgeId: by.badgeId,
        loadedAt: at,
      };
      const next = { ...t, onward: [...t.onward, onward] };
      this.transfers.set(id, next);
      for (const p of parcels) this.waiting.delete(p);
      out.push(next);
    }
    return out;
  }

  /**
   * 2026-11-24 — A PARCEL FROM A HANDOVER PUT ON THE HUB'S OWN COUNTER SHELF (a hub that hands out too): it leaves the floor by
   * hand, no bag, and waits there for its receiver's code. Its record says so, and it no longer waits for a coded seal.
   */
  noteCounter(hubId: string, parcelId: string, slot: string, at: string): HubTransfer | undefined {
    const id = this.waiting.get(parcelId);
    const t = id ? this.transfers.get(id) : undefined;
    if (!t || t.mdpId !== hubId) return undefined;
    const next = { ...t, onward: [...t.onward, { kind: 'counter' as const, bagCode: '', parcels: [parcelId], slot, badgeId: '', loadedAt: at }] };
    this.transfers.set(t.transferId, next);
    this.waiting.delete(parcelId);
    return next;
  }

  /** The handovers at a hub, newest first: for the hub, its owner and staff. */
  forHub(mdpId: string, limit = 50): HubTransfer[] {
    return [...this.transfers.values()].filter((t) => t.mdpId === mdpId).sort((a, b) => b.received.at.localeCompare(a.received.at)).slice(0, limit);
  }

  /** The handovers a parcel went through, oldest first: its custody chain across borders. */
  forParcel(parcelId: string): HubTransfer[] {
    return [...this.transfers.values()].filter((t) => t.parcels.includes(parcelId)).sort((a, b) => a.received.at.localeCompare(b.received.at));
  }

  /** The handover of a bag, by its code, newest first. */
  forBag(code: string): HubTransfer[] {
    return [...this.transfers.values()].filter((t) => t.bagCode === code || t.onward.some((o) => o.bagCode === code)).sort((a, b) => b.received.at.localeCompare(a.received.at));
  }

  get(transferId: string): HubTransfer | undefined {
    return this.transfers.get(transferId);
  }

  private driverOf(did: string): { name?: string; fleetDid?: string } | undefined {
    try {
      const d = this.drivers.get(did);
      return { name: d.displayName, ...(d.managerDid ? { fleetDid: d.managerDid } : {}) };
    } catch {
      return undefined;
    }
  }
}
