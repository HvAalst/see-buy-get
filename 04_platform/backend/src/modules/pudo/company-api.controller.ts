import { Body, Controller, Delete, Get, Headers, Param, Post, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiVersionInterceptor } from '../../foundation/http/api-versions';
import type { IntrospectionResult } from '../../foundation/auth/auth.types';
import { Public } from '../../foundation/auth/public.decorator';
import { EntityService } from '../../foundation/entity/entity.service';
import { GlosError } from '../../foundation/http/glos-error';
import { IdempotencyService } from '../../foundation/http/idempotency.service';
import { OwnIdempotency } from '../../foundation/http/idempotency.interceptor';
import { RateLimit, RateLimitGuard } from '../../foundation/http/rate-limit.guard';
import { ApiBoardQueryDto, ApiOrdersQueryDto, ApiPlanQueryDto, CompanyPhotoDto, SendOrdersDto, TakeLoadDto, WithdrawLoadDto } from './company-api.dto';
import { LoadSealService } from './load-seal.service';
import { LoadSealsView, LoadSealView, WriteSealDto } from './load-seal.types';
import { MediaService } from './media.service';
import { CompanyKey, CompanyKeyGuard } from './company-key.guard';
import type { CompanyCaller } from './company-key.types';
import { CarriageContractService } from './carriage-contract.service';
import { DispatchService } from './dispatch.service';
import type { Freight } from './dispatch.types';
import { DriverService } from './driver.service';
import { FleetHookService, earningsRowFor } from './fleet-hooks.service';
import { FleetManagerService } from './fleet-manager.service';
import { FleetPlanService } from './fleet-plan.service';
import { FleetService } from './fleet.service';
import { LoadPostingService } from './load-posting.service';
import { ORDER_SHEET_TEMPLATE } from './order-sheet';
import { OrderImportService } from './order-import.service';
import { RegisterFreightDto } from './pudo.dto';
import { VehicleService } from './vehicle.service';

/** The order sheet's own columns, in its own order: an order a system sends is read exactly as a line of a sheet. */
const SHEET_COLUMNS = ORDER_SHEET_TEMPLATE.split('\r\n')[0].split(',');

/**
 * THE API FOR A COMPANY'S OWN SYSTEMS (the user, round 12: "An API for businesses and fleets"; "Post, send in, take at its
 * price"; "Same as the system"; "A year, with notice").
 *
 * A key is the company's system acting for the company, and only for what the company's people would do the same way:
 *   - a BUSINESS's key reads its loads as its Loads screen does, posts a load, withdraws one nobody has taken yet;
 *   - a FLEET's key reads its orders and its day's plan, sends orders in (checked exactly as an uploaded sheet is), reads
 *     the board for one of its drivers on a shift, and takes a board load for that driver at its price.
 * Never a key's: accepting a plan, agreeing a negotiated price, anything about money or people.
 *
 * Every act goes through the door the app uses (LoadPostingService, OrderImportService, DispatchService.assign), so a key
 * meets the same checks in the same words. A TEST key runs every check and keeps nothing. Each key has its own limit
 * per minute, and a retried write is answered once (an `Idempotency-Key`, scoped to the key).
 */
@Controller('sbg/api')
@UseGuards(CompanyKeyGuard, RateLimitGuard) // in this order: the limit spends whichever key the first guard found
@UseInterceptors(new ApiVersionInterceptor()) // which version answered, and — once it is set to stop — when it stops
export class CompanyApiController {
  constructor(
    private readonly entities: EntityService,
    private readonly dispatch: DispatchService,
    private readonly posting: LoadPostingService,
    private readonly idempotency: IdempotencyService,
    private readonly managers: FleetManagerService,
    private readonly contracts: CarriageContractService,
    private readonly imports: OrderImportService,
    private readonly plans: FleetPlanService,
    private readonly fleet: FleetService,
    private readonly drivers: DriverService,
    private readonly vehicles: VehicleService,
    private readonly hooks: FleetHookService,
    // Round 33 — the seals on a business's loads, and the photographs they name.
    private readonly seals: LoadSealService,
    private readonly media: MediaService,
  ) {}

  /* --------------------------------------------------------------- a business -- */

  /** Its loads, exactly as its Loads screen reads them. */
  @Public()
  @RateLimit(120, 60)
  @Get('business/loads')
  loads(@CompanyKey() caller: CompanyCaller) {
    const items = this.dispatch.postedBy(this.business(caller).did);
    return { items, total: items.length };
  }

  @Public()
  @RateLimit(120, 60)
  @Get('business/loads/:freightId')
  load(@Param('freightId') freightId: string, @CompanyKey() caller: CompanyCaller) {
    const row = this.dispatch.postedBy(this.business(caller).did).find((r) => r.freightId === freightId);
    if (!row) throw new GlosError('NOT_FOUND', 'No such load of yours');
    return row;
  }

  /**
   * Post a load, as a person in the Business app does: the same fields, the same checks. With a test key every check runs
   * and the load is worked out — its class, the body it needs — and nothing is posted.
   */
  @Public()
  @OwnIdempotency()
  @RateLimit(30, 60)
  @Post('business/loads')
  async postLoad(@Body() dto: RegisterFreightDto, @CompanyKey() caller: CompanyCaller, @Headers('idempotency-key') idempotencyKey?: string) {
    const entity = this.business(caller);
    const actor = { role: 'business', did: entity.did, tenant: entity.entityId, actorName: caller.name } as IntrospectionResult;
    const { result, replayed } = await this.idempotency.run(`api:business/loads:${caller.keyId}`, idempotencyKey, dto, () => {
      if (caller.mode === 'test') return { test: true, load: checkedLoad(this.posting.post(dto, actor, true)) };
      const posted = this.posting.post(dto, actor);
      return { test: false, load: this.dispatch.postedBy(entity.did).find((r) => r.freightId === posted.freightId) };
    });
    return { ...result, replayed };
  }

  /** Withdraw one of its loads that nobody has taken yet. Once a carrier has it, a person withdraws it in the app, where the carrier is told. */
  @Public()
  @OwnIdempotency()
  @RateLimit(30, 60)
  @Post('business/loads/:freightId/withdraw')
  async withdrawLoad(@Param('freightId') freightId: string, @Body() dto: WithdrawLoadDto, @CompanyKey() caller: CompanyCaller, @Headers('idempotency-key') idempotencyKey?: string) {
    const entity = this.business(caller);
    const row = this.dispatch.postedBy(entity.did).find((r) => r.freightId === freightId);
    if (!row) throw new GlosError('NOT_FOUND', 'No such load of yours');
    if (!['available', 'scheduled', 'ordered'].includes(row.status)) {
      throw new GlosError('INVALID_STATE', row.status === 'cancelled' ? 'This load is already withdrawn' : `A carrier has this load (${row.status}) — withdraw it in the Business app, where the carrier is told`);
    }
    const { result, replayed } = await this.idempotency.run(`api:business/withdraw:${caller.keyId}`, idempotencyKey, { freightId, ...dto }, () => {
      if (caller.mode === 'test') return { test: true, withdrawn: false, freightId, code: row.code };
      const done = this.dispatch.cancelFreight(freightId, { did: entity.did, role: 'shipper' }, dto.reason);
      return { test: false, withdrawn: true, freightId, code: done.code, status: done.status };
    });
    return { ...result, replayed };
  }

  /*
   * Round 33 — THE SEALS ON ITS LOADS (the user: "A business's key writes seals"). Its system writes a seal as a person in
   * the Business app does, through the same door (LoadSealService.write): on its own load, before the goods are taken
   * over, with the three photographs — each one the business sent, here first, and used for nothing else. A test key runs
   * every check and keeps nothing.
   */

  /** The seals on one of its loads, as its Loads screen reads them, and whether they may still be written. */
  @Public()
  @RateLimit(120, 60)
  @Get('business/loads/:freightId/seals')
  sealsOn(@Param('freightId') freightId: string, @CompanyKey() caller: CompanyCaller): LoadSealsView {
    const f = this.ownLoad(caller, freightId);
    // Round 38 — whether its pickup country's company requires a seal on it, and whose rule it is: as the Business app says it.
    const required = this.dispatch.sealRequiredBy(f);
    return { freightId: f.freightId, seals: this.seals.views(f.freightId), editable: this.seals.editable(f), ...(required ? { required } : {}) };
  }

  /** A photograph for a seal, sent before the seal names it: its `photoId`. Unused, it is removed after two days. */
  @Public()
  @RateLimit(60, 60)
  @Post('business/photos')
  photo(@Body() dto: CompanyPhotoDto, @CompanyKey() caller: CompanyCaller): { photoId: string; keptUnusedUntil: string } {
    const entity = this.business(caller);
    const { mediaId } = this.media.upload({ ownerDid: entity.did, kind: 'seal', dataUrl: dto.dataUrl, thumbDataUrl: dto.thumbDataUrl });
    return { photoId: mediaId, keptUnusedUntil: this.media.unusedUntil(mediaId)! };
  }

  /** Write a seal on one of its loads before pickup. With a test key every check runs and nothing is kept. */
  @Public()
  @OwnIdempotency()
  @RateLimit(30, 60)
  @Post('business/loads/:freightId/seals')
  async writeSeal(@Param('freightId') freightId: string, @Body() dto: WriteSealDto, @CompanyKey() caller: CompanyCaller, @Headers('idempotency-key') idempotencyKey?: string) {
    const entity = this.business(caller);
    const f = this.ownLoad(caller, freightId);
    const { result, replayed } = await this.idempotency.run(`api:business/seals:${caller.keyId}`, idempotencyKey, { freightId, ...dto }, () => {
      const keep = caller.mode !== 'test';
      const seal = this.seals.write(f, { did: entity.did, name: caller.name }, { number: dto.number, sealClass: dto.sealClass, maker: dto.maker, appliedBy: dto.appliedBy, photos: dto.photos }, Date.now(), keep);
      const view: LoadSealView = keep ? this.seals.views(f.freightId).find((s) => s.sealId === seal.sealId)! : this.seals.viewAmong(f, seal);
      return { test: !keep, seal: view };
    });
    return { ...result, replayed };
  }

  /** Take a seal off one of its loads again, before pickup: written wrong, or not used after all. A test key keeps it. */
  @Public()
  @RateLimit(30, 60)
  @Delete('business/loads/:freightId/seals/:sealId')
  removeSeal(@Param('freightId') freightId: string, @Param('sealId') sealId: string, @CompanyKey() caller: CompanyCaller): { test: boolean; removed: boolean } {
    const f = this.ownLoad(caller, freightId);
    const keep = caller.mode !== 'test';
    this.seals.remove(f, sealId, keep);
    return { test: !keep, removed: keep };
  }

  /** One of this business's own loads — or, for any other, the same answer as for no load at all. */
  private ownLoad(caller: CompanyCaller, freightId: string): Freight {
    const entity = this.business(caller);
    let f: Freight | undefined;
    try {
      f = this.dispatch.requireFreightPublic(freightId);
    } catch {
      f = undefined;
    }
    if (!f || f.postedByDid !== entity.did) throw new GlosError('NOT_FOUND', 'No such load of yours');
    return f;
  }

  /* ------------------------------------------------------------------- a fleet -- */

  /** Its orders, exactly as its Orders screen reads them. */
  @Public()
  @RateLimit(120, 60)
  @Get('fleet/orders')
  orders(@Query() q: ApiOrdersQueryDto, @CompanyKey() caller: CompanyCaller) {
    const items = this.dispatch.ordersForFleet(this.fleetOf(caller).did, q);
    return { items, total: items.length };
  }

  /** Its plan for a day, as accepted, and what has changed under it since. Accepting a plan is a person's, in the app. */
  @Public()
  @RateLimit(120, 60)
  @Get('fleet/plan')
  plan(@Query() q: ApiPlanQueryDto, @CompanyKey() caller: CompanyCaller) {
    return this.plans.state(this.fleetOf(caller).did, q.day);
  }

  /**
   * Send orders in under one of its contracts, read exactly as a line of an uploaded sheet: every refusal said in words,
   * order by order. With a test key nothing is placed.
   */
  @Public()
  @OwnIdempotency()
  @RateLimit(30, 60)
  @Post('fleet/orders')
  async sendOrders(@Body() dto: SendOrdersDto, @CompanyKey() caller: CompanyCaller, @Headers('idempotency-key') idempotencyKey?: string) {
    const fleet = this.fleetOf(caller);
    const contract = this.contracts.requireForFleet(fleet.did, dto.contractId);
    if ((dto.pickupLat == null) !== (dto.pickupLng == null)) throw new GlosError('INVALID_INPUT', 'Give the collection point as a latitude and a longitude, or neither', { field: 'pickupLat' });
    const pickupLocation = dto.pickupLat != null && dto.pickupLng != null ? { lat: dto.pickupLat, lng: dto.pickupLng } : undefined;
    const rows = [SHEET_COLUMNS, ...dto.orders.map((o) => [o.reference, o.goods, String(o.weightKg), o.deliverTo, o.lat != null ? String(o.lat) : '', o.lng != null ? String(o.lng) : '', o.deliverOn, o.window ?? '', o.contact ?? '', o.phone ?? '', o.packaging ?? '', o.instructions ?? ''])];
    const { result, replayed } = await this.idempotency.run(`api:fleet/orders:${caller.keyId}`, idempotencyKey, dto, () => ({
      test: caller.mode === 'test',
      ...this.imports.run({ did: fleet.did, name: fleet.companyName }, contract, { rows, ...(dto.pickupLabel ? { pickupLabel: dto.pickupLabel } : {}), ...(pickupLocation ? { pickupLocation } : {}) }, caller.name, caller.mode === 'test'),
    }));
    return { ...result, replayed };
  }

  /**
   * The board for one of its drivers on a shift, as its Dispatch screen reads it: every load, what the driver would earn
   * on it, and every reason why not. Where its drivers are only when the fleet sends that to its own system (round 11).
   */
  @Public()
  @RateLimit(60, 60)
  @Get('fleet/board')
  board(@Query() q: ApiBoardQueryDto, @CompanyKey() caller: CompanyCaller) {
    const fleet = this.fleetOf(caller);
    const shown = this.hooks.positionsOn(fleet.did);
    const drivers = this.onShift(fleet.did).map((d) => ({ did: d.did, name: d.name, plate: d.plate, vehicleClass: d.vehicleClass, remainingKg: this.dispatch.remainingCapacity(d.did), ...(shown && d.location ? { location: d.location } : {}) }));
    const chosen = q.driverDid ? this.onShift(fleet.did).find((d) => d.did === q.driverDid) : undefined;
    if (q.driverDid && !chosen) throw new GlosError('NOT_FOUND', 'That is not one of your drivers on a shift');
    const rows = chosen ? this.dispatch.board({ driverDid: chosen.did, from: chosen.location ?? fleet.location }) : [];
    return { drivers, driverDid: chosen?.did ?? null, items: rows, total: rows.length };
  }

  /**
   * Take a load off the open board for one of its drivers on a shift, at its price — every check the app makes when its
   * office puts a load on a driver. Never an order under a contract (planned in the app) and never a load posted for a
   * price to be agreed. With a test key: whether this driver could take it, why not, and what it would pay; nothing taken.
   */
  @Public()
  @OwnIdempotency()
  @RateLimit(30, 60)
  @Post('fleet/loads/:freightId/take')
  async takeLoad(@Param('freightId') freightId: string, @Body() dto: TakeLoadDto, @CompanyKey() caller: CompanyCaller, @Headers('idempotency-key') idempotencyKey?: string) {
    const fleet = this.fleetOf(caller);
    const driver = this.onShift(fleet.did).find((d) => d.did === dto.driverDid);
    if (!driver) throw new GlosError('NOT_FOUND', 'That is not one of your drivers on a shift');
    let f: Freight;
    try {
      f = this.dispatch.requireFreightPublic(freightId);
    } catch {
      throw new GlosError('NOT_FOUND', 'No such load on the board');
    }
    if (f.contract) throw new GlosError('FORBIDDEN', 'An order under a contract is put on a truck by its fleet, in the Fleet app — a key takes loads off the open board');
    if (f.commitMode === 'negotiate') throw new GlosError('NEGOTIATION_REQUIRED', 'This load is posted for a price to be agreed — that is a person’s, in the app');
    const { result, replayed } = await this.idempotency.run(`api:fleet/take:${caller.keyId}`, idempotencyKey, { freightId, ...dto }, () => {
      if (caller.mode === 'test') {
        const row = this.dispatch.board({ driverDid: driver.did, from: driver.location ?? fleet.location }).find((r) => r.freightId === freightId);
        if (!row) throw new GlosError('NOT_FOUND', 'No such load on the board');
        return { test: true, taken: false, freightId, code: row.code, canTake: row.canTake, blockers: row.blockers, ...(row.price ? { price: row.price } : {}) };
      }
      const taken = this.dispatch.assign(freightId, driver.did, { managerDid: fleet.did, name: caller.name });
      return { test: false, taken: true, load: earningsRowFor(taken, (did) => this.driverName(did)) };
    });
    return { ...result, replayed };
  }

  /* --------------------------------------------------------------- whose key -- */

  private business(caller: CompanyCaller) {
    if (caller.kind !== 'business') throw new GlosError('FORBIDDEN', 'This is a business’s door; your key is a fleet’s');
    const entity = this.entities.find(caller.id);
    if (!entity?.business) throw new GlosError('UNAUTHORIZED', 'The business this key was made for is no longer here');
    return entity;
  }

  private fleetOf(caller: CompanyCaller) {
    if (caller.kind !== 'fleet') throw new GlosError('FORBIDDEN', 'This is a fleet’s door; your key is a business’s');
    let fleet;
    try {
      fleet = this.managers.get(caller.id);
    } catch {
      throw new GlosError('UNAUTHORIZED', 'The fleet this key was made for is no longer here');
    }
    if (fleet.status !== 'ACTIVE') throw new GlosError('FORBIDDEN', `This fleet is ${fleet.status} — its key acts again once it is active`);
    return fleet;
  }

  /** The fleet's drivers out on a shift now, in which vehicle, and where the phone last said they were. */
  private onShift(fleetDid: string): Array<{ did: string; name: string; plate: string; vehicleClass: string; location?: { lat: number; lng: number } }> {
    const mine = new Set(this.drivers.list({ managerDid: fleetDid }).map((d) => d.did));
    return this.fleet
      .list({ status: 'active' })
      .filter((a) => mine.has(a.driverDid))
      .map((a) => {
        const v = this.vehicles.list().find((x) => x.vehicleId === a.vehicleId);
        return { did: a.driverDid, name: this.driverName(a.driverDid), plate: v?.plate ?? a.vehicleId, vehicleClass: v?.vehicleClass ?? '', ...(a.location ? { location: a.location } : {}) };
      });
  }

  private driverName(did: string): string {
    try {
      return this.drivers.get(did).displayName;
    } catch {
      return '';
    }
  }
}

/** What a test key is told of a load it would have posted: what it is and what it needs. Never a number of its own. */
function checkedLoad(f: Freight) {
  return {
    code: f.code,
    description: f.description,
    pickupLabel: f.pickupLabel,
    destLabel: f.destLabel,
    weightKg: f.weightKg,
    cargoClass: f.cargoClass,
    ...(f.packaging ? { packaging: f.packaging } : {}),
    ...(f.bodyDerived ? { bodyDerived: f.bodyDerived } : {}),
    requiredEquipment: f.requiredEquipment ?? [],
    requiredCapabilities: f.requiredCapabilities ?? [],
    status: f.status,
    ...(f.contract ? { contract: { contractId: f.contract.contractId, fleetName: f.contract.fleetName } } : {}),
    ...(f.deliverOn ? { deliverOn: f.deliverOn } : {}),
  };
}
