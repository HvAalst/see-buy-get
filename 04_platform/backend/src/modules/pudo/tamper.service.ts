import { Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import type { Signer } from '../../foundation/entity/same-person';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { GlosError } from '../../foundation/http/glos-error';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { AgentService } from './agent.service';
import { DispatchService } from './dispatch.service';
import type { Freight } from './dispatch.types';
import { DriverService } from './driver.service';
import { FlagCaseService } from './flag-case.service';
import type { LoadSeal } from './load-seal.types';
import { LoadSealService } from './load-seal.service';
import { MediaService } from './media.service';
import { canonicalJson } from './note-archive.types';
import { whenSeen } from './observed-at';
import { ParcelService } from './parcel.service';
import type { Parcel } from './pudo.types';
import { ShipperCodesService } from './shipper-codes.service';
import { ToteService } from './tote.service';
import {
  FINDING_WORDS,
  MAX_TAMPER_NOTE,
  MAX_TAMPER_PHOTOS,
  MIN_RELEASE_REASON,
  type TamperException,
  type TamperExceptionView,
  type TamperFinding,
  type TamperStage,
  type TamperUnitType,
  type TamperUnitView,
  type UnitHold,
} from './tamper.types';

/** What a driver may report on a load. A broken seal has its own report, with its cause and the official's paper. */
const LOAD_FINDINGS: ReadonlyArray<TamperFinding> = ['seal_not_as_written', 'seal_not_as_on_the_note', 'wrap_cut'];

const STAGE_WORDS: Record<'pickup' | 'road' | 'delivery', string> = { pickup: 'at pickup', road: 'on the road', delivery: 'at delivery' };

/** Collectable at the destination: on the shelf, or past its window and still on it. */
const ON_THE_SHELF: ReadonlyArray<Parcel['status']> = ['Ready_For_Pickup', 'Unclaimed'];

export interface LoadTamperInput {
  finding: TamperFinding;
  sealId?: string;
  numberRead?: string;
  photoRefs?: string[];
  note?: string;
  /** In transit, at the receiver's door: a cut wrap found at delivery rather than on the road. */
  atDelivery?: boolean;
  observedAt?: string;
  location?: { lat: number; lng: number };
}

export interface ParcelTamperInput {
  photoRefs?: string[];
  note?: string;
  observedAt?: string;
}

/** Who reports a parcel: the shop at its counter (its did) or the hub (its id and the did its sign-in carries). */
export type ParcelReporter = { as: 'shop'; agentDid: string; name?: string } | { as: 'hub'; mdpId: string; mdpDid: string; mdpName: string; name?: string };

/** Who reads a unit's exceptions: staff with names; a party to it with the party that found it. */
export type TamperReader = 'staff' | 'party';

/**
 * THE TAMPER PROTOCOL (tamper.types.ts). Takes the report, holds the unit, keeps the exception, tells operations; takes
 * the release. Every report is checked whole — the unit, the reporter's hold on it, the photographs — before anything is
 * kept; a report of the same thing by the same person while it is still held (a phone sending again what it kept with
 * no signal) is the one already made.
 */
@Injectable()
export class TamperService implements OnModuleInit {
  private readonly log = new PersistentMap<string, TamperException>('pudo-tamper');

  constructor(
    private readonly parcels: ParcelService,
    private readonly dispatch: DispatchService,
    private readonly seals: LoadSealService,
    private readonly drivers: DriverService,
    private readonly agents: AgentService,
    private readonly totes: ToteService,
    private readonly codes: ShipperCodesService,
    private readonly media: MediaService,
    private readonly events: EventBus,
    @Optional() private readonly cases?: FlagCaseService,
  ) {}

  onModuleInit(): void {
    // Registered rather than injected: the load's own acts ask this, and this reads the load.
    this.dispatch.registerTamper({
      sealBroken: (f, driverDid, seal, now) => this.fromBrokenSeal(f, driverDid, seal, now),
      reportedAt: (freightId, stage) => this.forUnit('load', freightId).some((e) => e.stage === stage),
      noteLines: (freightId) => this.noteLines(freightId),
    });
  }

  /* ------------------------------------------------------------------ a load -- */

  /** The driver carrying it, while taking it over or carrying it: a seal not as written, the seals not as the note says, a cut wrap. */
  reportOnLoad(freightId: string, driverDid: string, input: LoadTamperInput, now: number = Date.now()): TamperUnitView {
    const f = this.dispatch.requireFreightPublic(freightId) as Freight;
    if (!driverDid || f.claimedBy !== driverDid) throw new GlosError('NOT_FOUND', 'No such load of yours');
    if (f.status !== 'claimed' && f.status !== 'in_transit') throw new GlosError('INVALID_STATE', `This load is ${f.status}: it is reported while you take it over or carry it`);
    const finding = input.finding;
    if (!LOAD_FINDINGS.includes(finding)) throw new GlosError('FIELD_REQUIRED', 'Say what you found: a seal that is not the one written, the seals not as the note says, or the wrap cut', { field: 'finding' });
    const stage: 'pickup' | 'road' | 'delivery' = f.status === 'claimed' ? 'pickup' : finding === 'seal_not_as_on_the_note' || input.atDelivery ? 'delivery' : 'road';
    let seal: TamperException['seal'];
    if (finding === 'seal_not_as_written') {
      if (stage !== 'pickup') throw new GlosError('INVALID_STATE', 'A seal is read against what was written at pickup. On the road, report it broken; at the door, say the seals are not as the note says', { field: 'finding' });
      seal = this.seals.notAsWritten(f, input.sealId, input.numberRead);
    }
    if (finding === 'seal_not_as_on_the_note' && !this.seals.of(f.freightId).length) {
      throw new GlosError('INVALID_STATE', 'This load has no seals. If the wrap or packaging is cut, report that', { field: 'finding' });
    }
    const link = { type: 'freight' as const, id: f.freightId };
    const photos = this.photosOf(input.photoRefs, driverDid, link);
    const same = this.sameHeld('load', f.freightId, finding, driverDid, seal?.sealId);
    if (same) return this.unitView('load', f.freightId, 'party');
    const e = this.keep(
      {
        unit: { type: 'load', id: f.freightId, ref: f.code },
        ssccs: this.codes.codesFor(f.freightId)?.codes ?? [],
        finding,
        stage,
        by: { did: driverDid, name: this.driverName(driverDid), as: 'driver' },
        where: STAGE_WORDS[stage],
        location: pointOf(input.location),
        photoRefs: photos,
        note: noteOf(input.note),
        seal,
      },
      input.observedAt,
      now,
    );
    for (const ref of photos) this.media.adopt(ref, driverDid, link, 'tamper');
    this.dispatch.holdFreight(f.freightId, holdOf(e));
    this.told(e, f, now);
    return this.unitView('load', f.freightId, 'party');
  }

  /** A seal reported broken on the road (LoadSealService.reportBroken): an exception too — held, logged, operations told. */
  private fromBrokenSeal(f: Freight, driverDid: string, seal: LoadSeal, now: number): void {
    if (!seal.broken) return;
    const all = this.seals.of(f.freightId);
    const e = this.keep(
      {
        unit: { type: 'load', id: f.freightId, ref: f.code },
        ssccs: this.codes.codesFor(f.freightId)?.codes ?? [],
        finding: 'seal_broken',
        stage: 'road',
        by: { did: driverDid, name: this.driverName(driverDid), as: 'driver' },
        where: STAGE_WORDS.road,
        location: seal.broken.location,
        photoRefs: [...seal.broken.photoRefs, ...(seal.broken.paperRef ? [seal.broken.paperRef] : [])],
        note: seal.broken.note,
        seal: { sealId: seal.sealId, no: all.findIndex((s) => s.sealId === seal.sealId) + 1, cause: seal.broken.cause },
      },
      seal.broken.at,
      now,
      seal.broken.receivedAt,
    );
    this.dispatch.holdFreight(f.freightId, holdOf(e));
    this.told(e, f, now);
  }

  /** A load's exceptions, for a reader the door has already let read the load's note (TamperController). */
  loadView(freightId: string, reader: TamperReader): TamperUnitView {
    const f = this.dispatch.requireFreightPublic(freightId) as Freight;
    return this.unitView('load', f.freightId, reader);
  }

  /* ---------------------------------------------------------------- a parcel -- */

  /**
   * A shop or a hub, about a parcel in its hands: the shop it was handed in at while it waits there, the shop it is going
   * to while it is on the shelf, the hub it stands at. Anybody else is told the same as for a number nobody was given.
   */
  reportOnParcel(parcelId: string, reporter: ParcelReporter, input: ParcelTamperInput, now: number = Date.now()): TamperUnitView {
    let p: Parcel;
    try {
      p = this.parcels.get(parcelId);
    } catch {
      throw new GlosError('NOT_FOUND', 'No parcel you hold has that number');
    }
    const place = placeOf(p, reporter);
    if (!place) throw new GlosError('NOT_FOUND', 'No parcel you hold has that number');
    const ownerDid = reporter.as === 'shop' ? reporter.agentDid : reporter.mdpDid;
    const link = { type: 'parcel' as const, id: p.parcelId };
    const photos = this.photosOf(input.photoRefs, ownerDid, link);
    const same = this.sameHeld('parcel', p.parcelId, 'wrap_cut', ownerDid);
    if (same) return this.unitView('parcel', p.parcelId, 'party');
    const where = reporter.as === 'shop' ? `at ${this.agents.find(reporter.agentDid)?.shopName ?? 'the shop'}` : `at ${reporter.mdpName}`;
    const e = this.keep(
      {
        unit: { type: 'parcel', id: p.parcelId, ref: p.parcelId },
        ssccs: p.sscc ? [p.sscc] : [],
        finding: 'wrap_cut',
        stage: place,
        by: { did: ownerDid, name: reporter.name?.trim() || where.slice(3), as: reporter.as },
        where,
        photoRefs: photos,
        note: noteOf(input.note),
      },
      input.observedAt,
      now,
    );
    for (const ref of photos) this.media.adopt(ref, ownerDid, link, 'tamper');
    // Set apart: out of a bag that has not left, so the bag can go on without it and nobody loads it by mistake.
    const bag = p.toteId ? this.totes.list().find((t) => t.toteId === p.toteId) : undefined;
    if (bag && bag.status !== 'in_transit' && bag.parcels.includes(p.parcelId)) this.totes.takeOut(bag.code, p.parcelId, p.size);
    this.parcels.hold(p.parcelId, holdOf(e), e.by.name);
    this.told(e, undefined, now, p);
    return this.unitView('parcel', p.parcelId, 'party');
  }

  /* ------------------------------------------------------------------ staff -- */

  /** A unit by how people say it (a load's code, a parcel's number), for staff: every exception, with who found it. */
  forStaff(ref: string): TamperUnitView {
    const unit = this.unitOfRef(ref);
    return this.unitView(unit.type, unit.id, 'staff');
  }

  /**
   * RELEASED BY OPERATIONS, with what was found and done. The case closes under the same words; every exception still
   * open on the unit keeps the release beside its fingerprinted body; the unit may move again.
   */
  release(ref: string, staff: Signer, reason: string, now: number = Date.now()): TamperUnitView {
    const unit = this.unitOfRef(ref);
    const words = String(reason ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_TAMPER_NOTE);
    if (words.length < MIN_RELEASE_REASON) throw new GlosError('FIELD_REQUIRED', 'Say what was found and what was done: a hold is released with a reason', { field: 'reason' });
    const open = this.forUnit(unit.type, unit.id).filter((e) => !e.release);
    if (!open.length) throw new GlosError('INVALID_STATE', 'This is not held');
    const at = new Date(now).toISOString();
    this.cases?.closeFor('Tamper_Hold', ref, staff, `Released: ${words}`, now);
    for (const e of open) this.log.set(e.exceptionId, { ...e, release: { at, by: staff.name, reason: words } });
    if (unit.type === 'load') this.dispatch.unholdFreight(unit.id);
    else this.parcels.unhold(unit.id, staff.name, words);
    const f = unit.type === 'load' ? (this.dispatch.requireFreightPublic(unit.id) as Freight) : undefined;
    void this.events
      .publish(GlosEvent.Pudo.UnitReleased, { unitType: unit.type, unitId: unit.id, ref, reason: words, ...(f ? { code: f.code, posterDid: f.postedByDid ?? f.shipperDid } : { parcelId: unit.id }) }, { source: 'pudo' })
      .catch(() => undefined);
    return this.unitView(unit.type, unit.id, 'staff');
  }

  /* ---------------------------------------------------------------- the note -- */

  /** Box 18 of the consignment note: each exception, where and when, and its release. Never who found it by name. */
  noteLines(freightId: string): string[] {
    return this.forUnit('load', freightId)
      .slice()
      .reverse()
      .map((e) => {
        const seal = e.seal ? ` (seal ${e.seal.no}${e.seal.numberRead ? `, read as ${e.seal.numberRead}` : ''})` : '';
        const released = e.release ? ` Released by operations ${day(e.release.at)}: ${e.release.reason}` : ' Held: operations has been told.';
        return `Held ${e.where}, ${day(e.at)}: ${FINDING_WORDS[e.finding]}${seal}.${released}`;
      });
  }

  /* ---------------------------------------------------------------- internal -- */

  forUnit(type: TamperUnitType, id: string): TamperException[] {
    return [...this.log.values()].filter((e) => e.unit.type === type && e.unit.id === id).sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  }

  private unitOfRef(ref: string): { type: TamperUnitType; id: string } {
    const key = String(ref ?? '').trim();
    const e = key ? [...this.log.values()].find((x) => x.unit.ref === key) : undefined;
    if (!e) throw new GlosError('NOT_FOUND', 'Nothing was ever held under that number');
    return { type: e.unit.type, id: e.unit.id };
  }

  private unitView(type: TamperUnitType, id: string, reader: TamperReader): TamperUnitView {
    const list = this.forUnit(type, id);
    const held = type === 'load' ? (this.dispatch.requireFreightPublic(id) as Freight).held : this.parcels.get(id).held;
    const ref = list[0]?.unit.ref ?? (type === 'load' ? (this.dispatch.requireFreightPublic(id) as Freight).code : id);
    return { unitType: type, unitId: id, ref, ...(held ? { held } : {}), exceptions: list.map((e) => viewOf(e, reader)) };
  }

  /** At least one photograph, each the reporter's own and not attached elsewhere — refused before anything is kept. */
  private photosOf(refs: string[] | undefined, ownerDid: string, link: { type: 'freight' | 'parcel'; id: string }): string[] {
    const photos = [...new Set((refs ?? []).filter((r) => typeof r === 'string' && r))].slice(0, MAX_TAMPER_PHOTOS);
    if (!photos.length) throw new GlosError('FIELD_REQUIRED', 'Photograph what you found, before anything else is touched', { field: 'photoRefs' });
    for (const ref of photos) this.media.requireHeld(ref, ownerDid, link, 'photoRefs');
    return photos;
  }

  private sameHeld(type: TamperUnitType, id: string, finding: TamperFinding, byDid: string, sealId?: string): TamperException | undefined {
    return this.forUnit(type, id).find((e) => !e.release && e.finding === finding && e.by.did === byDid && e.seal?.sealId === sealId);
  }

  private keep(body: Omit<TamperException, 'exceptionId' | 'at' | 'receivedAt' | 'hash'>, observedAt: string | undefined, now: number, receivedAt?: string): TamperException {
    const seen = observedAt && receivedAt !== undefined ? { at: Date.parse(observedAt), receivedAt } : whenSeen(observedAt, now);
    const clean = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)) as typeof body;
    const unsigned = {
      exceptionId: `tmp_${randomBytes(8).toString('hex')}`,
      ...clean,
      at: new Date(seen.at).toISOString(),
      ...(seen.receivedAt ? { receivedAt: seen.receivedAt } : {}),
    };
    const e: TamperException = { ...unsigned, hash: createHash('sha256').update(canonicalJson(unsigned)).digest('hex') };
    this.log.set(e.exceptionId, e);
    return e;
  }

  /** Operations, as a critical case, at once — not at the next sweep; the shipper or the store whose goods they are. */
  private told(e: TamperException, f: Freight | undefined, now: number, p?: Parcel): void {
    try {
      this.cases?.sync(now);
    } catch {
      /* the sweep opens it within five minutes */
    }
    void this.events
      .publish(
        GlosEvent.Pudo.UnitHeld,
        {
          unitType: e.unit.type,
          unitId: e.unit.id,
          ref: e.unit.ref,
          finding: e.finding,
          stage: e.stage,
          where: e.where,
          at: e.at,
          ...(f ? { posterDid: f.postedByDid ?? f.shipperDid } : {}),
          ...(p ? { parcelId: p.parcelId } : {}),
          ...(p?.vendorId ? { vendorId: p.vendorId, externalOrderId: p.externalOrderId } : {}),
        },
        { source: 'pudo' },
      )
      .catch(() => undefined);
  }

  private driverName(did: string): string {
    try {
      return this.drivers.get(did).displayName || 'the driver';
    } catch {
      return 'the driver';
    }
  }
}

/** Where the reporter holds the parcel, as a stage — or nowhere it does. */
function placeOf(p: Parcel, r: ParcelReporter): TamperStage | undefined {
  if (r.as === 'hub') return p.status === 'At_MDP' && p.atMdpId === r.mdpId ? 'hub' : undefined;
  if (p.status === 'At_PUDO' && p.originAgentDid === r.agentDid) return 'counter';
  if (ON_THE_SHELF.includes(p.status) && p.destAgentDid === r.agentDid) return 'counter';
  return undefined;
}

function holdOf(e: TamperException): UnitHold {
  return { since: e.at, finding: e.finding, stage: e.stage, exceptionId: e.exceptionId, where: e.where };
}

function viewOf(e: TamperException, reader: TamperReader): TamperExceptionView {
  return {
    exceptionId: e.exceptionId,
    ssccs: e.ssccs,
    finding: e.finding,
    stage: e.stage,
    at: e.at,
    ...(e.receivedAt ? { receivedAt: e.receivedAt } : {}),
    byAs: e.by.as,
    // A fleet driver is never named to a shipper (rule-a-handle-follows-the-contract); staff read who.
    ...(reader === 'staff' ? { byName: e.by.name } : {}),
    where: e.where,
    photoRefs: e.photoRefs,
    ...(e.note ? { note: e.note } : {}),
    ...(e.seal ? { sealNo: e.seal.no, ...(e.seal.numberRead ? { numberRead: e.seal.numberRead } : {}), ...(e.seal.cause ? { cause: e.seal.cause } : {}) } : {}),
    fingerprint: e.hash,
    ...(e.release ? { release: { at: e.release.at, by: reader === 'staff' ? e.release.by : 'operations', reason: e.release.reason } } : {}),
  };
}

function noteOf(raw: string | undefined): string | undefined {
  const s = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ').slice(0, MAX_TAMPER_NOTE) : '';
  return s || undefined;
}

function pointOf(p: { lat: number; lng: number } | undefined): { lat: number; lng: number } | undefined {
  return p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180 ? { lat: p.lat, lng: p.lng } : undefined;
}

function day(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}
