import { Injectable } from '@nestjs/common';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { GlosError } from '../../foundation/http/glos-error';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { isDay } from './carriage-contract.service';
import { DriverService } from './driver.service';
import { FleetManagerService } from './fleet-manager.service';
import { FleetDriver } from './fleet.types';
import { DriverRosterView, RosterDay, RosterView } from './fleet-roster.types';

/** How far ahead an office may say who drives: two months is a rota; further is a guess. */
export const ROSTER_DAYS_AHEAD = 62;

/** What a driver is told when the office puts them on a day's roster, or takes them off it. */
export interface DriverRostered {
  driverDid: string;
  fleetName: string;
  day: string;
  on: boolean;
}

/**
 * WHO DRIVES ON WHICH DAY — see RosterDay. The plan asks `driversFor`; the office reads and sets a day; each driver
 * reads their own coming days and is told when one changes for them.
 */
@Injectable()
export class FleetRosterService {
  private readonly days = new PersistentMap<string, RosterDay>('fleet-rosters');

  constructor(
    private readonly drivers: DriverService,
    private readonly managers: FleetManagerService,
    private readonly events: EventBus,
  ) {}

  /**
   * The drivers a plan for the day counts: the office's roster where it set one — of those, the ones still active in
   * this fleet — and otherwise every active driver, as a plan always counted them.
   */
  driversFor(fleetDid: string, day: string): { source: 'roster' | 'everyone'; drivers: FleetDriver[] } {
    const active = this.activeOf(fleetDid);
    const kept = this.days.get(keyOf(fleetDid, day));
    if (!kept) return { source: 'everyone', drivers: active };
    const on = new Set(kept.driverDids);
    return { source: 'roster', drivers: active.filter((d) => on.has(d.did)) };
  }

  view(fleetDid: string, day: string): RosterView {
    if (!isDay(day)) throw new GlosError('INVALID_INPUT', 'A day is YYYY-MM-DD', { field: 'day' });
    this.managers.get(fleetDid);
    const kept = this.days.get(keyOf(fleetDid, day));
    const { source, drivers } = this.driversFor(fleetDid, day);
    const on = new Set(drivers.map((d) => d.did));
    return {
      day,
      source,
      drivers: drivers.length,
      list: this.activeOf(fleetDid).map((d) => ({ driverDid: d.did, name: d.displayName, rostered: on.has(d.did) })),
      ...(kept ? { setAt: kept.setAt, setBy: kept.setBy } : {}),
    };
  }

  /**
   * Say who drives on a day: the whole list, replacing what was said before. Refused whole, before anything is kept,
   * when the day has gone or is too far off, or a name on it is not an active driver of this fleet. Each driver whose
   * day changed is told: put on it, or taken off a day they had been told they drive.
   */
  set(fleetDid: string, day: string, driverDids: string[], by: string, now: number = Date.now()): RosterView {
    if (!isDay(day)) throw new GlosError('INVALID_INPUT', 'A day is YYYY-MM-DD', { field: 'day' });
    const fleet = this.managers.get(fleetDid);
    const today = this.managers.todayOf(fleetDid, now);
    if (day < today) throw new GlosError('INVALID_INPUT', 'That day has gone — a roster is for today or later', { field: 'day' });
    if (day > addDays(today, ROSTER_DAYS_AHEAD)) throw new GlosError('INVALID_INPUT', `A roster is for the next ${ROSTER_DAYS_AHEAD} days at most`, { field: 'day' });
    const active = new Map(this.activeOf(fleetDid).map((d) => [d.did, d]));
    const wanted = [...new Set(driverDids)];
    const stranger = wanted.find((did) => !active.has(did));
    if (stranger) {
      const known = this.drivers.list({ managerDid: fleetDid }).find((d) => d.did === stranger);
      throw new GlosError('INVALID_INPUT', known ? `${known.displayName} is not an active driver, and cannot be put on a day` : 'A driver on this list is not in this fleet', { field: 'driverDids' });
    }

    const key = keyOf(fleetDid, day);
    const before = new Set(this.days.get(key)?.driverDids ?? []);
    this.days.set(key, { fleetDid, day, driverDids: wanted, setAt: new Date(now).toISOString(), setBy: by });

    // Told only what changed for them. Somebody left off a day the office had never rostered was never told they
    // drive it, so there is nothing to take back.
    const told: DriverRostered[] = [
      ...wanted.filter((did) => !before.has(did)).map((driverDid) => ({ driverDid, fleetName: fleet.companyName, day, on: true })),
      ...[...before].filter((did) => !wanted.includes(did) && active.has(did)).map((driverDid) => ({ driverDid, fleetName: fleet.companyName, day, on: false })),
    ];
    for (const payload of told) void this.events.publish(GlosEvent.Pudo.DriverRostered, payload, { source: 'pudo' }).catch(() => undefined);
    return this.view(fleetDid, day);
  }

  /** A driver's own coming days: each one their fleet has said who drives, today first, and whether they do. */
  forDriver(driverDid: string, now: number = Date.now()): DriverRosterView {
    const driver = this.drivers.get(driverDid);
    if (!driver.managerDid) return { days: [] };
    const fleetDid = driver.managerDid;
    const today = this.managers.todayOf(fleetDid, now);
    const days = [...this.days.values()]
      .filter((r) => r.fleetDid === fleetDid && r.day >= today)
      .sort((a, b) => a.day.localeCompare(b.day))
      .map((r) => ({ day: r.day, rostered: r.driverDids.includes(driverDid) }));
    return { fleetName: this.managers.get(fleetDid).companyName, days };
  }

  private activeOf(fleetDid: string): FleetDriver[] {
    return this.drivers
      .list({ managerDid: fleetDid })
      .filter((d) => d.status === 'ACTIVE')
      .sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { numeric: true }));
  }
}

const keyOf = (fleetDid: string, day: string) => `${fleetDid}|${day}`;

/** A day a number of days after another, both YYYY-MM-DD. Worked at noon, so no clock change moves it. */
function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}
