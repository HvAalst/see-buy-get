import { Injectable, Optional } from '@nestjs/common';
import { GlosError } from '../../foundation/http/glos-error';
import { isDay } from './carriage-contract.service';
import { DepartureService } from './departure.service';
import { DispatchService } from './dispatch.service';
import { FleetManagerService } from './fleet-manager.service';
import { FleetSiteService } from './fleet-site.service';
import { DEPOT_SITE } from './fleet-site.types';
import { FleetService } from './fleet.service';
import { FleetUseView, UseTotals, VehicleUse } from './fleet-use.types';
import { VehicleBreakdownService } from './vehicle-breakdown.service';
import { VehicleCareService } from './vehicle-care.service';
import { VehicleService } from './vehicle.service';

/** The longest stretch of days one look covers. */
export const MAX_USE_DAYS = 31;

/** HOW A FLEET'S VEHICLES WERE USED (see fleet-use.types.ts). Read by its office and by staff; it changes nothing. */
@Injectable()
export class FleetUseService {
  constructor(
    private readonly managers: FleetManagerService,
    private readonly vehicles: VehicleService,
    private readonly fleet: FleetService,
    private readonly dispatch: DispatchService,
    private readonly departures: DepartureService,
    @Optional() private readonly sites?: FleetSiteService,
    @Optional() private readonly care?: VehicleCareService,
    @Optional() private readonly breakdowns?: VehicleBreakdownService,
  ) {}

  /** From one day to another, both the fleet's own, at most a month. Refused before anything is worked out when the days are wrong. */
  view(fleetDid: string, from: string, to: string, now: number = Date.now()): FleetUseView {
    this.managers.get(fleetDid);
    if (!isDay(from) || !isDay(to)) throw new GlosError('INVALID_INPUT', 'A day is YYYY-MM-DD');
    if (to < from) throw new GlosError('INVALID_INPUT', 'The last day comes on or after the first', { field: 'to' });
    if (spanOf(from, to) > MAX_USE_DAYS) throw new GlosError('INVALID_INPUT', `At most ${MAX_USE_DAYS} days at a time`, { field: 'to' });
    const today = this.managers.todayOf(fleetDid, now);
    const days = daysBetween(from, to < today ? to : today);
    const inDays = new Set(days);
    const dayOf = (iso: string) => this.managers.todayOf(fleetDid, Date.parse(iso));
    const sites = this.sites?.sitesOf(fleetDid) ?? [];
    const siteName = (id: string) => sites.find((s) => s.siteId === id)?.name ?? 'Depot';

    const vehicles: VehicleUse[] = this.vehicles
      .list({ managerDid: fleetDid })
      .filter((v) => v.status !== 'RETIRED')
      .sort((a, b) => a.plate.localeCompare(b.plate, undefined, { numeric: true }))
      .map((v) => {
        const shifts = this.fleet.shiftsOfVehicle(v.vehicleId).filter((s) => inDays.has(dayOf(s.startedAt)));
        const out = new Set(shifts.map((s) => dayOf(s.startedAt)));
        const off = new Set([...this.offRoadDays(v.vehicleId, days, dayOf)].filter((d) => !out.has(d)));
        const hours = shifts.reduce((n, s) => n + Math.max(0, (Date.parse(s.endedAt ?? new Date(now).toISOString()) - Date.parse(s.startedAt)) / 3_600_000), 0);
        const loads = this.dispatch.deliveriesOf(v.vehicleId).filter((d) => inDays.has(dayOf(d.deliveredAt)));
        const runs = this.departures.runsOf(v.vehicleId).filter((r) => inDays.has(dayOf(r.leavesAt)));
        const km = this.care?.drivenOn(v.vehicleId, inDays, dayOf);
        const siteId = this.sites?.homeOf(fleetDid, 'vehicle', v.vehicleId) ?? DEPOT_SITE;
        return {
          vehicleId: v.vehicleId,
          plate: v.plate,
          vehicleClass: v.vehicleClass,
          capacityKg: v.capacityKg,
          siteId,
          siteName: siteName(siteId),
          vehicles: 1,
          daysOut: out.size,
          daysOffRoad: off.size,
          daysIdle: days.length - out.size - off.size,
          shifts: shifts.length,
          hoursOnShift: round1(hours),
          ...(km !== undefined ? { km } : {}),
          loads: loads.length,
          kgDelivered: Math.round(loads.reduce((n, d) => n + d.weightKg, 0)),
          loadedKm: round1(loads.reduce((n, d) => n + (d.loadedKm ?? 0), 0)),
          emptyKm: round1(loads.reduce((n, d) => n + (d.emptyKm ?? 0), 0)),
          runs: runs.length,
          runKg: Math.round(runs.reduce((n, r) => n + r.kg, 0)),
        };
      });

    return {
      from,
      to,
      days: days.length,
      vehicles,
      sites: (sites.length ? sites : [{ siteId: DEPOT_SITE, name: 'Depot' }]).map((s) => ({ siteId: s.siteId, name: s.name, ...sum(vehicles.filter((v) => v.siteId === s.siteId)) })),
      totals: sum(vehicles),
    };
  }

  /** The days of these that a spell or a breakdown kept it off the road. */
  private offRoadDays(vehicleId: string, days: string[], dayOf: (iso: string) => string): Set<string> {
    const spans = [...(this.care?.spellSpansOf(vehicleId, dayOf) ?? []), ...(this.breakdowns?.spansOf(vehicleId).map((b) => ({ from: dayOf(b.from), ...(b.until ? { until: dayOf(b.until) } : {}) })) ?? [])];
    return new Set(days.filter((d) => spans.some((s) => s.from <= d && (s.until === undefined || d <= s.until))));
  }
}

/** Vehicles added up — km only where every one of them has it, so a total never quietly leaves somebody out. */
function sum(list: UseTotals[]): UseTotals {
  const add = (k: keyof UseTotals) => list.reduce((n, v) => n + ((v[k] as number | undefined) ?? 0), 0);
  const kmKnown = list.length > 0 && list.every((v) => v.km !== undefined);
  return {
    vehicles: list.length,
    daysOut: add('daysOut'),
    daysOffRoad: add('daysOffRoad'),
    daysIdle: add('daysIdle'),
    shifts: add('shifts'),
    hoursOnShift: round1(add('hoursOnShift')),
    ...(kmKnown ? { km: Math.round(add('km')) } : {}),
    loads: add('loads'),
    kgDelivered: Math.round(add('kgDelivered')),
    loadedKm: round1(add('loadedKm')),
    emptyKm: round1(add('emptyKm')),
    runs: add('runs'),
    runKg: Math.round(add('runKg')),
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function spanOf(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000) + 1;
}

/** Every day from one to another, both counted; none when the first is after the last. */
function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = new Date(Date.parse(`${d}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) out.push(d);
  return out;
}
