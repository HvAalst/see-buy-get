import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { GlosError } from '../../foundation/http/glos-error';
import { PersistentMap } from '../../foundation/store/persistent-map';
import type { Freight } from './dispatch.types';
import {
  MAX_BREAK_PHOTOS,
  MAX_SEAL_NUMBER,
  MAX_SEALS,
  SEAL_APPLIED_BY,
  SEAL_BREAK_CAUSES,
  SEAL_CLASSES,
  SEAL_PHOTOS,
  SEALS_AT_DELIVERY,
  type LoadSeal,
  type LoadSealView,
  type SealAppliedBy,
  type SealBreakCause,
  type SealClass,
  type SealPhoto,
  type SealsAtDelivery,
  type SealToFind,
} from './load-seal.types';
import { MediaService } from './media.service';
import { whenSeen } from './observed-at';
import type { GeoPoint } from './pudo.types';

/** Before the goods are taken over: the seals are still the shipper's to write. */
const BEFORE_PICKUP: ReadonlyArray<Freight['status']> = ['scheduled', 'available', 'ordered', 'claimed'];

/**
 * A SEAL ON A LOAD (load-seal.types.ts; round 15). Keeps the seals beside the load and judges every act on them: the
 * shipper writing one, with its three photographs; the driver reading each off the door at pickup — the load does not
 * leave on a number that is not the one written; customs sealing it again at a post; a seal found broken on the road; the
 * look at the door at delivery. Every act is checked whole before anything is kept, and each one that needs a driver's
 * photograph takes only a photograph that driver took.
 */
@Injectable()
export class LoadSealService {
  private readonly seals = new PersistentMap<string, LoadSeal>('load-seals');

  constructor(private readonly media: MediaService) {}

  /** Every seal a load has had, in the order written. */
  of(freightId: string): LoadSeal[] {
    // By when each was written; two written in the same moment keep the order they were written in (a stable sort).
    return [...this.seals.values()].filter((s) => s.freightId === freightId).sort((a, b) => a.writtenAt.localeCompare(b.writtenAt));
  }

  /** The seals on the load now. */
  on(freightId: string): LoadSeal[] {
    return this.of(freightId).filter((s) => s.state === 'on');
  }

  views(freightId: string, numbers = true): LoadSealView[] {
    const all = this.of(freightId);
    return all.map((s) => (numbers ? viewOf(s, all) : withheld(viewOf(s, all))));
  }

  /** What the driver's app is told: which seals to find on the door, and what each is — never its number. */
  toFind(freightId: string): SealToFind[] {
    return this.of(freightId).map((s, i) => ({ sealId: s.sealId, no: i + 1, ...(s.sealClass ? { sealClass: s.sealClass } : {}), ...(s.maker ? { maker: s.maker } : {}), appliedBy: s.appliedBy, state: s.state, check: sealCheck(freightId, s.key) }));
  }

  /** Whether the shipper may still write the seals: until the goods are taken over. */
  editable(f: Freight): boolean {
    return BEFORE_PICKUP.includes(f.status);
  }

  /** Every photograph the seals of a load have: the note's copies carry them. */
  photosOf(freightId: string): string[] {
    return this.of(freightId).flatMap((s) => [...Object.values(s.photos), ...s.readings.map((r) => r.photoRef), ...(s.broken ? [...s.broken.photoRefs, s.broken.paperRef] : [])]).filter((r): r is string => Boolean(r));
  }

  /* ---------------------------------------------------------------- the shipper -- */

  /**
   * THE SHIPPER WRITES A SEAL on its load, before the goods are taken over: the number as printed, its ISO 17712 class,
   * the maker as marked, who closed it — and the three photographs, each the shipper's own and not used elsewhere.
   * Round 33 — `keep` false (a business's TEST key): every check runs, and nothing is kept — no seal, no photo adopted.
   */
  write(f: Freight, writer: { did: string; name: string }, input: { number: string; sealClass: SealClass; maker?: string; appliedBy: SealAppliedBy; photos: Partial<Record<SealPhoto, string>> }, now: number = Date.now(), keep = true): LoadSeal {
    if (!this.editable(f)) throw new GlosError('INVALID_STATE', 'The goods are taken over: a seal is written on the load before pickup');
    const number = sealNumber(input.number);
    if (!number) throw new GlosError('FIELD_REQUIRED', 'Write the seal’s number as it is printed on it', { field: 'number' });
    if (!SEAL_CLASSES.includes(input.sealClass)) throw new GlosError('FIELD_REQUIRED', 'Say the seal’s class as it is marked: I, S or H (ISO 17712)', { field: 'sealClass' });
    if (!SEAL_APPLIED_BY.includes(input.appliedBy)) throw new GlosError('FIELD_REQUIRED', 'Say who closed it: your own seal, or customs', { field: 'appliedBy' });
    const on = this.on(f.freightId);
    if (on.length >= MAX_SEALS) throw new GlosError('VALIDATION_FAILED', `A load carries up to ${MAX_SEALS} seals here`);
    if (on.some((s) => s.key === keyOf(number))) throw new GlosError('VALIDATION_FAILED', `Seal ${number} is on this load already`, { field: 'number' });
    for (const photo of SEAL_PHOTOS) {
      const ref = input.photos?.[photo];
      if (!ref) throw new GlosError('FIELD_REQUIRED', PHOTO_WORDS[photo], { field: `photos.${photo}` });
      this.mustBeOwn(ref, writer.did, PHOTO_WORDS[photo]);
    }
    // Round 33 — each photograph is of this seal and nothing else. They are kept with the LOAD, so the media's own link
    // cannot tell one seal's close-up from another's: asked here, before anything is written.
    const refs = SEAL_PHOTOS.map((photo) => input.photos[photo]!);
    if (new Set(refs).size !== refs.length) throw new GlosError('FIELD_REQUIRED', 'Three photographs, each its own: one picture cannot stand for two of them', { field: 'photos' });
    const named = new Set(this.of(f.freightId).flatMap((s) => Object.values(s.photos)));
    for (const photo of SEAL_PHOTOS) {
      if (named.has(input.photos[photo]!)) throw new GlosError('FIELD_REQUIRED', `${PHOTO_WORDS[photo]}: that photograph is another seal’s`, { field: `photos.${photo}` });
    }
    if (keep) for (const photo of SEAL_PHOTOS) this.media.adopt(input.photos[photo], writer.did, { type: 'freight', id: f.freightId }, 'seal');
    const maker = input.maker?.trim().slice(0, 60);
    const seal: LoadSeal = {
      sealId: `${keep ? '' : 'test_'}seal_${randomBytes(6).toString('hex')}`,
      freightId: f.freightId,
      number,
      key: keyOf(number),
      sealClass: input.sealClass,
      ...(maker ? { maker } : {}),
      appliedBy: input.appliedBy,
      photos: { loadedOpen: input.photos.loadedOpen, closedWithSeal: input.photos.closedWithSeal, sealCloseUp: input.photos.sealCloseUp },
      state: 'on',
      writtenAt: new Date(now).toISOString(),
      writtenBy: writer.name,
      readings: [],
    };
    if (keep) this.seals.set(seal.sealId, seal);
    return seal;
  }

  /** Round 33 — a seal as it would read on the load: what a test key is answered with, for a seal it did not keep. */
  viewAmong(f: Freight, seal: LoadSeal): LoadSealView {
    const all = [...this.of(f.freightId).filter((s) => s.sealId !== seal.sealId), seal];
    return viewOf(seal, all);
  }

  /** The shipper takes a seal off its load again, before pickup: written wrong, or not used after all. */
  remove(f: Freight, sealId: string, keep = true): void {
    if (!this.editable(f)) throw new GlosError('INVALID_STATE', 'The goods are taken over: the seals they left with stay on the record');
    const seal = this.seals.get(sealId);
    if (!seal || seal.freightId !== f.freightId) throw new GlosError('NOT_FOUND', 'No such seal on this load');
    if (keep) this.seals.delete(sealId); // round 33 — a test key's removal is checked, and the seal stays
  }

  /* ------------------------------------------------------------------- pickup -- */

  /**
   * AT PICKUP THE DRIVER READS EACH SEAL OFF THE DOOR. Every seal on the load must be read, each with its close-up; a
   * number that is not the one the shipper wrote and the load does not leave. Checked whole, BEFORE the pickup writes
   * anything; what to keep is handed back to be done once it has.
   */
  checkAtPickup(f: Freight, driverDid: string, read: Array<{ sealId: string; number: string; photoRef: string }> | undefined): (at: string) => void {
    const on = this.on(f.freightId);
    if (!on.length) return () => undefined;
    const all = this.of(f.freightId);
    for (const seal of on) {
      const no = all.indexOf(seal) + 1;
      const entry = read?.find((r) => r.sealId === seal.sealId);
      if (!entry || !sealNumber(entry.number)) throw new GlosError('SEAL_CHECK_INCOMPLETE', `Read seal ${no} off the door and photograph it before pickup`, { field: 'seals' });
      if (keyOf(sealNumber(entry.number)!) !== seal.key) {
        throw new GlosError('SEAL_MISMATCH', `Seal ${no}: the number on the door is not the one the shipper wrote. Read it again — if it is not the same, the load does not leave: show the shipper.`, { field: 'seals', sealNo: no });
      }
      this.mustBeOwn(entry.photoRef, driverDid, `Photograph seal ${no} close up, its number readable`);
    }
    return (at) => {
      for (const seal of on) {
        const entry = read!.find((r) => r.sealId === seal.sealId)!;
        this.media.adopt(entry.photoRef, driverDid, { type: 'freight', id: f.freightId }, 'seal');
        this.seals.set(seal.sealId, { ...seal, readings: [...seal.readings, { at, stage: 'pickup', result: 'matched', photoRef: entry.photoRef, by: driverDid }] });
      }
    };
  }

  /**
   * Round 35 — A SEAL THAT IS NOT THE ONE WRITTEN, said by the driver who read it again (the tamper protocol): which seal,
   * and the number on the door. Refused when it is the number written: then the seal is as written, and nothing is held.
   */
  notAsWritten(f: Freight, sealId: string | undefined, raw: string | undefined): { sealId: string; no: number; numberRead: string } {
    const all = this.of(f.freightId);
    const seal = this.on(f.freightId).find((s) => s.sealId === sealId);
    if (!seal) throw new GlosError('FIELD_REQUIRED', 'Say which seal is not the one written', { field: 'sealId' });
    const read = sealNumber(raw);
    if (!read) throw new GlosError('FIELD_REQUIRED', 'Write the number on the door as you read it', { field: 'numberRead' });
    if (keyOf(read) === seal.key) throw new GlosError('VALIDATION_FAILED', 'That is the number written: this seal is as written', { field: 'numberRead' });
    return { sealId: seal.sealId, no: all.indexOf(seal) + 1, numberRead: read };
  }

  /* -------------------------------------------------------- at a border post -- */

  /**
   * CLEARING A BORDER WITH SEALS ON, the driver says whether they are as they were — or which customs took off and the
   * new one it put on, with its photograph and the officer where given. Checked whole; what to keep is handed back.
   */
  checkAtPost(
    f: Freight,
    driverDid: string,
    answer: { asTheyWere?: boolean; replaced?: Array<{ sealId: string; newNumber: string; photoRef: string; officer?: string }> } | undefined,
  ): { says: { asTheyWere?: boolean; resealed?: Array<{ from: string; to: string; officer?: string }> }; keep: (at: string, post: string | undefined) => void } | undefined {
    const on = this.on(f.freightId);
    if (!on.length) return undefined;
    const replaced = answer?.replaced ?? [];
    if (!answer || (!answer.asTheyWere && !replaced.length)) throw new GlosError('FIELD_REQUIRED', 'Say whether the seals are as they were, or which customs opened and sealed again', { field: 'seals' });
    if (answer.asTheyWere && replaced.length) throw new GlosError('VALIDATION_FAILED', 'The seals are either as they were, or some were replaced — not both', { field: 'seals' });
    const keys = new Set(on.map((s) => s.key));
    for (const r of replaced) {
      const seal = on.find((s) => s.sealId === r.sealId);
      if (!seal) throw new GlosError('NOT_FOUND', 'That seal is not on this load', { field: 'seals' });
      const newNumber = sealNumber(r.newNumber);
      if (!newNumber) throw new GlosError('FIELD_REQUIRED', 'Write the new seal’s number as it is printed on it', { field: 'seals' });
      if (keys.has(keyOf(newNumber))) throw new GlosError('VALIDATION_FAILED', `Seal ${newNumber} is on this load already`, { field: 'seals' });
      keys.add(keyOf(newNumber));
      this.mustBeOwn(r.photoRef, driverDid, 'Photograph the new seal close up, its number readable');
    }
    if (answer.asTheyWere) return { says: { asTheyWere: true }, keep: () => undefined };
    const says = {
      resealed: replaced.map((r) => {
        const officer = r.officer?.trim().slice(0, 80);
        return { from: on.find((s) => s.sealId === r.sealId)!.number, to: sealNumber(r.newNumber)!, ...(officer ? { officer } : {}) };
      }),
    };
    const keep = (at: string, post: string | undefined) => {
      for (const r of replaced) {
        const seal = this.seals.get(r.sealId)!;
        const officer = r.officer?.trim().slice(0, 80);
        const newNumber = sealNumber(r.newNumber)!;
        const next: LoadSeal = {
          sealId: `seal_${randomBytes(6).toString('hex')}`,
          freightId: f.freightId,
          number: newNumber,
          key: keyOf(newNumber),
          appliedBy: 'customs',
          photos: { sealCloseUp: r.photoRef },
          state: 'on',
          writtenAt: at,
          writtenBy: 'the driver, at the post',
          replaces: seal.sealId,
          readings: [],
        };
        this.media.adopt(r.photoRef, driverDid, { type: 'freight', id: f.freightId }, 'seal');
        this.seals.set(next.sealId, next);
        this.seals.set(seal.sealId, { ...seal, state: 'replaced', replaced: { at, ...(post ? { post } : {}), ...(officer ? { officer } : {}), by: driverDid, newSealId: next.sealId } });
      }
    };
    return { says, keep };
  }

  /* ------------------------------------------------------------- on the road -- */

  /**
   * A SEAL FOUND BROKEN ON THE ROAD — by the police, by customs, for a repair, or found so. The driver carrying the load,
   * while it is on the road, with at least one photograph of it and of any official paper; dated when it was seen.
   */
  reportBroken(f: Freight, driverDid: string, sealId: string, input: { cause: SealBreakCause; note?: string; photoRefs: string[]; paperRef?: string; location?: GeoPoint; observedAt?: string }, now: number = Date.now()): LoadSeal {
    if (f.claimedBy !== driverDid) throw new GlosError('FORBIDDEN', 'This freight was claimed by another driver');
    if (f.status !== 'in_transit') throw new GlosError('INVALID_STATE', `Freight is ${f.status}: a broken seal is reported while the load is on the road`);
    const seal = this.seals.get(sealId);
    if (!seal || seal.freightId !== f.freightId) throw new GlosError('NOT_FOUND', 'No such seal on this load');
    if (seal.state !== 'on') throw new GlosError('INVALID_STATE', seal.state === 'broken' ? 'This seal is reported broken already' : 'This seal was replaced: report the one on the door now');
    if (!SEAL_BREAK_CAUSES.includes(input.cause)) throw new GlosError('FIELD_REQUIRED', 'Say what broke it: the police, customs, a repair, or found broken', { field: 'cause' });
    const photos = [...new Set(input.photoRefs ?? [])].slice(0, MAX_BREAK_PHOTOS);
    if (!photos.length) throw new GlosError('FIELD_REQUIRED', 'Photograph the broken seal', { field: 'photoRefs' });
    for (const ref of photos) this.mustBeOwn(ref, driverDid, 'Photograph the broken seal');
    if (input.paperRef) this.mustBeOwn(input.paperRef, driverDid, 'Photograph the official paper');
    const location = input.location && Number.isFinite(input.location.lat) && Number.isFinite(input.location.lng) && Math.abs(input.location.lat) <= 90 && Math.abs(input.location.lng) <= 180 ? { lat: input.location.lat, lng: input.location.lng } : undefined;
    const seen = whenSeen(input.observedAt, now);
    for (const ref of [...photos, ...(input.paperRef ? [input.paperRef] : [])]) this.media.adopt(ref, driverDid, { type: 'freight', id: f.freightId }, 'seal');
    const note = input.note?.trim().slice(0, 500);
    const broken: LoadSeal = {
      ...seal,
      state: 'broken',
      broken: { at: new Date(Math.max(seen.at, Date.parse(f.pickedUpAt ?? '') || 0)).toISOString(), ...(seen.receivedAt ? { receivedAt: seen.receivedAt } : {}), cause: input.cause, ...(note ? { note } : {}), photoRefs: photos, ...(input.paperRef ? { paperRef: input.paperRef } : {}), ...(location ? { location } : {}), by: driverDid },
    };
    this.seals.set(seal.sealId, broken);
    return broken;
  }

  /* ---------------------------------------------------------------- delivery -- */

  /** AT DELIVERY, with the receiver: are the seals as the note says? Asked of every load that has had a seal. */
  checkAtDelivery(f: Freight, driverDid: string, answer: SealsAtDelivery | undefined): ((at: string) => void) | undefined {
    const all = this.of(f.freightId);
    if (!all.length) return undefined;
    if (!answer || !SEALS_AT_DELIVERY.includes(answer)) throw new GlosError('FIELD_REQUIRED', 'Look at the seals with the receiver: are they as the note says?', { field: 'sealsAtDelivery' });
    return (at) => {
      for (const seal of this.of(f.freightId).filter((s) => s.state !== 'replaced')) {
        this.seals.set(seal.sealId, { ...seal, readings: [...seal.readings, { at, stage: 'delivery', result: answer, by: driverDid }] });
      }
    };
  }

  /* ------------------------------------------------------------------ the note -- */

  /**
   * The seals as the consignment note says them: one line a seal, with what became of it, in order. Round 35 — `numbers`
   * false for a reader the numbers are withheld from until the goods are taken over (see ConsignmentNoteService).
   */
  noteLines(freightId: string, numbers = true): string[] {
    const all = this.of(freightId);
    return all.map((s, i) => {
      const what = [`Seal ${i + 1}: ${numbers ? s.number : 'its number is read off the door at taking over'}`, s.sealClass ? `ISO 17712 class ${s.sealClass}` : '', s.maker ?? '', s.appliedBy === 'customs' ? 'customs seal' : 'the sender’s seal'].filter(Boolean).join(' · ');
      const replaces = s.replaces ? all.find((x) => x.sealId === s.replaces) : undefined;
      const story = [
        replaces ? `put on by customs in place of ${replaces.number}${replaces.replaced?.post ? ` at ${replaces.replaced.post}` : ''}, ${day(s.writtenAt)}${replaces.replaced?.officer ? ` (officer: ${replaces.replaced.officer})` : ''}` : `written by ${s.writtenBy}, ${day(s.writtenAt)}`,
        ...s.readings.map((r) => (r.stage === 'pickup' ? `found on the door at taking over, ${day(r.at)}` : r.result === 'as_on_the_note' ? `as on this note at delivery, ${day(r.at)}` : `NOT as on this note at delivery, ${day(r.at)}`)),
        ...(s.replaced ? [`opened by customs${s.replaced.post ? ` at ${s.replaced.post}` : ''}, ${day(s.replaced.at)}`] : []),
        ...(s.broken ? [`FOUND BROKEN on the road, ${day(s.broken.at)}: ${BREAK_WORDS[s.broken.cause]}${s.broken.note ? ` — “${s.broken.note}”` : ''}${s.broken.paperRef ? '; the official paper is photographed' : ''}`] : []),
      ];
      return `${what} — ${story.join('; ')}.`;
    });
  }

  /** What box 18 must say of the seals: the carrier's observations — one found broken, one not as the note says at the door. */
  noteObservations(freightId: string): string[] {
    const all = this.of(freightId);
    return all.flatMap((s, i) => [
      ...(s.broken ? [`Seal ${i + 1} (${s.number}) found broken on the road, ${day(s.broken.at)}: ${BREAK_WORDS[s.broken.cause]}`] : []),
      ...s.readings.filter((r) => r.stage === 'delivery' && r.result === 'not_as_on_the_note').map((r) => `Seal ${i + 1} (${s.number}) not as on this note at delivery, ${day(r.at)}`),
    ]);
  }

  private mustBeOwn(ref: string | undefined, ownerDid: string, words: string): void {
    const m = ref ? this.media.get(ref) : undefined;
    if (!m || m.status !== 'active' || m.ownerDid !== ownerDid) throw new GlosError('FIELD_REQUIRED', `${words}: that photograph is not one of yours`, { field: 'photos' });
  }
}

const PHOTO_WORDS: Record<SealPhoto, string> = {
  loadedOpen: 'Photograph the load open, blocked and braced',
  closedWithSeal: 'Photograph the doors closed, the vehicle’s or container’s number and the seal both in view',
  sealCloseUp: 'Photograph the seal close up, its whole number readable',
};

const BREAK_WORDS: Record<SealBreakCause, string> = {
  police: 'broken by the police',
  customs: 'broken by customs',
  repair: 'broken for a repair on the road',
  found_broken: 'found broken',
  other: 'broken',
};

/**
 * Round 35 — a seal as a reader sees it before the goods are taken over, when it is not the shipper's or staff's to read:
 * which seal and what it is, never its number — the driver reads that off the door, and could not if he had looked it up.
 */
function withheld(v: LoadSealView): LoadSealView {
  const { number: _number, ...rest } = v;
  void _number;
  return { ...rest, numberWithheld: true };
}

function viewOf(s: LoadSeal, all: LoadSeal[]): LoadSealView {
  const matched = s.readings.find((r) => r.stage === 'pickup');
  const atDelivery = [...s.readings].reverse().find((r) => r.stage === 'delivery');
  const next = s.replaced ? all.find((x) => x.sealId === s.replaced!.newSealId) : undefined;
  const before = s.replaces ? all.find((x) => x.sealId === s.replaces) : undefined;
  return {
    sealId: s.sealId,
    number: s.number,
    ...(s.sealClass ? { sealClass: s.sealClass } : {}),
    ...(s.maker ? { maker: s.maker } : {}),
    appliedBy: s.appliedBy,
    state: s.state,
    writtenAt: s.writtenAt,
    ...(matched ? { matchedAt: matched.at } : {}),
    ...(before ? { replaces: before.number } : {}),
    ...(s.replaced ? { replaced: { at: s.replaced.at, ...(s.replaced.post ? { post: s.replaced.post } : {}), ...(s.replaced.officer ? { officer: s.replaced.officer } : {}), by: next?.number ?? '' } } : {}),
    ...(s.broken ? { broken: { at: s.broken.at, cause: s.broken.cause, ...(s.broken.note ? { note: s.broken.note } : {}) } } : {}),
    ...(atDelivery ? { atDelivery: { at: atDelivery.at, result: atDelivery.result as SealsAtDelivery } } : {}),
  };
}

/** A seal number as written: trimmed, single spaces, at most so long. */
function sealNumber(raw: string | undefined): string | undefined {
  const s = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : '';
  return s ? s.slice(0, MAX_SEAL_NUMBER) : undefined;
}

/** A seal number folded for matching: what a person reads off a bolt, without the spaces, dashes and dots between. */
export function keyOf(number: string): string {
  return number.toUpperCase().replace(/[\s\-./]/g, '');
}

/**
 * WHAT THE DRIVER'S APP CHECKS A READING AGAINST, with no signal: the load and the folded number, hashed. A pickup made
 * where there is no signal waits on the phone, so the server's refusal would come after the truck has left; the app says
 * "not the number written" on the spot instead. Since round 35 the numbers are kept from the carrier until the goods are
 * taken over, so this is the one way left to them: a short number can be tried until it fits, which takes deliberate work.
 */
export function sealCheck(freightId: string, key: string): string {
  return createHash('sha256').update(`${freightId}|${key}`).digest('hex');
}

function day(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}
