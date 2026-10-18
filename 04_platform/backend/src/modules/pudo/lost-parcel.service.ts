import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import type { Signer } from '../../foundation/entity/same-person';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { FlagCaseService } from './flag-case.service';
import { ParcelService } from './parcel.service';
import { LostParcelAct, LostParcelView } from './lost-parcel.types';

/**
 * LOST, BY STAFF AFTER A SEARCH (the user, 2026-10-18; pudo.types.ts ParcelLoss). The parcel carries what the sender
 * may read — when, where staff looked, where it turned up. WHO declared it and who found it is the staff's own record,
 * kept here and never on the parcel, which shops and stores read. Declaring it from its search case closes that case
 * under the same name and the same words.
 */

/** Found ones stay on the list this long, so whoever declared it sees that it turned up. */
const FOUND_SHOWN_MS = 30 * 24 * 3_600_000;

@Injectable()
export class LostParcelService {
  private readonly log = new PersistentMap<string, LostParcelAct & { parcelId: string }>('lost-parcel-log');

  constructor(
    private readonly parcels: ParcelService,
    private readonly cases: FlagCaseService,
  ) {}

  declare(parcelId: string, reason: string, staff: Signer, now: number = Date.now()): LostParcelView {
    const parcel = this.parcels.declareLost(parcelId, reason, now);
    this.note(parcelId, 'declared', staff.name, parcel.lost!.reason, now);
    this.cases.closeFor('Not_Seen', parcelId, staff, `Declared lost: ${parcel.lost!.reason}`, now);
    return this.view(parcelId);
  }

  found(parcelId: string, note: string, staff: Signer, now: number = Date.now()): LostParcelView {
    const parcel = this.parcels.foundAgain(parcelId, note);
    this.note(parcelId, 'found', staff.name, parcel.lost!.foundNote ?? note, now);
    return this.view(parcelId);
  }

  view(parcelId: string): LostParcelView {
    const p = this.parcels.get(parcelId);
    const acts = [...this.log.values()]
      .filter((a) => a.parcelId === parcelId)
      .sort((a, b) => a.at.localeCompare(b.at))
      .map((a): LostParcelAct => ({ act: a.act, by: a.by, at: a.at, words: a.words }));
    return {
      parcelId,
      status: p.status,
      ...(p.lost
        ? { declaredAt: p.lost.declaredAt, reason: p.lost.reason, lastSeenAt: p.lost.lastSeenAt, ...(p.lost.foundAt ? { foundAt: p.lost.foundAt, foundNote: p.lost.foundNote } : {}) }
        : {}),
      ...(p.originZone ? { from: p.originZone } : {}),
      ...(p.destZone ? { to: p.destZone } : {}),
      acts,
    };
  }

  /** The parcels lost now, and those found in the last thirty days — newest first. Staff's. */
  list(now: number = Date.now()): LostParcelView[] {
    return this.parcels
      .list()
      .filter((p) => p.lost && (p.status === 'Lost' || (p.lost.foundAt && now - new Date(p.lost.foundAt).getTime() < FOUND_SHOWN_MS)))
      .sort((a, b) => b.lost!.declaredAt.localeCompare(a.lost!.declaredAt))
      .map((p) => this.view(p.parcelId));
  }

  private note(parcelId: string, act: LostParcelAct['act'], by: string, words: string, now: number): void {
    const id = `lpa_${now.toString(36)}_${randomBytes(4).toString('hex')}`;
    this.log.set(id, { parcelId, act, by, at: new Date(now).toISOString(), words });
  }
}
