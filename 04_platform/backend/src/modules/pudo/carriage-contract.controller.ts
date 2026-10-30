import { FleetPlanService } from './fleet-plan.service';
import { DayPlanState, DayPlanView, PlanSendResult } from './fleet-plan.types';
import { OrderImportService } from './order-import.service';
import { PlanAdviserService } from './plan-adviser.service';
import { PlanAdviceView, PlanAdviserStatus } from './plan-adviser.types';
import { OrderImportResult } from './order-import.types';
import { ORDER_SHEET_TEMPLATE } from './order-sheet';
import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Roles } from '../../foundation/auth/scopes.decorator';
import { Actor } from '../../foundation/auth/actor.decorator';
import { IntrospectionResult } from '../../foundation/auth/auth.types';
import { actingTenant, auditActor } from '../../foundation/auth/acting';
import { GlosError } from '../../foundation/http/glos-error';
import { BusinessMemberGuard } from './business-member.guard';
import { BusinessService } from './business.service';
import { CarriageContractService } from './carriage-contract.service';
import { CarriageContractList, CarriageContractView, ContractInviteIssued } from './carriage-contract.types';
import { AdvisePlanDto, CreateContractDto, EndContractDto, SetFleetClockDto, SplitOrderDto, FleetOrdersQueryDto, ImportOrdersDto, LinkContractDto, PinOrderDto, PlanDayDto, PlanStateQueryDto, WithdrawOrderDto } from './carriage-contract.dto';
import { DispatchService } from './dispatch.service';
import { FleetOrderList, OrderLoads } from './dispatch.types';
import { FleetManagerService } from './fleet-manager.service';
import { DirectoryService } from './directory.service';
import { FleetClockView } from './fleet.types';

/**
 * P1 — STANDING CONTRACTS, AND THE ORDERS THAT ARRIVE UNDER THEM.
 *
 * Two sides, and the routes say which. The FLEET records a contract, sends the shipper's business a code to link it,
 * and reads the orders it must carry. The shipper's BUSINESS links the contract and from then on orders under it (on
 * the ordinary load route, naming the contract). Either may end it; ending stops new orders, never the delivery of
 * ones already placed.
 */
@Controller('sbg')
@UseGuards(BusinessMemberGuard)
export class CarriageContractController {
  constructor(
    private readonly contracts: CarriageContractService,
    private readonly managers: FleetManagerService,
    private readonly dispatch: DispatchService,
    private readonly businesses: BusinessService,
    private readonly imports: OrderImportService,
    private readonly directory: DirectoryService,
    private readonly plans: FleetPlanService,
    private readonly adviser: PlanAdviserService,
  ) {}

  /* ------------------------------------------------------------- the fleet -- */

  @Roles('fleet_manager', 'operator')
  @Get('fleet/managers/:did/contracts')
  fleetList(@Param('did') did: string, @Actor() actor: IntrospectionResult): CarriageContractList {
    this.assertFleet(did, actor);
    return { items: this.contracts.forFleet(did).map((c) => this.contracts.view(c)) };
  }

  @Roles('fleet_manager', 'operator')
  @Post('fleet/managers/:did/contracts')
  async create(@Param('did') did: string, @Body() dto: CreateContractDto, @Actor() actor: IntrospectionResult): Promise<CarriageContractView> {
    const fleet = this.assertFleet(did, actor);
    // Recorded for a business that asked through the directory: offered to it in its app. Only one that DID ask.
    const asker = dto.askedBy ? this.directory.askerOf(dto.askedBy, did) : undefined;
    if (dto.askedBy && !asker) throw new GlosError('VALIDATION_FAILED', 'That business has not asked you for a contract through the directory', { field: 'askedBy' });
    const c = this.contracts.create({ did, name: fleet.companyName }, { ...dto, ...(asker ? { offeredTo: asker.entityId } : {}) }, this.fleetPerson(actor, fleet.companyName));
    if (asker) await this.contracts.tellOffered(asker, c);
    return this.contracts.view(c);
  }

  /** A code for the shipper's business to link the contract with. Shown once; a new one replaces the last. */
  @Roles('fleet_manager', 'operator')
  @Post('fleet/managers/:did/contracts/:contractId/invite')
  invite(@Param('did') did: string, @Param('contractId') contractId: string, @Actor() actor: IntrospectionResult): ContractInviteIssued {
    this.assertFleet(did, actor);
    return this.contracts.issueInvite(did, contractId);
  }

  @Roles('fleet_manager', 'operator')
  @Post('fleet/managers/:did/contracts/:contractId/end')
  fleetEnd(@Param('did') did: string, @Param('contractId') contractId: string, @Body() dto: EndContractDto, @Actor() actor: IntrospectionResult): CarriageContractView {
    const fleet = this.assertFleet(did, actor);
    return this.contracts.view(this.contracts.end(this.contracts.requireForFleet(did, contractId), 'fleet', this.fleetPerson(actor, fleet.companyName), dto.reason));
  }

  /** The orders this fleet must carry, by the day they must arrive. */
  @Roles('fleet_manager', 'operator')
  @Get('fleet/managers/:did/orders')
  orders(@Param('did') did: string, @Query() q: FleetOrdersQueryDto, @Actor() actor: IntrospectionResult): FleetOrderList {
    this.assertFleet(did, actor);
    const items = this.dispatch.ordersForFleet(did, q);
    return { items, total: items.length };
  }

/**
   * P1b — a sheet of orders for one contract. Sent first as a CHECK (`dryRun`, the default): every line judged, nothing
   * created. Sent again with `dryRun: false`, the good lines become orders and the rest are left out and said why.
   */
  @Roles('fleet_manager', 'operator')
  @Post('fleet/managers/:did/contracts/:contractId/orders/import')
  importOrders(@Param('did') did: string, @Param('contractId') contractId: string, @Body() dto: ImportOrdersDto, @Actor() actor: IntrospectionResult): OrderImportResult {
    const fleet = this.assertFleet(did, actor);
    const pickupLocation = dto.pickupLat != null && dto.pickupLng != null ? { lat: dto.pickupLat, lng: dto.pickupLng } : undefined;
    return this.imports.run({ did, name: fleet.companyName }, this.contracts.requireForFleet(did, contractId), { text: dto.text, ...(dto.workbook ? { workbook: Buffer.from(dto.workbook, 'base64') } : {}), pickupLabel: dto.pickupLabel, pickupLocation }, this.fleetPerson(actor, fleet.companyName), dto.dryRun !== false);
  }

  /** The sheet to hand a shipper: the columns by the names the import reads, and one line showing each form. */
  @Roles('fleet_manager', 'operator')
  @Get('fleet/managers/:did/orders/template')
  orderTemplate(@Param('did') did: string, @Actor() actor: IntrospectionResult): { fileName: string; csv: string } {
    this.assertFleet(did, actor);
    return { fileName: 'orders-template.csv', csv: ORDER_SHEET_TEMPLATE };
  }

  /** The office puts an uploaded order's delivery address on the map, so it can be planned. */
  @Roles('fleet_manager', 'operator')
  @Post('fleet/managers/:did/orders/:freightId/pin')
  pinOrder(@Param('did') did: string, @Param('freightId') freightId: string, @Body() dto: PinOrderDto, @Actor() actor: IntrospectionResult): { pinned: true } {
    this.assertFleet(did, actor);
    this.dispatch.pinOrderDestination(did, freightId, { lat: dto.lat, lng: dto.lng });
    return { pinned: true };
  }

  /** The office withdraws an order it uploaded itself. One the shipper placed is the shipper's to withdraw. */
  @Roles('fleet_manager', 'operator')
  @Post('fleet/managers/:did/orders/:freightId/withdraw')
  withdrawOrder(@Param('did') did: string, @Param('freightId') freightId: string, @Body() dto: WithdrawOrderDto, @Actor() actor: IntrospectionResult): { withdrawn: true } {
    this.assertFleet(did, actor);
    this.dispatch.withdrawUploadedOrder(did, freightId, dto.reason);
    return { withdrawn: true };
  }

  /**
   * Split an order into loads — for one that is more than a vehicle carries. The office's act, on an order that is
   * still its own to plan; the shipper is told. The loads add up to the order.
   */
  @Roles('fleet_manager', 'operator')
  @Post('fleet/managers/:did/orders/:freightId/split')
  splitOrder(@Param('did') did: string, @Param('freightId') freightId: string, @Body() dto: SplitOrderDto, @Actor() actor: IntrospectionResult): OrderLoads {
    const fleet = this.assertFleet(did, actor);
    return { loads: this.dispatch.splitOrder(did, freightId, dto.loadsKg, this.fleetPerson(actor, fleet.companyName)).map((f) => ({ freightId: f.freightId, code: f.code, weightKg: f.weightKg, no: f.partOf!.no, of: f.partOf!.of })) };
  }

  /** Put an order back together, while every load of it is still an order: none on a truck, none handed on. */
  @Roles('fleet_manager', 'operator')
  @Post('fleet/managers/:did/orders/:freightId/rejoin')
  rejoinOrder(@Param('did') did: string, @Param('freightId') freightId: string, @Actor() actor: IntrospectionResult): OrderLoads {
    const fleet = this.assertFleet(did, actor);
    const f = this.dispatch.rejoinOrder(did, freightId, this.fleetPerson(actor, fleet.companyName));
    return { loads: [{ freightId: f.freightId, code: f.code, weightKg: f.weightKg, no: 1, of: 1 }] };
  }

/* ------------------------------------------------------------ the plan -- */

  /**
   * P3 — a PROPOSAL for a day: which truck takes which orders, trip after trip, what does not fit and why, and how
   * many trucks short the fleet is. Worked out fresh; changes nothing.
   */
  @Roles('fleet_manager', 'operator')
  @Post('fleet/managers/:did/plan')
  proposePlan(@Param('did') did: string, @Body() dto: PlanDayDto, @Actor() actor: IntrospectionResult): Promise<DayPlanView> {
    this.assertFleet(did, actor);
    return this.plans.proposeRouted(did, dto);
  }

  /** Accept the plan for a day. Worked out again here from the same asks, kept, and written onto its orders. */
  @Roles('fleet_manager', 'operator')
  @Post('fleet/managers/:did/plan/accept')
  acceptPlan(@Param('did') did: string, @Body() dto: PlanDayDto, @Actor() actor: IntrospectionResult): Promise<DayPlanView> {
    const fleet = this.assertFleet(did, actor);
    return this.plans.acceptRouted(did, dto, this.fleetPerson(actor, fleet.companyName));
  }

  /** P3b — send the next trip to every truck in TODAY's accepted plan that is ready for one. */
  @Roles('fleet_manager', 'operator')
  @Post('fleet/managers/:did/plan/send')
  sendPlan(@Param('did') did: string, @Body() dto: PlanStateQueryDto, @Actor() actor: IntrospectionResult): PlanSendResult {
    this.assertFleet(did, actor);
    return this.plans.send(did, dto.day);
  }

  /** The plan accepted for a day, as accepted, and what has changed under it since. */
  @Roles('fleet_manager', 'operator')
  @Get('fleet/managers/:did/plan')
  planState(@Param('did') did: string, @Query() q: PlanStateQueryDto, @Actor() actor: IntrospectionResult): DayPlanState {
    this.assertFleet(did, actor);
    return this.plans.state(did, q.day);
  }

  /**
   * THE FLEET'S OWN CLOCK — which time zone its plans, its "today" and its deliveries are read on, where that comes
   * from, and what time it is there now. The office's alone to read, and to set.
   */
  @Roles('fleet_manager', 'operator')
  @Get('fleet/managers/:did/clock')
  clock(@Param('did') did: string, @Actor() actor: IntrospectionResult): FleetClockView {
    this.assertFleet(did, actor);
    return this.managers.clockOf(did);
  }

  @Roles('fleet_manager', 'operator')
  @Post('fleet/managers/:did/clock')
  setClock(@Param('did') did: string, @Body() dto: SetFleetClockDto, @Actor() actor: IntrospectionResult): FleetClockView {
    this.assertFleet(did, actor);
    this.managers.setTimeZone(did, dto.timeZone);
    return this.managers.clockOf(did);
  }

  /** P5 — can this server reach the adviser at all? The screen asks before it offers one. */
  @Roles('fleet_manager', 'operator')
  @Get('fleet/managers/:did/plan/adviser')
  adviserStatus(@Param('did') did: string, @Actor() actor: IntrospectionResult): PlanAdviserStatus {
    this.assertFleet(did, actor);
    return this.adviser.status();
  }

  /**
   * P5 — say something to the adviser about a day's plan: a question, or what to change. It answers with words and
   * with a PROPOSAL the solver worked out; nothing is accepted and nothing is sent to a driver by asking.
   */
  @Roles('fleet_manager', 'operator')
  @Post('fleet/managers/:did/plan/advise')
  advisePlan(@Param('did') did: string, @Body() dto: AdvisePlanDto, @Actor() actor: IntrospectionResult): Promise<PlanAdviceView> {
    this.assertFleet(did, actor);
    return this.adviser.advise(did, dto);
  }

  /* ----------------------------------------------------------- the shipper -- */

  @Roles('business')
  @Get('business/me/contracts')
  shipperList(@Actor() actor: IntrospectionResult): CarriageContractList {
    const acting = this.businesses.requireMember(actor);
    return { items: this.contracts.forShipper(acting.entity.entityId).map((c) => this.contracts.view(c)), offers: this.contracts.offeredTo(acting.entity.entityId).map((c) => this.contracts.view(c)) };
  }

  /** A contract a haulier offered after this business asked for it: accepted — an owner's act, as linking by code is. */
  @Roles('business')
  @Post('business/me/contracts/:contractId/accept')
  async accept(@Param('contractId') contractId: string, @Actor() actor: IntrospectionResult): Promise<CarriageContractView> {
    const acting = this.businesses.requireMember(actor);
    if (acting.member.role !== 'owner') throw new GlosError('FORBIDDEN', 'Only an owner of the business accepts a contract');
    return this.contracts.view(await this.contracts.accept({ entityId: acting.entity.entityId, name: acting.entity.name }, contractId, acting.member.name));
  }

  /** Or declined: the haulier keeps it, not linked. */
  @Roles('business')
  @Post('business/me/contracts/:contractId/decline')
  async decline(@Param('contractId') contractId: string, @Actor() actor: IntrospectionResult): Promise<CarriageContractView> {
    const acting = this.businesses.requireMember(actor);
    if (acting.member.role !== 'owner') throw new GlosError('FORBIDDEN', 'Only an owner of the business declines a contract');
    return this.contracts.view(await this.contracts.decline({ entityId: acting.entity.entityId, name: acting.entity.name }, contractId));
  }

  /** Link a contract with the fleet's code. An owner's act: it commits the business to the fleet as its carrier. */
  @Roles('business')
  @Post('business/me/contracts/link')
  link(@Body() dto: LinkContractDto, @Actor() actor: IntrospectionResult): CarriageContractView {
    const acting = this.businesses.requireMember(actor);
    if (acting.member.role !== 'owner') throw new GlosError('FORBIDDEN', 'Only an owner of the business links a contract');
    return this.contracts.view(this.contracts.link({ entityId: acting.entity.entityId, name: acting.entity.name }, dto.code, acting.member.name));
  }

  @Roles('business')
  @Post('business/me/contracts/:contractId/end')
  shipperEnd(@Param('contractId') contractId: string, @Body() dto: EndContractDto, @Actor() actor: IntrospectionResult): CarriageContractView {
    const acting = this.businesses.requireMember(actor);
    if (acting.member.role !== 'owner') throw new GlosError('FORBIDDEN', 'Only an owner of the business ends a contract');
    return this.contracts.view(this.contracts.end(this.contracts.requireForShipper(acting.entity.entityId, contractId), 'shipper', acting.member.name, dto.reason));
  }

  /* -------------------------------------------------------------- helpers -- */

  /** The fleet's own office, or network staff. Anybody else is told this fleet is not theirs. */
  private assertFleet(did: string, actor: IntrospectionResult) {
    const fleet = this.managers.get(did); // 404 if unknown
    const office = actor?.role === 'fleet_manager' && actingTenant(actor) === did;
    if (actor?.role !== 'operator' && !office) throw new GlosError('FORBIDDEN', 'This fleet is not yours');
    return fleet;
  }

  /** The person at the office's keyboard, by name where the token has one. */
  private fleetPerson(actor: IntrospectionResult, company: string): string {
    return actor?.actorName || (actor?.role === 'operator' ? auditActor(actor) : company);
  }
}
