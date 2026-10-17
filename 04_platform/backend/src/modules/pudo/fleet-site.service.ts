import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { GlosError } from '../../foundation/http/glos-error';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { DriverService } from './driver.service';
import { FleetManagerService } from './fleet-manager.service';
import { VehicleService } from './vehicle.service';
import { DEPOT_SITE, FleetSite, FleetSitesView, FleetSiteView, MAX_SHIFTS, MAX_SITES, SiteShift, SiteWeek, WEEKDAYS } from './fleet-site.types';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const minutesOf = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));

/** A site as a plan asks about it: where, how many load at once, open when, and the shifts that start there. */
export interface SiteForPlan {
  siteId: string;
  name: string;
  location: { lat: number; lng: number };
  /** Absent: not said — as many load at once as come. */
  loadingBays?: number;
  /** Open for loading on that day, in minutes after midnight. Absent: it never closes. Null: closed that day. */
  open?: { fromMin: number; toMin: number } | null;
  shifts: SiteShift[];
}

/**
 * A FLEET'S SITES (see fleet-site.types.ts). The fleet's own record: its office adds, changes and closes them, and
 * says who works from where. Staff read it.
 */
@Injectable()
export class FleetSiteService {
  private readonly sites = new PersistentMap<string, FleetSite>('fleet-sites');
  /** Where each vehicle and driver works from: `vehicle:<id>` / `driver:<did>` → site. Kept beside them, never on them. */
  private readonly homes = new PersistentMap<string, { fleetDid: string; siteId: string; setAt: string; setBy: string }>('fleet-site-homes');

  constructor(
    private readonly managers: FleetManagerService,
    private readonly vehicles: VehicleService,
    private readonly drivers: DriverService,
  ) {}

  /** The fleet's open sites: the depot it signed up with first, then the rest by name. */
  sitesOf(fleetDid: string): FleetSite[] {
    const m = this.managers.get(fleetDid);
    const kept = [...this.sites.values()].filter((s) => s.fleetDid === fleetDid);
    const depot = kept.find((s) => s.siteId === DEPOT_SITE) ?? {
      siteId: DEPOT_SITE,
      fleetDid,
      name: 'Depot',
      location: { lat: m.location.lat, lng: m.location.lng },
      ...(m.depotAddress ? { address: m.depotAddress } : {}),
      shifts: [],
      createdAt: m.createdAt ?? new Date(0).toISOString(),
      createdBy: m.companyName,
    };
    const others = kept.filter((s) => s.siteId !== DEPOT_SITE && !s.closedAt).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    return [...(depot.closedAt ? [] : [depot]), ...others];
  }

  /** An open site of this fleet, or a refusal in words. */
  site(fleetDid: string, siteId: string): FleetSite {
    const s = this.sitesOf(fleetDid).find((x) => x.siteId === siteId);
    if (!s) throw new GlosError('NOT_FOUND', 'No such open site of this fleet', { field: 'siteId' });
    return s;
  }

  /** The site a vehicle or driver works from: the one the office said while it is open, else the fleet's first. */
  homeOf(fleetDid: string, kind: 'vehicle' | 'driver', id: string): string {
    const open = this.sitesOf(fleetDid);
    const said = this.homes.get(`${kind}:${id}`);
    return said && said.fleetDid === fleetDid && open.some((s) => s.siteId === said.siteId) ? said.siteId : open[0].siteId;
  }

  view(fleetDid: string): FleetSitesView {
    const sites = this.sitesOf(fleetDid);
    const vehicles = this.vehicles
      .list({ managerDid: fleetDid })
      .filter((v) => v.status !== 'RETIRED')
      .sort((a, b) => a.plate.localeCompare(b.plate, undefined, { numeric: true }))
      .map((v) => ({ id: v.vehicleId, name: v.plate, siteId: this.homeOf(fleetDid, 'vehicle', v.vehicleId) }));
    const drivers = this.drivers
      .list({ managerDid: fleetDid })
      .filter((d) => d.status === 'ACTIVE')
      .sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { numeric: true }))
      .map((d) => ({ id: d.did, name: d.displayName, siteId: this.homeOf(fleetDid, 'driver', d.did) }));
    return {
      sites: sites.map((s): FleetSiteView => ({
        siteId: s.siteId,
        name: s.name,
        location: { ...s.location },
        ...(s.address ? { address: s.address } : {}),
        ...(s.hours ? { hours: { ...s.hours } } : {}),
        ...(s.loadingBays !== undefined ? { loadingBays: s.loadingBays } : {}),
        shifts: s.shifts.map((x) => ({ ...x })),
        main: s.siteId === DEPOT_SITE,
        vehicles: vehicles.filter((v) => v.siteId === s.siteId).length,
        drivers: drivers.filter((d) => d.siteId === s.siteId).length,
      })),
      vehicles,
      drivers,
    };
  }

  /**
   * A NEW SITE: a name, where it is (a point, not words alone — a plan measures from it), and optionally when it is
   * open for loading, how many trucks load there at once, and its shifts. Refused whole, before anything is kept.
   */
  add(fleetDid: string, input: SiteInput, by: string, now: number = Date.now()): FleetSitesView {
    const open = this.sitesOf(fleetDid);
    if (open.length >= MAX_SITES) throw new GlosError('INVALID_STATE', `A fleet has ${MAX_SITES} sites at most`);
    const name = input.name?.trim();
    if (!name) throw new GlosError('FIELD_REQUIRED', 'Name the site', { field: 'name' });
    if (input.lat === undefined || input.lng === undefined) throw new GlosError('FIELD_REQUIRED', 'Put the site on the map: a plan measures from where it is', { field: 'lat' });
    this.assertNameFree(open, name);
    const site: FleetSite = {
      siteId: `site_${randomBytes(5).toString('hex')}`,
      fleetDid,
      name,
      location: { lat: input.lat, lng: input.lng },
      ...(input.address?.trim() ? { address: input.address.trim() } : {}),
      ...(input.hours ? { hours: weekOf(input.hours) } : {}),
      ...(input.loadingBays ? { loadingBays: input.loadingBays } : {}),
      shifts: shiftsOf(input.shifts ?? [], []),
      createdAt: new Date(now).toISOString(),
      createdBy: by,
    };
    this.sites.set(keyOf(fleetDid, site.siteId), site);
    return this.view(fleetDid);
  }

  /** What changes about a site; what is not said stays. The depot it signed up with is kept as a site the first time it changes. */
  update(fleetDid: string, siteId: string, input: SiteInput, by: string, now: number = Date.now()): FleetSitesView {
    const open = this.sitesOf(fleetDid);
    const was = this.site(fleetDid, siteId);
    const name = input.name !== undefined ? input.name.trim() : was.name;
    if (!name) throw new GlosError('FIELD_REQUIRED', 'Name the site', { field: 'name' });
    if (name.toLowerCase() !== was.name.toLowerCase()) this.assertNameFree(open, name);
    if ((input.lat === undefined) !== (input.lng === undefined)) throw new GlosError('INVALID_INPUT', 'A place is a latitude and a longitude together', { field: 'lat' });
    const hours = input.hours === null ? undefined : input.hours !== undefined ? weekOf(input.hours) : was.hours;
    const next: FleetSite = {
      ...was,
      name,
      location: input.lat !== undefined && input.lng !== undefined ? { lat: input.lat, lng: input.lng } : was.location,
      ...(input.address !== undefined ? (input.address.trim() ? { address: input.address.trim() } : { address: undefined }) : {}),
      hours,
      // Null: no longer counted.
      loadingBays: input.loadingBays === null ? undefined : (input.loadingBays ?? was.loadingBays),
      shifts: input.shifts !== undefined ? shiftsOf(input.shifts, was.shifts) : was.shifts,
      updatedAt: new Date(now).toISOString(),
      updatedBy: by,
    };
    if (!next.address) delete next.address;
    if (!next.hours) delete next.hours;
    if (next.loadingBays === undefined) delete next.loadingBays;
    this.sites.set(keyOf(fleetDid, siteId), next);
    return this.view(fleetDid);
  }

  /**
   * CLOSE A SITE. Refused while it is the last one, or while vehicles or drivers still work from it — they are moved
   * first, so nobody's home quietly becomes somewhere else.
   */
  close(fleetDid: string, siteId: string, by: string, now: number = Date.now()): FleetSitesView {
    const open = this.sitesOf(fleetDid);
    const site = this.site(fleetDid, siteId);
    if (open.length === 1) throw new GlosError('INVALID_STATE', 'This is the fleet’s only site: add another before closing it');
    const v = this.view(fleetDid);
    const vehicles = v.vehicles.filter((x) => x.siteId === siteId).length;
    const drivers = v.drivers.filter((x) => x.siteId === siteId).length;
    if (vehicles || drivers) {
      const what = [vehicles ? `${vehicles} ${vehicles === 1 ? 'vehicle' : 'vehicles'}` : '', drivers ? `${drivers} ${drivers === 1 ? 'driver' : 'drivers'}` : ''].filter(Boolean).join(' and ');
      throw new GlosError('INVALID_STATE', `Move ${what} to another site before closing ${site.name}`);
    }
    this.sites.set(keyOf(fleetDid, siteId), { ...site, closedAt: new Date(now).toISOString(), closedBy: by });
    return this.view(fleetDid);
  }

  /** Where a vehicle or a driver of this fleet works from. */
  setHome(fleetDid: string, kind: 'vehicle' | 'driver', id: string, siteId: string, by: string, now: number = Date.now()): FleetSitesView {
    this.site(fleetDid, siteId);
    if (kind === 'vehicle') {
      const v = this.vehicles.get(id);
      if (v.managerDid !== fleetDid) throw new GlosError('FORBIDDEN', `${v.plate} is not one of this fleet’s vehicles`);
    } else {
      const d = this.drivers.list({ managerDid: fleetDid }).find((x) => x.did === id);
      if (!d) throw new GlosError('FORBIDDEN', 'That driver is not in this fleet');
    }
    this.homes.set(`${kind}:${id}`, { fleetDid, siteId, setAt: new Date(now).toISOString(), setBy: by });
    return this.view(fleetDid);
  }

  /** A site as a plan for a day asks about it: open when, on that day's weekday. */
  forPlan(fleetDid: string, day: string): SiteForPlan[] {
    const weekday = WEEKDAYS[(new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7];
    return this.sitesOf(fleetDid).map((s) => {
      const today = s.hours ? s.hours[weekday] : undefined;
      return {
        siteId: s.siteId,
        name: s.name,
        location: s.location,
        ...(s.loadingBays !== undefined ? { loadingBays: s.loadingBays } : {}),
        ...(s.hours ? { open: today ? { fromMin: minutesOf(today.open), toMin: minutesOf(today.close) } : null } : {}),
        shifts: s.shifts.map((x) => ({ ...x })),
      };
    });
  }

  private assertNameFree(open: FleetSite[], name: string): void {
    if (open.some((s) => s.name.toLowerCase() === name.toLowerCase())) throw new GlosError('INVALID_INPUT', `There is already a site called ${name}`, { field: 'name' });
  }
}

export interface SiteInput {
  name?: string;
  lat?: number;
  lng?: number;
  address?: string;
  hours?: Record<string, { open: string; close: string } | null> | null;
  /** Null: no longer counted. */
  loadingBays?: number | null;
  shifts?: Array<{ shiftId?: string; name: string; start: string; hours: number }>;
}

const keyOf = (fleetDid: string, siteId: string) => `${fleetDid}|${siteId}`;

/** Opening hours as the office wrote them, checked: known days, HH:MM, opening before closing. */
function weekOf(hours: Record<string, { open: string; close: string } | null>): SiteWeek {
  const week: SiteWeek = {};
  for (const [day, h] of Object.entries(hours)) {
    if (!(WEEKDAYS as readonly string[]).includes(day)) throw new GlosError('INVALID_INPUT', `${day} is not a day of the week`, { field: 'hours' });
    if (h === null) {
      week[day as keyof SiteWeek] = null;
      continue;
    }
    if (!h || !HHMM.test(h.open) || !HHMM.test(h.close)) throw new GlosError('INVALID_INPUT', 'Opening and closing times are HH:MM', { field: 'hours' });
    if (minutesOf(h.close) <= minutesOf(h.open)) throw new GlosError('INVALID_INPUT', `On ${day} the site closes before it opens`, { field: 'hours' });
    week[day as keyof SiteWeek] = { open: h.open, close: h.close };
  }
  return week;
}

/** The shifts as the office wrote them: each named once, a new one given an id, one already there keeping its own. */
function shiftsOf(input: Array<{ shiftId?: string; name: string; start: string; hours: number }>, was: SiteShift[]): SiteShift[] {
  if (input.length > MAX_SHIFTS) throw new GlosError('INVALID_INPUT', `A site has ${MAX_SHIFTS} shifts at most`, { field: 'shifts' });
  const names = new Set<string>();
  return input.map((s) => {
    const name = s.name.trim();
    if (!name) throw new GlosError('FIELD_REQUIRED', 'Name each shift', { field: 'shifts' });
    if (names.has(name.toLowerCase())) throw new GlosError('INVALID_INPUT', `Two shifts are called ${name}`, { field: 'shifts' });
    names.add(name.toLowerCase());
    if (!HHMM.test(s.start)) throw new GlosError('INVALID_INPUT', 'A shift starts at HH:MM', { field: 'shifts' });
    if (!(s.hours >= 1 && s.hours <= 13)) throw new GlosError('INVALID_INPUT', 'A shift is 1 to 13 hours', { field: 'shifts' });
    const kept = s.shiftId ? was.find((x) => x.shiftId === s.shiftId) : undefined;
    if (s.shiftId && !kept) throw new GlosError('INVALID_INPUT', 'That shift is not this site’s', { field: 'shifts' });
    return { shiftId: kept?.shiftId ?? `shf_${randomBytes(4).toString('hex')}`, name, start: s.start, hours: Math.round(s.hours * 4) / 4 };
  });
}
