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
import { RatingService, belowFloor } from './rating.service';
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
import { FreightBoardResponse, FreightProposalsResponse, PostedFreightResponse } from './dispatch.types';
import { MarketPulseService } from './market-pulse.service';
import { CargoService } from './cargo.service';
import { FleetManagerService } from './fleet-manager.service';
import { AccountService } from './account.service';
import { OtpService } from './otp.service';
import { PersonService } from './person.service';
import { TRUCK_SUBTYPE_CATALOG } from './fleet.config';
import { AcceptParcelDto, BookFreightDto, OpenConsignmentDto, ConsignmentDepositDto, ArriveDto, AssignCorridorDto, AssignNodeDto, AssignToteDto, AvailabilityDto, CheckoutDto, ClassifyDto, CollectDto, CorridorDto, CorridorStatusDto, BagBaysDto, CollectionPointDto, OpenDockBagDto, DeclineOfferDto, CoupleDto, DeclareAreaDto, DeclareLegDto, SnoozeDto, SuggestNearbyDto, DisputeDto, DriverDto, DriverKycDecisionDto, DriverKycDto, DriverPayoutDto, DropBagDto, EntityFeeDto, OpenBagDto, SealBagDto, FillToteDto, HandoverDto, InboundOrderDto, IntakeDto, CancelParcelDto, ForgotDto, KycDecisionDto, LoadBagDto, LocateDto, LoginDto, ManagerKycDecisionDto, ManagerKycDto, ManagerLoginDto, PhoneRequestDto, PhoneVerifyDto, ReceiveBagDto, ResetDto, SignupDto, PickupDto, PlanJourneyDto, RateDto, RateDriverDto, ReissueReleaseDto, RegisterAgentDto, RegisterDriverDto, RegisterFleetManagerDto, RegisterFreightDto, RegisterMdpDto, RegisterVehicleDto, RegisterVendorDto, SetHoursDto, SetLocationDto, SetPriceDto, SetFxRateDto, IssueApiKeyDto, ShelfDto, ShopfrontDto, ShelveDto, SortParcelDto, StartSessionDto, SubmitKycDto, SuggestRouteDto, SurgeRuleDto, TopUpDto, UpdateVendorDto, VendorLoginDto, VehicleDocsDto, VoidDto, FreightActionDto, FreightBoardQueryDto, ProposeFreightDto, WithdrawProposalDto, RecordTempDto, VendorOrdersQueryDto, VendorLedgerQueryDto, AgentParcelsQueryDto, AgentLedgerQueryDto, DriverJobsQueryDto } from './pudo.dto';
import { classifySize, NETWORK_CURRENCY, SIZE_WEIGHT_KG } from './pudo.config';
import { EntityService } from '../../foundation/entity/entity.service';
import { BooksService } from '../../foundation/books/books.service';
import { FX_BASE, FX_RATE_MAX_AGE_H, FxService } from '../../foundation/money/fx.service';
import { BagPlanService } from './bag-plan.service';
import { ForthcomingService } from './forthcoming.service';
import { DockService } from './dock.service';
import { ApiKeyService } from './api-key.service';
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
    private readonly entities: EntityService,
    private readonly fx: FxService,
    private readonly apiKeys: ApiKeyService,
    private readonly books: BooksService,
    private readonly bagPlans: BagPlanService,
    private readonly forthcoming: ForthcomingService,
    private readonly vendors: VendorService,
    private readonly dock: DockService,
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

  /**
   * Where this network can actually operate — one entry per country with a daughter company behind it.
   *
   * Public on purpose, and the counterpart of the open-data rates: a shop deciding whether to sign up, a
   * store wondering whether we reach its customers, and (soon) a vendor integrating the shipping API all
   * ask the same question first — and the sign-up wizard needs it before anyone can choose. It is derived
   * from the sisters rather than listed, so a country cannot appear here that nobody could lawfully
   * invoice in. Structural only: which country, what it is called, what it settles in. The entity's own id
   * is the shape of the business and stays behind GET /entities, which is operator-only.
   */
  @Public()
  @Get('countries')
  countries() {
    return this.entities.sisters().map((e) => ({ country: e.jurisdiction, name: e.name, currency: e.currency }));
  }

  /**
   * The rate book every cross-border price stands on: one rate per currency against the base, with when
   * it was taken and who from. Operator-only — not because it is a secret, but because a rate with no
   * context invites being read as a promise; what a customer sees is the rate ON THEIR QUOTE.
   */
  @Roles('operator')
  @Get('fx')
  fxRates() {
    return { base: FX_BASE, maxAgeHours: FX_RATE_MAX_AGE_H, rates: this.fx.rates() };
  }

  /**
   * Push a rate. This is the door a live feed comes through — the same one an operator uses by hand when
   * the feed is down, which is deliberate: there is one way a rate enters the system, and it is recorded
   * with its source either way.
   */
  @Roles('operator')
  @Post('fx')
  setFxRate(@Body() dto: SetFxRateDto) {
    return this.fx.setRate(dto.currency, dto.perBase, dto.source?.trim() || 'operator');
  }

  /**
   * The group and its sister companies — who is registered where, and which of them may transact.
   * Operator-only: it is the shape of the business, not a public directory. Structural facts only;
   * no balances, no accounts (those belong to the sisters' books, which do not exist yet).
   */
  @Roles('operator')
  @Get('entities')
  listEntities() {
    return this.entities.list().map((e) => ({ ...e, holdsCustody: this.entities.canHoldCustody(e.entityId) }));
  }

  /**
   * A sister's books: the trial balance, whether it balances, and the coverage read — money held against
   * money owed. Operator-only, and the closest thing the network has to an answer for "are we solvent",
   * which could not even be ASKED before the postings existed.
   */
  @Roles('operator')
  @Get('entities/:entityId/books')
  entityBooks(@Param('entityId') entityId: string) {
    return {
      entityId,
      accounts: this.books.trialBalance(entityId),
      integrity: this.books.balances(entityId),
      coverage: this.books.coverage(entityId),
    };
  }

  /**
   * Turn a sister's margin knob. Operator-gated today because there is no per-sister admin role yet —
   * when there is, this is the endpoint it owns, scoped to its own entity and nobody else's.
   *
   * It reprices nothing already quoted: every parcel carries the rate it was minted at.
   */
  @Roles('operator')
  @Post('entities/:entityId/fee')
  setEntityFee(@Param('entityId') entityId: string, @Body() dto: EntityFeeDto) {
    return this.entities.setFeePct(entityId, dto.feePct);
  }

  /**
   * What a margin change actually did. Not just what each rate earned — that half is arithmetic — but
   * what happened to the NUMBER of shipments after it, which can only be observed. Read as a timeline of
   * spells, so a rate raised and then lowered again shows as two separate periods to compare.
   */
  @Roles('operator')
  @Get('entities/:entityId/rate-impact')
  entityRateImpact(@Param('entityId') entityId: string) {
    const entity = this.entities.get(entityId);
    return { entityId, currency: entity.currency, currentPct: this.entities.feePctOf(entityId), ...this.parcels.rateImpact(entityId) };
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

  /** Declare the floor room for outbound BAGS — the shelf's counterpart for the other pile in the room. */
  @Post('agents/:did/bag-bays')
  setBagBays(@Param('did') did: string, @Body() dto: BagBaysDto, @Actor() actor: IntrospectionResult) {
    return this.agents.setBagBays(actingDid(actor, did), dto.bays);
  }

  /** Move the shop's map pin (My-shop location editor). */
  @Post('agents/:did/location')
  setLocation(@Param('did') did: string, @Body() dto: SetLocationDto) {
    return this.agents.setLocation(did, { lat: dto.lat, lng: dto.lng });
  }

  /** Set (or clear) the shop-front photo shown on the My-shop dashboard. */
  @Post('agents/:did/shopfront')
  setShopfront(@Param('did') did: string, @Body() dto: ShopfrontDto) {
    return this.agents.setShopfront(did, dto.mediaId);
  }

  /**
   * What this shop should be bagging: its waiting parcels grouped by NEXT HOP, plus the bags it already
   * has open. Several bags at once is the normal case — direct-to-Addis alongside one for the local hub.
   */
  @Get('agents/:did/bag-plan')
  bagPlan(@Param('did') did: string, @Actor() actor: IntrospectionResult) {
    return this.bagPlans.forShop(actingDid(actor, did));
  }

  /** Drop a waiting parcel into the shop's bag — refuses one that is going somewhere else. */
  @Post('agents/:did/totes/:code/fill')
  fillShopBag(@Param('did') did: string, @Param('code') code: string, @Body() dto: FillToteDto, @Actor() actor: IntrospectionResult) {
    return this.mdps.fillShopBag(code, actingDid(actor, did), dto.parcelId);
  }

  /** Seal the bag — where the completeness gate lives for a bagged hand-over (see sealShopBag). */
  @Post('agents/:did/totes/:code/seal')
  sealShopBag(@Param('did') did: string, @Param('code') code: string, @Body() dto: SealBagDto, @Actor() actor: IntrospectionResult) {
    return this.mdps.sealShopBag(code, actingDid(actor, did), dto);
  }

  /** The shelf grid + free-slot availability for a PUDO. */
  @Get('agents/:did/shelf')
  getShelf(@Param('did') did: string) {
    return { grid: this.shelf.grid(did), capacity: this.shelf.capacity(did), available: this.shelf.available(did) };
  }

  // `currency` travels with every balance that leaves the system: a bare number is ambiguous the moment
  // a second currency exists anywhere in the network, and that is a change nobody remembers to audit for.
  @Get('agents')
  listAgents() {
    return this.agents.list().map((a) => ({ ...a, balance: this.agents.balance(a.did), currency: NETWORK_CURRENCY, rating: this.ratings.agentRating(a.did), freeSlots: this.shelf.available(a.did), capacity: this.shelf.capacity(a.did) }));
  }

  @Get('agents/:did')
  getAgent(@Param('did') did: string) {
    const a = this.agents.get(did);
    return { ...a, balance: this.agents.balance(did), currency: NETWORK_CURRENCY, rating: this.ratings.agentRating(did) };
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
      postedByDid: agentDid, // FB0c — the booking shop negotiates for it, even though the cash settles off-platform
      commitMode: dto.commitMode,
      // FB2c — the two facts only a person standing at the load can supply. They reach canonicalBody() inside
      // registerFreight, so the body stamped on this load is derived from what the counter actually saw.
      indivisible: dto.indivisible,
      bodyHint: dto.bodyHint as never,
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

  /** DT — the printable label for a parcel (reprint). The label no longer carries any release secret (it
   *  prints the public tracking key and the creation date), but reprinting someone's parcel label is still
   *  a support action rather than a public one, so it stays operator-only. */
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

  /* --- a vendor's own collection point: OUTBOUND ONLY (see CollectionPoint) --- */

  /**
   * Turn the store's own address into a place the network collects from — a saved drop-off trip, and one
   * handover fewer for the goods. It grants exactly one power: a driver may be sent here for a sealed bag.
   * It is NOT a PUDO — no shelf, no release, never a destination, and no intake fee, because nobody takes
   * in a box its own owner packed.
   */
  @Scopes('vendor:manage:self')
  @Post('vendors/:id/collection-point')
  setCollectionPoint(@Param('id') id: string, @Body() dto: CollectionPointDto, @Actor() actor: IntrospectionResult) {
    this.assertVendorOwner(id, actor);
    return VendorService.publicView(this.vendors.setCollectionPoint(id, dto));
  }

  /* --- merchant API keys: who the shipping API sees when this store calls it --- */

  /**
   * Mint a key. The SECRET is in this response and in no other, ever — see ApiKeyService.
   *
   * A store issues its own, as many as it likes: one per environment, one per storefront, one to rotate
   * into before revoking the old. Keys being cheap is what makes revoking one an easy decision.
   */
  @Scopes('vendor:manage:self')
  @Post('vendors/:id/api-keys')
  issueApiKey(@Param('id') id: string, @Body() dto: IssueApiKeyDto, @Actor() actor: IntrospectionResult) {
    this.assertVendorOwner(id, actor);
    this.vendors.get(id); // 404 on an unknown store before anything is minted
    const { key, secret } = this.apiKeys.issue(id, dto.kind, dto.mode ?? 'test', dto.label);
    // `secret` is the only place the full value appears. The stored record is a hash for a secret key.
    return { ...this.apiKeys.list(id).find((k) => k.keyId === key.keyId)!, secret };
  }

  /** This store's keys, in a shape safe to render — never a secret, not even to its owner. */
  @Scopes('vendor:read:self')
  @Get('vendors/:id/api-keys')
  listApiKeys(@Param('id') id: string, @Actor() actor: IntrospectionResult) {
    this.assertVendorOwner(id, actor);
    return this.apiKeys.list(id);
  }

  /** Stop a key working. Kept rather than deleted, so "what was that key doing" stays answerable. */
  @Scopes('vendor:manage:self')
  @Delete('vendors/:id/api-keys/:keyId')
  revokeApiKey(@Param('id') id: string, @Param('keyId') keyId: string, @Actor() actor: IntrospectionResult) {
    this.assertVendorOwner(id, actor);
    return this.apiKeys.revoke(id, keyId);
  }

  /** Stop collecting here. Bags already claimed stay with the drivers who claimed them. */
  @Scopes('vendor:manage:self')
  @Delete('vendors/:id/collection-point')
  clearCollectionPoint(@Param('id') id: string, @Actor() actor: IntrospectionResult) {
    this.assertVendorOwner(id, actor);
    return VendorService.publicView(this.vendors.clearCollectionPoint(id));
  }

  /** What this dock should be bagging: paid parcels grouped by destination, plus the bags already open. */
  @Scopes('vendor:read:self')
  @Get('vendors/:id/dock')
  dockPlan(@Param('id') id: string, @Actor() actor: IntrospectionResult) {
    this.assertVendorOwner(id, actor);
    return this.dock.plan(id);
  }

  @Scopes('vendor:manage:self')
  @Post('vendors/:id/dock/bags')
  openDockBag(@Param('id') id: string, @Body() dto: OpenDockBagDto, @Actor() actor: IntrospectionResult) {
    this.assertVendorOwner(id, actor);
    return this.dock.openBag(id, dto.destZone);
  }

  @Scopes('vendor:manage:self')
  @Post('vendors/:id/dock/bags/:code/fill')
  fillDockBag(@Param('id') id: string, @Param('code') code: string, @Body() dto: FillToteDto, @Actor() actor: IntrospectionResult) {
    this.assertVendorOwner(id, actor);
    return this.dock.fillBag(code, id, dto.parcelId);
  }

  /** Close the bag: the store's commitment, and the moment drivers near the dock are told it is ready. */
  @Scopes('vendor:manage:self')
  @Post('vendors/:id/dock/bags/:code/seal')
  sealDockBag(@Param('id') id: string, @Param('code') code: string, @Body() dto: SealBagDto, @Actor() actor: IntrospectionResult) {
    this.assertVendorOwner(id, actor);
    return this.dock.sealBag(code, id, dto ?? {});
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
      // Which country the shop stands in — already implied by its pin, and needed explicitly so a sign-up
      // can suggest the areas of the country somebody is joining rather than every area on the network.
      country: this.agents.countryOf(a),
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
    // Where does this shipment START? Either a drop-off PUDO the store names, or — when it names none and
    // has a collection point — its own dock. The dock is a place on the route, not a node of the network,
    // so the quote carries no origin node fee: nobody handled the parcel, so nobody is owed for handling
    // it. The margin then belongs to the store's own sister, which is who is selling the shipment.
    const dock = dto.originPudoDid ? undefined : this.vendors.requireCollection(dto.vendorId);
    const quote = dock
      ? this.routing.quoteShipmentFrom(
          { type: 'dock', id: vendor.did, label: dock.label, zone: dock.zone, country: this.vendors.dockCountryOf(vendor), location: dock.location },
          destPudoDid,
          size,
          this.vendors.entityIdOf(vendor),
        )
      : this.routing.quoteShipment(dto.originPudoDid!, destPudoDid, size);
    const result = this.parcels.createInbound({
      vendorId: dto.vendorId,
      externalOrderId: dto.externalOrderId ?? handoff?.externalOrderId,
      originAgentDid: dto.originPudoDid,
      originZone: dock?.zone,
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

  /**
   * Control tower: rotate a parcel's burned release secret so a locked-out customer can still collect.
   * Operator-only — this is the recovery authority behind every "ask the control tower to reissue".
   * The new inbound collection code is never returned here; it reaches the buyer's app + the vendor.
   */
  @Roles('operator')
  @Post('parcels/:id/reissue-release')
  reissueRelease(@Param('id') id: string, @Body() dto: ReissueReleaseDto, @Actor() actor: IntrospectionResult) {
    return this.parcels.reissueRelease(id, auditActor(actor, dto.by));
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
   * REP2 — an AGENT rates a DRIVER on the movement leg (pickup punctuality, on-time / after-hours arrival,
   * overnight holds, care, equipment). The acting agent is pinned to its token (operator may override). Gated
   * on a REAL interaction: the agent must have handed to / received from this driver (a badge is not secret, so
   * "knowing it" is not enough). One rating per agent↔driver pair, last-wins.
   */
  @Post('drivers/:did/rate')
  rateDriver(@Param('did') did: string, @Body() dto: RateDriverDto, @Actor() actor: IntrospectionResult) {
    const agentDid = actingDid(actor, dto.agentDid);
    this.agents.get(agentDid); // the rater must be an agent (404 otherwise)
    this.assertServedByDriver(did, agentDid, actor); // verified-interaction gate (operator bypasses)
    return this.ratings.rateDriver({ driverDid: did, byAgentDid: agentDid, stars: dto.stars, issues: dto.issues });
  }

  /** REP2 gate — the agent may rate a driver only for a real handover/receipt: a parcel this shop took in or
   *  handed out that this driver actually carried (its driverBadgeId matches the driver's badge). Prevents a
   *  shop trashing a driver it never dealt with. Operator bypasses (it acts on the network's behalf). */
  private assertServedByDriver(driverDid: string, agentDid: string, actor?: IntrospectionResult): void {
    const driver = this.drivers.get(driverDid); // 404 on an unknown driver
    if (actor?.role === 'operator') return;
    const badge = driver.badgeId;
    const served = Boolean(badge) && this.parcels.list({}).some((p) => p.driverBadgeId === badge && (p.originAgentDid === agentDid || p.destAgentDid === agentDid));
    if (!served) throw new GlosError('FORBIDDEN', 'You can only rate a driver you have handed parcels to or received a bag from');
  }

  /**
   * REP1 — a provider's PUBLIC reputation profile: a PII-free trust surface (name, zone, pin, the aggregate
   * stars + count, a "new" flag below the min-ratings floor, and serving-since). @Public for the same
   * open-data reasoning as /network/points — nothing operational (no balance, device, vault refs or PII)
   * leaves here, and the agent's did + shop name + zone + pin are already public there. Agents only for now;
   * drivers/fleet/MDP get profiles in later reputation slices (this 404s a non-agent did until then).
   */
  /**
   * REP4 — the operator's reputation-review queue: every provider whose RELIABLE rating has fallen below the
   * enforcing floor (a driver is already barred from freight; an agent has no auto-consequence yet, so the
   * operator acts). Declared BEFORE reputation/:did so the static path wins over the :did param. Operator-only —
   * it names underperformers, which the public profiles never rank.
   */
  @Roles('operator')
  @Get('reputation/review')
  reputationReview() {
    const drivers = this.drivers
      .list({})
      .map((d) => ({ did: d.did, kind: 'driver' as const, name: d.displayName, rating: this.ratings.driverRating(d.did) }))
      .filter((x) => belowFloor(x.rating));
    const agents = this.agents
      .list()
      .map((a) => ({ did: a.did, kind: 'agent' as const, name: a.shopName, rating: this.ratings.agentRating(a.did) }))
      .filter((x) => belowFloor(x.rating));
    return { belowFloor: [...drivers, ...agents] };
  }

  @Public()
  @Get('reputation/:did')
  reputationProfile(@Param('did') did: string) {
    // A rated provider is an AGENT (REP1), a DRIVER (REP2), a FLEET or an MDP hub (REP3). Resolve across the
    // registries; 404 only if the did is none. Every surface is PII-free (shop/driver/company name, zone/pin —
    // never a national ID, licence or phone).
    const agent = this.agents.list().find((a) => a.did === did);
    if (agent) {
      return { did: agent.did, kind: 'agent' as const, name: agent.shopName, zone: agent.zone, location: agent.location, rating: this.ratings.agentRating(agent.did), since: agent.createdAt };
    }
    const driver = this.drivers.list({}).find((x) => x.did === did);
    if (driver) {
      return { did: driver.did, kind: 'driver' as const, name: driver.displayName, rating: this.ratings.driverRating(driver.did), since: driver.createdAt };
    }
    // REP3 — a FLEET's DERIVED rating: the count-weighted aggregate of the drivers it fields.
    const fleet = this.managers.list().find((m) => m.did === did);
    if (fleet) {
      const driverDids = this.drivers.list({ managerDid: fleet.did }).map((x) => x.did);
      return { did: fleet.did, kind: 'fleet' as const, name: fleet.companyName, rating: this.ratings.fleetRating(fleet.did, driverDids), memberCount: driverDids.length, since: fleet.createdAt };
    }
    // REP3 — an MDP hub's DERIVED operational scorecard (on-time / dwell), not a star rating: hubs earn a
    // reputation by moving parcels through fast, not by being rated.
    const mdp = this.mdps.list().find((m) => m.did === did);
    if (mdp) {
      return { did: mdp.did, kind: 'mdp' as const, name: mdp.name, scorecard: this.monitor.mdpScorecard(mdp.mdpId) };
    }
    throw new GlosError('NOT_FOUND', 'No rated provider with that id');
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
    return this.mdps.assignTote(code, dto.destinationNodeId, dto.destinationLabel);
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
    const driver = this.drivers.get(did);
    // REP4 — the driver's own rating + whether it has fallen below the enforcing floor, so the app can explain
    // WHY freight vanished (rather than the driver seeing an empty marketplace with no reason).
    const rating = this.ratings.driverRating(did);
    return { ...driver, rating, freightPaused: belowFloor(rating) };
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
    return this.fleet.couple(did, dto.vehicleId, dto.corridorId, dto.leg);
  }

  @Post('fleet/drivers/:did/uncouple')
  uncouple(@Param('did') did: string) {
    return this.fleet.uncouple(did);
  }

  /** Driver starts a shift by scanning the vehicle's dashboard QR → couples them for the day. */
  @Post('fleet/drivers/:did/start-session')
  startSession(@Param('did') did: string, @Body() dto: StartSessionDto) {
    // Naming a vehicle they have driven before is the same act as scanning it — the coupling rules (licence,
    // usable vehicle, nobody else on it) are what actually protect this, and they run either way.
    if (dto.vehicleId?.trim()) return this.fleet.couple(did, dto.vehicleId.trim(), undefined, dto.leg);
    if (!dto.vehicleQr?.trim()) throw new GlosError('FIELD_REQUIRED', 'Scan the vehicle QR, or pick one you have driven before');
    return this.fleet.startSession(did, dto.vehicleQr, dto.leg);
  }

  /** The vehicles this driver has driven before — the "which one today?" list, before they reach the yard. */
  @Get('fleet/drivers/:did/vehicles')
  driverVehicles(@Param('did') did: string) {
    return { vehicles: this.fleet.recentVehicles(did) };
  }

  /**
   * Say (or re-say) where this shift is going. Re-declaring mid-shift is the normal case: a driver who has
   * reached Addis turns round, and the loads worth telling them about are now the ones on the road back.
   */
  @Post('fleet/drivers/:did/leg')
  declareLeg(@Param('did') did: string, @Body() dto: DeclareLegDto) {
    return this.fleet.declareLeg(did, dto);
  }

  /** The roads this driver has run before — offered instead of making them name two places every morning. */
  @Get('fleet/drivers/:did/legs')
  driverLegs(@Param('did') did: string) {
    return { legs: this.fleet.recentLegs(did) };
  }

  /**
   * Declare a PATCH instead of a road: "I take work within this many km of me". For a bike or a bajaj there
   * is no corridor to name — there is a district, and it moves with them.
   */
  @Post('fleet/drivers/:did/area')
  declareArea(@Param('did') did: string, @Body() dto: DeclareAreaDto) {
    return this.fleet.declareArea(did, dto.radiusKm);
  }

  /**
   * Hold new offers for a while — lunch, a fare of their own, a puncture, the last hour of a long day.
   * Stops NEW work only: whatever they are already carrying is still theirs to hand over and deliver.
   */
  @Post('fleet/drivers/:did/snooze')
  snoozeWork(@Param('did') did: string, @Body() dto: SnoozeDto) {
    return this.fleet.snooze(did, dto.minutes);
  }

  /** Take work again, now. */
  @Post('fleet/drivers/:did/resume')
  resumeWork(@Param('did') did: string) {
    return this.fleet.resume(did);
  }

  /** Find work AROUND me rather than along a road — the same marketplace, matched by distance. */
  @Post('fleet/drivers/:did/suggest-nearby')
  suggestNearby(@Param('did') did: string, @Body() dto: SuggestNearbyDto) {
    this.fleet.reportLocation(did, dto.at); // where they say they are IS their live position
    const offers = this.dispatch.suggestNearby(did, dto.at, dto.radiusKm, Date.now(), dto.minEarn);
    return {
      remainingCapacityKg: this.dispatch.remainingCapacity(did),
      remainingTotes: this.dispatch.remainingTotes(did),
      offers,
      expected: [], // a consolidation lot is a truckload — never a patch rider's work
      freightPaused: belowFloor(this.ratings.driverRating(did)),
    };
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

  /**
   * Register a fresh tote at a PUDO so the agent can bag outbound parcels.
   *
   * With a `destZone` the bag is opened AND addressed in one step, which is what a counter actually
   * needs — a bag with no destination cannot take a parcel, so making the shop do it in two calls only
   * created a state where the bag exists and is useless. Without one, the original register-only
   * behaviour is unchanged.
   */
  @Post('agents/:did/totes')
  registerAgentTote(@Param('did') did: string, @Body() dto: OpenBagDto) {
    // Every field is optional, so a bodyless call still means "just a bare tote" — and unlike a union
    // type, this one the schema emitter can actually describe.
    if (dto?.destZone) return this.mdps.openShopBag(did, dto.destZone);
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
  registerFreight(@Body() dto: RegisterFreightDto, @Actor() actor: IntrospectionResult) {
    // FB0b — the DTO carries dimensions as {l,w,h} (the shape every other measured route uses); the service
    // takes the orientation-free tuple. Convert here, as createInbound/accept already do.
    const dimensionsCm: [number, number, number] | undefined = dto.dimensionsCm ? [dto.dimensionsCm.l, dto.dimensionsCm.w, dto.dimensionsCm.h] : undefined;
    // FB0c — whoever posted it is who negotiates for it. Read straight off the actor rather than through
    // actingDid: a bulletin freight posted with no identity legitimately has no owner, and must not 403 here.
    return this.dispatch.registerFreight({ ...dto, dimensionsCm, bodyHint: dto.bodyHint as never, excludedBodies: dto.excludedBodies as never, postedByDid: actor?.did });
  }

  @Get('dispatch/freight')
  listFreight(@Query('status') status?: string) {
    return this.dispatch.listFreight({ status: status as never });
  }

  /**
   * FB1 — the open freight board: the whole market from where the operator is standing.
   *
   * Every load an operator cannot take comes back MARKED rather than removed, because the loads you cannot
   * take are the ones that tell you what to buy. `radiusKm` is the OPERATOR's own filter — omit it and the
   * answer is the entire market, with no 15 km clamp anywhere near it (that number governs interruptions,
   * and browsing is not an interruption).
   */
  @Get('dispatch/board')
  freightBoard(@Query() q: FreightBoardQueryDto, @Actor() actor: IntrospectionResult): FreightBoardResponse {
    // Judged against the caller's own vehicle unless an operator names someone else's.
    const driverDid = actor?.role === 'operator' ? q.driverDid : (q.driverDid ?? actor?.did);
    const items = this.dispatch.board({ driverDid, from: { lat: Number(q.lat), lng: Number(q.lng) }, radiusKm: q.radiusKm });
    return { items, total: items.length };
  }

  /* ------------------------------------------- FB0c: negotiate before commit -- */

  /**
   * FB2b — the loads this shop or vendor posted, each with how many prices are waiting for an answer.
   *
   * Scoped at the source, never by filtering the public list: an operator may name another party, everyone
   * else is pinned to their own token.
   */
  @Get('dispatch/posted')
  postedFreight(@Query('did') did: string | undefined, @Actor() actor: IntrospectionResult): PostedFreightResponse {
    return { items: this.dispatch.postedBy(actingDid(actor, did)) };
  }

  /** A driver names their price for a load posted 'negotiate'. Reserves nothing — the poster's accept claims it. */
  @Post('dispatch/freight/:id/proposals')
  proposeForFreight(@Param('id') id: string, @Body() dto: ProposeFreightDto, @Actor() actor: IntrospectionResult) {
    return this.dispatch.propose({ freightId: id, driverDid: actingDid(actor, dto.driverDid), from: dto.from, price: dto.price, note: dto.note });
  }

  /** The prices offered on a load. Restricted to the side that can act on them — the poster, or an operator. */
  @Get('dispatch/freight/:id/proposals')
  listFreightProposals(@Param('id') id: string, @Actor() actor: IntrospectionResult): FreightProposalsResponse {
    this.requireNegotiator(id, actor);
    return { items: this.dispatch.proposalsFor(id) };
  }

  /** The poster takes a price — and that acceptance is what claims the load. */
  @Post('dispatch/proposals/:id/accept')
  acceptFreightProposal(@Param('id') id: string, @Actor() actor: IntrospectionResult) {
    this.requireNegotiator(this.dispatch.requireProposalPublic(id).freightId, actor);
    return this.dispatch.acceptProposal(id);
  }

  /** The poster says no to one price. The load, and every other proposal on it, stay open. */
  @Post('dispatch/proposals/:id/decline')
  declineFreightProposal(@Param('id') id: string, @Actor() actor: IntrospectionResult) {
    this.requireNegotiator(this.dispatch.requireProposalPublic(id).freightId, actor);
    return this.dispatch.declineProposal(id);
  }

  /** A driver pulls back their own price. */
  @Post('dispatch/proposals/:id/withdraw')
  withdrawFreightProposal(@Param('id') id: string, @Body() dto: WithdrawProposalDto, @Actor() actor: IntrospectionResult) {
    return this.dispatch.withdrawProposal(id, actingDid(actor, dto.driverDid));
  }

  /**
   * Only the side that POSTED a load may read or answer the prices offered on it (or an operator).
   *
   * postedByDid first, then shipperDid: they are usually the same party but not always — a counter booking
   * has a shop that posted it and no shipper at all, because the customer's cash settles off-platform. A
   * bulletin freight has neither, and is an operator matter until someone owns it.
   */
  private requireNegotiator(freightId: string, actor: IntrospectionResult): void {
    if (actor?.role === 'operator') return;
    const f = this.dispatch.requireFreightPublic(freightId);
    const owner = f.postedByDid ?? f.shipperDid;
    if (!owner || !actor?.did || actor.did !== owner) throw new GlosError('FORBIDDEN', 'Only the shipper who posted this load can answer the prices offered on it');
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
    // BOTH ends of a cooperative haul can be address-less. The lot is collected where the crop is — a shed,
    // a yard, a farm gate — which is often nowhere near the counter that owns the lot, and that is where the
    // truck must go. A pin wins; a NAMED site is geocoded, but only if the gazetteer actually recognised it,
    // because a fallback guess (a national centroid) would send a truck further astray than the shop's own
    // pin, which is at least a real place. No pickup given at all → the shop, exactly as before.
    const named = dto.pickupLabel?.trim();
    const geocodedPickup = named ? this.geocoder.geocode(named) : undefined;
    const pickupLocation = dto.pickupLocation ?? (geocodedPickup && geocodedPickup.confidence !== 'fallback' ? geocodedPickup.location : undefined) ?? owner.location;
    return this.consignments.open({
      ownerDid,
      natureCode: dto.natureCode,
      pickupLabel: named || owner.shopName,
      pickupLocation,
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
    // F3 — what is COMING but cannot be taken yet: consolidation lots still filling along this route. Advisory
    // only (no offer, nothing to claim), so a trucker can plan a return leg around a lot that is nearly full.
    const expected = this.forthcoming.nearRoute(did, dto);
    // REP4 — return the LIVE freight-bar verdict alongside the offers, so the app's "freight is paused" note
    // comes from the SAME read as the loads it sits next to (never stale: missing when a pause just began, or
    // contradicting freight cards after it lifted).
    return { remainingCapacityKg: this.dispatch.remainingCapacity(did), remainingTotes: this.dispatch.remainingTotes(did), offers, expected, freightPaused: belowFloor(this.ratings.driverRating(did)) };
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
    return { remainingCapacityKg: this.dispatch.remainingCapacity(did), remainingTotes: this.dispatch.remainingTotes(did), claims: this.dispatch.claimsFor(did) };
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

  /**
   * Decline an offer straight from the notification's "Not now", using the one-shot capability that rode in
   * the push. PUBLIC by necessity and safe by construction: the service worker handling that tap has no
   * session, and the alternative — handing a background script the driver's token — trades a one-word
   * problem for their whole identity. The token is unguessable, bound to a single offer, single-use, and
   * dead when the offer lapses (see mintDeclineToken). It carries no authority to claim anything.
   */
  @Public()
  @Post('dispatch/offers/decline')
  declineOffer(@Body() dto: DeclineOfferDto) {
    return this.dispatch.declineByToken(dto.token);
  }
}
