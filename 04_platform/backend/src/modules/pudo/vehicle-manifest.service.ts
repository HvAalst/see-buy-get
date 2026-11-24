import { TelemetryService } from './telemetry.service';
import { Injectable, Optional } from '@nestjs/common';
import { GlosError } from '../../foundation/http/glos-error';
import { FxService } from '../../foundation/money/fx.service';
import { DepartureService } from './departure.service';
import { DispatchService } from './dispatch.service';
import { DriverService } from './driver.service';
import { fiscalCardOf, fiscalCountriesOf, RO_THRESHOLD_KG, RO_THRESHOLD_RON } from './fiscal-codes';
import { FleetService } from './fleet.service';
import type { Vehicle } from './fleet.types';
import { LoadPassageService } from './load-passage.service';
import { ParcelService } from './parcel.service';
import { toCsv } from './query';
import { VehicleService } from './vehicle.service';
import type { AboardKind, ManifestAmount, ManifestCrossing, ManifestFlag, ManifestItem, VehicleManifest } from './vehicle-manifest.types';

/** One thing on a vehicle or coming to it, as both the breakdown take-over and the manifest read it. */
export interface Aboard {
  kind: AboardKind;
  id: string;
  label: string;
  state: 'aboard' | 'to_collect';
  weightKg: number;
  freightId?: string;
  shipperDid?: string;
  lineName?: string;
  departureId?: string;
}

/**
 * WHAT IS ON THE VEHICLE, OR COMING TO IT (moved here 2026-11-24 from VehicleBreakdownService, so the take-over after a breakdown
 * and the manifest read the same list): the loads its driver took on and has not delivered, in it or still to collect; the
 * bookings on a run of it that has left; the driver's bags; and the parcels a shop handed them loose.
 */
export function loadsAboard(
  deps: { dispatch: Pick<DispatchService, 'loadsOnVehicle' | 'bagsWith'>; departures: Pick<DepartureService, 'bookingsAboard'>; parcels?: Pick<ParcelService, 'onBusWith'>; drivers: Pick<DriverService, 'get'> },
  v: Pick<Vehicle, 'vehicleId'>,
  driverDid: string,
): Aboard[] {
  const freight = deps.dispatch.loadsOnVehicle(driverDid, v.vehicleId).map((f) => ({ kind: 'freight' as const, id: f.freightId, freightId: f.freightId, label: f.code, state: f.state, weightKg: f.weightKg, ...(f.shipperDid ? { shipperDid: f.shipperDid } : {}) }));
  const bookings = deps.departures.bookingsAboard(v.vehicleId).map((b) => ({ kind: 'booking' as const, id: b.bookingId, label: b.description, state: 'aboard' as const, lineName: b.lineName, departureId: b.departureId, weightKg: b.weightKg, ...(b.shipperDid ? { shipperDid: b.shipperDid } : {}) }));
  // The driver's bags — on the vehicle, or claimed and still to collect — and the parcels a shop handed them loose.
  const bags = deps.dispatch.bagsWith(driverDid).map((t) => ({ kind: 'bag' as const, id: t.code, label: t.code, state: t.status === 'claimed' ? ('to_collect' as const) : ('aboard' as const), weightKg: t.weightKg }));
  const loose = (deps.parcels?.onBusWith(deps.drivers.get(driverDid).badgeId) ?? []).map((p) => ({ kind: 'parcel' as const, id: p.parcelId, label: p.parcelId, state: 'aboard' as const, weightKg: p.weightKg }));
  return [...freight, ...bookings, ...bags, ...loose];
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * 2026-11-24 — THE MASTER MANIFEST (the owner's brief, feature 3): for a vehicle on a shift, everything aboard or to collect with
 * its ends, countries, weight, declared value and Romania's or Bulgaria's codes; the totals; the crossings its loads passed; and
 * what wants a look: a code missing, Romania's 500 kg or RON 10,000 passed, a code running out or run out. For its driver, its
 * fleet's office, and the fleet's own system by key, as JSON or CSV.
 */
@Injectable()
export class VehicleManifestService {
  constructor(
    private readonly dispatch: DispatchService,
    private readonly fleet: FleetService,
    private readonly drivers: DriverService,
    private readonly departures: DepartureService,
    private readonly vehicles: VehicleService,
    @Optional() private readonly parcels?: ParcelService,
    @Optional() private readonly passages?: LoadPassageService,
    @Optional() private readonly fx?: FxService,
    // 2026-11-24 — the run's GPS watch, whose id the manifest carries while one is open (slice 3).
    @Optional() private readonly telemetry?: TelemetryService,
  ) {}

  /** The manifest of the vehicle a driver is on now. */
  forDriver(driverDid: string, now: number = Date.now()): VehicleManifest {
    const shift = this.fleet.activeForDriver(driverDid);
    const v = this.fleet.vehicleForDriver(driverDid);
    if (!shift || !v) throw new GlosError('NOT_COUPLED', 'This driver is on no vehicle now: a manifest is of a vehicle on a shift');
    let driverName: string | undefined;
    try {
      driverName = this.drivers.get(driverDid).displayName;
    } catch {
      driverName = undefined;
    }
    const items = loadsAboard({ dispatch: this.dispatch, departures: this.departures, parcels: this.parcels, drivers: this.drivers }, v, driverDid).map((a) => this.item(a, now));
    const values = new Map<string, number>();
    let ron = 0;
    let allRon = true;
    for (const i of items) {
      if (!i.declaredValue) continue;
      values.set(i.declaredValue.currency, (values.get(i.declaredValue.currency) ?? 0) + i.declaredValue.amount);
      if (i.valueRon === undefined) allRon = false;
      else ron += i.valueRon;
    }
    const crossings: ManifestCrossing[] = items
      .filter((i) => i.kind === 'freight')
      .flatMap((i) => (this.passages?.of(i.ref) ?? []).map((p) => ({ freightCode: i.label, kind: p.kind, ...(p.post ? { post: p.post } : {}), ...(p.from ? { from: p.from } : {}), ...(p.to ? { to: p.to } : {}), at: p.at })))
      .sort((a, b) => a.at.localeCompare(b.at));
    return {
      manifestId: this.telemetry?.openFor(driverDid)?.sessionId ?? `man_${v.vehicleId}_${shift.startedAt.replace(/[^0-9]/g, '').slice(0, 14)}`,
      vehicleId: v.vehicleId,
      truckPlate: v.plate,
      ...(v.towing?.plate ? { trailerPlate: v.towing.plate } : {}),
      driverDid,
      ...(driverName ? { driverName } : {}),
      ...(v.managerDid ? { fleetDid: v.managerDid } : {}),
      shiftStartedAt: shift.startedAt,
      items,
      totalWeightKg: r1(items.reduce((n, i) => n + i.weightKg, 0)),
      totalValue: [...values].map(([currency, amount]): ManifestAmount => ({ amount: Math.round(amount * 100) / 100, currency })),
      ...(values.size && allRon ? { totalValueRon: Math.round(ron) } : {}),
      flagged: items.filter((i) => i.flags.length).length,
      crossings,
      at: new Date(now).toISOString(),
    };
  }

  /** A fleet's vehicle by its id: the manifest of the shift it is on. Another fleet's vehicle is not found. */
  forVehicle(fleetDid: string, vehicleId: string, now: number = Date.now()): VehicleManifest {
    const v = this.vehicles.list({ managerDid: fleetDid }).find((x) => x.vehicleId === vehicleId);
    if (!v) throw new GlosError('NOT_FOUND', 'Vehicle not found');
    return this.forDriver(this.driverOn(v.vehicleId, v.plate), now);
  }

  /** …and by its plate, as a fleet's own system knows it: spaces and case do not matter. */
  forPlate(fleetDid: string, plate: string, now: number = Date.now()): VehicleManifest {
    const key = plate.replace(/[\s-]/g, '').toUpperCase();
    const v = this.vehicles.list({ managerDid: fleetDid }).find((x) => x.plate.replace(/[\s-]/g, '').toUpperCase() === key);
    if (!v) throw new GlosError('NOT_FOUND', `No vehicle of yours has the plate ${plate}`);
    return this.forDriver(this.driverOn(v.vehicleId, v.plate), now);
  }

  /** The CSV: one row a thing aboard, its codes and flags, and the vehicle's plates on each so a row reads alone. */
  csv(m: VehicleManifest): string {
    const code = (i: ManifestItem, country: 'RO' | 'BG') => i.fiscalCodes?.find((c) => c.country === country);
    return toCsv(
      ['manifest_id', 'truck_plate', 'trailer_plate', 'driver', 'kind', 'ref', 'label', 'state', 'from', 'to', 'pickup_country', 'dest_country', 'weight_kg', 'declared_value', 'currency', 'value_ron', 'ro_uit', 'ro_uit_valid_through', 'ro_exempt', 'bg_utn', 'bg_utn_valid_through', 'bg_exempt', 'flags', 'border_crossings'],
      m.items.map((i) => {
        const ro = code(i, 'RO');
        const bg = code(i, 'BG');
        const crossed = m.crossings.filter((c) => c.freightCode === i.label).map((c) => `${c.kind}${c.post ? ` ${c.post}` : ''} ${c.at}`).join('; ');
        return [m.manifestId, m.truckPlate, m.trailerPlate, m.driverName ?? m.driverDid, i.kind, i.ref, i.label, i.state, i.from, i.to, i.pickupCountry, i.destCountry, i.weightKg, i.declaredValue?.amount, i.declaredValue?.currency, i.valueRon, ro?.code, ro?.validThrough, ro?.exempt, bg?.code, bg?.validThrough, bg?.exempt, i.flags.join(' '), crossed];
      }),
    );
  }

  /** The driver on a shift with a vehicle; the vehicle on no shift is said so. */
  private driverOn(vehicleId: string, plate: string): string {
    const a = this.fleet.list({ status: 'active' }).find((x) => x.vehicleId === vehicleId);
    if (!a) throw new GlosError('NOT_COUPLED', `${plate} is on no shift now: a manifest is of a vehicle on a shift`);
    return a.driverDid;
  }

  /** One thing aboard, with what the manifest says of it. */
  private item(a: Aboard, now: number): ManifestItem {
    if (a.kind === 'freight') {
      const f = this.dispatch.requireFreightPublic(a.id);
      const valueRon = this.inRon(f.declaredValue);
      const cards = f.fiscalCodes?.length ? fiscalCardOf(f.fiscalCodes, now) : [];
      const asked = fiscalCountriesOf(f.pickupCountry, f.destCountry);
      const roEnd = asked.includes('RO');
      const flags: ManifestFlag[] = [];
      if (asked.some((c) => !cards.some((k) => k.country === c))) flags.push('missing_code');
      if (roEnd && f.weightKg > RO_THRESHOLD_KG) flags.push('over_500kg');
      if (roEnd && valueRon !== undefined && valueRon > RO_THRESHOLD_RON) flags.push('over_ron_10000');
      if (cards.some((c) => c.status === 'expiring_soon')) flags.push('code_expiring');
      if (cards.some((c) => c.status === 'expired')) flags.push('code_expired');
      return {
        kind: 'freight',
        ref: f.freightId,
        label: f.code,
        state: a.state,
        from: f.pickupLabel,
        to: f.destLabel,
        ...(f.pickupCountry ? { pickupCountry: f.pickupCountry } : {}),
        ...(f.destCountry ? { destCountry: f.destCountry } : {}),
        weightKg: f.weightKg,
        ...(f.packages ? { parcels: f.packages } : {}),
        ...(f.declaredValue ? { declaredValue: { amount: f.declaredValue.amount, currency: f.declaredValue.currency } } : {}),
        ...(valueRon !== undefined ? { valueRon: Math.round(valueRon) } : {}),
        ...(cards.length ? { fiscalCodes: cards } : {}),
        flags,
      };
    }
    if (a.kind === 'bag') {
      const b = this.dispatch.bagFacts(a.id);
      return { kind: 'bag', ref: a.id, label: a.label, state: a.state, ...(b?.fromLabel ? { from: b.fromLabel } : {}), ...(b?.toLabel ? { to: b.toLabel } : {}), ...(b?.from ? { pickupCountry: b.from } : {}), ...(b?.to ? { destCountry: b.to } : {}), weightKg: r1(a.weightKg), ...(b ? { parcels: b.parcels } : {}), flags: [] };
    }
    return { kind: a.kind, ref: a.id, label: a.label, state: a.state, ...(a.lineName ? { to: a.lineName } : {}), weightKg: r1(a.weightKg), flags: [] };
  }

  /** A declared value in lei, where the rate is known. */
  private inRon(v: { amount: number; currency: string } | undefined): number | undefined {
    if (!v) return undefined;
    if (v.currency.toUpperCase() === 'RON') return v.amount;
    try {
      return this.fx?.convert(v.amount, v.currency.toUpperCase() as never, 'RON' as never);
    } catch {
      return undefined;
    }
  }
}
