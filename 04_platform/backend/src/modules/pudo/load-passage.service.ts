import { Inject, Injectable, Optional } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { GlosError } from '../../foundation/http/glos-error';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { BorderRuleService } from './border-rules.service';
import type { Freight } from './dispatch.types';
import {
  MAX_PLACE_NAME,
  MIN_MEASURED_CROSSINGS,
  PASSAGE_KINDS,
  WAIT_WINDOW_DAYS,
  type BorderWait,
  type BorderWaitRow,
  type LoadCrossing,
  type LoadPassage,
  type LoadPassageForDriver,
  type LoadPassageView,
  type PassageKind,
} from './load-passage.types';
import { whenSeen } from './observed-at';
import { BORDER_DWELL_H, VEHICLE_SPEED_KMH } from './pudo.config';
import type { GeoPoint } from './pudo.types';
import { ROUTER, type Router } from './router';

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/**
 * A LOAD AT A BORDER OR A HUB, said by the driver carrying it (load-passage.types.ts; round 14).
 *
 * Keeps the steps, beside the load; judges each new one against the load and the steps before it; measures each post's
 * wait from the loads that cleared it; and says, for a load that crosses a border, where it has got to and when it is
 * expected — from what the driver said, never from the clock.
 */
@Injectable()
export class LoadPassageService {
  private readonly passages = new PersistentMap<string, LoadPassage>('load-passages');
  /**
   * The steps by load, and the cleared crossings by their two countries: a Loads screen asks for every row's steps and
   * every crossing's wait, and reading the whole store for each would grow with everything ever said. Built on first use
   * from the store (it is this process's own: one writer per database), kept up to date as steps are said.
   */
  private index?: { byLoad: Map<string, LoadPassage[]>; clearedByPair: Map<string, LoadPassage[]> };

  constructor(
    @Inject(ROUTER) private readonly router: Router,
    // The posts each crossing has on record, for the driver to choose from. Optional so the specs that build this by hand
    // keep working; without it the driver names the post.
    @Optional() private readonly borders?: BorderRuleService,
  ) {}

  /** Every step said on a load, in the order it happened. */
  of(freightId: string): LoadPassage[] {
    return [...(this.indexed().byLoad.get(freightId) ?? [])];
  }

  /** The steps as anybody but the driver reads them. */
  views(freightId: string): LoadPassageView[] {
    return this.of(freightId).map(viewOf);
  }

  /**
   * THE DRIVER SAYS A STEP on the load they carry, while it is on the road. Refused before anything is kept, in words
   * the driver can act on: not their load, not on the road, a border on a load that stays in one country, a second
   * border before the first is cleared, cleared without being at one, a post or a hub not named.
   *
   * A tap sent twice — the phone did not hear the answer and sent it again — is the same step, not a second one: the
   * same as the last step said, at the same place, is answered as it was.
   */
  record(f: Freight, driverDid: string, input: { kind: PassageKind; post?: string; hub?: string; location?: GeoPoint; observedAt?: string }, now: number = Date.now()): { passage: LoadPassage; replayed: boolean } {
    if (f.claimedBy !== driverDid) throw new GlosError('FORBIDDEN', 'This freight was claimed by another driver');
    if (f.status !== 'in_transit') throw new GlosError('INVALID_STATE', `Freight is ${f.status}: a border or a hub is said while it is on the road`);
    if (!PASSAGE_KINDS.includes(input.kind)) throw new GlosError('INVALID_INPUT', 'Say what it is: at the border, cleared the border, or at a hub');
    const before = this.of(f.freightId);
    const last = before[before.length - 1];
    const open = openCrossing(before);
    const post = placeName(input.post);
    const hub = placeName(input.hub);

    const sameAsLast =
      last &&
      last.kind === input.kind &&
      (input.kind === 'cleared_border' || (input.kind === 'at_border' && post != null && fold(post) === last.postKey) || (input.kind === 'at_hub' && hub != null && fold(hub) === fold(last.hub ?? '')));
    if (sameAsLast) return { passage: last, replayed: true };

    const location = input.location && validPoint(input.location) ? { lat: input.location.lat, lng: input.location.lng } : undefined;
    if (input.location && !location) throw new GlosError('INVALID_INPUT', 'Where the phone was is not a place on the map', { field: 'location' });

    const crossing = crossingCountries(f);
    let step: Pick<LoadPassage, 'post' | 'postKey' | 'from' | 'to' | 'hub'>;
    if (input.kind === 'at_border') {
      if (!crossing) throw new GlosError('INVALID_STATE', 'This load stays in one country: it crosses no border');
      if (open) throw new GlosError('INVALID_STATE', `It is at ${open.post} already: say it has cleared before it is at another border`);
      if (!post) throw new GlosError('FIELD_REQUIRED', 'Say which border post it is at', { field: 'post' });
      // A post on record keeps the name it is recorded under, however the driver spelt it; any other, the driver's words.
      const named = this.postsFor(crossing.from, crossing.to).find((n) => fold(n) === fold(post)) ?? post;
      step = { post: named, postKey: fold(named), from: crossing.from, to: crossing.to };
    } else if (input.kind === 'cleared_border') {
      if (!open) throw new GlosError('INVALID_STATE', 'It is not at a border: say it is at one first');
      step = { post: open.post, postKey: open.postKey, from: open.from, to: open.to };
    } else {
      if (!hub) throw new GlosError('FIELD_REQUIRED', 'Name the hub it is at', { field: 'hub' });
      step = { hub };
    }

    // Dated when the driver said it, within reason — and never before what was already said about the load, nor before it
    // was picked up: the order of its steps is part of what they mean.
    const seen = whenSeen(input.observedAt, now);
    const floor = Math.max(Date.parse(f.pickedUpAt ?? '') || 0, last ? Date.parse(last.at) : 0);
    const atMs = Math.max(seen.at, floor);
    const passage: LoadPassage = {
      passageId: `lp_${randomBytes(8).toString('hex')}`,
      freightId: f.freightId,
      kind: input.kind,
      ...step,
      at: new Date(atMs).toISOString(),
      ...(seen.receivedAt ? { receivedAt: seen.receivedAt } : {}),
      by: driverDid,
      ...(location ? { location } : {}),
      ...(input.kind === 'cleared_border' && open ? { waitedMin: Math.max(0, Math.round((atMs - Date.parse(open.at)) / 60_000)) } : {}),
    };
    this.passages.set(passage.passageId, passage);
    this.remember(passage);
    return { passage, replayed: false };
  }

  /**
   * HOW LONG A CROSSING TAKES. For a post: the median of the loads that cleared it on this crossing in the last ninety
   * days, once there are enough of them — else the standard four hours, said as such. For the crossing as a whole, before
   * the load is at a post: its one recorded post's, where it has only one; else every post's crossings together, once
   * there are enough; else the standard.
   */
  waitFor(from: string, to: string, post?: string, now: number = Date.now()): BorderWait {
    const cleared = this.clearedOn(from, to, now);
    const named = post ?? this.onlyPost(from, to);
    if (named) {
      const mine = cleared.filter((p) => p.postKey === fold(named));
      if (mine.length >= MIN_MEASURED_CROSSINGS) return { from, to, post: named, hours: hoursOf(median(mine.map((p) => p.waitedMin!))), basis: 'measured', crossings: mine.length };
      return { from, to, post: named, hours: BORDER_DWELL_H, basis: 'standard' };
    }
    if (cleared.length >= MIN_MEASURED_CROSSINGS) {
      const posts = new Map(cleared.map((p) => [p.postKey!, p.post!]));
      return { from, to, hours: hoursOf(median(cleared.map((p) => p.waitedMin!))), basis: 'measured', crossings: cleared.length, posts: [...posts.values()].sort() };
    }
    return { from, to, hours: BORDER_DWELL_H, basis: 'standard' };
  }

  /**
   * A LOAD THAT CROSSES A BORDER, where it has got to and when it is expected. The expectation starts from the last step
   * the driver said (or the pickup): from there, the drive to its destination and whatever of the wait is still ahead.
   * Where the phone's position was not given, the last place known stands in — it can only make the drive longer.
   */
  crossingOf(f: Freight, now: number = Date.now()): LoadCrossing | undefined {
    const countries = crossingCountries(f);
    if (!countries) return undefined;
    const steps = this.of(f.freightId);
    const open = openCrossing(steps);
    const cleared = [...steps].reverse().find((p) => p.kind === 'cleared_border');
    const state = open ? 'at_post' : cleared ? 'cleared' : 'ahead';
    const wait = this.waitFor(countries.from, countries.to, open?.post ?? cleared?.post, now);

    let expectedAt: string | undefined;
    if (f.status === 'in_transit' && f.destLocation && f.pickedUpAt) {
      const last = steps[steps.length - 1];
      const fromMs = last ? Date.parse(last.at) : Date.parse(f.pickedUpAt);
      const place = [...steps].reverse().find((p) => p.location)?.location ?? f.pickupLocation;
      const speed = VEHICLE_SPEED_KMH[f.carriage?.vehicleClass === 'truck' ? 'truck' : 'bus'];
      const driveMs = (this.router.roadKm(place, f.destLocation) / speed) * HOUR_MS;
      const waitMs = wait.hours * HOUR_MS;
      const waitAheadMs = state === 'ahead' ? waitMs : state === 'at_post' ? Math.max(0, waitMs - (fromMs - Date.parse(open!.at))) : 0;
      if (Number.isFinite(fromMs) && Number.isFinite(driveMs)) expectedAt = new Date(fromMs + driveMs + waitAheadMs).toISOString();
    }
    return {
      state,
      from: countries.from,
      to: countries.to,
      ...(open ? { post: open.post, since: open.at } : cleared ? { post: cleared.post, clearedAt: cleared.at, ...(cleared.waitedMin != null ? { waitedMin: cleared.waitedMin } : {}) } : wait.post ? { post: wait.post } : {}),
      wait,
      ...(expectedAt ? { expectedAt } : {}),
    };
  }

  /** What the driver's app needs to say the next step on a load it carries. */
  forDriver(f: Freight, now: number = Date.now()): LoadPassageForDriver {
    const countries = crossingCountries(f);
    const steps = this.of(f.freightId);
    const open = openCrossing(steps);
    const last = steps[steps.length - 1];
    return {
      crosses: Boolean(countries),
      ...(countries ? { from: countries.from, to: countries.to } : {}),
      posts: countries ? this.postsFor(countries.from, countries.to) : [],
      ...(open && countries ? { atPost: { post: open.post!, since: open.at, wait: this.waitFor(countries.from, countries.to, open.post, now) } } : {}),
      ...(last ? { last: viewOf(last) } : {}),
    };
  }

  /** Every post's measured wait, for staff: the loads that cleared it in the last ninety days. */
  board(now: number = Date.now()): BorderWaitRow[] {
    const since = now - WAIT_WINDOW_DAYS * DAY_MS;
    const groups = new Map<string, LoadPassage[]>();
    for (const list of this.indexed().clearedByPair.values()) {
      for (const p of list) {
        if (Date.parse(p.at) < since) continue;
        const key = `${p.from}|${p.to}|${p.postKey}`;
        groups.set(key, [...(groups.get(key) ?? []), p]);
      }
    }
    return [...groups.values()]
      .map((list) => {
        const latest = list.reduce((a, b) => (b.at > a.at ? b : a));
        return {
          from: latest.from!,
          to: latest.to!,
          post: latest.post!,
          hours: hoursOf(median(list.map((p) => p.waitedMin!))),
          crossings: list.length,
          measured: list.length >= MIN_MEASURED_CROSSINGS,
          longestHours: hoursOf(Math.max(...list.map((p) => p.waitedMin!))),
          lastClearedAt: latest.at,
        };
      })
      .sort((a, b) => `${a.from}${a.to}${a.post}`.localeCompare(`${b.from}${b.to}${b.post}`));
  }

  /** The posts a crossing has on record, by name. */
  postsFor(from: string, to: string): string[] {
    return (this.borders?.ruleFor(from, to)?.crossings ?? []).map((c) => c.name).filter(Boolean);
  }

  private onlyPost(from: string, to: string): string | undefined {
    const posts = this.postsFor(from, to);
    return posts.length === 1 ? posts[0] : undefined;
  }

  private clearedOn(from: string, to: string, now: number): LoadPassage[] {
    const since = now - WAIT_WINDOW_DAYS * DAY_MS;
    return (this.indexed().clearedByPair.get(`${from}|${to}`) ?? []).filter((p) => Date.parse(p.at) >= since);
  }

  private indexed(): NonNullable<LoadPassageService['index']> {
    if (!this.index) {
      this.index = { byLoad: new Map(), clearedByPair: new Map() };
      for (const p of [...this.passages.values()].sort((a, b) => a.at.localeCompare(b.at))) this.remember(p);
    }
    return this.index;
  }

  /** A step added to the index. Not built yet: nothing to do — building it reads the store, this step included. */
  private remember(p: LoadPassage): void {
    const index = this.index;
    if (!index) return;
    // Said in order (record() dates a step no earlier than the one before it), so appending keeps each load's steps in order.
    index.byLoad.set(p.freightId, [...(index.byLoad.get(p.freightId) ?? []), p]);
    if (p.kind === 'cleared_border' && p.waitedMin != null) {
      const pair = `${p.from}|${p.to}`;
      index.clearedByPair.set(pair, [...(index.clearedByPair.get(pair) ?? []), p]);
    }
  }
}

/** The two countries a load crosses between, where they differ. */
export function crossingCountries(f: Pick<Freight, 'pickupCountry' | 'destCountry'>): { from: string; to: string } | undefined {
  return f.pickupCountry && f.destCountry && f.pickupCountry !== f.destCountry ? { from: f.pickupCountry, to: f.destCountry } : undefined;
}

/** The post a load is at now: the last it arrived at and has not cleared. */
function openCrossing(steps: LoadPassage[]): LoadPassage | undefined {
  let open: LoadPassage | undefined;
  for (const p of steps) {
    if (p.kind === 'at_border') open = p;
    else if (p.kind === 'cleared_border') open = undefined;
  }
  return open;
}

export function viewOf(p: LoadPassage): LoadPassageView {
  return { kind: p.kind, ...(p.post ? { post: p.post } : {}), ...(p.hub ? { hub: p.hub } : {}), at: p.at, ...(p.waitedMin != null ? { waitedMin: p.waitedMin } : {}) };
}

function placeName(raw: string | undefined): string | undefined {
  const s = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : '';
  return s ? s.slice(0, MAX_PLACE_NAME) : undefined;
}

function fold(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

function validPoint(p: GeoPoint): boolean {
  return Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Minutes as hours, to the tenth. */
function hoursOf(minutes: number): number {
  return Math.round((minutes / 60) * 10) / 10;
}
