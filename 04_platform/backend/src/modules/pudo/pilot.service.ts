import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { createHash } from 'crypto';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { ParcelService } from './parcel.service';
import { HandoverRecord, PILOT_TARGETS, PilotBoard, PilotWeek, TAKE_IN_MAX_S, TakeInRecord } from './pilot.types';
import { Parcel } from './pudo.types';

const DAY = 24 * 3_600_000;
const WEEK = 7 * DAY;
/** Each hour a week that has ended is frozen, if it was not already. Reading the board does the same. */
const SWEEP_MS = 3_600_000;

/** Monday 00:00 UTC of the week `t` falls in. */
export function weekStart(t: number): number {
  const d = new Date(t);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
}

/** The ISO week a Monday starts, as "2026-W42": the week's Thursday decides its year. */
export function isoWeek(monday: number): string {
  const year = new Date(monday + 3 * DAY).getUTCFullYear();
  const first = weekStart(Date.UTC(year, 0, 4));
  return `${year}-W${String(1 + Math.round((monday - first) / WEEK)).padStart(2, '0')}`;
}

/** When the parcel was taken in at a counter: its intake, or a walk-up's first scan by the shop. Never a mint. */
export function takenInAt(p: Parcel): number | undefined {
  const scan = p.scans.find((s) => s.status === 'At_PUDO' || (s.status === 'CREATED' && Boolean(p.originAgentDid) && s.by === p.originAgentDid));
  return scan ? Date.parse(scan.at) : undefined;
}

/** The middle one, and the one nine in ten are faster than. */
function quantile(sorted: number[], q: number): number {
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[i];
}

const ratio = (a: number, b: number): number | undefined => (b > 0 ? Math.round((a / b) * 10_000) / 10_000 : undefined);

/**
 * THE PILOT, WEEK BY WEEK (pilot.types.ts; the user, 2026-10-18). Two things the network did not keep are kept from now:
 * what each counter handover was due to load against what it scanned, and how long each take-in took at the counter.
 * The rest is read from the parcels. A week that has ended is frozen once, with a fingerprint, and never counted again.
 */
@Injectable()
export class PilotService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(PilotService.name);
  private readonly handovers = new PersistentMap<string, HandoverRecord>('pilot-handovers');
  private readonly takeIns = new PersistentMap<string, TakeInRecord>('pilot-take-ins');
  private readonly weeks = new PersistentMap<string, PilotWeek>('pilot-weeks');
  private timer?: NodeJS.Timeout;

  constructor(private readonly parcels: ParcelService) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      try {
        this.freeze();
      } catch (err) {
        this.logger.warn(`freezing pilot weeks failed: ${(err as Error).message}`);
      }
    }, SWEEP_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** A counter handover: the parcels its manifest expected, the ones scanned onto the bus, the ones left behind. */
  noteHandover(agentDid: string, result: { manifestId: string; expected: string[]; handed: string[]; missed: string[] }, now: number = Date.now()): void {
    if (!result.expected.length && !result.handed.length) return;
    this.handovers.set(result.manifestId, { at: new Date(now).toISOString(), agentDid, expected: result.expected.length, handed: result.handed.length, missed: result.missed.length });
  }

  /**
   * A take-in, timed by the counter's app from the first touch on the form to the parcel taken in. Kept once per parcel
   * (a take-in that waited for a signal is sent again with the same time), and only a plausible one: nothing, or longer
   * than TAKE_IN_MAX_S, is an interrupted take-in, not a slow one.
   */
  noteTakeIn(parcelId: string, agentDid: string, seconds: unknown, now: number = Date.now()): void {
    const s = Number(seconds);
    if (!Number.isFinite(s) || s <= 0 || s > TAKE_IN_MAX_S || this.takeIns.get(parcelId)) return;
    this.takeIns.set(parcelId, { parcelId, agentDid, at: new Date(now).toISOString(), seconds: Math.round(s * 10) / 10 });
  }

  /** The week still running (so far), every frozen week newest first, and the compendium's targets. */
  board(now: number = Date.now()): PilotBoard {
    this.freeze(now);
    const monday = weekStart(now);
    return {
      thisWeek: this.compute(monday, now, false),
      weeks: [...this.weeks.values()].sort((a, b) => b.from.localeCompare(a.from)),
      targets: {
        handshake: PILOT_TARGETS.handshake.target,
        handshakeWarn: PILOT_TARGETS.handshake.warn,
        loss: PILOT_TARGETS.loss.target,
        lossWarn: PILOT_TARGETS.loss.warn,
        takeInSeconds: PILOT_TARGETS.takeInSeconds.target,
        takeInWarnSeconds: PILOT_TARGETS.takeInSeconds.warn,
        retention: PILOT_TARGETS.retention.target,
        retentionAtWeek: PILOT_TARGETS.retention.atWeek,
      },
    };
  }

  /** Every week that has ended since the pilot's first, frozen if it was not. A frozen week is never counted again. */
  freeze(now: number = Date.now()): number {
    const first = this.firstWeek();
    if (first === undefined) return 0;
    let made = 0;
    for (let monday = first; monday + WEEK <= now; monday += WEEK) {
      const key = isoWeek(monday);
      if (this.weeks.get(key)) continue;
      const week = this.compute(monday, monday + WEEK, true, now);
      this.weeks.set(key, week);
      made += 1;
    }
    return made;
  }

  /** The Monday the first parcel was taken in at a counter: week 1 of the pilot. */
  private firstWeek(): number | undefined {
    let first: number | undefined;
    for (const p of this.parcels.list()) {
      const t = takenInAt(p);
      if (t !== undefined && (first === undefined || t < first)) first = t;
    }
    return first === undefined ? undefined : weekStart(first);
  }

  private compute(from: number, to: number, frozen: boolean, now: number = to): PilotWeek {
    const within = (iso?: string) => {
      if (!iso) return false;
      const t = Date.parse(iso);
      return t >= from && t < to;
    };
    const parcels = this.parcels.list();

    let handed = 0;
    let missed = 0;
    for (const h of this.handovers.values()) {
      if (!within(h.at)) continue;
      handed += h.handed;
      missed += h.missed;
    }

    let takenIn = 0;
    let lost = 0;
    let damaged = 0;
    for (const p of parcels) {
      const t = takenInAt(p);
      if (t !== undefined && t >= from && t < to) takenIn += 1;
      // Declared lost this week and not found by the time it was counted: a parcel that turned up is not a loss.
      if (p.lost && within(p.lost.declaredAt) && !(p.lost.foundAt && Date.parse(p.lost.foundAt) <= now)) lost += 1;
      if (p.dispute && within(p.dispute.raisedAt)) damaged += 1;
    }

    const times = [...this.takeIns.values()]
      .filter((r) => within(r.at))
      .map((r) => r.seconds)
      .sort((a, b) => a - b);

    const week: PilotWeek = {
      week: isoWeek(from),
      from: new Date(from).toISOString(),
      to: new Date(frozen ? to : from + WEEK).toISOString(),
      frozen,
      handshake: { handed, missed, ...(ratio(handed, handed + missed) !== undefined ? { rate: ratio(handed, handed + missed) } : {}) },
      loss: { lost, damaged, takenIn, ...(ratio(lost + damaged, takenIn) !== undefined ? { rate: ratio(lost + damaged, takenIn) } : {}) },
      takeIn: { timed: times.length, ...(times.length ? { medianSeconds: quantile(times, 0.5), p90Seconds: quantile(times, 0.9) } : {}) },
      ...this.retention(parcels, from, to),
    };
    if (!frozen) return week;
    const frozenAt = new Date(now).toISOString();
    return { ...week, frozenAt, sha256: createHash('sha256').update(JSON.stringify(week)).digest('hex') };
  }

  /** Of the shops that worked a counter in the pilot's first week, how many worked one in this week. */
  private retention(parcels: Parcel[], from: number, to: number): Pick<PilotWeek, 'retention'> {
    const first = this.firstWeek();
    if (first === undefined || from < first) return {};
    const original = this.shopsWorking(parcels, first, first + WEEK);
    const now = from === first ? original : this.shopsWorking(parcels, from, to);
    const active = [...original].filter((shop) => now.has(shop)).length;
    return { retention: { pilotWeek: 1 + Math.round((from - first) / WEEK), original: original.size, active, ...(ratio(active, original.size) !== undefined ? { rate: ratio(active, original.size) } : {}) } };
  }

  /**
   * The shops that did counter work between `from` and `to`: a scan the shop itself signed, on a parcel it took in or was
   * to hand out — taking in, receiving, shelving, handing out. A hub's, a driver's or the network's own scans of the same
   * parcel are not the shop working.
   */
  private shopsWorking(parcels: Parcel[], from: number, to: number): Set<string> {
    const shops = new Set<string>();
    for (const p of parcels) {
      for (const s of p.scans) {
        if (s.by !== p.originAgentDid && s.by !== p.destAgentDid) continue;
        const t = Date.parse(s.at);
        if (t >= from && t < to) shops.add(s.by);
      }
    }
    return shops;
  }
}
