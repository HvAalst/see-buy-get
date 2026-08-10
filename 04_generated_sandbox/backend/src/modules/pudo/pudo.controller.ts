import { Body, Controller, Delete, Get, Header, Inject, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiQuery } from '@nestjs/swagger';
import { GlosError } from '../../foundation/http/glos-error';
import { Public } from '../../foundation/auth/public.decorator';
import { Roles, Scopes } from '../../foundation/auth/scopes.decorator';
import { Actor } from '../../foundation/auth/actor.decorator';
import { actingDid, actingTenant, auditActor } from '../../foundation/auth/acting';
import { IntrospectionResult } from '../../foundation/auth/auth.types';
import { AuthService } from '../../foundation/auth/auth.service';
import { AgentService } from './agent.service';
import { WalletGateService } from './wallet-gate.service';
import { CorridorService } from './corridor.service';
import { operationalParcelView, ParcelService } from './parcel.service';
import { MonitorService } from './monitor.service';
import { RatingService } from './rating.service';
import { VendorService } from './vendor.service';
import { ShelfService } from './shelf.service';
import { RoutingService } from './routing.service';
import { MdpService } from './mdp.service';
import { ToteService } from './tote.service';
import { ConsignmentService } from './consignment.service';
import { VehicleService } from './vehicle.service';
import { DriverService } from './driver.service';
import { FleetService } from './fleet.service';
import { DispatchService } from './dispatch.service';
import { MarketPulseService } from './market-pulse.service';
import { CargoService } from './cargo.service';
import { FleetManagerService } from './fleet-manager.service';
import { AccountService } from './account.service';
import { OtpService } from './otp.service';
import { PersonService } from './person.service';
import { TRUCK_SUBTYPE_CATALOG } from './fleet.config';
import { AcceptParcelDto, BookFreightDto, OpenConsignmentDto, ConsignmentDepositDto, ArriveDto, AssignCorridorDto, AssignNodeDto, AssignToteDto, AvailabilityDto, CheckoutDto, ClassifyDto, CollectDto, CorridorDto, CorridorStatusDto, CoupleDto, DisputeDto, DriverDto, DriverKycDecisionDto, DriverKycDto, DriverPayoutDto, DropBagDto, FillToteDto, HandoverDto, InboundOrderDto, IntakeDto, CancelParcelDto, ForgotDto, KycDecisionDto, LoadBagDto, LocateDto, LoginDto, ManagerKycDecisionDto, ManagerKycDto, ManagerLoginDto, OverdraftDto, PhoneRequestDto, PhoneVerifyDto, ReceiveBagDto, ResetDto, SignupDto, PickupDto, PlanJourneyDto, RateDto, RegisterAgentDto, RegisterDriverDto, RegisterFleetManagerDto, RegisterFreightDto, RegisterMdpDto, RegisterVehicleDto, RegisterVendorDto, SetHoursDto, SetPriceDto, ShelfDto, ShelveDto, SortParcelDto, StartSessionDto, SubmitKycDto, SuggestRouteDto, SurgeRuleDto, TopUpDto, UpdateVendorDto, VendorLoginDto, VehicleDocsDto, VoidDto, FreightActionDto, RecordTempDto, VendorOrdersQueryDto, VendorLedgerQueryDto, AgentParcelsQueryDto, AgentLedgerQueryDto, DriverJobsQueryDto } from './pudo.dto';
import { classifySize, SIZE_WEIGHT_KG } from './pudo.config';
import { haversineKm } from './geo';
import { GEOCODER, Geocoder } from './geocoder';

interface ModuleInfo {
  module: string;
  name: string;
  edition: string;
  status: 'active';
}

/**
 * PUDO Light — emerging-market Tier 1/2 on-ramp. DID-authenticated (global guard; no @Public).
 * Surface = the operator Control Tower (agents / finance / corridors / dashboard / support) + the
 * 3-screen agent app (accept / handover / pickup) over the pre-paid wallet gate.
 */
@Controller('sbg')
export class SbgController {
  constructor(
    private readonly agents: AgentService,
    private readonly gate: WalletGateService,
    private readonly corridors: CorridorService,
    private readonly parcels: ParcelService,
    private readonly monitor: MonitorService,
    private readonly ratings: RatingService,
    private readonly vendors: VendorService,
    private readonly shelf: ShelfService,
    private readonly routing: RoutingService,
    private readonly mdps: MdpService,
    private readonly totes: ToteService,
    private readonly consignments: ConsignmentService,
    private readonly vehicles: VehicleService,
    private readonly drivers: DriverService,
    private readonly fleet: FleetService,
    private readonly dispatch: DispatchService,
    private readonly managers: FleetManagerService,
    private readonly accounts: AccountService,
    private readonly otp: OtpService,
    private readonly auth: AuthService,
    private readonly persons: PersonService,
    private readonly cargo: CargoService,
    private readonly market: MarketPulseService,
    @Inject(GEOCODER) private readonly geocoder: Geocoder,
  ) {}

  // --- phone verification (mandatory at onboarding — control-tower contact + GPS) ---
  // These six are @Public(): they are the PRE-auth flow. A caller cannot hold an actor token before
  // they have signed up or logged in, and once GLOS_CLIENT_SECRET gates /auth/token (S0) the browser
  // can no longer mint a machine token to reach them either. They must be reachable unauthenticated.

  /** Issue a verification code for a phone (returned for the sandbox; SMS'd in production). */
  @Public()
  @Post('auth/phone/request')
  phoneRequest(@Body() dto: PhoneRequestDto) {
    return this.otp.request(dto.phone);
  }

  /** Confirm the code → marks the phone verified for sign-up. */
  @Public()
  @Post('auth/phone/verify')
  phoneVerify(@Body() dto: PhoneVerifyDto) {
    return this.otp.verify(dto.phone, dto.code);
  }

  // --- participant accounts: sign up / sign in / reset (PUDO field apps) ---

  /** Create a participant account + its domain entity (PUDO agent / driver / MDP) → an actor token. */
  @Public()
  @Post('auth/signup')
  signup(@Body() dto: SignupDto) {
    return this.accounts.signup(dto);
  }

  /** Sign in with email + password → an actor-scoped token the app carries. */
  @Public()
  @Post('auth/login')
  authLogin(@Body() dto: LoginDto) {
    return this.accounts.login(dto.email, dto.password);
  }

  /** Request a password reset (the token is returned for the sandbox; emailed in production). */
  @Public()
  @Post('auth/forgot')
  authForgot(@Body() dto: ForgotDto) {
    return this.accounts.forgot(dto.email);
  }

  @Public()
  @Post('auth/reset')
  authReset(@Body() dto: ResetDto) {
    return this.accounts.reset(dto.token, dto.password);
  }

  @Get('module-info')
  info(): ModuleInfo {
    return { module: 'PUDO', name: 'PUDO Light — Pick-Up/Drop-Off network', edition: 'Light v1.0 (GLOS Phase 1, emerging markets)', status: 'active' };
  }

  // --- agents (↔ M1 Tiers 1–2) ---

  @Post('agents')
  register(@Body() dto: RegisterAgentDto) {
    return this.agents.register(dto);
  }

  /** Upload KYC documents (ID copy, trading licence, shop photos) → KYC_PENDING. */
  @Post('agents/:did/submit-kyc')
  submitKyc(@Param('did') did: string, @Body() dto: SubmitKycDto) {
    return this.agents.submitKyc(did, dto);
  }

  /** Operator vetting decision — a field token must never approve/reject KYC. */
  @Roles('operator')
  @Post('agents/:did/kyc-decision')
  decideKyc(@Param('did') did: string, @Body() dto: KycDecisionDto, @Actor() actor: IntrospectionResult) {
    return this.agents.decideKyc(did, dto.approve, auditActor(actor, dto.by));
  }

  /** Record the refundable equipment/starter-kit deposit. */
  @Post('agents/:did/deposit')
  deposit(@Param('did') did: string) {
    return this.agents.recordDeposit(did);
  }

  /** Operator KYC review queue — agents awaiting a decision. */
  @Roles('operator')
  @Get('agents/kyc-queue')
  kycQueue() {
    return this.agents.kycQueue();
  }

  @Post('agents/:did/ping')
  ping(@Param('did') did: string) {
    return this.agents.ping(did);
  }

  /** Agent marks the shop open or temporarily closed. */
  @Post('agents/:did/availability')
  setAvailability(@Param('did') did: string, @Body() dto: AvailabilityDto) {
    return this.agents.setAvailability(did, dto.open);
  }

  /** Set the weekly opening schedule (pickup window + ETA constraint). */
  @Post('agents/:did/hours')
  setHours(@Param('did') did: string, @Body() dto: SetHoursDto) {
    return this.agents.setHours(did, dto.openingHours);
  }

  /** Reconfigure the shelf grid (rows × columns). */
  @Post('agents/:did/shelf')
  setShelf(@Param('did') did: string, @Body() dto: ShelfDto) {
    return this.agents.setShelf(did, dto);
  }

  /** The shelf grid + free-slot availability for a PUDO. */
  @Get('agents/:did/shelf')
  getShelf(@Param('did') did: string) {
    return { grid: this.shelf.grid(did), capacity: this.shelf.capacity(did), available: this.shelf.available(did) };
  }

  @Get('agents')
  listAgents() {
    return this.agents.list().map((a) => ({ ...a, balance: this.agents.balance(a.did), rating: this.ratings.agentRating(a.did), freeSlots: this.shelf.available(a.did), capacity: this.shelf.capacity(a.did) }));
  }

  @Get('agents/:did')
  getAgent(@Param('did') did: string) {
    const a = this.agents.get(did);
    return { ...a, balance: this.agents.balance(did), rating: this.ratings.agentRating(did) };
  }

  // --- pre-paid wallet (Light SSE) ---

  /**
   * 'No money, no scan' gate. Returns 200 with `{ ok, canTransact, code, balance, shortfall }` — a
   * locked wallet is a readable state, not an error status carrying a payload (S4). The client reads
   * `code` to choose between the top-up and unlock prompts.
   */
  @Get('agents/:did/can-transact')
  canTransact(@Param('did') did: string) {
    return this.gate.canTransact(did);
  }

  @Post('agents/:did/top-up')
  topUp(@Param('did') did: string, @Body() dto: TopUpDto) {
    return this.gate.topUp(did, dto.amount, dto.bankRef);
  }

  /** Emergency admin credit — operator only (self-asserted adminId is no longer trusted). */
  @Roles('operator')
  @Post('agents/:did/overdraft')
  overdraft(@Param('did') did: string, @Body() dto: OverdraftDto, @Actor() actor: IntrospectionResult) {
    return this.gate.overdraft(did, dto.amount, auditActor(actor, dto.adminId));
  }

  /** A shop's EARNINGS register (R4): its OWN ledger (top-ups / handling pay / shipping fees / refunds),
   *  server-side searched / filtered / sorted / paginated → { items, total }. Owner-scoped (was unscoped —
   *  a data-firewall fix: a shop's money history must not be readable by another token via the path did). */
  @Scopes('wallet:read:self')
  @Get('agents/:did/ledger')
  agentLedger(@Param('did') did: string, @Query() query: AgentLedgerQueryDto, @Actor() actor: IntrospectionResult) {
    this.assertAgentOwner(did, actor);
    return this.gate.agentLedgerPage(did, query);
  }

  /** Running totals (in / out / net / count) for the current filter + the always-current wallet balance. Owner-scoped. */
  @Scopes('wallet:read:self')
  @Get('agents/:did/ledger/summary')
  agentLedgerSummary(@Param('did') did: string, @Query() query: AgentLedgerQueryDto, @Actor() actor: IntrospectionResult) {
    this.assertAgentOwner(did, actor);
    return { ...this.gate.agentLedgerSummary(did, query), balance: this.agents.balance(did) };
  }

  /** Export the whole matching set (every page, current filters) as CSV — the shop's OWN earnings export. Owner-scoped. */
  @Scopes('wallet:read:self')
  @Get('agents/:did/ledger/export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="earnings.csv"')
  agentLedgerExport(@Param('did') did: string, @Query() query: AgentLedgerQueryDto, @Actor() actor: IntrospectionResult): string {
    this.assertAgentOwner(did, actor);
    return this.gate.agentLedgerCsv(did, query);
  }

  /** A shop's PARCEL-HISTORY register (R4): the parcels it handled (drop-off origin or collection dest),
   *  server-side searched / filtered / sorted / paginated → { items, total }. Owner-scoped. */
  @Scopes('agent:read:self')
  @Get('agents/:did/parcels')
  agentParcels(@Param('did') did: string, @Query() query: AgentParcelsQueryDto, @Actor() actor: IntrospectionResult) {
    this.assertAgentOwner(did, actor);
    return this.parcels.agentParcelsPage(did, query);
  }

  /** Export the shop's parcel history (every page, current filters) as CSV. Owner-scoped. */
  @Scopes('agent:read:self')
  @Get('agents/:did/parcels/export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="parcels.csv"')
  agentParcelsExport(@Param('did') did: string, @Query() query: AgentParcelsQueryDto, @Actor() actor: IntrospectionResult): string {
    this.assertAgentOwner(did, actor);
    return this.parcels.agentParcelsCsv(did, query);
  }

  // --- corridors + drivers (↔ M3 light) ---

  @Post('corridors')
  addCorridor(@Body() dto: CorridorDto) {
    return this.corridors.addCorridor(dto);
  }

  @Get('corridors')
  listCorridors() {
    return this.corridors.listCorridors();
  }

  @Post('corridors/:id/status')
  setCorridorStatus(@Param('id') id: string, @Body() dto: CorridorStatusDto) {
    return this.corridors.setStatus(id, dto.status);
  }

  @Post('drivers')
  addDriver(@Body() dto: DriverDto) {
    return this.corridors.addDriver(dto);
  }

  @Get('drivers')
  listDrivers() {
    return this.corridors.listDrivers();
  }

  /** Weekly driver settlement (Finance · DRIVER_PAYOUT) — operator only. */
  @Roles('operator')
  @Post('drivers/payout')
  driverPayout(@Body() dto: DriverPayoutDto) {
    return this.gate.driverPayout(dto.driverId, dto.amount);
  }

  // --- agent app: 3 screens ---

  @Post('parcels/accept')
  accept(@Body() dto: AcceptParcelDto, @Actor() actor: IntrospectionResult) {
    return this.parcels.accept({ ...dto, agentDid: actingDid(actor, dto.agentDid) });
  }

  /** F2 — the counter books a too-big (dedicated, P4+) walk-up as FREIGHT instead of refusing it (the perishable
   *  "book immediate or planned" + rural "the shop IS the PUDO" path). The acting agent is pinned to its token
   *  (operator may override) and is the on-platform originator; the customer pays a CASH budget cap at the counter
   *  (→ the freight's maxSpend ceiling, so no driver can claim above it) and settles OFF-PLATFORM — no shipperDid,
   *  so the load stays 'unpaid' and the agent's parcel-sized wallet is never billed a truck haul (the driver is
   *  still paid on delivery by the platform, as for any bulletin freight). Immediate or planned (F1). Returns a
   *  tracking code the agent prints for a phone-less customer. */
  @Post('parcels/book-freight')
  bookFreight(@Body() dto: BookFreightDto, @Actor() actor: IntrospectionResult) {
    const agentDid = actingDid(actor, dto.agentDid);
    const origin = this.agents.get(agentDid); // 404 if the acting id is not an agent
    if (dto.destPudoDid === agentDid) throw new GlosError('INVALID_INPUT', 'A shipment cannot be sent to the shop booking it — pick a different destination.');
    const dest = this.agents.get(dto.destPudoDid); // 404 on an unknown destination
    const dimsCm: [number, number, number] = [dto.dimensionsCm.l, dto.dimensionsCm.w, dto.dimensionsCm.h];
    const cargoClass = this.cargo.classify({ kg: dto.weightKg, dimsCm });
    // Freight is the DEDICATED (P4+) lane only. A bus-sized load must be taken in as a normal parcel, not booked
    // as a truck haul — reject it so the counter can't turn an ordinary parcel into an (unpaid) freight job.
    if (!this.cargo.dedicatedRequired(cargoClass)) {
      throw new GlosError('INVALID_INPUT', `A ${cargoClass} load fits the parcel network — take it in as a normal parcel, not freight.`);
    }
    const freight = this.dispatch.registerFreight({
      description: `Counter freight (${cargoClass}) booked at ${origin.shopName}`,
      pickupLocation: origin.location,
      pickupLabel: origin.shopName,
      destLabel: dest.shopName,
      destLocation: dest.location,
      weightKg: dto.weightKg,
      dimensionsCm: dimsCm,
      natureCode: dto.natureCode,
      fragile: dto.fragile,
      bulk: false, // a walk-up dedicated load is DISCRETE/palletised — it needs real handling equipment, not a tipper
      // shipperDid intentionally omitted: a cash counter booking settles OFF-PLATFORM (paidStatus 'unpaid'), so
      // no wallet is billed — the customer's cash cap is the money, held by the agent (the F2 model the user chose).
      originEquipment: origin.equipment,
      destEquipment: dest.equipment,
      buyerMobile: dto.customerMobile, // hashed on the freight (never the cleartext) so the customer can track it
      maxSpend: dto.budgetCap, // the cash cap → dispatch won't OFFER or let a driver CLAIM above it
      scheduledPickupAt: dto.scheduledPickupAt,
      allowEarlyClaim: dto.allowEarlyClaim,
    });
    // A focused, PII-free receipt for the counter: the human FRT code + the public tracking key to print, the
    // status/date, and the site-equipment advisory (a small shop may not be able to load a pallet).
    return {
      freightId: freight.freightId,
      code: freight.code,
      trackingKey: freight.trackingKey,
      status: freight.status,
      scheduledPickupAt: freight.scheduledPickupAt,
      destLabel: freight.destLabel,
      weightKg: freight.weightKg,
      cargoClass: freight.cargoClass,
      equipmentGaps: freight.equipmentGaps,
      maxSpend: freight.maxSpend,
    };
  }

  @Post('parcels/handover')
  handover(@Body() dto: HandoverDto, @Actor() actor: IntrospectionResult) {
    return this.parcels.handover({ ...dto, agentDid: actingDid(actor, dto.agentDid) });
  }

  @Post('parcels/:id/arrive')
  arrive(@Param('id') id: string, @Body() dto: ArriveDto, @Actor() actor: IntrospectionResult) {
    return this.parcels.arrive(id, actingDid(actor, dto.destAgentDid));
  }

  @Post('parcels/:id/pickup')
  pickup(@Param('id') id: string, @Body() dto: PickupDto, @Actor() actor: IntrospectionResult) {
    return this.parcels.pickup(id, actingDid(actor, dto.agentDid), dto.otp, dto.deliveredPhotoRef);
  }

  @Post('parcels/:id/void')
  voidParcel(@Param('id') id: string, @Body() dto: VoidDto, @Actor() actor: IntrospectionResult) {
    return this.parcels.void(id, actingDid(actor, dto.agentDid), dto.voidedPhotoRef);
  }

  /** The operational parcel list (agent + hub screens). PG2: PROJECTED for everyone but an operator —
   *  the raw record carries phones, hashes and the handover secrets (collection code / OTP), none of
   *  which a list surface needs; before this, ANY valid token could read them all. */
  @Get('parcels')
  listParcels(@Query('status') status?: string, @Query('agent') agent?: string, @Actor() actor?: IntrospectionResult) {
    const rows = this.parcels.list({ status: status as never, agentDid: agent });
    return actor?.role === 'operator' ? rows : rows.map(operationalParcelView);
  }

  @Get('parcels/:id')
  getParcel(@Param('id') id: string) {
    return this.monitor.parcelTimeline(id);
  }

  /** The planned route for a parcel (origin PUDO → MDP(s) → dest PUDO), once a destination is known. */
  @Get('parcels/:id/route')
  parcelRoute(@Param('id') id: string) {
    const parcel = this.parcels.get(id);
    if (!parcel.destAgentDid) return { planned: false, reason: 'No destination PUDO nominated yet (set at accept or arrival).' };
    return { planned: true, ...this.routing.planJourney({ originAgentDid: parcel.committedNodeDid ?? parcel.originAgentDid, destAgentDid: parcel.destAgentDid }) };
  }

  /** DT — the printable label for a parcel (reprint). Operator-only: the inbound label carries the buyer's
   *  collection code (a handover secret), so this is not a public surface — the creator got it in the mint /
   *  accept response, and the vendor sees it on their order detail. */
  @Roles('operator')
  @Get('parcels/:id/label')
  parcelLabel(@Param('id') id: string) {
    return this.parcels.labelFor(id);
  }

  /** Reverse logistics: cancel a not-yet-delivered parcel (Created / At_PUDO / At_MDP) — operator only. */
  @Roles('operator')
  @Post('parcels/:id/cancel')
  cancelParcel(@Param('id') id: string, @Body() dto: CancelParcelDto, @Actor() actor: IntrospectionResult) {
    return this.parcels.cancel(id, auditActor(actor, dto.by), dto.reason);
  }

  /** Destination PUDO receives a whole bag → shelves each parcel + frees the tote (closes the tote leg). */
  @Post('agents/:did/receive-bag')
  receiveBag(@Param('did') did: string, @Body() dto: ReceiveBagDto) {
    return this.mdps.deliverBag(did, dto.code);
  }

  // --- e-commerce vendors + inbound pickup-at-PUDO ---

  /** Register an e-commerce vendor (returns a signing secret for callback verification).
   *  @Public (S15): this IS a signup — the same pre-auth reasoning as auth/signup. The
   *  secret is in the response exactly once; vendors/login is how it is used ever after. */
  @Public()
  @Post('vendors')
  registerVendor(@Body() dto: RegisterVendorDto) {
    const vendor = this.vendors.register(dto);
    // S20: if the operator gave a phone, link this store to their person identity — same human, one account.
    if (dto.ownerPhone) this.persons.tryAttachRole(dto.ownerPhone, 'vendor', vendor.did);
    return vendor;
  }

  /**
   * Merchant console sign-in (S15): store ID + the signing secret (issued once, at
   * registration) → a genesis-role actor token bound to the vendor's DID. @Public for the
   * same reason auth/login is: a caller cannot hold an actor token before signing in.
   */
  @Public()
  @Post('vendors/login')
  vendorLogin(@Body() dto: VendorLoginDto) {
    const vendor = this.vendors.login(dto.vendorId, dto.secret);
    return { ...VendorService.publicView(vendor), token: this.auth.mintActorToken({ role: 'genesis', did: vendor.did }) };
  }

  @Get('vendors')
  listVendors() {
    return this.vendors.list();
  }

  /**
   * Load a single vendor (so the merchant console can sign back into an existing store via ?vendor=).
   * Returns the public view — the signing secret is issued once at registration and never re-exposed.
   */
  @Get('vendors/:id')
  getVendor(@Param('id') id: string) {
    return VendorService.publicView(this.vendors.get(id));
  }

  /** Update the store profile: map pin (origin-PUDO ranking), address, callback URL, split policy.
   *  Owner-scoped (PG0): the callback URL + split policy are the store's webhook/money config — an
   *  unlabelled write would let ANY token redirect another store's callbacks or rewrite its pricing. */
  @Scopes('vendor:manage:self')
  @Patch('vendors/:id')
  updateVendor(@Param('id') id: string, @Body() dto: UpdateVendorDto, @Actor() actor: IntrospectionResult) {
    this.assertVendorOwner(id, actor);
    return VendorService.publicView(this.vendors.updateProfile(id, dto));
  }

  /**
   * OWNER GATE for a vendor's own data AND writes (PG0). 404 on an unknown store; 403 unless the caller IS
   * that store — a vendor's token carries did = vendor.did (mintActorToken at vendors/login), so we compare
   * the acting DID to the record; an operator (client-secret gated) may act on any store. Without this, an
   * unlabelled route is admitted for ANY valid token: on reads the path id alone would expose one store's
   * orders + buyer PII to another, and on writes (mint / settle / top-up / profile) the BODY's vendorId
   * would let any token bill or reconfigure another store. `@Scopes(...)` additionally keeps roles that
   * never carry vendor authority off these routes.
   */
  private assertVendorOwner(id: string, actor: IntrospectionResult): void {
    const vendor = this.vendors.get(id); // 404 if unknown
    if (actor?.role !== 'operator' && (!actor?.did || actor.did !== vendor.did)) {
      throw new GlosError('FORBIDDEN', 'This store is not yours to view');
    }
  }

  /** OWNER GATE for a shop's own data (R4). 404 on an unknown shop; 403 unless the caller IS that shop — a
   *  shop's token carries did = the agent did — or an operator. The did IS the record key, so we compare it
   *  directly. Without this, the earnings ledger + parcel history would be readable for any shop by path did. */
  private assertAgentOwner(did: string, actor: IntrospectionResult): void {
    this.agents.get(did); // 404 if unknown
    if (actor?.role !== 'operator' && (!actor?.did || actor.did !== did)) {
      throw new GlosError('FORBIDDEN', 'This shop is not yours to view');
    }
  }

  /** OWNER GATE for a driver's own data (R5). 404 on an unknown driver; 403 unless the caller IS that driver
   *  (its token carries did = the driver did) or an operator. */
  private assertDriverOwner(did: string, actor: IntrospectionResult): void {
    this.drivers.get(did); // 404 if unknown
    if (actor?.role !== 'operator' && (!actor?.did || actor.did !== did)) {
      throw new GlosError('FORBIDDEN', 'These jobs are not yours to view');
    }
  }

  /** A vendor's shipment register (R0): their OWN inbound parcels, server-side searched / filtered /
   *  sorted / paginated. Returns { items, total } so the console can page. Owner-scoped (403 for non-owners). */
  @Scopes('vendor:read:self')
  @Get('vendors/:id/orders')
  vendorOrders(@Param('id') id: string, @Query() query: VendorOrdersQueryDto, @Actor() actor: IntrospectionResult) {
    this.assertVendorOwner(id, actor);
    return this.parcels.vendorOrdersPage(id, query);
  }

  /** Export the WHOLE matching set (every page, current filters) as CSV — the vendor's OWN shipment export.
   *  Owner-scoped. Declared before the :parcelId route so "export" is not captured as a parcel id. */
  @Scopes('vendor:read:self')
  @Get('vendors/:id/orders/export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="shipments.csv"')
  vendorOrdersExport(@Param('id') id: string, @Query() query: VendorOrdersQueryDto, @Actor() actor: IntrospectionResult): string {
    this.assertVendorOwner(id, actor);
    return this.parcels.vendorOrdersCsv(id, query);
  }

  /** Store-wide shipment counts (total / unpaid / active) for the console header — computed over the WHOLE
   *  store, never the current register page, so the "top up" nudge stays honest under any filter. Owner-scoped.
   *  Declared before the :parcelId route so "stats" is not captured as a parcel id. */
  @Scopes('vendor:read:self')
  @Get('vendors/:id/orders/stats')
  vendorOrderStats(@Param('id') id: string, @Actor() actor: IntrospectionResult) {
    this.assertVendorOwner(id, actor);
    return this.parcels.vendorOrderStats(id);
  }

  /** Full detail for one order (the watch-only status screen's drill-down). Owner-scoped; strips the
   *  control-tower-only short-ship marker before it reaches the external merchant. */
  @Scopes('vendor:read:self')
  @Get('vendors/:id/orders/:parcelId')
  vendorOrder(@Param('id') id: string, @Param('parcelId') parcelId: string, @Actor() actor: IntrospectionResult) {
    this.assertVendorOwner(id, actor);
    return this.parcels.vendorOrderView(id, parcelId);
  }

  /** The buyer's checkout selections waiting to be shipped (the console's incoming-orders inbox). Owner-scoped:
   *  these carry buyer email/mobile, so only the store itself (or an operator) may read them. */
  @Scopes('vendor:read:self')
  @Get('vendors/:id/checkouts')
  vendorCheckouts(@Param('id') id: string, @Actor() actor: IntrospectionResult) {
    this.assertVendorOwner(id, actor);
    return this.vendors.checkoutsFor(id);
  }

  /**
   * The embedded PUDO-picker node (or a webhook, or manual entry): capture the buyer's destination-PUDO
   * choice + email so it can pre-fill a shipment in the console. This is what hooks into the vendor's checkout.
   */
  @Post('vendors/:id/checkout')
  captureCheckout(@Param('id') id: string, @Body() dto: CheckoutDto) {
    return this.vendors.captureCheckout({ vendorId: id, destAgentDid: dto.destPudoDid, buyerEmail: dto.buyerEmail, buyerMobile: dto.buyerMobile, externalOrderId: dto.externalOrderId, items: dto.items, subtotal: dto.subtotal, source: dto.source });
  }

  /** Vendor status-callback outbox (HMAC-signed ready_for_pickup / collected / disputed). Owner-scoped —
   *  the outbox holds signatures + payloads for this store only. */
  @Scopes('vendor:read:self')
  @Get('vendors/:id/callbacks')
  vendorCallbacks(@Param('id') id: string, @Actor() actor: IntrospectionResult) {
    this.assertVendorOwner(id, actor);
    return this.vendors.outboxFor(id);
  }

  /** Derive the size tier from dimensions (cm) + weight (kg) — live preview for the mint form. S32c also
   *  returns the cargo class + whether it needs dedicated freight, so the mint form can warn BEFORE minting
   *  that a P4+ load won't ride the parcel network (it will be diverted to the dedicated-freight lane).
   *  @Public (PG3): a pure derivation over the open size/cargo thresholds — no data is read, nothing is
   *  written. The anonymous Send wizard needs it: dims+weight are the ONLY size input now (no self-declared
   *  tiers), and a guest pricing a parcel must derive the tier before the (equally public) quote. */
  @Public()
  @Post('size/classify')
  classify(@Body() dto: ClassifyDto) {
    const cargoClass = this.cargo.classify({ kg: dto.kg, dimsCm: [dto.l, dto.w, dto.h] });
    return { size: classifySize(dto), cargoClass, dedicated: this.cargo.dedicatedRequired(cargoClass) };
  }

  /** Quote a shipment from the open-data participant rates: flexible (any carrier) vs locked (cheapest).
   *  @Public (S13): the quote is derived ONLY from open-data prices — it is the SEE of See-Buy-Get,
   *  and a consumer holds no account to authenticate with. */
  @Public()
  @Get('quote')
  quote(@Query('origin') origin: string, @Query('dest') dest: string, @Query('size') size?: string) {
    if (!origin || !dest) throw new GlosError('FIELD_REQUIRED', 'origin and dest are required');
    return this.routing.quoteShipment(origin, dest, (size as 'S' | 'M' | 'L' | 'HEAVY') || 'M');
  }

  /**
   * Quote many candidates at once so each PUDO pin on the map carries a real total. Either fix the origin
   * and vary the destinations (buyer's map) or fix the destination and vary the origins (vendor's drop-off map).
   */
  @Public()
  @Get('quote/options')
  quoteOptions(@Query('origin') origin: string, @Query('dest') dest: string, @Query('origins') origins: string, @Query('dests') dests: string, @Query('size') size?: string) {
    const sz = (size as 'S' | 'M' | 'L' | 'HEAVY') || 'M';
    const list = (origin && dests) ? dests.split(',').map((d) => [origin, d] as const)
      : (dest && origins) ? origins.split(',').map((o) => [o, dest] as const)
        : null;
    if (!list) throw new GlosError('FIELD_REQUIRED', 'provide origin+dests or dest+origins');
    const variable = origin ? 1 : 0; // which side varies → the `did` the pin represents
    return { options: list.filter(([a, b]) => a && b).map(([o, d]) => {
      try { return { did: [o, d][variable], quote: this.routing.quoteShipment(o, d, sz) }; }
      catch (e) { return { did: [o, d][variable], error: e instanceof Error ? e.message : 'no route' }; }
    }) };
  }

  /**
   * Competitive price discovery, BOUNDED so it scales to 30k PUDOs. Returns a local **benchmark**
   * (median / p25–p75 / min–max / count of nearby same-type rates) + a **capped** set of nearby price
   * pins for the map — never the whole network. With `type` → that one service (PUDO/MDP per-parcel,
   * vehicle per-km); without `type` → just the three network benchmarks (the public hub summary).
   * Without lat/lng → network-wide (no radius filter). In-memory haversine here; a geo-index at real scale.
   */
  @Get('pricing/near')
  @ApiQuery({ name: 'type', required: false, enum: ['pudo', 'mdp', 'vehicle'] })
  @ApiQuery({ name: 'lat', required: false })
  @ApiQuery({ name: 'lng', required: false })
  @ApiQuery({ name: 'radiusKm', required: false })
  @ApiQuery({ name: 'limit', required: false })
  pricingNear(@Query('type') type?: string, @Query('lat') lat?: string, @Query('lng') lng?: string, @Query('radiusKm') radiusKm?: string, @Query('limit') limit?: string) {
    const R = Number(radiusKm) || 25;
    const L = Math.min(Number(limit) || 50, 200);
    const here = lat && lng ? { lat: Number(lat), lng: Number(lng) } : undefined;
    const pct = (sorted: number[], p: number): number => {
      if (!sorted.length) return 0;
      const i = (sorted.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
      return Math.round((sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo)) * 100) / 100;
    };
    const benchmark = (prices: number[]) => {
      const s = [...prices].sort((a, b) => a - b);
      return { count: s.length, median: pct(s, 0.5), p25: pct(s, 0.25), p75: pct(s, 0.75), min: s[0] ?? 0, max: s[s.length - 1] ?? 0 };
    };
    type Row = { id: string; label: string; location?: { lat: number; lng: number }; price: number };
    const rowsFor = (t: string): Row[] => {
      if (t === 'mdp') return this.mdps.list().map((m) => ({ id: m.mdpId, label: m.name, location: m.location, price: m.pricePerParcel }));
      if (t === 'vehicle') return this.vehicles.list({ status: 'ACTIVE' }).map((v) => ({ id: v.vehicleId, label: v.plate, price: v.pricePerKm }));
      return this.agents.list().filter((a) => a.status === 'ACTIVE').map((a) => ({ id: a.did, label: a.shopName, location: a.location, price: a.pricePerParcel }));
    };
    const forType = (t: string) => {
      let rows = rowsFor(t).map((r) => ({ ...r, km: here && r.location ? Math.round(haversineKm(here, r.location) * 10) / 10 : undefined }));
      if (here && t !== 'vehicle') rows = rows.filter((r) => r.km != null && r.km <= R).sort((a, b) => (a.km ?? 0) - (b.km ?? 0)); // vehicles roam → network benchmark
      return { benchmark: benchmark(rows.map((r) => r.price)), pins: t === 'vehicle' ? [] : rows.slice(0, L) };
    };
    if (type) return { type, radiusKm: here ? R : null, ...forType(type) };
    return { pudo: forType('pudo').benchmark, mdp: forType('mdp').benchmark, vehicle: forType('vehicle').benchmark };
  }

  /** Open pricing feed — every PUDO, MDP and vehicle's advertised rate. DEBUG/small-network only — at scale use /pricing/near. */
  @Get('pricing')
  pricing() {
    return {
      pudos: this.agents.list().filter((a) => a.status === 'ACTIVE').map((a) => ({ did: a.did, shopName: a.shopName, zone: a.zone, location: a.location, pricePerParcel: a.pricePerParcel })),
      mdps: this.mdps.list().map((m) => ({ mdpId: m.mdpId, name: m.name, zones: m.zones, location: m.location, pricePerParcel: m.pricePerParcel })),
      vehicles: this.vehicles.list({ status: 'ACTIVE' }).map((v) => ({ vehicleId: v.vehicleId, plate: v.plate, vehicleClass: v.vehicleClass, pricePerKm: v.pricePerKm })),
      perKm: this.vehicles.priceRange(),
    };
  }

  /** A PUDO agent sets its open-data per-parcel handling price. */
  @Patch('agents/:did/pricing')
  setAgentPrice(@Param('did') did: string, @Body() dto: SetPriceDto) {
    return this.agents.setPrice(did, dto.price);
  }

  /** An MDP sets its open-data per-parcel sort price. */
  @Patch('mdps/:id/pricing')
  setMdpPrice(@Param('id') id: string, @Body() dto: SetPriceDto) {
    return this.mdps.setPrice(id, dto.price);
  }

  /** A driver / fleet manager sets a vehicle's open-data per-km transport rate. */
  @Patch('vehicles/:id/pricing')
  setVehiclePrice(@Param('id') id: string, @Body() dto: SetPriceDto) {
    return this.vehicles.setPrice(id, dto.price);
  }

  /** Vendor prepays its balance with the per-country daughter company. Owner-scoped (PG0): money movement
   *  on a store's book is the store's own action, even in the crediting direction. */
  @Scopes('vendor:manage:self')
  @Post('vendors/:id/top-up')
  topUpVendor(@Param('id') id: string, @Body() dto: TopUpDto, @Actor() actor: IntrospectionResult) {
    this.assertVendorOwner(id, actor);
    return VendorService.publicView(this.vendors.topUp(id, dto.amount));
  }

  /** A vendor's prepaid balance + settlement book (top-ups / billings / rebates). Owner-scoped — this is the
   *  store's money history. The searchable/paginated register is at .../ledger; this stays for the balance. */
  @Scopes('vendor:read:self')
  @Get('vendors/:id/settlement')
  vendorSettlement(@Param('id') id: string, @Actor() actor: IntrospectionResult) {
    this.assertVendorOwner(id, actor);
    return { balance: this.vendors.balanceOf(id), entries: this.vendors.settlementsFor(id) };
  }

  /** The vendor's bookkeeping register (R3): their OWN ledger, server-side searched / filtered / sorted /
   *  paginated → { items, total }. Owner-scoped (403 for non-owners). */
  @Scopes('vendor:read:self')
  @Get('vendors/:id/ledger')
  vendorLedger(@Param('id') id: string, @Query() query: VendorLedgerQueryDto, @Actor() actor: IntrospectionResult) {
    this.assertVendorOwner(id, actor);
    return this.vendors.vendorLedgerPage(id, query);
  }

  /** Running totals (in / out / net / count) for the CURRENT filtered view, plus the always-current balance.
   *  Owner-scoped. Declared before no :sub route, but kept explicit for parity with the shipment register. */
  @Scopes('vendor:read:self')
  @Get('vendors/:id/ledger/summary')
  vendorLedgerSummary(@Param('id') id: string, @Query() query: VendorLedgerQueryDto, @Actor() actor: IntrospectionResult) {
    this.assertVendorOwner(id, actor);
    return { ...this.vendors.vendorLedgerSummary(id, query), balance: this.vendors.balanceOf(id) };
  }

  /** Export the WHOLE matching set (every page, current filters) as CSV — the vendor's OWN bookkeeping export.
   *  Owner-scoped. */
  @Scopes('vendor:read:self')
  @Get('vendors/:id/ledger/export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="bookkeeping.csv"')
  vendorLedgerExport(@Param('id') id: string, @Query() query: VendorLedgerQueryDto, @Actor() actor: IntrospectionResult): string {
    this.assertVendorOwner(id, actor);
    return this.vendors.vendorLedgerCsv(id, query);
  }

  /** Retry the prepaid gate on an unpaid shipment after a top-up → issue the label + ParcelPaid.
   *  Owner-scoped (PG0): settling BILLS the minting store's balance, so only that store (or an
   *  operator) may trigger it — a storeless walk-up parcel has no settle path at all. */
  @Scopes('shipment:create')
  @Post('parcels/:id/settle')
  settleParcel(@Param('id') id: string, @Actor() actor: IntrospectionResult) {
    if (actor?.role !== 'operator') {
      const vendorId = this.parcels.get(id).vendorId;
      if (!vendorId) throw new GlosError('FORBIDDEN', 'Only the minting store may settle a shipment');
      this.assertVendorOwner(vendorId, actor);
    }
    return this.parcels.settleUnpaid(id);
  }

  /** Public track-and-trace by the shareable tracking key (no PII, no handover code).
   *  @Public (S13): the comment above was always the intent — the KEY is the credential; the
   *  response carries no PII and no collection code, and the GET of See-Buy-Get cannot ask a
   *  consumer for an account it has no way to hold. */
  @Public()
  @Get('track/:key')
  track(@Param('key') key: string) {
    const t = this.parcels.track(key);
    // DT — surface the twin's stable id + its PLANNED route (the hops it will travel + when it should be
    // ready), so the parcel is trackable AS a planned journey from creation, before it has moved. All PII-free
    // (shop names + zones are already public via /network/points). Best-effort — a route it can't plan yet
    // (no destination / no corridor) just omits the plannedRoute; the status ladder still renders.
    const parcel = this.parcels.get(t.ref);
    let plannedRoute: { hops: string[]; mdpRouted: boolean; pickupReadyAt: string } | undefined;
    if (parcel.destAgentDid) {
      try {
        const j = this.routing.planJourney({ originAgentDid: parcel.committedNodeDid ?? parcel.originAgentDid, destAgentDid: parcel.destAgentDid });
        plannedRoute = { hops: j.hops.map((h) => h.label), mdpRouted: j.mdpRouted, pickupReadyAt: j.pickupReadyAt };
      } catch {
        plannedRoute = undefined;
      }
    }
    return { ...t, did: parcel.did, plannedRoute };
  }

  /**
   * Resolve a free-text place/area/landmark to a point — the agent's "Address" intake mode geocodes a
   * typed area, then ranks the network points nearest-first client-side. @Public for the same open-data
   * reasoning as /quote + /network/points: a pure offline gazetteer lookup, no data read or written.
   * `confidence` (exact | approx | fallback) lets the UI flag an approximate pin.
   */
  @Public()
  @Get('geocode')
  geocode(@Query('q') q?: string) {
    if (!q || !q.trim()) throw new GlosError('FIELD_REQUIRED', 'Enter a place or area to look up');
    return this.geocoder.geocode(q);
  }

  /**
   * The public network directory — the sanitized slice of the agent register a SENDER needs to
   * choose a drop-off or delivery point: name, zone, pin, open state, the open-data handling
   * price, rating and free shelf slots. NOTHING operational leaves here: no balance, no device,
   * no vault refs, no requirements — that is what keeps this @Public while GET /agents stays
   * token-gated (S3).
   */
  @Public()
  @Get('network/points')
  networkPoints() {
    return this.agents.list().map((a) => ({
      did: a.did,
      shopName: a.shopName,
      zone: a.zone,
      location: a.location,
      landmark: a.landmark,
      openState: a.openState,
      pricePerParcel: a.pricePerParcel,
      rating: this.ratings.agentRating(a.did),
      freeSlots: this.shelf.available(a.did),
      since: a.createdAt, // REP1 — a "serving since" trust signal for the public profile (an onboarding date, not PII)
    }));
  }

  /** Vendor mint: an order ships → create the inbound parcel + phygital label + collection code + tracking key.
   *  Owner-scoped (PG0): the mint BILLS dto.vendorId's prepaid balance, and vendorId comes from the BODY —
   *  without the gate any valid token could mint against (and drain) another store's book. */
  @Scopes('shipment:create')
  @Post('inbound/orders')
  createInbound(@Body() dto: InboundOrderDto, @Actor() actor: IntrospectionResult) {
    this.assertVendorOwner(dto.vendorId, actor);
    const vendor = this.vendors.get(dto.vendorId);
    const handoff = dto.checkoutId ? this.vendors.checkout(dto.checkoutId) : undefined;
    // A checkout handoff is itself store-owned: binding another store's handoff would pull its buyer
    // contact into this store's parcel AND consume it out of the victim's incoming-orders inbox.
    if (handoff && handoff.vendorId !== dto.vendorId) throw new GlosError('FORBIDDEN', 'This checkout belongs to a different store');
    const destPudoDid = dto.destPudoDid ?? handoff?.destAgentDid;
    if (!destPudoDid) throw new GlosError('FIELD_REQUIRED', 'A destination PUDO is required');
    // Derive the size, then quote the route from the open-data participant rates.
    const size = dto.dimensionsCm ? classifySize({ ...dto.dimensionsCm, kg: dto.weightKg ?? SIZE_WEIGHT_KG[dto.size ?? 'M'] }) : (dto.size ?? 'M');
    // S32: a heavy/oversized order (cargo class P4+) is DEDICATED FREIGHT — it can never enter the shelf/tote
    // network. Instead of minting a PUDO parcel (or, as before S32, rejecting it), DIVERT it into the freight
    // marketplace with the vendor as shipper, and skip the parcel quote/settlement (freight is a negotiated,
    // claim-based model). ParcelService.createInbound keeps its own P4+ guard as a safety net for direct callers.
    const weightKg = dto.weightKg ?? SIZE_WEIGHT_KG[size];
    const dimsCm: [number, number, number] | undefined = dto.dimensionsCm ? [dto.dimensionsCm.l, dto.dimensionsCm.w, dto.dimensionsCm.h] : undefined;
    const cargoClass = this.cargo.classify({ kg: weightKg, dimsCm });
    if (this.cargo.dedicatedRequired(cargoClass)) {
      const origin = this.agents.get(dto.originPudoDid);
      const dest = this.agents.get(destPudoDid);
      const freight = this.dispatch.registerFreight({
        description: `Order ${dto.externalOrderId ?? handoff?.externalOrderId ?? vendor.name} — ${cargoClass} dedicated cargo`,
        pickupLocation: origin.location,
        pickupLabel: origin.shopName,
        destLabel: dest.shopName,
        destLocation: dest.location,
        weightKg,
        dimensionsCm: dimsCm,
        natureCode: dto.natureCode,
        fragile: dto.fragile,
        bulk: false, // a diverted e-commerce order is DISCRETE/palletised, so it needs real handling equipment
        shipperDid: dto.vendorId,
        // S32c: the freight's ends ARE these PUDOs — check they can actually HANDLE the cargo (a small shop
        // with only manual handling can't take a pallet), flagging a gap advisory for a Local Admin to resolve.
        originEquipment: origin.equipment,
        destEquipment: dest.equipment,
        // S32d: keep the buyer joined to their order so it stays in their "my shipments" with a tracking key.
        buyerMobile: dto.buyerMobile ?? handoff?.buyerMobile,
        externalOrderId: dto.externalOrderId ?? handoff?.externalOrderId,
        // S34c: the vendor's freight-spend cap — dispatch won't move this order above it.
        maxSpend: vendor.shippingPolicy?.maxTransportSpend,
      });
      if (handoff) this.vendors.consumeCheckout(handoff.id, freight.freightId);
      return { diverted: true, reason: 'dedicated_freight', cargoClass, freight };
    }
    const quote = this.routing.quoteShipment(dto.originPudoDid, destPudoDid, size);
    const result = this.parcels.createInbound({
      vendorId: dto.vendorId,
      externalOrderId: dto.externalOrderId ?? handoff?.externalOrderId,
      originAgentDid: dto.originPudoDid,
      destAgentDid: destPudoDid,
      buyerMobile: dto.buyerMobile ?? handoff?.buyerMobile ?? '',
      buyerEmail: dto.buyerEmail ?? handoff?.buyerEmail,
      size: dto.size,
      dimensionsCm: dto.dimensionsCm,
      weightKg: dto.weightKg,
      contentPhotoRef: dto.contentPhotoRef,
      fragile: dto.fragile,
      natureCode: dto.natureCode,
      items: dto.items ?? handoff?.items,
      subtotal: dto.subtotal ?? handoff?.subtotal,
      shippingPolicy: vendor.shippingPolicy,
      routeMode: dto.routeMode,
      quote,
    });
    if (handoff) this.vendors.consumeCheckout(handoff.id, result.parcel.parcelId);
    return result;
  }

  /** Origin PUDO scans a parcel in: a vendor's inbound (prepaid — labour fee) or a person's pre-minted
   *  peer send (PG2 — cash collected against the locked price, drop-off photo required). ONE scan surface;
   *  the parcel's own record decides which intake it is. */
  @Post('parcels/:id/intake')
  intake(@Param('id') id: string, @Body() dto: IntakeDto, @Actor() actor: IntrospectionResult) {
    const did = actingDid(actor, dto.agentDid);
    if (this.parcels.get(id).direction === 'outbound') return this.parcels.intakeConsumerSend(id, did, dto.dropoffPhotoRef);
    return this.parcels.intakeInbound(id, did);
  }

  /** PG2 — what the counter must know about a scanned parcel BEFORE confirming intake: what it is, what
   *  cash is due, where it goes. Field-picked (no phones, no handover secrets) and pinned to the acting
   *  shop — the same WRONG_PUDO rule the intake itself enforces, so the answer doubles as "is this mine
   *  to take in". */
  @Scopes('parcel:accept')
  @Get('parcels/:id/intake-preview')
  intakePreview(@Param('id') id: string, @Actor() actor: IntrospectionResult) {
    const parcel = this.parcels.get(id);
    if (actor?.role !== 'operator' && parcel.originAgentDid !== actor?.did) {
      throw new GlosError('WRONG_PUDO', 'This parcel is booked for drop-off at another shop');
    }
    const kind = parcel.vendorId ? 'vendor_order' : parcel.senderMobile === 'app' ? 'peer_send' : 'walk_up';
    // A vendor order is intakeable only once the store has actually PAID (intakeInbound hard-requires
    // ParcelPaid); a peer send stays unpaid-by-design until the cash is collected at THIS counter.
    const intakeReady = parcel.status === 'Created' && (kind !== 'vendor_order' || parcel.paidStatus === 'ParcelPaid');
    return {
      parcelId: parcel.parcelId,
      kind,
      status: parcel.status,
      intakeReady,
      size: parcel.size,
      weightKg: parcel.weightKg,
      fragile: parcel.fragile ?? false,
      destZone: parcel.destZone,
      destShopName: parcel.destAgentDid ? this.agents.get(parcel.destAgentDid).shopName : undefined,
      cashDue: kind === 'peer_send' ? parcel.shipmentCost ?? 0 : 0,
    };
  }

  /** Destination PUDO shelves an arrived parcel → Ready_For_Pickup + buyer notified. */
  @Post('parcels/:id/shelve')
  shelve(@Param('id') id: string, @Body() dto: ShelveDto, @Actor() actor: IntrospectionResult) {
    return this.parcels.shelve(id, actingDid(actor, dto.agentDid), dto.binId);
  }

  /** Buyer presents the collection QR → resolve the parcel + shelf slot (opens the handover screen). */
  @Post('parcels/collect')
  collect(@Body() dto: CollectDto, @Actor() actor: IntrospectionResult) {
    return this.parcels.collect(dto.collectionCode, actingDid(actor, dto.agentDid));
  }

  /** Buyer confirms the parcel is correct → Delivered, order closed. */
  @Post('parcels/:id/collect-confirm')
  collectConfirm(@Param('id') id: string, @Body() dto: CollectDto, @Actor() actor: IntrospectionResult) {
    return this.parcels.collectConfirm(id, actingDid(actor, dto.agentDid), dto.collectionCode);
  }

  /** Buyer reports a discrepancy at collection → Disputed, with mandatory photo proof. */
  @Post('parcels/:id/dispute')
  dispute(@Param('id') id: string, @Body() dto: DisputeDto, @Actor() actor: IntrospectionResult) {
    return this.parcels.dispute(id, actingDid(actor, dto.agentDid), dto.reason, dto.photoProofRef);
  }

  /** Tier-1 customer rates a delivered parcel → writes the agent composite to the shared core (graduation). */
  @Post('parcels/:id/rate')
  rate(@Param('id') id: string, @Body() dto: RateDto) {
    return this.ratings.rate({ parcelId: id, stars: dto.stars, raterMobile: dto.raterMobile });
  }

  @Get('agents/:did/rating')
  agentRating(@Param('did') did: string) {
    return this.ratings.agentRating(did);
  }

  /**
   * REP1 — a provider's PUBLIC reputation profile: a PII-free trust surface (name, zone, pin, the aggregate
   * stars + count, a "new" flag below the min-ratings floor, and serving-since). @Public for the same
   * open-data reasoning as /network/points — nothing operational (no balance, device, vault refs or PII)
   * leaves here, and the agent's did + shop name + zone + pin are already public there. Agents only for now;
   * drivers/fleet/MDP get profiles in later reputation slices (this 404s a non-agent did until then).
   */
  @Public()
  @Get('reputation/:did')
  reputationProfile(@Param('did') did: string) {
    const a = this.agents.get(did); // 404 if the did is not a rated provider (agents only in REP1)
    return {
      did: a.did,
      kind: 'agent' as const,
      name: a.shopName,
      zone: a.zone,
      location: a.location,
      rating: this.ratings.agentRating(a.did),
      since: a.createdAt,
    };
  }

  // --- operator control tower (↔ M7/SSE light) — operator only ---

  @Roles('operator')
  @Get('dashboard')
  dashboard() {
    return this.monitor.dashboard();
  }

  @Roles('operator')
  @Get('flags')
  flags() {
    return this.monitor.flags();
  }

  /** PUDO coverage heatmap — points + density + open/closed counts (feeds journey-leg planning). */
  @Get('heatmap')
  heatmap() {
    return this.monitor.heatmap();
  }

  // --- routing: first-mile node + leg computation ---

  /** Assign a first-mile node: nearest open PUDO with free shelf capacity. */
  @Post('routing/assign-node')
  assignNode(@Body() dto: AssignNodeDto) {
    return this.routing.assignFirstMileNode(dto);
  }

  /** Plan the journey: commit a first-mile node (given or assigned) and compute the legs + ETA. */
  @Post('routing/plan-journey')
  planJourney(@Body() dto: PlanJourneyDto) {
    return this.routing.planJourney(dto);
  }

  /** Network revenue / float / ledger — operator only. A field token must never read this. */
  @Roles('operator')
  @Get('finance')
  finance() {
    return this.monitor.finance();
  }

  // --- S34b: freight market pulse (dynamic pricing insight + operator surge overrides) ---

  /** The market-pulse watchtower — per-zone supply/demand + the applied surge factor, hottest first. */
  @Roles('operator')
  @Get('market-pulse')
  marketPulse() {
    return this.market.insight();
  }

  /** Force a recompute of the whole-map pulse now (it also recomputes on a 2-min timer). */
  @Roles('operator')
  @Post('market-pulse/recompute')
  recomputeMarketPulse() {
    return { cells: this.market.recompute() };
  }

  /** Set an operator surge override for a zone — a cell key, or a lat/lng the server buckets into one. */
  @Roles('operator')
  @Post('market/surge-rules')
  setSurgeRule(@Body() dto: SurgeRuleDto, @Actor() actor: IntrospectionResult) {
    const cell = dto.cell ?? (dto.location ? this.market.cellFor(dto.location) : undefined);
    if (!cell) throw new GlosError('FIELD_REQUIRED', 'Provide a cell key or a location (lat/lng) for the surge rule');
    return this.market.setSurgeRule({ cell, factor: dto.factor, reason: dto.reason, by: auditActor(actor, dto.by), expiresAt: dto.expiresAt });
  }

  /** Lift an operator surge override from a zone. */
  @Roles('operator')
  @Delete('market/surge-rules/:cell')
  clearSurgeRule(@Param('cell') cell: string) {
    return this.market.clearSurgeRule(cell);
  }

  // --- MDP hubs + tote-bag sorting (multi-hop) ---

  /** Register an MDP sort hub covering one or more zones. */
  @Post('mdps')
  registerMdp(@Body() dto: RegisterMdpDto) {
    return this.mdps.register(dto);
  }

  @Get('mdps')
  listMdps() {
    return this.mdps.list().map((m) => ({ ...m, totes: this.totes.list({ locationId: m.mdpId }).length }));
  }

  /** Register a fresh laminated tote (QR + human code) into the pool at this MDP. */
  @Post('mdps/:id/totes')
  registerTote(@Param('id') id: string) {
    return this.mdps.registerTote(id);
  }

  /** Totes currently at a location (MDP id or agent did). */
  @Get('totes')
  listTotes(@Query('location') location?: string, @Query('status') status?: string) {
    return this.totes.list({ locationId: location, status: status as never });
  }

  @Get('totes/:code')
  getTote(@Param('code') code: string) {
    return this.totes.requireByCode(code);
  }

  /** Link a free bag to a single next destination so it can start taking parcels. */
  @Post('totes/:code/assign')
  assignTote(@Param('code') code: string, @Body() dto: AssignToteDto) {
    return this.totes.assign(code, dto.destinationNodeId, dto.destinationLabel);
  }

  /** Drop a parcel into a bag (capacity-checked) — connects bag ↔ parcel. */
  @Post('totes/:code/fill')
  fillTote(@Param('code') code: string, @Body() dto: FillToteDto) {
    return this.mdps.fillTote(code, dto.parcelId);
  }

  /** Scan the bag onto a bus — one scan moves the whole tote + every parcel to On_Bus. */
  @Post('totes/:code/load')
  loadBag(@Param('code') code: string, @Body() dto: LoadBagDto) {
    return this.mdps.loadBag(code, dto.driverBadgeId);
  }

  /** A bus drops a bag at an MDP → scan the bag code, empty it; parcels become unsorted (At_MDP). */
  @Post('mdps/:id/drop-bag')
  dropBag(@Param('id') id: string, @Body() dto: DropBagDto) {
    return this.mdps.dropBag(id, dto.code);
  }

  /** Sort a parcel at an MDP → returns its next destination + the bag code to drop it in. */
  @Post('mdps/:id/sort')
  sortParcel(@Param('id') id: string, @Body() dto: SortParcelDto) {
    return this.mdps.sortParcel(id, dto.parcelId);
  }

  // --- fleet managers (the operator who owns the fleet — own onboarding + requirements) ---

  /** Register a fleet manager (eligibility: business reg + transport-operator licence + tax ID + depot). */
  @Post('fleet/managers')
  registerManager(@Body() dto: RegisterFleetManagerDto) {
    const manager = this.managers.register(dto);
    // S20: link the fleet operator to their person identity by phone (a manager can also send/drive).
    this.persons.tryAttachRole(manager.contactPhone, 'fleet_manager', manager.did, manager.did);
    return manager;
  }

  @Get('fleet/managers')
  listManagers() {
    return this.managers.list();
  }

  /** Fleet-console sign-in — resolve an ACTIVE manager from their login code, mint their actor token.
   * A manager's own DID is both their identity and their tenant boundary (they see only their fleet). */
  @Public()
  @Post('fleet/managers/login')
  managerLogin(@Body() dto: ManagerLoginDto) {
    const m = this.managers.login(dto.code);
    // S20: resolve this fleet login to the operator's person (idempotent with registration).
    this.persons.tryAttachRole(m.contactPhone, 'fleet_manager', m.did, m.did);
    const token = this.auth.mintActorToken({ role: 'fleet_manager', did: m.did, tenant: m.did });
    return { ...m, token };
  }

  /** Managers awaiting a KYC decision (the GLOS operator review queue). */
  @Roles('operator')
  @Get('fleet/managers/kyc-queue')
  managerKycQueue() {
    return this.managers.kycQueue();
  }

  @Get('fleet/managers/:did')
  getManager(@Param('did') did: string) {
    return this.managers.get(did);
  }

  /** Upload business KYC (registration cert, operator licence, owner ID, proof of address) → KYC_PENDING. */
  @Post('fleet/managers/:did/submit-kyc')
  managerSubmitKyc(@Param('did') did: string, @Body() dto: ManagerKycDto) {
    return this.managers.submitKyc(did, dto);
  }

  /** GLOS operator vetting of a fleet manager — a manager/driver token must never self-approve. */
  @Roles('operator')
  @Post('fleet/managers/:did/kyc-decision')
  managerDecideKyc(@Param('did') did: string, @Body() dto: ManagerKycDecisionDto, @Actor() actor: IntrospectionResult) {
    return this.managers.decideKyc(did, dto.approve, auditActor(actor, dto.by));
  }

  /** Record the refundable operating bond → ACTIVE — operator only (the fleet console recorded its
   * own bond before S3: a self-approval loop wired into shipped UI). */
  @Roles('operator')
  @Post('fleet/managers/:did/bond')
  managerBond(@Param('did') did: string) {
    return this.managers.recordBond(did);
  }

  @Roles('operator')
  @Post('fleet/managers/:did/suspend')
  suspendManager(@Param('did') did: string) {
    return this.managers.suspend(did);
  }

  // --- fleet: vehicles (own ID) ---

  /** Register a vehicle into the fleet (own ID; capacity computed; verified = full docs + factory ID). */
  @Post('vehicles')
  registerVehicle(@Body() dto: RegisterVehicleDto) {
    return this.vehicles.register(dto as never);
  }

  /** A fleet manager sees only their own vehicles (actor.tenant); operator sees all. */
  @Get('vehicles')
  listVehicles(@Actor() actor: IntrospectionResult, @Query('status') status?: string, @Query('class') vehicleClass?: string) {
    // Open-data marketplace list, but scoped: a fleet manager sees their own vehicles in full; a
    // non-owner sees only the public fields — never another tenant's owner id, docs, QR or photo mediaIds.
    return this.vehicles.listFor({ status: status as never, vehicleClass: vehicleClass as never, managerDid: actingTenant(actor) }, actingTenant(actor), actor?.role === 'operator');
  }

  /** The truck sub-type catalog (label + capacity + handling capabilities) for registration UIs. */
  @Get('vehicles/truck-subtypes')
  truckSubtypes() {
    return Object.entries(TRUCK_SUBTYPE_CATALOG).map(([id, s]) => ({ id, ...s }));
  }

  @Get('vehicles/:id')
  getVehicle(@Param('id') id: string, @Actor() actor: IntrospectionResult) {
    // Scope the detail to the viewer: owner/operator see the full record; others get the public
    // marketplace fields only — never the owner id, docs, dashboard QR or the S26 photo mediaIds.
    return this.vehicles.viewFor(id, actingTenant(actor), actor?.role === 'operator');
  }

  /** Upload / update registration docs — re-evaluates the verified (dispatch-priority) flag. */
  @Post('vehicles/:id/documents')
  updateVehicleDocs(@Param('id') id: string, @Body() dto: VehicleDocsDto) {
    return this.vehicles.updateDocuments(id, dto);
  }

  @Post('vehicles/:id/ground')
  groundVehicle(@Param('id') id: string) {
    return this.vehicles.ground(id);
  }

  @Post('vehicles/:id/retire')
  retireVehicle(@Param('id') id: string) {
    return this.vehicles.retire(id);
  }

  // --- fleet: drivers (own ID, staged onboarding) ---

  /** Register a driver. Bike/motorcycle → light registry (ACTIVE immediately); heavier → DRAFT + KYC. */
  @Post('drivers/onboard')
  registerDriver(@Body() dto: RegisterDriverDto) {
    return this.drivers.register(dto as never);
  }

  /** A fleet manager sees only their own drivers (actor.tenant); operator sees all. */
  @Get('fleet/drivers')
  listFleetDrivers(@Actor() actor: IntrospectionResult) {
    return this.drivers.list({ managerDid: actingTenant(actor) });
  }

  @Roles('operator')
  @Get('fleet/drivers/kyc-queue')
  driverKycQueue() {
    return this.drivers.kycQueue();
  }

  @Get('fleet/drivers/:did')
  getFleetDriver(@Param('did') did: string) {
    return this.drivers.get(did);
  }

  /** Heavy registry: upload ID + licence copy → KYC_PENDING. */
  @Post('fleet/drivers/:did/submit-kyc')
  driverSubmitKyc(@Param('did') did: string, @Body() dto: DriverKycDto) {
    return this.drivers.submitKyc(did, dto);
  }

  @Roles('operator')
  @Post('fleet/drivers/:did/kyc-decision')
  driverDecideKyc(@Param('did') did: string, @Body() dto: DriverKycDecisionDto, @Actor() actor: IntrospectionResult) {
    return this.drivers.decideKyc(did, dto.approve, auditActor(actor, dto.by));
  }

  @Roles('operator')
  @Post('fleet/drivers/:did/suspend')
  suspendDriver(@Param('did') did: string) {
    return this.drivers.suspend(did);
  }

  @Post('fleet/drivers/:did/ping')
  pingDriver(@Param('did') did: string) {
    return this.drivers.ping(did);
  }

  // --- fleet: flexible driver ↔ vehicle coupling ---

  /** Couple a driver to a vehicle (optionally on a corridor). Re-assignable. */
  @Post('fleet/drivers/:did/couple')
  couple(@Param('did') did: string, @Body() dto: CoupleDto) {
    return this.fleet.couple(did, dto.vehicleId, dto.corridorId);
  }

  @Post('fleet/drivers/:did/uncouple')
  uncouple(@Param('did') did: string) {
    return this.fleet.uncouple(did);
  }

  /** Driver starts a shift by scanning the vehicle's dashboard QR → couples them for the day. */
  @Post('fleet/drivers/:did/start-session')
  startSession(@Param('did') did: string, @Body() dto: StartSessionDto) {
    return this.fleet.startSession(did, dto.vehicleQr);
  }

  /** Driver closes the shift → decouples driver + vehicle. */
  @Post('fleet/drivers/:did/end-session')
  endSession(@Param('did') did: string) {
    return this.fleet.endSession(did);
  }

  /** The driver's current shift session (active coupling + vehicle), or { active:false } off duty. */
  @Get('fleet/drivers/:did/session')
  driverSession(@Param('did') did: string) {
    return this.fleet.sessionFor(did);
  }

  @Post('fleet/drivers/:did/assign-corridor')
  assignDriverCorridor(@Param('did') did: string, @Body() dto: AssignCorridorDto) {
    return this.fleet.assignCorridor(did, dto.corridorId);
  }

  @Get('fleet/assignments')
  listAssignments(@Query('status') status?: string) {
    return this.fleet.list({ status: status as never });
  }

  // --- PUDO outbound totes + the dispatch marketplace (opportunistic line-haul) ---

  /** Register a fresh tote at a PUDO so the agent can bag outbound parcels for a destination MDP. */
  @Post('agents/:did/totes')
  registerAgentTote(@Param('did') did: string) {
    this.agents.get(did); // 404 if unknown
    return this.totes.register(did);
  }

  /** Publish a filling tote to the claim marketplace early (before it is full / 24 h). */
  @Post('totes/:code/release')
  releaseTote(@Param('code') code: string) {
    return this.dispatch.release(code);
  }

  /** Sweep: publish every tote that is full or has waited ≥ 24 h. */
  @Post('dispatch/publish-ready')
  publishReady() {
    return { published: this.dispatch.publishReady() };
  }

  /** Register a bulk freight job (trucks only) into the same marketplace as totes. */
  @Post('dispatch/freight')
  registerFreight(@Body() dto: RegisterFreightDto) {
    return this.dispatch.registerFreight(dto);
  }

  @Get('dispatch/freight')
  listFreight(@Query('status') status?: string) {
    return this.dispatch.listFreight({ status: status as never });
  }

  /** Bulk freight pickup (claimed → in_transit). driverDid (the claimer) is verified against claimedBy. */
  @Post('dispatch/freight/:id/pickup')
  freightPickup(@Param('id') id: string, @Body() dto: FreightActionDto) {
    return this.dispatch.pickupFreight(id, dto.driverDid, { confirmed: dto.confirmed, securementPhotoId: dto.securementPhotoId });
  }

  /** Bulk freight delivery (in_transit → delivered; releases the driver's reserved capacity). */
  @Post('dispatch/freight/:id/deliver')
  freightDeliver(@Param('id') id: string, @Body() dto: FreightActionDto) {
    return this.dispatch.deliverFreight(id, dto.driverDid, { confirmed: dto.confirmed });
  }

  /** S33b — log a temperature reading for a cold-chain freight in transit (a breach flags it for the tower). */
  @Post('dispatch/freight/:id/temperature')
  freightTemp(@Param('id') id: string, @Body() dto: RecordTempDto) {
    return this.dispatch.recordTemp(id, dto.celsius, dto.driverDid);
  }

  // --- F3: consolidation consignments (durable dry commodities) — the bulk analogue of totes ---

  /** F3 — a cooperative opens a consolidation LOT for a durable dry commodity: members deposit toward a
   *  truckload, and when it is full or aged it posts itself as one bulk freight (off-platform, like an F2
   *  counter freight). Owner-scoped: the acting agent (operator may override) is the aggregating PUDO, and its
   *  site is the freight's pickup. A perishable commodity is refused here — it books freight directly. */
  @Post('consignments')
  openConsignment(@Body() dto: OpenConsignmentDto, @Actor() actor: IntrospectionResult) {
    const ownerDid = actingDid(actor, dto.ownerDid);
    const owner = this.agents.get(ownerDid); // 404 if the acting id is not an agent
    // The dest is a hand-named market (rarely a network PUDO), so backfill its coordinates by geocoding the
    // label when a pin isn't given — otherwise the eventual haul would price at zero trip distance (the driver
    // hauls the full route but is paid only the deadhead). A gazetteer fallback still beats no coordinate.
    const destLocation = dto.destLocation ?? (dto.destLabel.trim() ? this.geocoder.geocode(dto.destLabel).location : undefined);
    return this.consignments.open({
      ownerDid,
      natureCode: dto.natureCode,
      pickupLabel: owner.shopName,
      pickupLocation: owner.location,
      destLabel: dto.destLabel,
      destLocation,
      targetKg: dto.targetKg,
      maxSpend: dto.maxSpend,
    });
  }

  /** F3 — record a member deposit into a lot (auto-posts the freight the moment the lot fills). Owner-scoped
   *  to the lot's owner (403 for another shop). */
  @Post('consignments/:code/deposit')
  depositConsignment(@Param('code') code: string, @Body() dto: ConsignmentDepositDto, @Actor() actor: IntrospectionResult) {
    const lot = this.consignments.requireByCode(code); // 404 unknown
    this.assertAgentOwner(lot.ownerDid, actor);
    return this.consignments.deposit(code, dto.memberRef, dto.weightKg);
  }

  /** F3 — a cooperative's own consolidation lots (owner-scoped; an operator must name the owner). */
  @Get('consignments')
  @ApiQuery({ name: 'owner', required: false })
  @ApiQuery({ name: 'status', required: false })
  listConsignments(@Query('owner') owner: string, @Query('status') status: string, @Actor() actor: IntrospectionResult) {
    const ownerDid = actingDid(actor, owner);
    this.assertAgentOwner(ownerDid, actor);
    return this.consignments.list({ ownerDid, status: status as never });
  }

  /** F3 — sweep: post every full/aged lot to the marketplace (operator-triggered; a cron would call this). */
  @Roles('operator')
  @Post('consignments/publish-ready')
  publishReadyConsignments() {
    return { posted: this.consignments.publishReadyConsignments() };
  }

  /** A driver declares a route A→B → the platform suggests the loads sitting on the way. */
  @Post('fleet/drivers/:did/suggest-work')
  suggestWork(@Param('did') did: string, @Body() dto: SuggestRouteDto) {
    const offers = this.dispatch.suggest(did, dto, Date.now(), dto.minEarn); // S34c — the driver's min-earning filter
    this.fleet.reportLocation(did, dto.from); // the driver is at the route start → live map
    return { remainingCapacityKg: this.dispatch.remainingCapacity(did), offers };
  }

  /** Driver GPS heartbeat — updates the vehicle's position on the live fleet map. */
  @Post('fleet/drivers/:did/locate')
  locate(@Param('did') did: string, @Body() dto: LocateDto) {
    const a = this.fleet.reportLocation(did, dto);
    return { located: Boolean(a), location: a?.location };
  }

  /** Fleet-manager dashboard: vehicle/driver/session counts, working hours, live positions + cargo.
   * A fleet manager sees ONLY their own fleet (actor.tenant); the ?manager= scope and the omit-for-all
   * view are operator-only. Before S3 anyone could pass ?manager= to read a competitor's fleet. */
  @Get('fleet/dashboard')
  fleetDashboard(@Actor() actor: IntrospectionResult, @Query('manager') managerQuery?: string) {
    const managerDid = actingTenant(actor, managerQuery);
    const overview = this.fleet.overview(managerDid);
    const driverDids = managerDid ? new Set(this.drivers.list().filter((d) => d.managerDid === managerDid).map((d) => d.did)) : undefined;
    const cargo = this.dispatch.activeCargo(driverDids);
    const items = cargo.items.map((c) => ({ ...c, driver: this.driverNameOf(c.driverDid) }));
    return { managerDid: managerDid ?? null, ...overview, cargo: { ...cargo, items } };
  }

  private driverNameOf(did: string): string {
    try { return this.drivers.get(did).displayName; } catch { return '—'; }
  }

  @Get('fleet/drivers/:did/offers')
  driverOffers(@Param('did') did: string) {
    return this.dispatch.activeOffersFor(did);
  }

  @Get('fleet/drivers/:did/claims')
  driverClaims(@Param('did') did: string) {
    return { remainingCapacityKg: this.dispatch.remainingCapacity(did), claims: this.dispatch.claimsFor(did) };
  }

  /** A driver's JOBS + EARNINGS register (R5): the dedicated-freight hauls they claimed, server-side searched /
   *  filtered / sorted / paginated → { items, total }. Each row carries the driver's agreed earning (lockedPrice)
   *  and whether it has been paid. Owner-scoped (403 for another driver). */
  @Scopes('driver:read:self')
  @Get('fleet/drivers/:did/jobs')
  driverJobs(@Param('did') did: string, @Query() query: DriverJobsQueryDto, @Actor() actor: IntrospectionResult) {
    this.assertDriverOwner(did, actor);
    return this.dispatch.driverJobsPage(did, query);
  }

  /** Running totals (earned / paid / unpaid / delivered / count) for the current filter. Owner-scoped. */
  @Scopes('driver:read:self')
  @Get('fleet/drivers/:did/jobs/summary')
  driverJobsSummaryRoute(@Param('did') did: string, @Query() query: DriverJobsQueryDto, @Actor() actor: IntrospectionResult) {
    this.assertDriverOwner(did, actor);
    return this.dispatch.driverJobsSummary(did, query);
  }

  /** Export the whole matching set (every page, current filters) as CSV — the driver's OWN earnings export. Owner-scoped. */
  @Scopes('driver:read:self')
  @Get('fleet/drivers/:did/jobs/export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="jobs.csv"')
  driverJobsExport(@Param('did') did: string, @Query() query: DriverJobsQueryDto, @Actor() actor: IntrospectionResult): string {
    this.assertDriverOwner(did, actor);
    return this.dispatch.driverJobsCsv(did, query);
  }

  /** Driver accepts a suggestion → reserves the load + its weight against the vehicle's capacity. */
  @Post('dispatch/offers/:id/claim')
  claimOffer(@Param('id') id: string) {
    return this.dispatch.claim(id);
  }

  /** Driver declines a suggestion. */
  @Post('dispatch/offers/:id/ignore')
  ignoreOffer(@Param('id') id: string) {
    return this.dispatch.ignore(id);
  }
}
