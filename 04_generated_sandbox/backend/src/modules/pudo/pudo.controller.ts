import { CarriageContractService, isDay } from './carriage-contract.service';
import type { ContractRef } from './carriage-contract.types';
import { BusinessClientService } from './business-client.service';
import { clientRefOf, type ClientRef } from './business-client.types';
import { driverPapers, lapsedOf, offRoadLine } from './papers';
import { PapersWatchService } from './papers-watch.service';
import type { FleetDriver, FleetSetupRow } from './fleet.types';
import { ConsignmentNoteService } from './consignment-note.service';
import { DepartureNoteService } from './departure-note.service';
import { NoteArchiveService } from './note-archive.service';
import { NoteBundleService } from './note-bundle.service';
import { DestinationService } from './destination.service';
import { FleetMoveService } from './fleet-move.service';
import { FleetOfferService } from './fleet-offer.service';
import { NetworkPulseService } from './network-pulse.service';
import { SiteService, SITE_BASIS, type Site } from './site.service';
import { TransitAuthorityService, TRANSIT_BASIS } from './transit-authority.service';
import { FieldObservationService, OBSERVATION_BASIS } from './field-observation.service';
import { MailService } from '../../foundation/mail/mail.service';
import { SmsService } from '../../foundation/sms/sms.service';
import { SmsSendError } from '../../foundation/sms/sms.types';
import { appUrl } from '../../foundation/mail/mail.templates';
import { InterestService } from '../../foundation/interest/interest.service';
import { DepartureService } from './departure.service';
import { BusinessMemberGuard } from './business-member.guard';
import { BusinessService } from './business.service';
import { boardDocId } from './note-archive.types';
import { isSandbox } from '../../foundation/runtime/sandbox';
import { Body, Controller, Delete, Get, Header, Inject, Param, Patch, Post, Query, Req, Res, StreamableFile, Optional, UseGuards } from '@nestjs/common';
import { staffNetworkAllows } from '../../foundation/auth/staff-network';
import { RateLimit, RateLimitGuard } from '../../foundation/http/rate-limit.guard';
import { ACCOUNT_CODES } from '../../foundation/books/books.types';
import { PRESENCE_CAPABILITIES, PRESENCE_LEVELS, type PresenceLevel } from '../../foundation/presence/presence.types';
import { capabilitiesOf } from '../../foundation/presence/presence.service';
import { countryImpactOf } from './country-impact';
import { BorderRuleService } from './border-rules.service';
import type { Response } from 'express';
import { CompanyDocumentService } from '../../foundation/entity/company-documents.service';
import { HandleService } from '../../foundation/handle/handle.service';
import { HandleDirectory } from './handle-directory.service';
import { ProfileView, presenceSays, profileDoes } from './profile.types';
import { MOBILISATION_MEASURED } from './mobilisation';
import { AGENT_MEASURED, RECORD_SAYS } from './agent-record';
import { CONTAINER_TYPES, type ContainerTypeSpec } from './container-type';
import { MoversView } from './movers.types';
import { ImportService } from './import.service';
import { AgentFinderResponse, ClearanceOffer, ClearanceRecordResponse, ContainerBoxView, ImportDetail, ImportRow, KnownPaper } from './import.types';
import { CompanyReadinessService } from '../../foundation/entity/company-readiness.service';
import type { Entity } from '../../foundation/entity/entity.types';
import { COUNTRY_CATALOGUE, catalogueEntry } from '../../foundation/countries/catalogue';
import { ApiQuery } from '@nestjs/swagger';
import { GlosError } from '../../foundation/http/glos-error';
import { Public } from '../../foundation/auth/public.decorator';
import { Roles, Scopes, SignedIn } from '../../foundation/auth/scopes.decorator';
import { Actor } from '../../foundation/auth/actor.decorator';
import { actingDid, actingTenant, auditActor } from '../../foundation/auth/acting';
import { PresenceService } from '../../foundation/presence/presence.service';
import { staffOf } from './staff-of';
import { SetupKeyMay, setupKeyOutsideSandbox } from '../../foundation/auth/setup-key';
import type { Signer } from '../../foundation/entity/same-person';
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
import { RoutingService, publicQuote } from './routing.service';
import { MdpService } from './mdp.service';
import { ToteService } from './tote.service';
import { ConsignmentService } from './consignment.service';
import { VehicleService } from './vehicle.service';
import { DriverService } from './driver.service';
import { FleetService } from './fleet.service';
import { DispatchService } from './dispatch.service';
import { isFor } from './addressed-to';
import { RouteConstraintService } from './route-constraint.service';
import { ConstraintView, ConstraintsResponse, RouteConstraintsResponse } from './route-constraint.types';
import { FreightBoardResponse, FreightProposalsResponse, MarketResponse, MarketSeries, LaneCarriers, PostedFreightResponse, FreightCancelledResponse, FreightClaimResponse, FreightClaimQueueRow } from './dispatch.types';
import { MarketPulseService } from './market-pulse.service';
import { CargoService } from './cargo.service';
import { MediaService } from './media.service';
import { EmptyDepot, EmptyDepotService } from './empty-depot.service';
import { CONTACT_BASIS, ContactCardService } from './contact-card.service';
import { ContactCardView, DepotListResponse, DepotRegisterView } from './depot.types';
import { FleetManagerService } from './fleet-manager.service';
import { AccountService } from './account.service';
import { OTP_TTL_MINUTES, OtpService } from './otp.service';
import { PersonService } from './person.service';
import { TRUCK_SUBTYPE_CATALOG } from './fleet.config';
import { AcceptParcelDto, BookFreightDto, OpenConsignmentDto, ConsignmentDepositDto, ArriveDto, AssignCorridorDto, AssignNodeDto, AssignToteDto, AvailabilityDto, CheckoutDto, ClassifyDto, CollectDto, CorridorDto, CorridorStatusDto,
  ProposeLineDto,
  RegisterImportDto,
  AppointAgentDto,
  RevokeAgentDto,
  PublishRequiredDto,
  ReleaseDto,
  FieldObservationDto,
  RemoveEvidenceDto,
  TransitAuthorityDto,
  WithdrawTransitDto,
  SupplyPaperDto,
  PaperDecisionDto,
  KnownPapersQueryDto,
  QuoteClearanceFeeDto,
  AcceptClearanceFeeDto,
  ClearanceFeeStatusDto,
  RecordCustomsHoldDto,
  AnswerCustomsHoldDto,
  ReleaseCustomsHoldDto,
  ClearanceOfferDto,
  FindAgentsQueryDto,
  DeclareCargoDto,
  BoxArrivedDto,
  BoxFreeDaysDto,
  BoxEndingDto,
  BoxReturnLegDto,
  BoxInterchangeDto,
  DeclareDepotDto,
  DepotBoxDto,
  ByDto,
  ContactCardDto,
  MintRoadLegDto,
  PresenceDto,
  PresenceDecisionDto,
  CreateCompanyDto,
  CompanyRecordDto,
  CompanyDeclarationDto,
  CompanyDocumentDto,
  DocumentDecisionDto,
  StoreAccountDto, BorderRuleDto, BagBaysDto, CollectionPointDto, OpenDockBagDto, DeclineOfferDto, SuggestVehicleDto, DeclareAreaDto, DeclareLegDto, DeclineReturnDto, DerivedLegDto, NudgeMinEarnDto, PayoutFailureDto, PayoutSettleDto, SnoozeDto, SuggestNearbyDto, DisputeDto, DriverDto, DriverKycDecisionDto, DriverKycDto, DriverPayoutDto, DropBagDto, EntityAdminDto, EntityAdminLoginDto, StaffLoginDto, TwoStepCodeDto, StaffProposalDeclineDto, StaffWelcomeCheckDto, StaffWelcomeDto, EntityAdminPasswordDto, EntityFeeDto, EntityInsuranceDto, CarrierPapersDto, CarrierPapersRecordDto, SendCarrierPaperDto, RefuseCarrierPaperDto, CancelBookingDto, SwapVehicleDto, BookDepartureDto, AddOwnLoadDto, DeliverDepartureDto, SecureDepartureDto, OpenBookingClaimDto, AnswerBookingClaimDto, DeclareDepartureDto, DepartureStatusDto, AssignDepartureDriverDto, WaitingStopDto, WaiveWaitingDto, EntityAmountsDto, EntityRatesDto, EntityTaxDto, EntityTopUpFeeDto, InterestDto, OpenBagDto, SealBagDto, FillToteDto, HandoverDto, InboundOrderDto, IntakeDto, CancelParcelDto, ForgotDto, KycDecisionDto, LoadBagDto, LocateDto, LoginDto, ManagerKycDecisionDto, ManagerKycDto, ManagerLoginDto, ManagerSessionDto, ManagerChoicesDto, DriverSessionDto, FleetOfferDto, FleetOfferView, DriverOfferView, RemoveDriverDto, FleetMoveView, FleetLeaveView, ChangePasswordDto, RotateSecretDto, PhoneRequestDto, PhoneVerifyDto, ReceiveBagDto, ResetDto, SignupDto, PickupDto, PlanJourneyDto, RateDto, RateDriverDto, ReissueReleaseDto, RegisterAgentDto, RegisterDriverDto, RegisterFleetManagerDto, RegisterFreightDto, RegisterMdpDto, RegisterVehicleDto, RegisterVendorDto, ResolveDisputeDto, SetHoursDto, SetLocationDto, SetPriceDto, SetFxRateDto, IssueApiKeyDto, ShelfDto, ShopfrontDto, ShelveDto, SortParcelDto, StartSessionDto, SubmitKycDto, SuggestRouteDto, SurgeRuleDto, TopUpDto, UpdateVendorDto, VendorLoginDto, VehicleDocsDto, VoidDto, FreightActionDto, CancelFreightDto, FreightDeliveryFailedDto, OpenFreightClaimDto, FreightBoardQueryDto, MarketQueryDto, MarketSeriesQueryDto, LaneCarriersQueryDto, DeclareSiteDto, SitesQueryDto, ProposeFreightDto, WithdrawProposalDto, RecordTempDto, VendorOrdersQueryDto, VendorLedgerQueryDto, AgentParcelsQueryDto, AgentLedgerQueryDto, DriverJobsQueryDto, FleetEarningsQueryDto, WriteOffParcelDto, ReportConstraintDto, RefuteConstraintDto, ConfirmConstraintDto, ClearConstraintDto, ConstraintsNearQueryDto, ConstraintsRouteQueryDto, RenewLicenceDto, SendLicenceRenewalDto, RefuseLicenceRenewalDto, FleetDispatchQueryDto, FleetAssignDto, RateFreightDto, FreightInstructionsDto, HandBackDto, NoteArchiveQueryDto, VerifyNoteDto, ConnectDestinationDto } from './pudo.dto';
import { incotermEntry } from '../../foundation/incoterms/catalogue';
import { UnclaimedService } from './unclaimed.service';
import { MerchantRatingService } from './merchant-rating.service';
import { classifySize, MAX_CLAIM_AWARD, measuredFactor, NETWORK_CURRENCY, SIZE_WEIGHT_KG } from './pudo.config';
import { EntityService } from '../../foundation/entity/entity.service';
import { EntityAdminView, OperatorAccountView, StaffAccountList, StaffInvited, StaffProposalView, EntityChanges, EntityPricing } from '../../foundation/entity/entity.types';
import { EntityAdminService } from '../../foundation/entity/entity-admin.service';
import { CompanyPapersWatch } from '../../foundation/entity/company-papers-watch.service';
import { CompanyDeclarationService, COMPANY_PAPER_KINDS, PAPER_BOUND_SECTIONS, recordKeeper } from '../../foundation/entity/company-declarations.service';
import { CompanyPaperReportService } from '../../foundation/entity/company-paper-reports.service';
import { OperatorAccountService, staffIdOf } from '../../foundation/entity/operator-account.service';
import { CARGO_LANES } from './cargo.types';
import { ReturnService } from './return.service';
import { PayoutService } from '../../foundation/payouts/payout.service';
import { FundingService } from '../../foundation/funding/funding.service';
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
/**
 * The ceiling an award on this shipment is checked against, and where that ceiling comes from.
 *
 * The same walk `resolveDispute` makes before it refuses one: a stated cover limit if the shipment has
 * one, else the sanity bound. Computed once, here, so the number an adjudicator is shown and the number
 * they are refused by are the same number — which they were not, because the queue used to send neither.
 *
 * `basis` matters as much as the figure. "Covered to 6,000 because they declared it" and "covered to
 * 5,000 because that is what we carry for free" invite different conversations with the claimant, and
 * "there is no cover at all" makes an award a goodwill decision rather than a policy one.
 */
export function awardCapOf(p: { coverLimit?: number; declaredValue?: number }): {
  coverLimit?: number;
  declaredValue?: number;
  awardCap: number;
  capBasis: 'declared' | 'free-limit' | 'sanity-bound';
} {
  const stated = p.coverLimit != null && p.coverLimit > 0;
  return {
    ...(p.coverLimit != null ? { coverLimit: p.coverLimit } : {}),
    ...(p.declaredValue != null ? { declaredValue: p.declaredValue } : {}),
    awardCap: stated ? p.coverLimit! : MAX_CLAIM_AWARD,
    capBasis: stated ? (p.declaredValue ? 'declared' : 'free-limit') : 'sanity-bound',
  };
}

@Controller('sbg')
// B1 — a business sign-in reaches about forty of these routes; whether that person is still in the business, and may
// change anything, is asked live on every one of them. Every other caller passes through untouched.
@UseGuards(BusinessMemberGuard)
export class SbgController {
  constructor(
    private readonly clients: BusinessClientService,
    private readonly agents: AgentService,
    private readonly gate: WalletGateService,
    private readonly corridors: CorridorService,
    private readonly parcels: ParcelService,
    private readonly unclaimed: UnclaimedService,
    private readonly merchants: MerchantRatingService,
    private readonly monitor: MonitorService,
    private readonly ratings: RatingService,
    private readonly entities: EntityService,
    private readonly presence: PresenceService,
    private readonly companyDocuments: CompanyDocumentService,
    private readonly handles: HandleService,
    private readonly handleDirectory: HandleDirectory,
    private readonly imports: ImportService,
    private readonly sites: SiteService,
    private readonly transit: TransitAuthorityService,
    private readonly observations: FieldObservationService,
    private readonly readiness: CompanyReadinessService,
    private readonly borderRules: BorderRuleService,
    private readonly entityAdmins: EntityAdminService,
    private readonly operatorAccounts: OperatorAccountService,
    private readonly notes: ConsignmentNoteService,
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
    private readonly payouts: PayoutService,
    private readonly funding: FundingService,
    private readonly returns: ReturnService,
    private readonly fleet: FleetService,
    private readonly dispatch: DispatchService,
    private readonly constraints: RouteConstraintService,
    private readonly managers: FleetManagerService,
    private readonly accounts: AccountService,
    private readonly otp: OtpService,
    private readonly auth: AuthService,
    private readonly persons: PersonService,
    private readonly cargo: CargoService,
    private readonly market: MarketPulseService,
    // Y3 — the box's gate photographs are served from here, under the IMPORT's own party rule rather than
    // the media module's owner-or-operator one: the driver took them, and the two parties are who need them.
    private readonly media: MediaService,
    // Y4 — a yard that says it holds empties, and what is on its way to it.
    private readonly depots: EmptyDepotService,
    // A company's own entry: how to reach them. One card, read by every directory.
    private readonly contacts: ContactCardService,
    @Inject(GEOCODER) private readonly geocoder: Geocoder,
    private readonly interest: InterestService,
    private readonly departures: DepartureService,
    private readonly departureNotes: DepartureNoteService,
    private readonly archive: NoteArchiveService,
    private readonly bundles: NoteBundleService,
    private readonly destinations: DestinationService,
    @Optional() private readonly mail?: MailService,
    @Optional() private readonly papers?: PapersWatchService,
    // Optional so the specs that hand-list this controller's providers keep working; app.boot.spec catches it
    // missing from the module.
    @Optional() private readonly fleetMove?: FleetMoveService,
    @Optional() private readonly fleetOffers?: FleetOfferService,
    @Optional() private readonly pulse?: NetworkPulseService,
    @Optional() private readonly contracts?: CarriageContractService,
    @Optional() private readonly businesses?: BusinessService,
    @Optional() private readonly companyPapers?: CompanyPapersWatch,
    @Optional() private readonly declarations?: CompanyDeclarationService,
    @Optional() private readonly paperReports?: CompanyPaperReportService,
    @Optional() private readonly sms?: SmsService,
  ) {}

  // --- phone verification (mandatory at onboarding — control-tower contact + GPS) ---
  // (CODE_NOT_SENT, below the class: one sentence for a code that could not be texted, whichever way it could not.)
  // These six are @Public(): they are the PRE-auth flow. A caller cannot hold an actor token before
  // they have signed up or logged in, and once GLOS_CLIENT_SECRET gates /auth/token (S0) the browser
  // can no longer mint a machine token to reach them either. They must be reachable unauthenticated.

  /**
   * Issue a verification code for a phone. The code comes back in the answer ONLY in a sandbox: anywhere else,
   * handing it to whoever asked would let anyone verify anyone's phone — it has to reach the phone itself, and it
   * goes there as a text (`SmsService`).
   *
   * "SENT" IS SAID ONLY WHEN IT WAS. Off a sandbox with no provider wired in, or when the provider did not take the
   * text, the person is told it could not be sent — not left at a screen waiting for a text that is not coming —
   * and the try is given back (`OtpService.notSent`): they may ask again at once.
   *
   * A number in a country that is not switched on is turned away before a code is made or counted: a text is paid
   * for, and codes asked for to numbers abroad is how that is abused. Switching a country on is what lets its
   * numbers be texted (`SmsService.mayGoTo`) — there is no list beside it.
   */
  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit(120, 15 * 60)
  @Post('auth/phone/request')
  async phoneRequest(@Body() dto: PhoneRequestDto) {
    const to = this.otp.phoneFor(dto.phone);
    const texts = this.sms?.sends() ?? false;
    if (!texts && !isSandbox()) throw new GlosError('SMS_NOT_SENT', CODE_NOT_SENT);
    if (texts && !this.sms?.mayGoTo(to)) throw new GlosError('PHONE_NOT_SERVED', 'We cannot send a code to a number in that country yet.', { field: 'phone' });
    const issued = this.otp.request(dto.phone);
    try {
      // In a sandbox with nothing wired in this is the outbox, which keeps it: the same steps run either way.
      await this.sms?.sendCode(to, issued.code, OTP_TTL_MINUTES);
    } catch (err) {
      this.otp.notSent(dto.phone);
      // The one failure that is the person's: the provider cannot text that number. Everything else is ours.
      if (err instanceof SmsSendError && err.kind === 'rejected') throw new GlosError('PHONE_INVALID', 'We cannot send a text to that number. Check it, or use a mobile number.', { field: 'phone' });
      throw new GlosError('SMS_NOT_SENT', CODE_NOT_SENT);
    }
    return isSandbox() ? issued : { sent: issued.sent };
  }

  /** Confirm the code → marks the phone verified for sign-up. */
  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit(60, 15 * 60)
  @Post('auth/phone/verify')
  phoneVerify(@Body() dto: PhoneVerifyDto) {
    return this.otp.verify(dto.phone, dto.code);
  }

  // --- participant accounts: sign up / sign in / reset (PUDO field apps) ---

  /** Create a participant account + its domain entity (PUDO agent / driver / MDP) → an actor token. */
  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit(120, 15 * 60)
  @Post('auth/signup')
  signup(@Body() dto: SignupDto) {
    return this.accounts.signup(dto);
  }

  /**
   * Sign in with email + password → an actor-scoped token the app carries. The Shop and Hub apps' door (and a
   * courier's who signs in by email).
   *
   * TWO COUNTS. Per ACCOUNT: five wrong passwords lock it (`AccountService`), whoever typed them and from wherever —
   * that is the one a guesser cannot spread out. Per CALLER, here: sixty in a quarter of an hour, which a street of
   * shops behind one mobile network's address fits and one machine working through a list of accounts does not.
   */
  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit(60, 15 * 60)
  @Post('auth/login')
  authLogin(@Body() dto: LoginDto) {
    return this.accounts.login(dto.email, dto.password);
  }

  /**
   * Request a password reset. The token comes back in the answer ONLY in a sandbox: anywhere else it is the
   * credential itself, and returning it would let anyone reset anyone's password. Outside a sandbox the answer is
   * also the same for an email nobody holds, so this route cannot be used to find out which accounts exist.
   */
  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit(20, 15 * 60)
  @Post('auth/forgot')
  authForgot(@Body() dto: ForgotDto) {
    const issued = this.accounts.forgot(dto.email);
    return isSandbox() ? issued : { sent: true };
  }

  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit(20, 15 * 60)
  @Post('auth/reset')
  authReset(@Body() dto: ResetDto) {
    return this.accounts.reset(dto.token, dto.password);
  }

  /**
   * Change your own password — shop, hub, courier account. @Public because it proves itself with the CURRENT
   * password, never with a session. Every other session is signed out; the answer carries a fresh sign-in.
   */
  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit(20, 15 * 60)
  @Post('auth/password')
  changeAccountPassword(@Body() dto: ChangePasswordDto) {
    return this.accounts.changePassword(dto.email, dto.password, dto.newPassword);
  }

  @SignedIn()
  @Get('module-info')
  info(): ModuleInfo {
    return { module: 'PUDO', name: 'PUDO Light — Pick-Up/Drop-Off network', edition: 'Light v1.0 (GLOS Phase 1, emerging markets)', status: 'active' };
  }

  // --- agents (↔ M1 Tiers 1–2) ---

  /**
   * Put a shop on the network WITHOUT its owner signing up — network staff, and on a laptop the seeder. A shop that
   * signs itself up goes through `auth/signup`, with a phone it has proven. This took any valid token: any signed-in
   * driver or store could mint shops.
   */
  @Roles('operator')
  @Post('agents')
  register(@Body() dto: RegisterAgentDto) {
    return this.agents.register(dto);
  }

  /** A shop sends its papers — a copy of an ID, its trading licence, a photograph of the shop — and they go to staff. */
  @Roles('agent', 'operator')
  @Post('agents/:did/submit-kyc')
  submitKyc(@Param('did') did: string, @Body() dto: SubmitKycDto, @Actor() actor: IntrospectionResult) {
    this.assertAgentActs(did, actor);
    const shop = this.agents.get(did);
    if (shop.status !== 'DRAFT') throw new GlosError('INVALID_STATE', `Agent is ${shop.status}, expected DRAFT`);
    // EACH PAPER IS A PICTURE THIS SHOP UPLOADED. A name with no file behind it was taken as a paper — the seeder sent
    // three — and staff were then asked to approve a shop on pictures nobody could open. Somebody else's picture is not
    // this shop's paper either. It also makes the sending the shop's own act: staff cannot supply what they then check.
    const papers: Array<[string, 'kyc_id' | 'kyc_licence' | 'shop']> = [[dto.idCopyRef, 'kyc_id'], [dto.tradingLicenceRef, 'kyc_licence'], ...dto.shopPhotoRefs.map((ref): [string, 'shop'] => [ref, 'shop'])];
    for (const [ref, kind] of papers) {
      if (!this.media.adopt(ref, did, { type: 'agent', id: did }, kind)) throw new GlosError('PHOTO_REQUIRED', 'That picture could not be attached — take the photograph again');
    }
    return this.agents.submitKyc(did, dto);
  }

  /** Operator vetting decision — a field token must never approve/reject KYC. */
  @Roles('operator')
  @Post('agents/:did/kyc-decision')
  decideKyc(@Param('did') did: string, @Body() dto: KycDecisionDto, @Actor() actor: IntrospectionResult) {
    return this.agents.decideKyc(did, dto.approve, auditActor(actor, dto.by), dto.reason);
  }

  /**
   * Record the refundable equipment/starter-kit deposit.
   *
   * STAFF, not the shop. It used to be the shop's own to declare, which made it the second thing in this
   * system a party could say about its own money and have believed. Unlike a top-up it is not a candidate
   * for a payment rail: it is taken once, at onboarding, in cash or in kind, by the person handing over
   * the printer — so the network genuinely is the observer here, and the question the user raised about
   * staff confirming *every* top-up does not arise for something that happens once per shop.
   *
   * It is still a FLAG rather than a posting. A refundable deposit is money we hold and owe back, and it
   * belongs in the books beside the float it must never be mixed with — named as a gap on progress.html
   * rather than guessed at here, because it needs an amount in the sister's own currency and the constant
   * it has today is in dollars.
   */
  @Roles('operator')
  @Post('agents/:did/deposit')
  deposit(@Param('did') did: string) {
    return this.agents.recordDeposit(did);
  }

  /**
   * EVERY COUNTRY, AND WHERE THE NETWORK STANDS IN IT.
   *
   * This used to return only the countries goods may be taken in — nine of the two hundred and forty-three
   * that exist — on the reasoning that a list should not offer a dead end. A driver in the Netherlands
   * showed why that is the wrong reading: a country that is simply ABSENT teaches nobody anything. You
   * cannot tell "we are not there yet" from "this form is broken", and the conclusion they reached was
   * that the product could only be joined through a fleet.
   *
   * So the list is the atlas, and each entry carries its own answer. `joinable` says whether anybody may
   * register there at all; `settles` whether a company of ours handles the money, and `settlesAs` names
   * it. Three states, and a form that shows all three tells somebody exactly where they stand at the
   * country step — which is far earlier, and far kinder, than discovering it at the end of a wizard or,
   * worse, never finding themselves on the list and assuming the fault is theirs.
   *
   * Nothing is loosened by saying more: `joinable` is read off the same presence the server enforces, and
   * registering in a country where it is false is refused exactly as it was before.
   *
   * `name` is the COUNTRY's name for all of them — it was the sister's ("SeeBuyGet Kenya") where one
   * existed, which reads as a company in a list of places and is unscannable among two hundred entries.
   * Who would contract you is a different fact, and it has its own field.
   */
  @Public()
  @Get('countries')
  countries() {
    return COUNTRY_CATALOGUE.map((c) => {
      const sister = this.entities.forJurisdiction(c.code);
      return {
        country: c.code,
        name: c.name,
        ...(sister?.currency ? { currency: sister.currency } : {}),
        settles: Boolean(sister),
        ...(sister ? { settlesAs: sister.name } : {}),
        joinable: this.presence.resolve(c.code).capabilities.takeIn,
      };
    });
  }

  /**
   * ASK TO BE TOLD WHEN THE NETWORK REACHES YOUR COUNTRY.
   *
   * Public, and unverified on purpose: this is evidence for a decision, not an account. A bad address
   * costs one person their answer and nothing else, and making somebody prove a phone before they may
   * say "I would carry freight here" is friction on the cheapest, most useful thing they can give us.
   *
   * A country that is ALREADY open is refused by name rather than thanked for waiting — there is nothing
   * to wait for, and the right answer is the sign-up.
   *
   * COUNTED PER CALLER, because each one sends an email to an address nobody has confirmed: without a count this
   * is a way to make us write to anybody, as often as somebody likes.
   */
  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit(20, 15 * 60)
  @Post('countries/:code/interest')
  registerInterest(@Param('code') code: string, @Body() dto: InterestDto) {
    const open = this.presence.resolve(code.trim().toUpperCase()).capabilities.takeIn;
    const note = this.interest.add({ country: code, kind: dto.kind, email: dto.email, message: dto.message }, open);
    const country = catalogueEntry(note.country)?.name ?? note.country;
    void this.mail?.send('interest-received', { address: note.email }, { country, kind: note.kind }).catch(() => undefined);
    return { noteId: note.noteId, country: note.country, name: country };
  }

  /** Who is waiting, by country, biggest first — the shape the switch-on decision is actually made in. */
  @Roles('operator')
  @Get('interest')
  interestQueue() {
    return { items: this.interest.byCountry() };
  }

  /** Take a note back. Removed, not flagged: somebody withdrawing has withdrawn. */
  @Roles('operator')
  @Delete('interest/:noteId')
  withdrawInterest(@Param('noteId') noteId: string) {
    this.interest.withdraw(noteId);
    return { noteId, withdrawn: true };
  }

  /**
   * CA1 — every country that exists, with what the network knows of it and where it stands. Public: it is the
   * atlas, not a decision. `priceable` says whether the rate book can convert its currency, which is what
   * switching a country on requires.
   */
  @Public()
  @Get('country-catalogue')
  countryCatalogue() {
    return {
      items: COUNTRY_CATALOGUE.map((c) => ({ ...c, priceable: Boolean(this.fx.point(c.currency)), level: this.presence.resolve(c.code).level })),
    };
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
   * MAY THIS CALLER ACT ON THIS COMPANY — and is it acting as network staff or as the company itself?
   *
   * Two callers reach these routes now. An OPERATOR is network staff and reaches every company, which is
   * what the wildcard scope has always meant. An ENTITY_ADMIN reaches the company its token names and any
   * company under it, which is the org chart asked a question rather than a permission list somebody has
   * to keep in step with it.
   *
   * A company an admin does not reach answers NOT FOUND rather than FORBIDDEN: "you may not touch this"
   * confirms it exists, and which companies a group owns is not a stranger's business.
   */
  /**
   * The name a TWO-PERSON rule records — and outside a sandbox, only a name the network established at sign-in.
   *
   * The shared operator key cannot say who holds it, so its token carries no name and the console used to send one
   * typed beside it. Two typed names are not two people: one person holding the key could approve their own change
   * by typing a colleague's name. On a laptop the typed name is still accepted, so a demo can play both people.
   */
  /** Whoever is READING, as a two-person rule tells them from the one who acted. No account, no key: only their name. */
  private reader(actor: IntrospectionResult | undefined): Signer {
    return { name: actor?.actorName ?? '', ...(actor?.actorName && actor.revocationKey ? { key: actor.revocationKey } : {}) };
  }

  /** Who is acting, for an act a DIFFERENT person must second: their name for the record, their account beside it. */
  private signed(actor: IntrospectionResult, typed?: string): { by: string; byKey: string } {
    const who = staffOf(actor, typed);
    return { by: who.name, byKey: who.key };
  }

  private namedActor(actor: IntrospectionResult, typed?: string): string {
    if (!isSandbox() && !actor?.actorName) {
      throw new GlosError('FORBIDDEN', 'A decision that needs two people needs a named sign-in — the shared operator key cannot say who is at the keyboard');
    }
    return auditActor(actor, typed);
  }

  /**
   * CL2a — WHICH COMPANY IS ACTING, for a route where that is the whole access question.
   *
   * A company administrator acts as their own company and cannot name another: the token carries the entity,
   * so naming a different one is refused rather than ignored. Network staff hold no company of their own, so
   * they must say which one they are acting for — there is no sensible default, and defaulting to the first
   * company on the system would put a decision on a real importer's record.
   */
  private actingCompany(actor: IntrospectionResult, typed?: string): string {
    // B1 — somebody acting for a customer's business acts as that business and no other, exactly like an administrator.
    // Whether they are still a member, and may act at all, BusinessMemberGuard has already asked.
    if (actor?.role === 'entity_admin' || actor?.role === 'business') {
      const own = actingTenant(actor);
      if (!own) throw new GlosError('FORBIDDEN', 'This sign-in carries no company');
      if (typed && typed !== own) throw new GlosError('FORBIDDEN', 'You act for one company, and it is not that one');
      return own;
    }
    if (!typed) throw new GlosError('FIELD_REQUIRED', 'Name the company you are acting for');
    return this.entities.get(typed).entityId;
  }

  /**
   * B4 — WHO A LOAD OR A BOOKING IS FOR, when an expeditor sends it for a client. The client must be in THIS business's
   * own book; nobody else may name one, because only a business keeps clients.
   */
/**
   * P1 — AN ORDER UNDER A STANDING CONTRACT: only the business that linked the contract places one, only while it
   * stands, and only for a day that has not gone by. What comes back is the copy the load carries.
   */
  private contractOrder(actor: IntrospectionResult, contractId: string | undefined, deliverOn: string | undefined, orderRef?: string): { contract?: ContractRef; deliverOn?: string; orderRef?: string } {
    if (!contractId) {
      if (deliverOn) throw new GlosError('INVALID_INPUT', 'A delivery day belongs to an order under a contract — name the contract', { field: 'contractId' });
      return {};
    }
    if (actor?.role !== 'business' || !actor.tenant) throw new GlosError('FORBIDDEN', 'Only the business that linked a contract orders under it');
    if (!this.contracts) throw new GlosError('INVALID_STATE', 'Contracts are not running in this deployment');
    if (!deliverOn || !isDay(deliverOn)) throw new GlosError('FIELD_REQUIRED', 'Say which day it must arrive', { field: 'deliverOn' });
    // "Today" is the carrier's: an order is for a day on the clock of the fleet that must bring it.
    const linked = this.contracts.requireForShipper(actor.tenant, contractId);
    if (deliverOn < this.dispatch.fleetDay(linked.fleetDid)) throw new GlosError('INVALID_INPUT', 'That day has gone — an order is for today or later', { field: 'deliverOn' });
    const contract = this.contracts.orderable(linked, deliverOn);
    const ref = orderRef?.trim();
    // The shipper's own number is used once under a contract — the same rule a sheet is held to.
    if (ref && this.dispatch.contractOrderByRef(contractId, ref)) throw new GlosError('CONFLICT', `Order ${ref} is already with ${contract.fleetName}`, { field: 'orderRef' });
    return { contract, deliverOn, ...(ref ? { orderRef: ref } : {}) };
  }

  private onBehalfOf(actor: IntrospectionResult, clientId: string | undefined): { onBehalfOf?: ClientRef } {
    if (!clientId) return {};
    if (actor?.role !== 'business' || !actor.tenant) throw new GlosError('FORBIDDEN', 'Only a business sends for a client of its own');
    return { onBehalfOf: clientRefOf(this.clients.require(actor.tenant, clientId)) };
  }

  private requireReach(actor: IntrospectionResult, entityId: string): void {
    if (actor?.role === 'operator') return;
    if (actor?.role === 'entity_admin' && this.entities.mayAdminister(actor.tenant, entityId)) return;
    // A business reaches itself. It has no parent and is nobody's: the company structure's reach does not apply.
    if (actor?.role === 'business' && actor.tenant === entityId) return;
    throw new GlosError('NOT_FOUND', `No such company: ${entityId}`);
  }

  /* ------------------------------------------------- how established we are -- */

  /**
   * HOW ESTABLISHED THE NETWORK IS, COUNTRY BY COUNTRY.
   *
   * Read by everybody who has to know what may be promised where, so it is not operator-only: a shop
   * asking whether it may take goods in, and under whose promise, is asking this. What it never
   * carries is money — a level says what is permitted, never what is held.
   */
  @SignedIn()
  @Get('presence')
  listPresence() {
    // CA3/CA7 — each country carries the companies standing (or being prepared) there, and whether each is ready.
    return {
      items: this.presence.list().map((p) => ({
        ...p,
        companies: this.entities
          .companies()
          .filter((c) => c.jurisdiction === p.jurisdiction)
          .map((c) => ({ entityId: c.entityId, name: c.name, kind: c.kind, status: c.status ?? 'active', ready: this.readiness.readinessOf(c.entityId).ready })),
      })),
    };
  }

  /**
   * CA1 — a country is switched on only from the catalogue, and only once the network can price in its money:
   * "refuse until mapped", asked of the person deciding instead of discovered at the first price.
   */
  /**
   * CL1 — a trade term may only be used where it has been switched ON, in the right direction.
   *
   * Modelled on requirePriceableSwitchOn below: refused where the person is DECIDING, in words naming the
   * term and the country, rather than discovered later by whoever is standing at a counter.
   *
   * A term names a border, so a load carrying one must say which countries it runs between. Both ends are
   * asked because the terms are not symmetric: EXW burdens the buyer with export clearance where the goods
   * START, DDP burdens the seller with import clearance where they END.
   */
  private requireActiveTerm(incoterm: string | undefined, pickupCountry?: string, destCountry?: string): void {
    const term = incotermEntry(incoterm);
    if (!term) return;
    if (!pickupCountry?.trim() || !destCountry?.trim()) {
      throw new GlosError('TERM_NOT_ACTIVE', 'A trade term names a border, so say which countries this load runs between before agreeing ' + term.code + '.');
    }
    const ends: Array<{ country: string; direction: 'origin' | 'destination' }> = [
      { country: pickupCountry.trim(), direction: 'origin' },
      { country: destCountry.trim(), direction: 'destination' },
    ];
    for (const end of ends) {
      const allowed = this.presence.resolve(end.country).incoterms[end.direction];
      if (!allowed.includes(term.code)) {
        throw new GlosError(
          'TERM_NOT_ACTIVE',
          term.code + ' is not switched on for ' + end.country.toUpperCase() + ' as ' + end.direction + '. Network staff activate a term per country, per direction, and two of them are needed to switch one on.',
        );
      }
    }
  }

  private requirePriceableSwitchOn(jurisdiction: string, level: string): void {
    const country = catalogueEntry(jurisdiction);
    if (!country) throw new GlosError('INVALID_INPUT', `${jurisdiction.toUpperCase()} is not a country in the catalogue`);
    const switchingOn = !this.presence.can(country.code, 'takeIn') && level !== 'observed';
    if (switchingOn && !this.fx.point(country.currency)) {
      throw new GlosError('INVALID_STATE', `There is no exchange rate for ${country.currency} yet — put one on the rate book before switching ${country.name} on`);
    }
  }

  /**
   * CA9 — what lowering or closing a country would leave behind, read BEFORE anybody presses it: parcels on shelves
   * there and whose promise they were taken in under, loads starting or ending there, what our companies still owe
   * suppliers there, and who is registered there. Operator-only.
   */
  @Roles('operator')
  @Get('presence/:jurisdiction/impact')
  presenceImpact(@Param('jurisdiction') jurisdiction: string, @Query('level') level?: string) {
    const toLevel = (PRESENCE_LEVELS as readonly string[]).includes(level ?? '') ? (level as PresenceLevel) : 'observed';
    const code = jurisdiction.trim().toUpperCase();
    const current = this.presence.resolve(code).capabilities;
    const next = capabilitiesOf(toLevel);
    return countryImpactOf({
      jurisdiction: code,
      toLevel,
      lost: PRESENCE_CAPABILITIES.filter((c) => current[c] && !next[c]),
      gained: PRESENCE_CAPABILITIES.filter((c) => !current[c] && next[c]),
      shops: this.agents.list().map((a) => ({ did: a.did, country: this.agents.countryOf(a) })),
      parcels: this.parcels.list(),
      stores: this.vendors.list().map((v) => ({ country: v.country })),
      hubs: this.mdps.list().map((m) => ({ did: m.did, country: this.mdps.countryOf(m) })),
      fleets: this.managers.list().map((m) => ({ did: m.did, jurisdiction: m.jurisdiction })),
      couriers: this.drivers.list().map((d) => ({ did: d.did, jurisdiction: d.jurisdiction, managerDid: d.managerDid })),
      freight: this.dispatch.listFreight(),
      payables: this.entities.sisters().map((e) => ({ entityId: e.entityId, name: e.name, currency: e.currency ?? '', outstanding: this.books.outstanding(e.entityId, ACCOUNT_CODES.PAYABLE_PROVIDER) })),
    });
  }

  /** CA2 — changes to a country waiting for a second person, and the ones already decided. Operator-only. */
  @Roles('operator')
  @Get('presence/proposals')
  presenceProposals(@Actor() actor: IntrospectionResult) {
    // `mine` is said per reader, so the console offers "Approve" by ACCOUNT: two colleagues may share a name.
    const reader = this.reader(actor);
    return { items: this.presence.listProposals().map((p) => ({ ...p, mine: this.presence.proposedByReader(p.proposalId, reader) })) };
  }

  /** CA2 — the second person approves. Never the proposer; the rate book is asked again if this switches a country on. */
  @Roles('operator')
  @Post('presence/proposals/:proposalId/approve')
  approvePresence(@Param('proposalId') proposalId: string, @Body() dto: PresenceDecisionDto, @Actor() actor: IntrospectionResult) {
    const who = staffOf(actor, dto.by);
    const by = who.name;
    // Everything that could refuse is asked BEFORE anything changes: the second person, the rate book, and — for
    // Established or Partnered — whether the company is ready. Only then is a draft company switched on.
    const proposal = this.presence.assertApprovable(proposalId, by, undefined, who.key);
    this.requirePriceableSwitchOn(proposal.jurisdiction, proposal.level);
    const company = this.requireReadyCompanyFor(proposal.jurisdiction, proposal.level);
    if (company) this.entities.activate(company.entityId, by);
    // The one promise the waiting list makes, kept by the approval rather than by anybody remembering.
    // After the refusals above and before the change, so a switch-on that is about to be rejected never
    // sends mail — and the list is read now, while the people on it are still marked as waiting.
    /*
     * THE ONE PROMISE THE WAITING LIST MAKES, kept by the approval rather than by anybody remembering.
     *
     * Read BEFORE the change and sent AFTER it. Before, because every refusal above has already had its
     * say and the list must still show these people as waiting; after, because a country is not open
     * until it is, and an email that arrives ahead of the fact is the same false note as a form promising
     * a company that does not exist.
     */
    const waiting = this.interest.waitingFor(proposal.jurisdiction);
    const decided = this.presence.approve(proposalId, by, undefined, who.key);

    if (waiting.length && this.presence.resolve(proposal.jurisdiction).capabilities.takeIn) {
      const name = catalogueEntry(proposal.jurisdiction)?.name ?? proposal.jurisdiction;
      const sister = this.entities.forJurisdiction(proposal.jurisdiction);
      for (const note of waiting) {
        void this.mail
          ?.send('country-open', { address: note.email }, { country: name, settles: Boolean(sister), ...(sister ? { company: sister.name } : {}), joinUrl: appUrl('home') })
          .catch(() => undefined);
      }
      // Marked told so a later raise — matched to established — does not repeat the same sentence. The
      // second change deserves its own message, and that is a slice of its own, named in the doc.
      this.interest.told(waiting.map((n) => n.noteId), proposal.level);
    }

    return decided;
  }

  /** CA2 — anyone declines (the proposer withdrawing included), always with a reason. */
  @Roles('operator')
  @Post('presence/proposals/:proposalId/decline')
  declinePresence(@Param('proposalId') proposalId: string, @Body() dto: PresenceDecisionDto, @Actor() actor: IntrospectionResult) {
    return this.presence.decline(proposalId, this.namedActor(actor, dto.by), dto.reason);
  }

  @SignedIn()
  @Get('presence/:jurisdiction')
  presenceFor(@Param('jurisdiction') jurisdiction: string) {
    return this.presence.resolve(jurisdiction);
  }

  /**
   * Move a country up or down the ladder. Operator-only, and the change is NAMED: “we launched in
   * Zambia” must be a record with a person on it rather than a deploy.
   *
   * ESTABLISHED cannot be claimed here without a sister that actually transacts there. The service
   * refuses it, because that claim would unlock a Merchant of Record, a float and a claims provision
   * that do not exist.
   */
  @Roles('operator')
  @Post('presence/:jurisdiction')
  setPresence(@Param('jurisdiction') jurisdiction: string, @Body() dto: PresenceDto, @Actor() actor: IntrospectionResult) {
    this.requirePriceableSwitchOn(jurisdiction, dto.level);
    this.requireReadyCompanyFor(jurisdiction, dto.level);
    // CA2 — a change that raises the country becomes a proposal for a second person; a lowering is applied now.
    return this.presence.propose({
      // CL1 — the trade terms this country allows, per direction. A term switched ON is a gain like any
      // other, so the service holds it to the same two-person rule.
      incoterms: dto.incoterms,
      jurisdiction,
      level: dto.level,
      overrides: dto.overrides as never,
      note: dto.note,
      ...this.signed(actor, dto.by),
    });
  }

  /* ----------------------------------------------- CA6: the rules of crossing a border -- */

  /** CA6 — every recorded rule between two countries. Read by anybody signed in: a driver needs it as much as staff. */
  @SignedIn()
  @Get('border-rules')
  borderRuleList() {
    return { items: this.borderRules.list() };
  }

  /** CA6 — record or replace the rule for one direction. Operator-only, and named. Absent a rule, nothing is permitted. */
  @Roles('operator')
  @Post('border-rules')
  setBorderRule(@Body() dto: BorderRuleDto, @Actor() actor: IntrospectionResult) {
    const { by, ...rule } = dto;
    return this.borderRules.set(rule as never, auditActor(actor, by));
  }

  /* ----------------------------------- CA3–CA5, CA7, CA8: a company, recorded properly -- */

  /**
   * The readiness gate for Established (a company of ours) and Partnered (a partner), asked when the change is
   * proposed and again when it is approved. A company already active has been switched on before and is not asked
   * again; a country with no company at all is refused by the presence, by name.
   */
  private requireReadyCompanyFor(jurisdiction: string, level: string): Entity | undefined {
    if (level !== 'established' && level !== 'partnered') return undefined;
    const company = level === 'established' ? this.entities.sisterRecordFor(jurisdiction) : this.entities.partnerFor(jurisdiction, { includeDraft: true });
    if (!company || company.status !== 'draft') return undefined;
    const readiness = this.readiness.readinessOf(company.entityId);
    if (!readiness.ready) {
      const missing = readiness.items.filter((i) => !i.met).map((i) => i.label);
      throw new GlosError('INVALID_STATE', `${company.name} is not ready to be switched on. Still missing: ${missing.join('; ')}`);
    }
    return company;
  }

  /** CA3/CA7 — create a company of ours or a partner, as a draft. Operator-only: the super-admin side. */
  @Roles('operator')
  @Post('entities')
  createCompany(@Body() dto: CreateCompanyDto, @Actor() actor: IntrospectionResult) {
    return this.entities.createCompany({ kind: dto.kind, jurisdiction: dto.jurisdiction, name: dto.name }, auditActor(actor, dto.by));
  }

  /** CA3 — everything about one company: the record, whether it is ready, its papers, what lapsed, what changed. */
  @Roles('operator', 'entity_admin', 'business')
  @Get('entities/:entityId/record')
  companyRecord(@Param('entityId') entityId: string, @Actor() actor: IntrospectionResult) {
    this.requireReach(actor, entityId);
    const entity = this.entities.get(entityId);
    return {
      entity: { entityId: entity.entityId, name: entity.name, kind: entity.kind, jurisdiction: entity.jurisdiction, currency: entity.currency, status: entity.status ?? 'active' },
      // Their own public address. A company reading its own record should be able to see the page a
      // shipper reads about them, and until now the only way to learn your own handle was to be an
      // appointed clearing agent and read it off the clearance record.
      ...(this.handleOf(entityId) ? { handle: this.handleOf(entityId) } : {}),
      // WHO KEEPS THIS RECORD: staff until the company is switched on, the company itself from then. A screen offers
      // a change only to whoever that is — the other reads.
      keeper: recordKeeper(entity),
      record: this.entities.recordOf(entityId),
      // The company's own changes to the parts that switch something, each with what it was, what it is, and its paper.
      declarations: this.declarations?.list(entityId).slice(0, 50) ?? [],
      // What has been said against its papers, and what was decided: in full for staff; for the company and the company
      // above it, what was said — never by whom, and never what the reporter attached.
      reports: this.paperReports?.forEntity(entityId, actor?.role === 'operator' ? 'staff' : 'company') ?? [],
      readiness: entity.kind === 'group' ? null : this.readiness.readinessOf(entityId),
      // `mine` is said per reader, so the console offers "Verify" by ACCOUNT: two colleagues may share a name.
      documents: this.companyDocuments.list(entityId).map((d) => ({ ...d, mine: this.companyDocuments.uploadedByReader(d, this.reader(actor)) })),
      obligations: catalogueEntry(entity.jurisdiction)?.obligations ?? [],
      lapses: this.entities.lapsesFor(entity.jurisdiction).filter((l) => l.entityId === entityId),
      // What is running OUT, and what the company's administrators were told about it — beside what has already
      // lapsed, on the one screen every administrator of a company has.
      expiring: this.papersRunningOut(60, new Set([entityId])),
      changes: this.entities.changes(entityId, 50),
    };
  }

  /**
   * CA3 — save sections of a company's record. BY WHOEVER KEEPS IT, and by nobody else.
   *
   * Until a company is switched on, that is network staff: entering the record is the readiness check, and it is
   * unchanged. Once it is on, the company keeps its own record (the user, 2026-10-09: "sbg should only interact at
   * dispute") — its administrators save it, and staff no longer can. That refusal is the point, not a side effect:
   * one member of staff who could still type a company's licence date could switch a country off alone, and
   * striking a paper takes two.
   *
   * The parts that switch something do not come through here at all for a company: each changes with its paper,
   * one at a time (`record/declare`).
   */
  @Roles('operator', 'entity_admin')
  @Post('entities/:entityId/record')
  saveCompanyRecord(@Param('entityId') entityId: string, @Body() dto: CompanyRecordDto, @Actor() actor: IntrospectionResult) {
    this.requireReach(actor, entityId);
    const entity = this.entities.get(entityId);
    const { by, ...patch } = dto;
    if (recordKeeper(entity) === 'staff') {
      if (actor?.role !== 'operator') {
        throw new GlosError('FORBIDDEN', `${entity.name} is not switched on yet. Until it is, SeeBuyGet staff enter its record; put your papers on record, and they are verified before the country is switched on`);
      }
      return this.entities.updateRecord(entityId, patch as Record<string, unknown>, auditActor(actor, by));
    }
    if (actor?.role === 'operator') {
      throw new GlosError('FORBIDDEN', `${entity.name} is switched on and keeps its own record: its administrators change it. Staff act on a report of one of its papers, and two of you decide`);
    }
    if (PAPER_BOUND_SECTIONS.some((section) => (patch as Record<string, unknown>)[section] !== undefined)) {
      throw new GlosError('VALIDATION_FAILED', 'A licence, an insurance policy, a bank account and who may sign change one at a time, each with the paper behind it');
    }
    return this.entities.updateRecord(entityId, patch as Record<string, unknown>, auditActor(actor));
  }

  /**
   * ONE CHANGE TO A PART THAT SWITCHES SOMETHING, WITH ITS PAPER — the company's own act, and only the company's.
   * It counts at once; its other administrators and those of the company above it are told.
   */
  @Roles('entity_admin')
  @Post('entities/:entityId/record/declare')
  async declareCompanyChange(@Param('entityId') entityId: string, @Body() dto: CompanyDeclarationDto, @Actor() actor: IntrospectionResult) {
    this.requireReach(actor, entityId);
    // SAID HERE, NOT LEFT TO @Roles: the guard lets a staff token through every labelled route ("operator satisfies
    // everything"), and this is the one act staff must not be able to do — it is a company's licence date, changed alone.
    if (actor?.role !== 'entity_admin') {
      throw new GlosError('FORBIDDEN', 'A company’s own administrator makes this change, with the paper. Staff act on a report of one of its papers, and two of you decide');
    }
    if (!this.declarations) throw new GlosError('INVALID_STATE', 'A company’s own changes are not available here');
    const { declaration, document, told } = await this.declarations.declare({
      entityId,
      section: dto.section,
      was: dto.was,
      item: dto.item,
      paper: dto.paperDataUrl ? { kind: dto.paperKind, title: dto.paperTitle, dataUrl: dto.paperDataUrl } : undefined,
      by: auditActor(actor),
      byKey: actor?.revocationKey,
    });
    return { declaration, document, told, record: this.entities.recordOf(entityId) };
  }

  /** CA4 — put a document on record: fingerprinted, versioned, waiting for a second person to verify it. */
  @Roles('operator', 'entity_admin', 'business')
  @Post('entities/:entityId/documents')
  uploadCompanyDocument(@Param('entityId') entityId: string, @Body() dto: CompanyDocumentDto, @Actor() actor: IntrospectionResult) {
    this.requireReach(actor, entityId);
    // A paper a switched-on company keeps ABOUT ITSELF is its own to put on record, and counts when it does: staff do
    // not put one there for it. The papers of one consignment live in the same store and keep their own readers.
    const entity = this.entities.get(entityId);
    const own = recordKeeper(entity) === 'company' && (COMPANY_PAPER_KINDS as readonly string[]).includes(dto.kind);
    if (own && actor?.role === 'operator') {
      throw new GlosError('FORBIDDEN', `${entity.name} is switched on and keeps its own papers: one of its administrators puts this on record`);
    }
    return this.companyDocuments.upload({
      entityId,
      kind: dto.kind,
      title: dto.title,
      dataUrl: dto.dataUrl,
      relatesTo: dto.relatesTo,
      expiresAt: dto.expiresAt,
      ...this.signed(actor, dto.by),
      declared: own,
    });
  }

  /** CA4 — the file itself, with the fingerprint it was kept under and whether the stored bytes still match it. */
  @Roles('operator', 'entity_admin', 'business')
  @Get('entities/:entityId/documents/:documentId/file')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  companyDocumentFile(
    @Param('entityId') entityId: string,
    @Param('documentId') documentId: string,
    @Actor() actor: IntrospectionResult,
    @Res({ passthrough: true }) res: Response,
  ): StreamableFile {
    this.requireReach(actor, entityId);
    const file = this.companyDocuments.file(entityId, documentId);
    res.setHeader('X-Fingerprint', file.fingerprint);
    res.setHeader('X-Fingerprint-Intact', String(file.intact));
    res.setHeader('Access-Control-Expose-Headers', 'X-Fingerprint, X-Fingerprint-Intact');
    return new StreamableFile(file.bytes, { type: file.contentType });
  }

  /** CA4 — a second person verifies a document. Never the uploader. */
  @Roles('operator')
  @Post('entities/:entityId/documents/:documentId/verify')
  verifyCompanyDocument(@Param('entityId') entityId: string, @Param('documentId') documentId: string, @Body() dto: DocumentDecisionDto, @Actor() actor: IntrospectionResult) {
    const who = staffOf(actor, dto.by);
    return this.companyDocuments.verify(entityId, documentId, who.name, undefined, who.key);
  }

  /** CA4 — reject a document, always with a reason. */
  @Roles('operator')
  @Post('entities/:entityId/documents/:documentId/reject')
  rejectCompanyDocument(@Param('entityId') entityId: string, @Param('documentId') documentId: string, @Body() dto: DocumentDecisionDto, @Actor() actor: IntrospectionResult) {
    return this.companyDocuments.reject(entityId, documentId, this.namedActor(actor, dto.by), dto.reason);
  }

  /**
   * CA5 — licences and policies lapsing soon, or already lapsed. Soonest first.
   *
   * Network staff see every company's. A COMPANY'S OWN ADMINISTRATOR sees their company's, and those of the companies
   * under it: it is their paper, and until now the list of what was about to stop them was one they could not read.
   * Each row says what the company was last told and when — or that there was NOBODY to tell, which is the one row
   * staff must not miss.
   */
  @Roles('operator', 'entity_admin')
  @Get('companies/expiring')
  expiringCompanyPapers(@Actor() actor: IntrospectionResult, @Query('withinDays') withinDays?: string) {
    const days = Number(withinDays);
    const reach = actor?.role === 'operator' ? undefined : new Set(this.entities.administrable(actor?.tenant).map((e) => e.entityId));
    const within = Number.isFinite(days) && days > 0 ? Math.min(days, 365) : 60;
    return { items: this.papersRunningOut(within, reach) };
  }

  /** CA5 — the papers running out, with what each company was told. Without the watch (a hand-built module) it is the same list, saying nothing of who was told. */
  private papersRunningOut(withinDays: number, reach?: Set<string>) {
    return this.companyPapers ? this.companyPapers.list(Date.now(), withinDays, reach) : this.entities.expiring(Date.now(), withinDays).filter((p) => !reach || reach.has(p.entityId));
  }

  /* ------------------------------------------- CL2a — a container, and its papers -- */

  /**
   * THE IMPORTER'S SIDE and THE AGENT'S SIDE, on one set of routes.
   *
   * Both parties are companies, so both sign in as a company administrator and act as themselves — there is
   * no shared login anywhere in this, and the service decides which side of a consignment the caller is on
   * rather than the route trusting a claim in the body. Network staff reach every consignment, the same
   * reach `requireReach` already gives them over every company record; they are an onlooker on each, and
   * an onlooker is owed nothing and can act on nothing.
   */
  @Roles('operator', 'entity_admin', 'business')
  @Post('imports')
  registerImport(@Body() dto: RegisterImportDto, @Actor() actor: IntrospectionResult) {
    const acting = this.actingCompany(actor, dto.importerEntityId);
    /*
     * THE TWO PLACES, RESOLVED FROM SAVED SITES. A screen sends ids; staff typing through the API may
     * still send labels, which is why both survive. Resolved here and not in the import service, for the
     * same reason the road leg's are: that service has no business holding an address book.
     */
    const clearsAt = dto.clearanceSiteId ? this.sites.require(acting, dto.clearanceSiteId) : undefined;
    const discharge = dto.dischargeSiteId ? this.sites.require(acting, dto.dischargeSiteId) : undefined;
    return this.imports.register(
      {
        ...dto,
        importerEntityId: acting,
        destPort: clearsAt?.name ?? dto.destPort,
        ...(discharge?.name ?? dto.dischargePort ? { dischargePort: discharge?.name ?? dto.dischargePort } : {}),
      },
      this.namedActor(actor, dto.by),
    );
  }

  /**
   * A COMPANY'S PUBLIC ADDRESS, attached wherever the console names an agent.
   *
   * §6a's page closes the findability gap only if somebody can get to it, and an entity id is not an
   * address. Resolved in the controller rather than inside ImportService on purpose: that service has no
   * business knowing about handles, and giving it the dependency would mean every hand-listed provider
   * spec in this module needs it too — the DI trap this project has already paid for once.
   */
  private handleOf(entityId?: string): string | undefined {
    if (!entityId) return undefined;
    return this.handles.list().find((h) => h.id === entityId)?.handle;
  }

  private withHandles<T extends { agentEntityId?: string }>(row: T): T & { agentHandle?: string } {
    const agentHandle = this.handleOf(row.agentEntityId);
    return agentHandle ? { ...row, agentHandle } : row;
  }

  /** The consignments this company is a party to. Staff naming no company see the network's. */
  @Roles('operator', 'entity_admin', 'business')
  @Get('imports')
  listImports(@Actor() actor: IntrospectionResult, @Query('entityId') entityId?: string): { items: ImportRow[] } {
    const rows = actor?.role === 'operator' && !entityId ? this.imports.list('', { all: true }) : this.imports.list(this.actingCompany(actor, entityId));
    return { items: rows.map((r) => this.withHandles(r)) };
  }

  /**
   * WHAT AGENTS HAVE BEEN ASKED FOR AT A PORT — the foreknowledge that separates the user's two imports.
   *
   * Declared BEFORE `imports/:importId`, because a path parameter would otherwise swallow it.
   *
   * Every row is first-hand: it exists only because an agent clearing a real container published it as
   * something they would need. There is no route that accepts a claim about a border from somebody who was
   * not clearing anything, which is how rumour is refused at intake rather than stored at low confidence.
   * It is never phrased as a requirement — we say who asked, how often, and when.
   */
  @Roles('operator', 'entity_admin', 'business')
  @Get('imports/known-papers')
  knownImportPapers(@Query() q: KnownPapersQueryDto): { items: KnownPaper[] } {
    return { items: this.imports.knownPapers(q.country, q.port) };
  }

  @Roles('operator', 'entity_admin', 'business')
  @Get('imports/:importId')
  importDetail(@Param('importId') importId: string, @Actor() actor: IntrospectionResult, @Query('entityId') entityId?: string): ImportDetail {
    const detail = actor?.role === 'operator' && !entityId ? this.imports.detail(importId, '', { all: true }) : this.imports.detail(importId, this.actingCompany(actor, entityId));
    return this.withHandles(detail);
  }

  /** Appoint a clearing agent — the act that grants them the papers. The importer's decision alone. */
  @Roles('operator', 'entity_admin', 'business')
  @Post('imports/:importId/appoint')
  appointClearingAgent(@Param('importId') importId: string, @Body() dto: AppointAgentDto, @Actor() actor: IntrospectionResult): ImportDetail {
    return this.imports.appoint(importId, dto.agentEntityId, this.actingCompany(actor, dto.entityId), this.namedActor(actor, dto.by));
  }

  /** End it. Immediate, and visible to both sides: the grants are marked revoked, never deleted. */
  @Roles('operator', 'entity_admin', 'business')
  @Post('imports/:importId/revoke')
  revokeClearingAgent(@Param('importId') importId: string, @Body() dto: RevokeAgentDto, @Actor() actor: IntrospectionResult): ImportDetail {
    return this.imports.revoke(importId, this.actingCompany(actor, dto.entityId), this.namedActor(actor, dto.by), dto.reason);
  }

  /**
   * CL5 — MAY A PHOTOGRAPH BE KEPT HERE, AND WHAT MUST BE AGREED TO FIRST?
   *
   * Asked BEFORE the camera is offered, never after. Somebody who has already photographed a customs
   * document and is then told we cannot hold it has been made to do something they cannot undo — the
   * picture is on their phone either way, and we invited it.
   *
   * The notice travels with the answer so no screen has to keep its own copy of the words, which is how
   * two versions of a consent text start existing.
   */
  @Roles('operator', 'entity_admin', 'business', 'agent', 'driver', 'fleet_manager')
  @Get('field-observations/notice')
  observationNotice(@Query('country') country?: string) {
    return { country: country?.toUpperCase(), mayHoldEvidence: this.observations.mayHoldEvidence(country), ...this.observations.notice() };
  }

  /**
   * CL5 — record what you were asked for. First-hand or refused; positive by the shape of the form.
   *
   * Open to the people who are actually at a counter — a driver, a shopkeeping agent, a fleet office, a
   * company administrator — because a form that only staff can fill in collects what staff already know.
   */
  @Roles('operator', 'entity_admin', 'business', 'agent', 'driver', 'fleet_manager')
  @Post('field-observations')
  recordFieldObservation(@Body() dto: FieldObservationDto, @Actor() actor: IntrospectionResult) {
    return this.observations.record(
      {
        country: dto.country,
        place: dto.place,
        subject: dto.subject,
        note: dto.note,
        happenedOn: dto.happenedOn,
        firstHand: dto.firstHand,
        evidenceMediaId: dto.evidenceMediaId,
        ...(dto.consentAgreed !== undefined || dto.consentNoticeVersion
          ? { consent: { agreed: Boolean(dto.consentAgreed), noticeVersion: dto.consentNoticeVersion ?? '' } }
          : {}),
      },
      { did: actor?.did ?? actor?.sub ?? 'unknown', name: this.namedActor(actor, dto.by) },
    );
  }

  /** CL5 — what has been observed at a place, newest first by the date it HAPPENED. */
  @Roles('operator', 'entity_admin', 'business', 'agent', 'driver', 'fleet_manager')
  @Get('field-observations')
  listFieldObservations(@Query('country') country?: string, @Query('place') place?: string) {
    const items = country ? this.observations.at(country, place) : this.observations.list();
    return { items, basis: OBSERVATION_BASIS };
  }

  /**
   * CL5 — take a photograph back off an observation, keeping the words.
   *
   * Operator-only, and it exists for the two days that will come: a country's answer changing, and
   * somebody photographing a number they meant to cover.
   */
  @Roles('operator')
  @Post('field-observations/:observationId/remove-evidence')
  removeObservationEvidence(@Param('observationId') observationId: string, @Body() dto: RemoveEvidenceDto, @Actor() actor: IntrospectionResult) {
    return this.observations.removeEvidence(observationId, this.namedActor(actor, dto.by), dto.reason);
  }

  /**
   * BL1 — the appointed agent records that customs released the container.
   *
   * The agent's, because they are the party at the counter and the only one who knows. It is what lets a
   * split chain mint its delivery leg: before it, the box is still the state's business.
   */
  @Roles('operator', 'entity_admin', 'business')
  @Post('imports/:importId/released')
  recordImportRelease(@Param('importId') importId: string, @Body() dto: ReleaseDto, @Actor() actor: IntrospectionResult): ImportDetail {
    return this.imports.recordRelease(importId, this.actingCompany(actor, dto.entityId), this.namedActor(actor, dto.by));
  }

  /**
   * BL1 — a carrier's permission to move uncleared goods, and the register of them.
   *
   * Operator-recorded. A carrier stating their own transit licence would be the only paper on this
   * network nobody else ever looks at, and this one decides whether somebody's uncleared cargo may be
   * put on their truck — so it goes through the same desk that already records a lapsed driving licence.
   */
  @Roles('operator')
  @Post('carriers/:carrierDid/transit-authorities')
  declareTransitAuthority(@Param('carrierDid') carrierDid: string, @Body() dto: TransitAuthorityDto, @Actor() actor: IntrospectionResult) {
    return this.transit.declare({ carrierDid, country: dto.country, reference: dto.reference, expiresAt: dto.expiresAt }, this.namedActor(actor, dto.by));
  }

  @Roles('operator', 'entity_admin', 'business')
  @Get('carriers/:carrierDid/transit-authorities')
  listTransitAuthorities(@Param('carrierDid') carrierDid: string) {
    return { items: this.transit.list(carrierDid), basis: TRANSIT_BASIS };
  }

  @Roles('operator')
  @Post('carriers/:carrierDid/transit-authorities/:authorityId/withdraw')
  withdrawTransitAuthority(@Param('authorityId') authorityId: string, @Body() dto: WithdrawTransitDto, @Actor() actor: IntrospectionResult) {
    return this.transit.withdraw(authorityId, this.namedActor(actor, dto.by), dto.reason);
  }

  /** The agent publishes what they will need. We never assert this list — see the service. */
  @Roles('operator', 'entity_admin', 'business')
  @Post('imports/:importId/required')
  publishRequiredPapers(@Param('importId') importId: string, @Body() dto: PublishRequiredDto, @Actor() actor: IntrospectionResult): ImportDetail {
    return this.imports.publishRequired(importId, this.actingCompany(actor, dto.entityId), dto.items, this.namedActor(actor, dto.by));
  }

  /** The importer attaches one of their own papers. There is deliberately no upload on this route. */
  @Roles('operator', 'entity_admin', 'business')
  @Post('imports/:importId/supply')
  supplyRequiredPaper(@Param('importId') importId: string, @Body() dto: SupplyPaperDto, @Actor() actor: IntrospectionResult): ImportDetail {
    return this.imports.supply(importId, this.actingCompany(actor, dto.entityId), dto.key, dto.documentId, this.namedActor(actor, dto.by));
  }

  /** The agent ticks one off. An expired paper is refused HERE, not at the counter. */
  @Roles('operator', 'entity_admin', 'business')
  @Post('imports/:importId/required/:key/accept')
  acceptRequiredPaper(@Param('importId') importId: string, @Param('key') key: string, @Body() dto: PaperDecisionDto, @Actor() actor: IntrospectionResult): ImportDetail {
    return this.imports.accept(importId, this.actingCompany(actor, dto.entityId), key, this.namedActor(actor, dto.by));
  }

  /** Send one back, always with a reason. */
  @Roles('operator', 'entity_admin', 'business')
  @Post('imports/:importId/required/:key/reject')
  rejectRequiredPaper(@Param('importId') importId: string, @Param('key') key: string, @Body() dto: PaperDecisionDto, @Actor() actor: IntrospectionResult): ImportDetail {
    return this.imports.reject(importId, this.actingCompany(actor, dto.entityId), key, this.namedActor(actor, dto.by), dto.reason);
  }

  /**
   * Read a shared paper. The grant decides, and the same rule serves this route and the screens.
   *
   * A document the caller may not read answers NOT FOUND rather than FORBIDDEN: the alternative confirms to
   * somebody probing that a document with this id exists on a company they cannot see.
   */
  @Roles('operator', 'entity_admin', 'business')
  @Get('imports/:importId/documents/:documentId/file')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  importDocumentFile(
    @Param('importId') importId: string,
    @Param('documentId') documentId: string,
    @Actor() actor: IntrospectionResult,
    @Res({ passthrough: true }) res: Response,
    @Query('entityId') entityId?: string,
  ): StreamableFile {
    const reader = actor?.role === 'operator' && !entityId ? '' : this.actingCompany(actor, entityId);
    const found = this.imports.readableDocument(importId, reader, documentId);
    const file = this.companyDocuments.file(found.entityId, found.documentId);
    res.setHeader('X-Fingerprint', file.fingerprint);
    res.setHeader('X-Fingerprint-Intact', String(file.intact));
    res.setHeader('Access-Control-Expose-Headers', 'X-Fingerprint, X-Fingerprint-Intact');
    return new StreamableFile(file.bytes, { type: file.contentType });
  }

  /* ------------------------------------- CL2b — paying the agent, and the road leg -- */

  /** CL2b — the agent names their price. Allowed even where we cannot handle the money: it is their agreement. */
  @Roles('operator', 'entity_admin', 'business')
  @Post('imports/:importId/fee')
  quoteClearanceFee(@Param('importId') importId: string, @Body() dto: QuoteClearanceFeeDto, @Actor() actor: IntrospectionResult): ImportDetail {
    return this.imports.quoteFee(importId, this.actingCompany(actor, dto.entityId), dto.amount, dto.note, this.namedActor(actor, dto.by), Date.now(), { currency: dto.currency, reference: dto.reference });
  }

  /** CL2b — the importer agrees the figure. Nothing moves here; agreeing is not paying. */
  @Roles('operator', 'entity_admin', 'business')
  @Post('imports/:importId/fee/accept')
  acceptClearanceFee(@Param('importId') importId: string, @Body() dto: AcceptClearanceFeeDto, @Actor() actor: IntrospectionResult): ImportDetail {
    return this.imports.acceptFee(importId, this.actingCompany(actor, dto.entityId), this.namedActor(actor, dto.by));
  }

  /**
   * CL2b — the importer or the agent says the fee is paid, or back to open (2026-10-04: we do not manage the agent's
   * fee; we keep the quotation). Recorded by name with their reference. Nothing moves through our books.
   */
  @Roles('operator', 'entity_admin', 'business')
  @Post('imports/:importId/fee/status')
  setClearanceFeeStatus(@Param('importId') importId: string, @Body() dto: ClearanceFeeStatusDto, @Actor() actor: IntrospectionResult): ImportDetail {
    return this.imports.setFeeStatus(importId, this.actingCompany(actor, dto.entityId), dto.status, this.namedActor(actor, dto.by), dto.reference);
  }

  /* --------------------------------------- CL4 — what the state did, and the record -- */

  /**
   * Record that the state did something to this container: selected it, examined it, queried the papers.
   *
   * §6 divides a clearing agent's record in two, and this is the half that is NOT their doing. It is
   * recorded, shown and labelled as such — and never blended, because blending is what makes bribery look
   * like competence. Either party may record one; in practice the agent, who is the one standing there.
   *
   * That makes it self-serving by construction, so it is built like a road-hazard dispute: attributed,
   * visible to the other party at once, answerable BESIDE rather than instead, and never erased.
   */
  @Roles('operator', 'entity_admin', 'business')
  @Post('imports/:importId/customs-holds')
  recordCustomsHold(@Param('importId') importId: string, @Body() dto: RecordCustomsHoldDto, @Actor() actor: IntrospectionResult): ImportDetail {
    return this.imports.recordCustomsHold(
      importId,
      this.actingCompany(actor, dto.entityId),
      { kind: dto.kind as never, at: dto.at, note: dto.note },
      this.namedActor(actor, dto.by),
    );
  }

  /** The other party's account of the same hold. Never a deletion — see the service. */
  @Roles('operator', 'entity_admin', 'business')
  @Post('imports/:importId/customs-holds/:holdId/answer')
  answerCustomsHold(@Param('importId') importId: string, @Param('holdId') holdId: string, @Body() dto: AnswerCustomsHoldDto, @Actor() actor: IntrospectionResult): ImportDetail {
    return this.imports.answerCustomsHold(importId, this.actingCompany(actor, dto.entityId), holdId, dto.stance as never, dto.note, this.namedActor(actor, dto.by));
  }

  /** It ended. Once: a release date that moves is not a record. */
  @Roles('operator', 'entity_admin', 'business')
  @Post('imports/:importId/customs-holds/:holdId/release')
  releaseCustomsHold(@Param('importId') importId: string, @Param('holdId') holdId: string, @Body() dto: ReleaseCustomsHoldDto, @Actor() actor: IntrospectionResult): ImportDetail {
    return this.imports.releaseCustomsHold(importId, this.actingCompany(actor, dto.entityId), holdId, dto.at);
  }

  /**
   * ONE CLEARING AGENT'S RECORD — theirs to read about themselves, and an operator's to read about them.
   *
   * The same object the public profile page carries, so an agent's own copy cannot differ from what a
   * shipper reads: a record handed down is a verdict, one both parties hold is an account. The public page
   * is the other route to this, and the drive compares the two payloads field for field.
   */
  @Roles('operator', 'entity_admin', 'business')
  @Get('entities/:entityId/clearance-record')
  clearanceRecord(@Param('entityId') entityId: string, @Actor() actor: IntrospectionResult): ClearanceRecordResponse {
    const me = this.actingCompany(actor, entityId);
    const handle = this.handleOf(me);
    // Their own page's address travels with their own copy: "the same thing a shipper reads" is a claim
    // somebody should be able to go and check.
    const offer = this.imports.offerOf(me);
    return { record: this.imports.agentRecord(me), measured: AGENT_MEASURED, ...(handle ? { handle } : {}), ...(offer ? { offer } : {}) };
  }

  /**
   * CL7 — SAY WHAT KIND OF BOX IT IS, AND WHAT IS IN IT.
   *
   * The question this answers: an open top and a 40ft high-cube used to book identically, as did a
   * food-grade tank and a crude-oil tank. Everything about the BOX is now derived from its ISO code —
   * height, roof, the bodies that can carry it, the gear that lifts it — and everything about the GOODS
   * is DECLARED, because no code distinguishes edible oil from gas oil and reading it out of a
   * description would be us classifying goods. Same line as duty: regulated, and not ours to draw.
   *
   * The importer's, because the goods are theirs.
   */
  @Roles('operator', 'entity_admin', 'business')
  @Post('imports/:importId/cargo')
  declareImportCargo(@Param('importId') importId: string, @Body() dto: DeclareCargoDto, @Actor() actor: IntrospectionResult): ImportDetail {
    return this.withHandles(
      this.imports.declareCargo(
        importId,
        this.actingCompany(actor, dto.entityId),
        {
          containerNo: dto.containerNo,
          cscPlateDate: dto.cscPlateDate,
          containerType: dto.containerType,
          natureCode: dto.natureCode,
          cargoHeightM: dto.cargoHeightM,
          tank: dto.tank,
          dangerous: dto.dangerous,
        },
        this.namedActor(actor, dto.by),
      ),
    );
  }


  /* ------------------------- Y0 + Y1 — the box is somebody else's, and a clock runs on it -- */

  /**
   * WHEN IT LANDED — the demurrage clock's start, and the one date here that a person has to state.
   *
   * Detention is derived: the out-gate is our own road leg's pickup, so the leg we mint is literally what
   * starts it. An arrival is somebody else's event and nothing in this system watches a vessel berth, so
   * it is recorded with a name against it — and until it is, the clock says in words that demurrage is
   * not running rather than counting from an ETA that was a guess.
   */
  @Roles('operator', 'entity_admin', 'business')
  @Post('imports/:importId/box/arrived')
  recordBoxArrival(@Param('importId') importId: string, @Body() dto: BoxArrivedDto, @Actor() actor: IntrospectionResult): ImportDetail {
    return this.withHandles(
      this.imports.recordBoxArrival(importId, this.actingCompany(actor, dto.entityId), dto.at, this.namedActor(actor, dto.by)),
    );
  }

  /**
   * HOW MANY FREE DAYS THE IMPORTER SAYS THEY WERE GIVEN — the importer's alone, and a claim.
   *
   * Not an access decision but a truthfulness one: the free days are in a contract between them and the
   * shipping line that we have never seen, so nobody else is in a position to state the figure. We carry
   * it, attribute it, and count — and we never compute what being late costs, because that is the duty
   * line again and the penalty lands on somebody who is not us.
   */
  @Roles('operator', 'entity_admin', 'business')
  @Post('imports/:importId/box/free-days')
  claimBoxFreeDays(@Param('importId') importId: string, @Body() dto: BoxFreeDaysDto, @Actor() actor: IntrospectionResult): ImportDetail {
    return this.withHandles(
      this.imports.claimBoxFreeDays(importId, this.actingCompany(actor, dto.entityId), dto.kind as never, dto.days, this.namedActor(actor, dto.by)),
    );
  }

  /**
   * HOW THE SPELL ENDED: returned, or BOUGHT — and the second is why this takes a kind at all.
   *
   * Containers are traded goods, sold in the market and very often never returned, so "returned" is one
   * ending of three rather than the only exit. The clock stops on a recorded fact with a name and a date,
   * and never on somebody dismissing an alarm: an alarm a person can wave away teaches them to wave away
   * the next one, and the next one is the bill this exists to prevent.
   *
   * Either party may record it, and usually the agent will — they booked the box, they owe the return and
   * they are the one standing at the depot gate.
   */
  @Roles('operator', 'entity_admin', 'business')
  @Post('imports/:importId/box/ending')
  endBox(@Param('importId') importId: string, @Body() dto: BoxEndingDto, @Actor() actor: IntrospectionResult): ImportDetail {
    return this.withHandles(
      this.imports.endBox(
        importId,
        this.actingCompany(actor, dto.entityId),
        dto.kind as never,
        { at: dto.at, where: dto.where, note: dto.note },
        this.namedActor(actor, dto.by),
      ),
    );
  }


  /**
   * Y2 — POST THE LEG HOME, laden or empty, to the same board as any other load.
   *
   * The leg a laden run inland always implies and that nothing modelled: no driver was ever offered it,
   * the agent arranged it by telephone, and the board whose whole subject is repositioning could not see
   * it. It is very often NOT empty — a box is a dry lockable body, so cargo goes portward inside it — and
   * when it is empty it says so, because a driver who learns at the quay that there was nothing to carry
   * is a driver who stops taking container work.
   *
   * The weight is the box's own tare on an empty run, and it is asked for rather than invented: an empty
   * container is not a light one, and the figure is painted on the door.
   */
  @Roles('operator', 'entity_admin', 'business')
  @Post('imports/:importId/box/return-leg')
  mintReturnLeg(@Param('importId') importId: string, @Body() dto: BoxReturnLegDto, @Actor() actor: IntrospectionResult): ImportDetail {
    return this.withHandles(
      this.imports.mintReturnLeg(
        importId,
        this.actingCompany(actor, dto.entityId),
        {
          depotLabel: dto.depotLabel,
          depotLocation: dto.depotLocation as never,
          fromLabel: dto.fromLabel,
          fromLocation: dto.fromLocation as never,
          weightKg: dto.weightKg,
          cargo: dto.cargo,
          depotEntityId: dto.depotEntityId,
        },
        this.namedActor(actor, dto.by),
      ),
    );
  }


  /**
   * Y3 — SAY WHAT THE BOX LOOKED LIKE AT A GATE, beside whatever is already recorded there.
   *
   * The driver's half needs nobody: a securement photograph at pickup and a delivery photograph at the
   * depot are already demanded by the freight flow, and on a container leg what the driver took over IS
   * the box. This is the other half — the importer who says the hole was there before it was loaded, the
   * agent who says it was not — added BESIDE, never over, with nothing adjudicating the two.
   */
  @Roles('operator', 'entity_admin', 'business')
  @Post('imports/:importId/box/interchange')
  recordInterchange(@Param('importId') importId: string, @Body() dto: BoxInterchangeDto, @Actor() actor: IntrospectionResult): ImportDetail {
    return this.withHandles(
      this.imports.recordInterchange(
        importId,
        this.actingCompany(actor, dto.entityId),
        actor?.did ?? '',
        { side: dto.side as never, stance: dto.stance as never, note: dto.note, photoIds: dto.photoIds },
        this.namedActor(actor, dto.by),
      ),
    );
  }

  /**
   * ONE PHOTOGRAPH OF THIS BOX AT A GATE — and this route exists because of who took it.
   *
   * The driver owns those bytes, and the media module serves them to their owner and to an operator. That
   * is exactly useless here: the whole point of photographing a container at a gate is that the OTHER
   * party can look at it when the argument starts. So the read is widened, and no wider than the record
   * itself — this box, this spell, and the two parties to it, with the citation as the permission.
   *
   * A photograph the caller may not read answers NOT FOUND rather than FORBIDDEN, for the same reason the
   * document route does: the alternative confirms to somebody probing that it exists.
   */
  @Roles('operator', 'entity_admin', 'business')
  @Get('imports/:importId/box/photos/:mediaId')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  boxPhoto(
    @Param('importId') importId: string,
    @Param('mediaId') mediaId: string,
    @Actor() actor: IntrospectionResult,
    @Query('entityId') entityId?: string,
    @Query('variant') variant?: string,
  ): StreamableFile {
    const operator = actor?.role === 'operator' && !entityId;
    const reader = operator ? '' : this.actingCompany(actor, entityId);
    const id = this.imports.readableBoxPhoto(importId, reader, mediaId, { all: operator });
    const { bytes, contentType } = this.media.blob(id, variant === 'thumb' ? 'thumb' : 'full');
    return new StreamableFile(bytes, { type: contentType });
  }

  /**
   * EVERY BOX WE HAVE BEEN TOLD ABOUT, with its clock. Operator-only, because it spans companies.
   *
   * The per-container view is on the consignment and both parties see it. This one is the network's own
   * question — which boxes are out, and which are running out of time — and it is a read with no verdict
   * in it: no ranking, no charge, and the sentence each box carries says whose numbers produced it.
   */
  @Roles('operator')
  @Get('boxes')
  boxesOut(): { items: ContainerBoxView[] } {
    return { items: this.imports.boxesOut() as ContainerBoxView[] };
  }

  /**
   * The boxes this network books, with their real measurements. @Public — it is a catalogue, not data.
   *
   * Sent rather than mirrored into every client for the reason every derived table here is sent: two
   * copies of one table drift, and the copy on the screen drifts silently.
   */
  @Public()
  @Get('container-types')
  containerTypes(): { items: ContainerTypeSpec[] } {
    return { items: CONTAINER_TYPES };
  }



  /**
   * A COMPANY'S OWN ENTRY: how to reach them, written by them and changed by them whenever they like.
   *
   * The gap this closes was one the yard finder made: it said the next step was a telephone call and then
   * printed no telephone number. The clearing-agent directory had the same hole. So there is ONE card per
   * company — carried by the yard finder, the agent directory and the public page — because a telephone
   * number kept in three places drifts in two of them.
   *
   * A MERGE, so correcting a number does not drop the website; an empty string clears a field. Shapes are
   * checked and choices never are: we do not ring it, write to it, or open the site. And it is PUBLISHED,
   * which is the point of writing one — so it wants the gate's number rather than somebody's private one.
   */
  @Roles('operator', 'entity_admin', 'business')
  @Post('entities/:entityId/contact')
  setContactCard(@Param('entityId') entityId: string, @Body() dto: ContactCardDto, @Actor() actor: IntrospectionResult): ContactCardView {
    const own = actor?.role === 'operator' ? this.entities.get(entityId).entityId : this.actingCompany(actor, entityId);
    if (own !== entityId) throw new GlosError('FORBIDDEN', 'A company’s own entry is its own');
    const card = this.contacts.set(
      own,
      { contactName: dto.contactName, phone: dto.phone, phoneAlt: dto.phoneAlt, email: dto.email, website: dto.website, address: dto.address, hours: dto.hours, visitDays: dto.visitDays, visitFrom: dto.visitFrom, visitTo: dto.visitTo, closedDates: dto.closedDates, visitorsPerHour: dto.visitorsPerHour },
      this.namedActor(actor, dto.by),
    );
    return { ...card, basis: CONTACT_BASIS } as never;
  }

  /** Their card as it stands, for the screen that edits it. The same object every directory shows. */
  @Roles('operator', 'entity_admin', 'business')
  @Get('entities/:entityId/contact')
  contactCard(@Param('entityId') entityId: string, @Actor() actor: IntrospectionResult): ContactCardView {
    const own = actor?.role === 'operator' ? this.entities.get(entityId).entityId : this.actingCompany(actor, entityId);
    const card = this.contacts.of(own);
    if (!card) throw new GlosError('NOT_FOUND', 'That company has written no entry yet');
    return { ...card, basis: CONTACT_BASIS } as never;
  }

  /* ------------------------------ Y4 — a yard that wants to be findable, and what is coming to it -- */

  /**
   * A YARD OPTS IN. A claim, exactly as a clearing agent's advertisement is one: attributed, dated, and
   * never checked, because we run no yards and have nothing to check it against.
   *
   * WHAT THIS IS NOT is the more interesting half. Yard management is mainly smart planning — where to put
   * a box so it is not moved twice — and that needs the yard's geometry, the rules that bind a slot to a
   * box (a powered row for a reefer, segregation distances for dangerous goods, tier weights, ground
   * bearing) and the departure order. The first two are a model of a site we have never seen, and getting
   * a segregation distance wrong is the kind of advice that hurts somebody. So the layout stays theirs.
   * The departure side is ours already, because the leg home is on the board.
   */
  @Roles('operator', 'entity_admin', 'business')
  @Post('depots')
  declareDepot(@Body() dto: DeclareDepotDto, @Actor() actor: IntrospectionResult): EmptyDepot {
    return this.depots.declare(
      this.actingCompany(actor, dto.entityId),
      { placeLabel: dto.placeLabel, country: dto.country, location: dto.location as never, note: dto.note },
      this.namedActor(actor, dto.by),
    );
  }

  /** It stopped holding empties. Marked, never deleted — it held them last month. */
  @Roles('operator', 'entity_admin', 'business')
  @Post('depots/:entityId/close')
  closeDepot(@Param('entityId') entityId: string, @Body() dto: ByDto, @Actor() actor: IntrospectionResult): EmptyDepot {
    return this.depots.close(this.requireDepotKeeper(actor, entityId), this.namedActor(actor, dto.by));
  }

  /**
   * THE FINDER — alphabetical, never ranked, for the same reason the agent directory refused a league
   * table: an ordering is a judgement, and a yard that learns how to climb a list will climb it.
   *
   * Counts travel and the numbers do not. Which boxes are standing in a yard is a map of somebody else's
   * assets, and it serves nobody who is deciding where to drive — what they need is which yards exist,
   * near where, and whether there is anything in them. The next step is a telephone call.
   */
  @Roles('operator', 'entity_admin', 'business')
  @Get('depots')
  findDepots(@Query('country') country?: string, @Query('q') q?: string): DepotListResponse {
    return {
      items: this.depots.list({ country, text: q }) as never,
      basis: 'Alphabetical by name, never ranked. Each yard’s counts are its own claim and our own derivation, kept apart.',
    };
  }

  /**
   * ONE YARD'S REGISTER: what it says is there, what we derived, and what is on its way.
   *
   * The yard's own, and an operator's. Not a participant's: the box-level list is an inventory of another
   * company's assets, and the finder above already answers the question a haulier actually has.
   */
  @Roles('operator', 'entity_admin', 'business')
  @Get('depots/:entityId/register')
  depotRegister(@Param('entityId') entityId: string, @Actor() actor: IntrospectionResult): DepotRegisterView {
    return this.depots.registerOf(this.requireDepotKeeper(actor, entityId)) as never;
  }

  /**
   * The yard says a box is standing there — with the position IN THEIR OWN WORDS, if they keep one.
   *
   * "C-12, third row" is their handwriting, kept so a haulier can be told where to drive and a gate man
   * can find the box. Recording a position and assigning one are different jobs and only the first is
   * honestly ours, which is the whole of the layout argument in one field.
   */
  @Roles('operator', 'entity_admin', 'business')
  @Post('depots/:entityId/boxes')
  depotSays(@Param('entityId') entityId: string, @Body() dto: DepotBoxDto, @Actor() actor: IntrospectionResult): DepotRegisterView {
    return this.depots.say(this.requireDepotKeeper(actor, entityId), dto.containerNo, { position: dto.position, note: dto.note }, this.namedActor(actor, dto.by)) as never;
  }

  /** It left. Removed from what the yard SAYS — never from what we derived, which is a movement record. */
  @Roles('operator', 'entity_admin', 'business')
  @Delete('depots/:entityId/boxes/:containerNo')
  depotGone(@Param('entityId') entityId: string, @Param('containerNo') containerNo: string, @Actor() actor: IntrospectionResult): DepotRegisterView {
    return this.depots.gone(this.requireDepotKeeper(actor, entityId), containerNo) as never;
  }

  /** A yard's own register is the yard's, and network staff may act on it by naming which yard. */
  private requireDepotKeeper(actor: IntrospectionResult, entityId: string): string {
    if (actor?.role === 'operator') return this.entities.get(entityId).entityId;
    const own = this.actingCompany(actor, entityId);
    if (own !== entityId) throw new GlosError('FORBIDDEN', 'A yard’s register is its own');
    return own;
  }

  /* ------------------------------ CL6 — what an agent says they clear, and finding one -- */

  /**
   * AN AGENT'S OWN ADVERTISEMENT. Theirs to write, theirs to change, and never checked by us.
   *
   * The one asserted thing in the agent design. Identity and record stay derived — that is what stops
   * squatting and stops a record that can only flatter — but what somebody OFFERS cannot be derived at
   * all: nobody but the agent knows they clear livestock at Mombasa, and waiting to observe it would list
   * every agent as doing nothing until they had already been hired for it.
   *
   * Written by the company itself. An operator may write one on their behalf (they carry every company's
   * reach already), and the name on it says who did.
   */
  @Roles('operator', 'entity_admin', 'business')
  @Post('entities/:entityId/clearance-offer')
  setClearanceOffer(@Param('entityId') entityId: string, @Body() dto: ClearanceOfferDto, @Actor() actor: IntrospectionResult): ClearanceOffer {
    return this.imports.setOffer(
      this.actingCompany(actor, entityId),
      { specialisms: dto.specialisms, places: dto.places, words: dto.words },
      this.namedActor(actor, dto.by),
    );
  }

  /**
   * FINDING AN AGENT — @Public, because this is market dynamics and a directory nobody can read is not one.
   *
   * §6a refused a RANKED directory and that refusal holds in full. This answers with a list of PAGES,
   * ordered alphabetically and saying so in `basis`, so that advertising more cannot move anybody up it.
   * There is no relevance score, because a relevance score is the league table wearing a name that hides
   * it — and while this network is the party an importer appoints an agent through, publishing an ordering
   * of them is self-dealing.
   *
   * WHAT STOPS IT BEING GAMED is not a gate on the claim: we do not check claims, and an agent who claims
   * everything appears in every list. It is that every result carries the claim NEXT TO the record, so a
   * claim with nothing behind it and a claim with forty consignments behind it are visibly different.
   * Claiming more gets you seen; it does not get you credited.
   */
  @Public()
  @Get('agents/find')
  findAgents(@Query() q: FindAgentsQueryDto): AgentFinderResponse {
    const rows = this.imports.findAgents({ specialism: q.specialism, place: q.place, country: q.country });
    return {
      // A directory that says "go and ring them" and prints no number is half a directory. The card is the
      // agent's own entry, written and published by them, and it is the SAME card the yard finder shows.
      items: rows.map((r) => ({
        ...r,
        ...(this.handleOf(r.entityId) ? { handle: this.handleOf(r.entityId) } : {}),
        ...(this.contacts.of(r.entityId) ? { contact: { ...this.contacts.of(r.entityId)!, basis: CONTACT_BASIS } } : {}),
      })),
      total: rows.length,
      basis: 'alphabetical-never-ranked',
    };
  }

  /* ---- the places a company keeps: the ports it collects from, the addresses it delivers to ---- */

  /**
   * Save a place. One company's own list — see SiteService for why it is not pooled.
   *
   * The point comes from a dropped pin or from an address resolved through the gazetteer, and the record
   * says WHICH, because a resolved address is the centre of a town and a pin is somebody pointing at a
   * gate. Both end up on a consignment note, where the difference has legal weight.
   */
  @Roles('operator', 'entity_admin', 'business')
  @Post('entities/:entityId/sites')
  declareSite(@Param('entityId') entityId: string, @Body() dto: DeclareSiteDto, @Actor() actor: IntrospectionResult): Site {
    return this.sites.declare(
      this.actingCompany(actor, entityId),
      { kind: dto.kind, name: dto.name, ...(dto.location ? { location: dto.location } : {}), ...(dto.address ? { address: dto.address } : {}) },
      this.namedActor(actor, dto.by),
    );
  }

  /** This company's saved places, alphabetical. Theirs alone: nobody else's list is reachable here. */
  @Roles('operator', 'entity_admin', 'business')
  @Get('entities/:entityId/sites')
  sitesOf(@Param('entityId') entityId: string, @Query() q: SitesQueryDto, @Actor() actor: IntrospectionResult): { sites: Site[]; basis: string } {
    return { sites: this.sites.list(this.actingCompany(actor, entityId), q.kind), basis: SITE_BASIS };
  }

  /** CL2b — mint the road leg from the port. A person does this; we observe no arrival and invent none. */
  @Roles('operator', 'entity_admin', 'business')
  @Post('imports/:importId/road-leg')
  mintImportRoadLeg(@Param('importId') importId: string, @Body() dto: MintRoadLegDto, @Actor() actor: IntrospectionResult): ImportDetail {
    const acting = this.actingCompany(actor, dto.entityId);
    /*
     * A SAVED PLACE ANSWERS BOTH QUESTIONS AT ONCE — the point a truck is routed to and the name that
     * goes on the consignment note. Resolved here rather than inside the import service, which has no
     * business knowing about somebody's address book; what it receives is the same shape it always did.
     */
    const from = dto.pickupSiteId ? this.sites.require(acting, dto.pickupSiteId) : undefined;
    const to = dto.destSiteId ? this.sites.require(acting, dto.destSiteId) : undefined;
    const pickupLocation = from?.location ?? dto.pickupLocation;
    if (!pickupLocation) throw new GlosError('FIELD_REQUIRED', 'Say which port it is collected from');
    const destLabel = to ? (to.address ?? to.name) : dto.destLabel;
    if (!destLabel) throw new GlosError('FIELD_REQUIRED', 'Say where the container is going');
    return this.imports.mintRoadLeg(
      importId,
      acting,
      {
        pickupLocation,
        pickupLabel: from?.name ?? dto.pickupLabel,
        destLabel,
        destLocation: to?.location ?? dto.destLocation,
        weightKg: dto.weightKg,
      },
      this.namedActor(actor, dto.by),
    );
  }

  /**
   * The group and its sister companies — who is registered where, and which of them may transact.
   * Operator-only: it is the shape of the business, not a public directory. Structural facts only;
   * no balances, no accounts (those belong to the sisters' books, which do not exist yet).
   */
  @Roles('operator', 'entity_admin')
  @Get('entities')
  listEntities(@Actor() actor: IntrospectionResult) {
    // An operator sees the whole structure; an administrator sees only what it administers. Filtering
    // HERE rather than on the screen is the point: a console can only render what it was given.
    // Never a customer's business: this is the structure of OUR companies, read by the rates, money and register
    // screens. Businesses have their own staff list (`GET businesses`).
    const rows = (actor?.role === 'operator' ? this.entities.list() : this.entities.administrable(actor?.tenant)).filter((e) => e.kind !== 'business');
    return rows.map((e) => ({ ...e, holdsCustody: this.entities.canHoldCustody(e.entityId) }));
  }

  /**
   * A sister's books: the trial balance, whether it balances, and the coverage read — money held against
   * money owed. Operator-only, and the closest thing the network has to an answer for "are we solvent",
   * which could not even be ASKED before the postings existed.
   */
  @Roles('operator', 'entity_admin')
  @Get('entities/:entityId/books')
  entityBooks(@Param('entityId') entityId: string, @Actor() actor: IntrospectionResult) {
    this.requireReach(actor, entityId);
    return {
      entityId,
      accounts: this.books.trialBalance(entityId),
      integrity: this.books.balances(entityId),
      coverage: this.books.coverage(entityId),
    };
  }

  /* ------------------------------------------------ paying the people we owe -- */

  /**
   * Settle today's provider payables — raise a payout for everybody this sister owes.
   *
   * It RAISES, it does not pay: the run decides, the rail carries, and only the rail's answer moves the
   * books. Idempotent per payee per day, so a retry, an overlapping cron or two operators pressing the
   * same button cannot pay one day's work twice. A payee it cannot cover is SKIPPED and told why — a
   * part-payment nobody asked for reads as a wrong amount rather than as short cash.
   */
  @Roles('operator')
  @Post('entities/:entityId/payouts/run')
  runPayouts(@Param('entityId') entityId: string) {
    return this.payouts.runFor(entityId);
  }

  /** Hand a raised payout to the rail. Still not a payment — an attempt, with a reference. */
  @Roles('operator')
  @Post('payouts/:payoutId/submit')
  submitPayout(@Param('payoutId') payoutId: string) {
    return this.payouts.submit(payoutId);
  }

  /**
   * The rail says it landed — the one call that moves money in the books.
   *
   * Operator-gated because in the sandbox a person presses it. In a live deployment this is what the
   * provider's callback drives, and the door is deliberately the same one: nothing above here is allowed
   * to learn that a payment can complete merely because we asked for it.
   */
  @Roles('operator')
  @Post('payouts/:payoutId/settle')
  settlePayout(@Param('payoutId') payoutId: string, @Body() dto: PayoutSettleDto) {
    return this.payouts.settle(payoutId, dto.providerRef);
  }

  /** It did not go. The payable stands, because the money is still owed. */
  @Roles('operator')
  @Post('payouts/:payoutId/fail')
  failPayout(@Param('payoutId') payoutId: string, @Body() dto: PayoutFailureDto) {
    return this.payouts.fail(payoutId, dto.reason);
  }

  /** It went and came back. Its own entry, never an unwinding of the first. */
  @Roles('operator')
  @Post('payouts/:payoutId/reverse')
  reversePayout(@Param('payoutId') payoutId: string, @Body() dto: PayoutFailureDto) {
    return this.payouts.reverse(payoutId, dto.reason);
  }

  /** A sister's payouts, newest first — the settlement page. */
  /**
   * What this company has raised for the people it owes.
   *
   * READABLE by the company itself, because it is its own money and its own obligations — the same
   * reasoning that lets a sister read its own books. RAISING a run and moving a payout along the rail
   * stay with network staff: those are acts on a payment rail, and a company telling the network that
   * money has left is not a claim it gets to make about itself.
   */
  @Roles('operator', 'entity_admin')
  @Get('entities/:entityId/payouts')
  listPayouts(@Param('entityId') entityId: string, @Actor() actor: IntrospectionResult) {
    this.requireReach(actor, entityId);
    return { items: this.payouts.list({ entityId }) };
  }

  /**
   * Everything one sister charges, on every lane, in one read — what it earns, what it collects for an
   * authority, what it covers, where each of those answers came from, and the bounds the next edit will be
   * held to.
   *
   * The endpoint the operator console's rate screen is built on. The knobs below can each be read one lane
   * at a time, which is the right shape for a service asking about one shipment and the wrong shape for a
   * person deciding whether a lane should differ from the default: that is a comparison, and it needs the
   * whole table at once.
   *
   * Operator-only like its neighbours. The three-layer split is for running the business and is never
   * customer-facing on either side.
   */
  @Roles('operator', 'entity_admin')
  @Get('entities/:entityId/pricing')
  entityPricing(@Param('entityId') entityId: string, @Actor() actor: IntrospectionResult): EntityPricing {
    this.requireReach(actor, entityId);
    // The lane vocabulary is passed IN because it belongs to this module: foundation holds numbers against
    // keys and has always refused to learn what a parcel is.
    // `editable` is the same question this route already answered to get here, reported so the screen
    // renders what the caller can actually do instead of guessing at it.
    return this.entities.pricingFor(entityId, [...CARGO_LANES], { editable: true });
  }

  /** What was changed here, by whom, and what it was before. Same reach as the knobs themselves. */
  @Roles('operator', 'entity_admin')
  @Get('entities/:entityId/changes')
  entityChanges(@Param('entityId') entityId: string, @Actor() actor: IntrospectionResult): EntityChanges {
    this.requireReach(actor, entityId);
    return { entityId, items: this.entities.changes(entityId) };
  }

  /* ------------------------------------------------ who administers a company -- */

  /**
   * Create an administrator for a company.
   *
   * There is deliberately NO public route to this. An administrator is created by somebody who already
   * administers the company — network staff, or the group's own admin over its sisters — because a
   * signup form that could mint "admin of SeeBuyGet Kenya" for whoever asked would make every other rule
   * about who may change a price decoration.
   *
   * The password comes back EXACTLY ONCE and is never stored in a form anybody can read again.
   */
  @Roles('operator', 'entity_admin')
  @Post('entities/:entityId/admins')
  createEntityAdmin(@Param('entityId') entityId: string, @Body() dto: EntityAdminDto, @Actor() actor: IntrospectionResult) {
    this.requireReach(actor, entityId);
    return this.entityAdmins.create(entityId, { email: dto.email, name: dto.name }, auditActor(actor));
  }

  /** Who administers this company. Never a hash, never anybody else's company. */
  @Roles('operator', 'entity_admin')
  @Get('entities/:entityId/admins')
  listEntityAdmins(@Param('entityId') entityId: string, @Actor() actor: IntrospectionResult): { items: EntityAdminView[] } {
    this.requireReach(actor, entityId);
    return { items: this.entityAdmins.list(entityId) };
  }

  /** Take a login away. The record is KEPT — "who changed this rate in March" outlives the person. */
  @Roles('operator', 'entity_admin')
  @Delete('entities/:entityId/admins/:adminId')
  revokeEntityAdmin(@Param('entityId') entityId: string, @Param('adminId') adminId: string, @Actor() actor: IntrospectionResult): EntityAdminView {
    this.requireReach(actor, entityId);
    return this.entityAdmins.revoke(entityId, adminId, auditActor(actor));
  }

  /* ------------------------------------------------------ who works for the network -- */

  /**
   * Make a staff account with the SETUP KEY, alone — outside a sandbox only while nobody can sign in. A member of
   * staff with an account of their own never makes another alone, anywhere: they ask (`operators/proposals`) and a
   * second person approves. One stolen staff sign-in must not be able to become two people.
   */
  @Roles('operator')
  @SetupKeyMay()
  @Post('operators')
  createOperator(@Body() dto: EntityAdminDto, @Actor() actor: IntrospectionResult) {
    if (staffIdOf(actor?.revocationKey)) {
      throw new GlosError('FORBIDDEN', 'Ask for the account instead, and a second member of staff approves it. Nobody on staff makes another sign-in alone.');
    }
    return this.operatorAccounts.create({ email: dto.email, name: dto.name }, auditActor(actor));
  }

  /** Every staff account that can still sign in, and the ones asked for that wait for a second member of staff. */
  @Roles('operator')
  @SetupKeyMay()
  @Get('operators')
  listOperators(@Actor() actor: IntrospectionResult): StaffAccountList {
    return {
      items: this.operatorAccounts.list(),
      waiting: this.operatorAccounts.waitingFor(staffIdOf(actor?.revocationKey)),
      // Outside a sandbox this is all the setup key reaches: said, so the console shows it and nothing else.
      ...(setupKeyOutsideSandbox(actor) ? { setupOnly: true } : {}),
    };
  }

  /** A member of staff ASKS for a new staff account. Nothing can sign in until a second member approves it. */
  @Roles('operator')
  @Post('operators/proposals')
  proposeOperator(@Body() dto: EntityAdminDto, @Actor() actor: IntrospectionResult): StaffProposalView {
    return this.operatorAccounts.propose({ email: dto.email, name: dto.name }, this.staffSelf(actor));
  }

  /**
   * The second person approves — never the one who asked. A member of staff; or the setup key, for somebody who is the
   * only one able to sign in. No password is made: the new person is emailed a link to choose their own.
   */
  @Roles('operator')
  @SetupKeyMay()
  @Post('operators/proposals/:proposalId/approve')
  approveOperator(@Param('proposalId') proposalId: string, @Actor() actor: IntrospectionResult): Promise<StaffInvited> {
    const operatorId = staffIdOf(actor?.revocationKey);
    return this.operatorAccounts.approve(proposalId, operatorId ? { operatorId } : { setupKey: true });
  }

  /** Send somebody who has not chosen a password yet a NEW link, to their own address. The old one stops working. */
  @Roles('operator')
  @Post('operators/:operatorId/welcome-link')
  resendStaffWelcome(@Param('operatorId') operatorId: string): Promise<StaffInvited> {
    return this.operatorAccounts.sendWelcome(operatorId);
  }

  /** Whose link is this? Asked by the console before it shows "choose your password". One answer for every bad link. */
  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit(20, 15 * 60)
  @Post('operators/welcome/check')
  staffWelcomeCheck(@Body() dto: StaffWelcomeCheckDto, @Req() req: { ip?: string }) {
    this.assertStaffNetwork(req.ip);
    return this.operatorAccounts.welcomeFor(dto.token);
  }

  /** A new member of staff chooses their own password, proven by the link they were emailed. It works once. */
  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit(20, 15 * 60)
  @Post('operators/welcome')
  staffWelcome(@Body() dto: StaffWelcomeDto, @Req() req: { ip?: string }) {
    this.assertStaffNetwork(req.ip);
    return this.operatorAccounts.choosePassword(dto.token, dto.password);
  }

  /** The setup key asked to take a sign-in away, and everybody was told: any member of staff stops it. */
  @Roles('operator')
  @Post('operators/:operatorId/removal/stop')
  stopStaffRemoval(@Param('operatorId') operatorId: string, @Actor() actor: IntrospectionResult): OperatorAccountView {
    return this.operatorAccounts.stopRemoval(operatorId, this.staffSelf(actor));
  }

  /** Decline an account somebody asked for, with the reason — or take back your own. */
  @Roles('operator')
  @Post('operators/proposals/:proposalId/decline')
  declineOperator(@Param('proposalId') proposalId: string, @Body() dto: StaffProposalDeclineDto, @Actor() actor: IntrospectionResult) {
    return this.operatorAccounts.decline(proposalId, this.staffSelf(actor), dto.reason);
  }

  /**
   * Take a staff login away. By a member of staff: at once, and its open sessions end; the record is kept. By the
   * SETUP KEY outside a sandbox: announced to everybody on staff first, and finished a day later unless one stops it.
   */
  @Roles('operator')
  @SetupKeyMay()
  @Delete('operators/:operatorId')
  revokeOperator(@Param('operatorId') operatorId: string, @Actor() actor: IntrospectionResult): OperatorAccountView {
    return staffIdOf(actor?.revocationKey) ? this.operatorAccounts.revoke(operatorId, auditActor(actor)) : this.operatorAccounts.removeByKey(operatorId);
  }

  /**
   * A staff member signs in: the password, then the code from their authenticator app. The token carries their name,
   * so nothing has to be typed beside it. An account without two-step sign-in, where it is required, is answered
   * with a secret to scan instead of a token. Rate-limited per caller; each account's code also locks after five misses.
   */
  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit(20, 15 * 60)
  @Post('operators/login')
  operatorLogin(@Body() dto: StaffLoginDto, @Req() req: { ip?: string }) {
    this.assertStaffNetwork(req.ip);
    return this.operatorAccounts.login(dto.email, dto.password, dto.code);
  }

  /** A staff member changes their own password, proven with the current one. */
  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit(20, 15 * 60)
  @Post('operators/password')
  changeOperatorPassword(@Body() dto: EntityAdminPasswordDto, @Req() req: { ip?: string }) {
    this.assertStaffNetwork(req.ip);
    return this.operatorAccounts.changePassword(dto.email, dto.password, dto.newPassword);
  }

  /** The signed-in member of staff's own account — what their Settings reads. */
  @Roles('operator')
  @Get('operators/me')
  myStaffAccount(@Actor() actor: IntrospectionResult) {
    return this.operatorAccounts.view(this.staffSelf(actor).operatorId);
  }

  /** Set up two-step sign-in from Settings: a secret to scan. Its first code turns it on (`…/confirm`). */
  @Roles('operator')
  @Post('operators/me/two-step')
  startTwoStep(@Actor() actor: IntrospectionResult) {
    return this.operatorAccounts.startTwoStep(this.staffSelf(actor).operatorId);
  }

  @Roles('operator')
  @Post('operators/me/two-step/confirm')
  confirmTwoStep(@Body() dto: TwoStepCodeDto, @Actor() actor: IntrospectionResult) {
    return this.operatorAccounts.confirmTwoStep(this.staffSelf(actor).operatorId, dto.code);
  }

  /**
   * Somebody lost their authenticator. The first member of staff to call this ASKS; a second, different one — and
   * neither of them the person concerned — completes it. Their sessions end; the next sign-in sets it up again.
   */
  @Roles('operator')
  @Post('operators/:operatorId/two-step/reset')
  resetTwoStep(@Param('operatorId') operatorId: string, @Actor() actor: IntrospectionResult) {
    return this.operatorAccounts.resetTwoStep(operatorId, this.staffSelf(actor));
  }

  /** Staff sign-in is fenced to the networks a deployment names (`GLOS_STAFF_NETWORKS`); open everywhere when it names none. */
  private assertStaffNetwork(ip: string | undefined): void {
    if (!staffNetworkAllows(ip)) throw new GlosError('FORBIDDEN', 'Staff sign-in is open only from the networks SeeBuyGet staff work on');
  }

  /** The member of staff behind this token. The shared setup key is nobody in particular, so it cannot act as one. */
  private staffSelf(actor: IntrospectionResult | undefined): { operatorId: string; name: string } {
    const operatorId = staffIdOf(actor?.revocationKey);
    if (!operatorId) throw new GlosError('FORBIDDEN', 'Sign in with your own staff account — the setup key cannot tell two people apart');
    return { operatorId, name: auditActor(actor) };
  }

  /**
   * A company administrator signs in — @Public, like every other login on the network.
   *
   * The token it mints carries the ENTITY (the person acts as the company) and the person's NAME, which
   * is what the audit trail records. That name is established here, at login, rather than typed into a
   * request body later: a self-asserted name is a name anybody can type.
   */
  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit(20, 15 * 60)
  @Post('entities/admins/login')
  entityAdminLogin(@Body() dto: EntityAdminLoginDto) {
    return this.entityAdmins.login(dto.email, dto.password);
  }

  /**
   * Change your own password — @Public because it proves itself with the CURRENT one.
   *
   * The other half of handing somebody a generated password: without it, "have them change it" is advice
   * nobody can take. It is deliberately not gated on the session: a tab left signed in is not proof that
   * the person at it is the account holder, and the old password is.
   */
  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit(20, 15 * 60)
  @Post('entities/admins/password')
  changeEntityAdminPassword(@Body() dto: EntityAdminPasswordDto) {
    return this.entityAdmins.changePassword(dto.email, dto.password, dto.newPassword);
  }

  /**
   * Turn a sister's margin knob. Operator-gated today because there is no per-sister admin role yet —
   * when there is, this is the endpoint it owns, scoped to its own entity and nobody else's.
   *
   * It reprices nothing already quoted: every parcel carries the rate it was minted at.
   */
  @Roles('operator', 'entity_admin')
  @Post('entities/:entityId/fee')
  setEntityFee(@Param('entityId') entityId: string, @Body() dto: EntityFeeDto, @Actor() actor: IntrospectionResult) {
    this.requireReach(actor, entityId);
    return this.entities.setFeePct(entityId, dto.feePct, auditActor(actor));
  }

  /**
   * Turn a sister's rate knobs — cost of risk, profit on risk, margin — for one lane of work or for
   * everything it does.
   *
   * Three layers rather than one number because they answer different questions, and blended they answer
   * none: a sister earning well cannot otherwise tell whether the market is good or whether it is carrying
   * risk nobody is paying for. They ADD, they do not compound, and their sum is bounded so three
   * innocent-looking numbers cannot price a market out of existence.
   *
   * Operator-gated for now, like the knob above. When sisters get their own administration this is one of
   * the endpoints it owns — scoped to its own entity — and a group-level console reads them side by side.
   */
  @Roles('operator', 'entity_admin')
  @Post('entities/:entityId/rates')
  setEntityRates(@Param('entityId') entityId: string, @Body() dto: EntityRatesDto, @Actor() actor: IntrospectionResult) {
    this.requireReach(actor, entityId);
    return this.entities.setRates(entityId, dto, auditActor(actor));
  }

  /** What this sister actually charges for a lane of work, with the three layers stated. Operator-only:
   *  the split is for running the business, never for a customer. */
  @Roles('operator', 'entity_admin')
  @Get('entities/:entityId/rates')
  entityRates(@Param('entityId') entityId: string, @Actor() actor: IntrospectionResult, @Query('lane') lane?: string) {
    this.requireReach(actor, entityId);
    return { entityId, lane: lane ?? null, ...this.entities.ratesFor(entityId, lane) };
  }

  /**
   * Set what a sister charges a shop or a store to put money in.
   *
   * The knob behind a design decided on 2026-08-18: the payment provider's cost is per PAYMENT, so it is
   * recovered where it occurs rather than baked into a parcel price where the shop that tops up sensibly
   * would be subsidising the one that drips. Flat below a threshold, free above it.
   *
   * Sending `{}` REMOVES the rule, which is how a sister says it charges nothing — distinct from a fee of
   * zero, which the service refuses. Absent means no fee anywhere it is read, so removal is a real and
   * reachable state rather than a number small enough to ignore.
   *
   * It reprices nothing already asked for: a funding request carries the terms it was opened under.
   */
  @Roles('operator', 'entity_admin')
  @Post('entities/:entityId/top-up-fee')
  setEntityTopUpFee(@Param('entityId') entityId: string, @Body() dto: EntityTopUpFeeDto, @Actor() actor: IntrospectionResult) {
    this.requireReach(actor, entityId);
    const removing = dto.freeAbove === undefined && dto.amount === undefined;
    return this.entities.setTopUpFee(entityId, removing ? null : { freeAbove: dto.freeAbove as number, amount: dto.amount as number }, auditActor(actor));
  }

  /**
   * Set what a parcel costs and what each step pays at this company, in its own money.
   *
   * These were constants in the code. Each company now keeps its own figure where it has set one and stands at what
   * every company starts from where it has not, so nothing moves until somebody decides it should.
   *
   * It reprices nothing that has happened: a parcel keeps what its shop was charged and paid at the counter, and a
   * parcel already past its free time keeps the daily rate it started at. A step done after the change is paid at
   * the new figure.
   */
  @Roles('operator', 'entity_admin')
  @Post('entities/:entityId/amounts')
  setEntityAmounts(@Param('entityId') entityId: string, @Body() dto: EntityAmountsDto, @Actor() actor: IntrospectionResult) {
    this.requireReach(actor, entityId);
    const entity = this.entities.setAmounts(entityId, { ...dto }, auditActor(actor));
    // THE PRICE OF A PARCEL IS THE FLOAT A SHOP NEEDS, so every open or shut counter of this company is judged again
    // against the new one, now. A shop's state is otherwise only worked out when money moves on its own float: a
    // shop shut at the old price would stay shut at a price it can afford until its next payment. Only shops that
    // are open or shut — one that was never funded is not opened by a change of price.
    for (const shop of this.agents.list()) {
      if ((shop.status === 'ACTIVE' || shop.status === 'LOCKED') && this.agents.entityIdOrNone(shop) === entityId) this.agents.refreshLock(shop.did);
    }
    return entity;
  }

  /**
   * Set the tax a sister collects — a different kind of knob from the three above, and the one place in
   * this system where a rate is not ours to choose.
   *
   * Two things it refuses. A rate above zero without a registration number: charging tax you are not
   * registered to collect is money taken from a customer in the name of an authority that has never heard
   * of you. And the group: it is the merchant of record nowhere, so it collects nothing anywhere.
   *
   * Like every other rate here it reprices nothing already sold — a shipment carries the tax rate it was
   * minted at, because a rate change has a date and every sale before it was correctly taxed at the old one.
   */
  @Roles('operator', 'entity_admin')
  @Post('entities/:entityId/tax')
  setEntityTax(@Param('entityId') entityId: string, @Body() dto: EntityTaxDto, @Actor() actor: IntrospectionResult) {
    this.requireReach(actor, entityId);
    return this.entities.setTax(entityId, dto, auditActor(actor));
  }

  /** The tax that applies to a lane of work, and the registration it is collected under. Operator-gated
   *  like its neighbours, though unlike the rate split this is not a secret: what a customer was charged
   *  and by whom appears on their own receipt. */
  @Roles('operator', 'entity_admin')
  @Get('entities/:entityId/tax')
  entityTax(@Param('entityId') entityId: string, @Actor() actor: IntrospectionResult, @Query('lane') lane?: string) {
    this.requireReach(actor, entityId);
    return { entityId, lane: lane ?? null, ...this.entities.taxFor(entityId, lane) };
  }

  /**
   * Set what a sister covers when it breaks something, and what it charges to cover more.
   *
   * This is the policy an upheld damage award is checked against. Until it existed the network's
   * liability was undefined — an adjudicator had a number to type and nothing to check it against — and
   * a sanity bound in a service method was standing in for a commercial decision.
   *
   * Every sister starts covering nothing, because a free limit invented in this codebase would be a
   * promise nobody costed. Setting one is a deliberate commercial act, exactly like the rates and the tax.
   */
  @Roles('operator', 'entity_admin')
  @Post('entities/:entityId/insurance')
  setEntityInsurance(@Param('entityId') entityId: string, @Body() dto: EntityInsuranceDto, @Actor() actor: IntrospectionResult) {
    this.requireReach(actor, entityId);
    return this.entities.setInsurance(entityId, dto, auditActor(actor));
  }

  /** What this sister covers on a lane of work. Not a secret — a shipper cannot decide whether to declare
   *  a value without knowing what is already covered and what more would cost, so the same figures ride
   *  on every public quote. */
  @Roles('operator', 'entity_admin')
  @Get('entities/:entityId/insurance')
  entityInsurance(@Param('entityId') entityId: string, @Actor() actor: IntrospectionResult, @Query('lane') lane?: string) {
    this.requireReach(actor, entityId);
    return { entityId, lane: lane ?? null, ...this.entities.insuranceFor(entityId, lane) };
  }

  /**
   * Say which of a CARRIER's own papers this sister will not trade without.
   *
   * The dates themselves are recorded and shown whatever is set here — this decides only the consequence
   * of one having lapsed: the carrier's runs come off the board and it can be sold no new work, or it
   * stays a red row somebody has to act on. See CarrierPapersRule for why nothing is the default.
   *
   * The whole list, every time. "Which papers do you enforce" has a complete answer, and a patch could
   * never express turning the last one off.
   */
  @Roles('operator', 'entity_admin')
  @Post('entities/:entityId/carrier-papers')
  setEntityCarrierPapers(@Param('entityId') entityId: string, @Body() dto: CarrierPapersDto, @Actor() actor: IntrospectionResult) {
    this.requireReach(actor, entityId);
    return this.entities.setCarrierPapers(entityId, dto.enforce ?? [], auditActor(actor));
  }

  /** What this sister enforces against its carriers. An empty list is the answer for most of them. */
  @Roles('operator', 'entity_admin')
  @Get('entities/:entityId/carrier-papers')
  entityCarrierPapers(@Param('entityId') entityId: string, @Actor() actor: IntrospectionResult) {
    this.requireReach(actor, entityId);
    return { entityId, ...this.entities.carrierPapersFor(entityId) };
  }

  /**
   * What a margin change actually did. Not just what each rate earned — that half is arithmetic — but
   * what happened to the NUMBER of shipments after it, which can only be observed. Read as a timeline of
   * spells, so a rate raised and then lowered again shows as two separate periods to compare.
   */
  @Roles('operator', 'entity_admin')
  @Get('entities/:entityId/rate-impact')
  entityRateImpact(@Param('entityId') entityId: string, @Actor() actor: IntrospectionResult) {
    this.requireReach(actor, entityId);
    const entity = this.entities.get(entityId);
    return { entityId, currency: entity.currency, currentPct: this.entities.feePctOf(entityId), ...this.parcels.rateImpact(entityId) };
  }

  /** Operator KYC review queue — agents awaiting a decision. */
  @Roles('operator')
  @Get('agents/kyc-queue')
  kycQueue() {
    return this.agents.kycQueue();
  }

  /**
   * Shops that started joining and stopped.
   *
   * Deliberately NOT part of the KYC queue: nothing here is waiting on a decision by us, so it does not
   * belong in a list whose count means "somebody must act". It is a list of people to ring.
   */
  @Roles('operator')
  @Get('agents/unfinished')
  unfinishedSignups() {
    return { items: this.agents.unfinished() };
  }

  @Roles('agent', 'operator')
  @Post('agents/:did/ping')
  ping(@Param('did') did: string, @Actor() actor: IntrospectionResult) {
    this.assertAgentActs(did, actor);
    return this.agents.ping(did);
  }

  /** Agent marks the shop open or temporarily closed. */
  @Roles('agent', 'operator')
  @Post('agents/:did/availability')
  setAvailability(@Param('did') did: string, @Body() dto: AvailabilityDto, @Actor() actor: IntrospectionResult) {
    this.assertAgentActs(did, actor);
    return this.agents.setAvailability(did, dto.open);
  }

  /** Set the weekly opening schedule (pickup window + ETA constraint). */
  @Roles('agent', 'operator')
  @Post('agents/:did/hours')
  setHours(@Param('did') did: string, @Body() dto: SetHoursDto, @Actor() actor: IntrospectionResult) {
    this.assertAgentActs(did, actor);
    return this.agents.setHours(did, dto.openingHours);
  }

  /** Reconfigure the shelf grid (rows × columns). */
  @Roles('agent', 'operator')
  @Post('agents/:did/shelf')
  setShelf(@Param('did') did: string, @Body() dto: ShelfDto, @Actor() actor: IntrospectionResult) {
    this.assertAgentActs(did, actor);
    return this.agents.setShelf(did, dto);
  }

  /** Declare the floor room for outbound BAGS — the shelf's counterpart for the other pile in the room. */
  @Roles('agent', 'operator')
  @Post('agents/:did/bag-bays')
  setBagBays(@Param('did') did: string, @Body() dto: BagBaysDto, @Actor() actor: IntrospectionResult) {
    return this.agents.setBagBays(actingDid(actor, did), dto.bays);
  }

  /** Move the shop's map pin (My-shop location editor). */
  @Roles('agent', 'operator')
  @Post('agents/:did/location')
  setLocation(@Param('did') did: string, @Body() dto: SetLocationDto, @Actor() actor: IntrospectionResult) {
    this.assertAgentActs(did, actor);
    return this.agents.setLocation(did, { lat: dto.lat, lng: dto.lng });
  }

  /** Set (or clear) the shop-front photo shown on the My-shop dashboard. */
  @Roles('agent', 'operator')
  @Post('agents/:did/shopfront')
  setShopfront(@Param('did') did: string, @Body() dto: ShopfrontDto, @Actor() actor: IntrospectionResult) {
    this.assertAgentActs(did, actor);
    return this.agents.setShopfront(did, dto.mediaId);
  }

  /**
   * What this shop should be bagging: its waiting parcels grouped by NEXT HOP, plus the bags it already
   * has open. Several bags at once is the normal case — direct-to-Addis alongside one for the local hub.
   */
  @Roles('agent', 'operator')
  @Get('agents/:did/bag-plan')
  bagPlan(@Param('did') did: string, @Actor() actor: IntrospectionResult) {
    return this.bagPlans.forShop(actingDid(actor, did));
  }

  /** Drop a waiting parcel into the shop's bag — refuses one that is going somewhere else. */
  @Roles('agent', 'operator')
  @Post('agents/:did/totes/:code/fill')
  fillShopBag(@Param('did') did: string, @Param('code') code: string, @Body() dto: FillToteDto, @Actor() actor: IntrospectionResult) {
    return this.mdps.fillShopBag(code, actingDid(actor, did), dto.parcelId);
  }

  /** Seal the bag — where the completeness gate lives for a bagged hand-over (see sealShopBag). */
  @Roles('agent', 'operator')
  @Post('agents/:did/totes/:code/seal')
  sealShopBag(@Param('did') did: string, @Param('code') code: string, @Body() dto: SealBagDto, @Actor() actor: IntrospectionResult) {
    return this.mdps.sealShopBag(code, actingDid(actor, did), dto);
  }

  /** The shelf grid + free-slot availability for a PUDO. */
  @Roles('agent', 'operator')
  @Get('agents/:did/shelf')
  getShelf(@Param('did') did: string, @Actor() actor: IntrospectionResult) {
    this.assertAgentOwner(did, actor);
    return { grid: this.shelf.grid(did), capacity: this.shelf.capacity(did), available: this.shelf.available(did) };
  }

  // `currency` travels with every balance that leaves the system: a bare number is ambiguous the moment
  // a second currency exists anywhere in the network, and that is a change nobody remembers to audit for.
  /** Every shop. Network staff read the whole record; anybody else signed in gets the card the public map shows. */
  @SignedIn()
  @Get('agents')
  listAgents(@Actor() actor: IntrospectionResult): object[] {
    // THE WHOLE RECORD IS THE NETWORK'S: a shop's float, its papers and what was said about them, the tablet it is
    // bound to. This answered ANY sign-in with all of it — the driver's app asks here for the places it can route
    // toward, and was handed every shop's balance with them.
    if (actor?.role !== 'operator') return this.agents.list().map((a) => this.shopCard(a));
    // Beside each float, what one parcel costs at that shop's own company and the money both are in: a float is thin
    // or not against THAT, and a console that measured every shop against one figure of its own could not say.
    return this.agents.list().map((a) => ({ ...a, balance: this.agents.balance(a.did), ...this.shopMoney(a.did), rating: this.ratings.agentRating(a.did), freeSlots: this.shelf.available(a.did), capacity: this.shelf.capacity(a.did) }));
  }

  @Roles('agent', 'operator')
  @Get('agents/:did')
  getAgent(@Param('did') did: string, @Actor() actor: IntrospectionResult) {
    this.assertAgentOwner(did, actor);
    const a = this.agents.get(did);
    return { ...a, balance: this.agents.balance(did), ...this.shopMoney(did), rating: this.ratings.agentRating(did) };
  }

  /** The money a shop's float is in, and what one parcel costs it there: its own company's (amounts.ts). */
  private shopMoney(did: string): { currency: string; parcelPrice: number } {
    const list = this.agents.amountsOf(did);
    return { currency: list.currency ?? NETWORK_CURRENCY, parcelPrice: list.wholesale };
  }

  /**
   * P3 — what this counter must SAY before it takes a walk-up in: whose promise the goods are under, who
   * answers for them, and the cover. Asked when the take-in screen opens rather than learned from a
   * refusal after the photo is taken. Owner-scoped: it names the sister behind this shop.
   */
  @Scopes('agent:read:self')
  @Get('agents/:did/take-in-terms')
  takeInTerms(@Param('did') did: string, @Actor() actor: IntrospectionResult) {
    this.assertAgentOwner(did, actor);
    return this.parcels.takeInTerms(did);
  }

  // --- pre-paid wallet (Light SSE) ---

  /**
   * 'No money, no scan' gate. Returns 200 with `{ ok, canTransact, code, balance, shortfall }` — a
   * locked wallet is a readable state, not an error status carrying a payload (S4). The client reads
   * `code` to choose between the top-up and unlock prompts.
   */
  @Roles('agent', 'operator')
  @Get('agents/:did/can-transact')
  canTransact(@Param('did') did: string, @Actor() actor: IntrospectionResult) {
    this.assertAgentOwner(did, actor);
    return this.gate.canTransact(did);
  }

  /**
   * ASK TO TOP UP. It hands back a reference and how to pay; **it moves no money.**
   *
   * Until 2026-09-22 this route credited the float with whatever number arrived in the body, and the
   * books recorded cash the network could not prove it held. Money is now created only by a confirmed
   * payment — rule 5 of the money model, and the user's own words: *"if a shop tops up then we need proof
   * of that… we need psp, airtime or mobile money webhook confirmation."* See `foundation/funding`.
   */
  @Roles('agent', 'operator')
  @Post('agents/:did/top-up')
  topUp(@Param('did') did: string, @Body() dto: TopUpDto, @Actor() actor: IntrospectionResult) {
    this.assertAgentActs(did, actor);
    return this.funding.open({ payerKind: 'agent', payerDid: did, amount: dto.amount, payerPhone: dto.phone });
  }

  /** What this shop is waiting to have confirmed, and what has been confirmed lately. Owner-scoped:
   *  it is their money and nobody else's business. */
  @Roles('agent', 'operator')
  @Get('agents/:did/funding')
  agentFunding(@Param('did') did: string, @Actor() actor: IntrospectionResult) {
    this.assertAgentActs(did, actor);
    // The TERMS travel with it, so the top-up sheet can say what a fee would be BEFORE the shop commits
    // to an amount. A charge somebody discovers afterwards is the opaque deduction this design refuses.
    return {
      open: this.funding.openFor(did),
      items: this.funding.list({ payerDid: did }).slice(0, 10),
      terms: this.entities.topUpFeeFor(this.agents.entityIdOf(this.agents.get(did)), 0),
    };
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

  /**
   * A CORRIDOR IS NETWORK GEOGRAPHY, AND ONLY THE NETWORK MAY DRAW IT.
   *
   * It is not one manager's route: a corridor is the promise that a bus runs between two zones, and the
   * whole network reads it. A shop may only take in a cross-zone parcel that some corridor serves
   * (`RoutingService.plan` refuses "no active corridor from X to Y" where no hub can route it instead),
   * and the shop-counter handover manifest is built from the corridor's destination zone. So one fleet
   * manager adding a corridor would change what shops in that zone are allowed to accept, and blocking
   * one would stop parcels being taken in by people who never heard of them.
   *
   * These three writes were UNLABELLED, which under the guard's pre-migration default means any valid
   * token at all — a driver's, a shopkeeper's — could draw a route across the network or close one.
   */
  @Roles('operator')
  @Post('corridors')
  addCorridor(@Body() dto: CorridorDto) {
    return this.corridors.addCorridor(dto);
  }

  /** Readable by everyone who has to work with them: the fleet app offers them, the agent app checks them. */
  @SignedIn()
  @Get('corridors')
  listCorridors(@Actor() actor: IntrospectionResult) {
    // A fleet's PROPOSED line is its plan, not yet geography: its own fleet and the operator see it.
    return this.corridors.visibleTo(actingTenant(actor), actor?.role === 'operator');
  }

  /** Blocking one stops every cross-zone take-in it was serving. Operator only, for that reason. */
  @Roles('operator')
  @Post('corridors/:id/status')
  setCorridorStatus(@Param('id') id: string, @Body() dto: CorridorStatusDto) {
    return this.corridors.setStatus(id, dto.status);
  }

  /**
   * F2 — the network publishes a fleet's proposed line. Operator only, for the same reason as drawing one:
   * a published line changes what every shop in its origin zone may take in.
   */
  @Roles('operator')
  @Post('corridors/:id/publish')
  publishCorridor(@Param('id') id: string, @Actor() actor: IntrospectionResult) {
    return this.corridors.publish(id, auditActor(actor, undefined));
  }

  /**
   * F1 — a fleet proposes a line its own vehicles will run. In a country where we only MATCH, the fleet is
   * the local operator, and this is how its routes enter the network at all. Pinned to the fleet on the
   * token: nobody proposes a line in somebody else's name.
   */
  @Roles('fleet_manager')
  @Post('fleet/lines')
  proposeLine(@Body() dto: ProposeLineDto, @Actor() actor: IntrospectionResult) {
    const managerDid = actingTenant(actor);
    const manager = managerDid ? this.managers.list().find((m) => m.did === managerDid) : undefined;
    if (!manager) throw new GlosError('FORBIDDEN', 'Only a fleet can propose a line of its own');
    if (manager.status !== 'ACTIVE') throw new GlosError('FORBIDDEN', `${manager.companyName} is not active on the network, so it cannot propose a line yet`);
    return this.corridors.proposeLine({ ...dto, managerDid: manager.did, company: manager.companyName });
  }

  /** The corridor whitelist — a badge that may take a handover without being a fleet driver at all. Same
   *  reasoning as the corridor itself, and a stronger one: this is the list that says who may be handed
   *  other people's goods. */
  @Roles('operator')
  @Post('drivers')
  addDriver(@Body() dto: DriverDto) {
    return this.corridors.addDriver(dto);
  }

  // Read by everybody who works with corridors, as the corridors themselves are (corridor-authority.spec.ts holds both).
  @SignedIn()
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

  @Roles('agent', 'operator')
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
  @Roles('agent', 'operator')
  @Post('parcels/book-freight')
  bookFreight(@Body() dto: BookFreightDto, @Actor() actor: IntrospectionResult) {
    const agentDid = actingDid(actor, dto.agentDid);
    const origin = this.agents.get(agentDid); // 404 if the acting id is not an agent
    if (dto.destPudoDid === agentDid) throw new GlosError('INVALID_INPUT', 'A shipment cannot be sent to the shop booking it — pick a different destination.');
    const dest = this.agents.get(dto.destPudoDid); // 404 on an unknown destination
    // Freight moves wherever the network operates: asked at the counter, of both ends, is only whether goods may be
    // taken in there. Where no sister stands the haul settles off-platform between shipper and carrier (the
    // conversation's settlement card records it) and the delivery books nothing for the driver — never a refusal.
    for (const end of [origin, dest]) this.presence.require(this.agents.countryOf(end), 'takeIn');
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
      // FB5 — the clerk is asked outright, because they are the one looking at it. Absent falls back to the
      // DEPLOYMENT default rather than to 'palletised': a walk-up in Nakuru arrives in sacks far more often
      // than on a pallet, and that is a fact about where the counter is, not about walk-ups.
      packaging: dto.packaging,
      // shipperDid intentionally omitted: a cash counter booking settles OFF-PLATFORM (paidStatus 'unpaid'), so
      // no wallet is billed — the customer's cash cap is the money, held by the agent (the F2 model the user chose).
      originEquipment: origin.equipment,
      destEquipment: dest.equipment,
      // CA6 — the country at each end, so the rules of crossing a border can be asked of this load.
      pickupCountry: this.agents.countryOf(origin),
      destCountry: this.agents.countryOf(dest),
      postedByDid: agentDid, // FB0c — the booking shop negotiates for it, even though the cash settles off-platform
      commitMode: dto.commitMode,
      // FB2c — the two facts only a person standing at the load can supply. They reach canonicalBody() inside
      // registerFreight, so the body stamped on this load is derived from what the counter actually saw.
      indivisible: dto.indivisible,
      bodyHint: dto.bodyHint as never,
      excludedBodies: dto.excludedBodies as never,
      buyerMobile: dto.customerMobile, // hashed on the freight (never the cleartext) so the customer can track it
      maxSpend: dto.budgetCap, // the cash cap → dispatch won't OFFER or let a driver CLAIM above it
      scheduledPickupAt: dto.scheduledPickupAt,
      allowEarlyClaim: dto.allowEarlyClaim,
      // FP7 — box 13, as the clerk took it down at the counter.
      instructions: dto.instructions,
      contactName: dto.contactName,
      contactPhone: dto.contactPhone,
      deliveryWindow: dto.deliveryWindow,
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

  @Roles('agent', 'operator')
  @Post('parcels/handover')
  handover(@Body() dto: HandoverDto, @Actor() actor: IntrospectionResult) {
    return this.parcels.handover({ ...dto, agentDid: actingDid(actor, dto.agentDid) });
  }

  @Roles('agent', 'operator')
  @Post('parcels/:id/arrive')
  arrive(@Param('id') id: string, @Body() dto: ArriveDto, @Actor() actor: IntrospectionResult) {
    return this.parcels.arrive(id, actingDid(actor, dto.destAgentDid));
  }

  @Roles('agent', 'operator')
  @Post('parcels/:id/pickup')
  pickup(@Param('id') id: string, @Body() dto: PickupDto, @Actor() actor: IntrospectionResult) {
    return this.parcels.pickup(id, actingDid(actor, dto.agentDid), dto.otp, dto.deliveredPhotoRef);
  }

  @Roles('agent', 'operator')
  @Post('parcels/:id/void')
  voidParcel(@Param('id') id: string, @Body() dto: VoidDto, @Actor() actor: IntrospectionResult) {
    return this.parcels.void(id, actingDid(actor, dto.agentDid), dto.voidedPhotoRef);
  }

  /**
   * The operational parcel list (agent + hub screens). PG2: PROJECTED for everyone but an operator —
   * the raw record carries phones, hashes and the handover secrets (collection code / OTP), none of
   * which a list surface needs; before this, ANY valid token could read them all.
   *
   * `status` takes a COMMA-SEPARATED list. A shop counter has two piles — what is waiting to go on a bus
   * and what a customer is coming to collect — and a single-status query made the second pile impossible
   * to ask for in one breath. The alternative, omitting the filter, returns every parcel the shop has ever
   * handled: unbounded, and growing, on the cheapest phone in the network.
   */
  @Roles('agent', 'mdp', 'operator')
  @Get('parcels')
  listParcels(@Query('status') status?: string, @Query('agent') agent?: string, @Actor() actor?: IntrospectionResult) {
    // WHOSE LIST. A shop's is its own parcels, whatever shop the request names; a hub's is what stands at it; staff
    // name any shop, or none. The shop used to come from the request alone, so any sign-in read any shop's parcels —
    // and, naming none, every parcel on the network.
    const staff = actor?.role === 'operator';
    const shop = staff ? agent : actor?.role === 'agent' ? actor.did : undefined;
    const hub = actor?.role === 'mdp' && actor.did ? this.mdps.list().find((m) => m.did === actor.did)?.mdpId : undefined;
    if (!staff && !shop && !hub) throw new GlosError('FORBIDDEN', 'The parcel list is a shop’s or a hub’s own');
    const wanted = (status ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const all = wanted.length
      ? wanted.flatMap((s) => this.parcels.list({ status: s as never, agentDid: shop }))
      : this.parcels.list({ agentDid: shop });
    const rows = hub ? all.filter((p) => p.atMdpId === hub) : all;
    return staff ? rows : rows.map(operationalParcelView);
  }

  @Roles('agent', 'operator')
  @Get('parcels/:id')
  getParcel(@Param('id') id: string) {
    return this.monitor.parcelTimeline(id);
  }

  /** The planned route for a parcel (origin PUDO → MDP(s) → dest PUDO), once a destination is known. */
  @Scopes('vendor:manage:self')
  @Get('parcels/:id/route')
  parcelRoute(@Param('id') id: string, @Actor() actor: IntrospectionResult) {
    const parcel = this.parcels.get(id);
    // Read by the store that shipped it (its screen after minting). A parcel no store shipped has no store to ask.
    if (actor?.role !== 'operator') {
      if (!parcel.vendorId) throw new GlosError('FORBIDDEN', 'This parcel was not shipped by your store');
      this.assertVendorOwner(parcel.vendorId, actor);
    }
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
  @Roles('agent', 'operator')
  @Post('agents/:did/receive-bag')
  receiveBag(@Param('did') did: string, @Body() dto: ReceiveBagDto, @Actor() actor: IntrospectionResult) {
    this.assertAgentActs(did, actor);
    return this.mdps.deliverBag(did, dto.code);
  }

  // --- e-commerce vendors + inbound pickup-at-PUDO ---

  /** Register an e-commerce vendor (returns a signing secret for callback verification).
   *  @Public (S15): this IS a signup — the same pre-auth reasoning as auth/signup. The
   *  secret is in the response exactly once; vendors/login is how it is used ever after. */
  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit(20, 15 * 60)
  @Post('vendors')
  registerVendor(@Body() dto: RegisterVendorDto) {
    const { email, password, ...store } = dto;
    // A store may bring its own signing secret (its shop system may already have one). It is a machine's credential,
    // and for a store with no account yet it still opens the console: so it is long, or it is ours — never "1234".
    if (dto.secret !== undefined && dto.secret.length < 24) throw new GlosError('VALIDATION_FAILED', 'A signing secret you choose yourself needs at least 24 characters. Leave it out and one is made for you', { field: 'secret' });
    const withAccount = email !== undefined || password !== undefined;
    // The account is checked BEFORE the store is made: an email somebody already holds must not leave a store behind it.
    if (withAccount) this.accounts.checkNewAccount(email, password, dto.name);
    const vendor = this.vendors.register(store);
    // S20: if the operator gave a phone, link this store to their person identity — same human, one account.
    if (dto.ownerPhone) this.persons.tryAttachRole(dto.ownerPhone, 'vendor', vendor.did);
    if (!withAccount) return vendor;
    // ITS OWN ACCOUNT, in the same act: the store signs in with these from now on, and never with its secret.
    const account = this.accounts.setUpStore({ did: vendor.did, name: vendor.name, email: email ?? '', password: password ?? '', phone: dto.ownerPhone });
    return { ...vendor, email: account.email, token: account.token };
  }

  /**
   * STORE SIGN-IN, BY ITS ACCOUNT: an email and a password → the same store-bound token the console has always
   * carried. @Public for the reason every sign-in is. One answer for everything that can be wrong.
   *
   * EVERY TRY IS COUNTED. The secret this replaces as the way in was 96 random bits; a password is something a
   * person chose, and a door that takes one without counting is a door that can be guessed at all night.
   */
  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit(20, 15 * 60)
  @Post('vendors/session')
  vendorSession(@Body() dto: LoginDto) {
    const account = this.accounts.storeLogin(dto.email, dto.password);
    const vendor = this.vendors.byDid(account.did);
    if (!vendor) throw new GlosError('AUTH_FAILED', 'Wrong email or password');
    return { ...VendorService.publicView(vendor), email: account.email, hasAccount: true, token: account.token };
  }

  /**
   * A STORE THAT ALREADY EXISTS SETS UP ITS ACCOUNT — signed in the old way, one last time. THE STORE'S OWN ACT AND
   * NOBODY ELSE'S: every other store route lets network staff act for a store (`assertVendorOwner`), and here that
   * would be staff choosing the password a store signs in with. So this route does not use that check. What refuses
   * staff today is that a staff token carries no store; the role is named as well, so that it stays refused if one
   * ever does.
   */
  @Scopes('vendor:manage:self')
  @Post('vendors/:id/account')
  setUpVendorAccount(@Param('id') id: string, @Body() dto: StoreAccountDto, @Actor() actor: IntrospectionResult) {
    const vendor = this.vendors.get(id);
    if (!actor?.did || actor.did !== vendor.did || actor.role === 'operator') throw new GlosError('FORBIDDEN', 'A store sets up its own account, signed in as that store');
    const account = this.accounts.setUpStore({ did: vendor.did, name: vendor.name, email: dto.email, password: dto.password });
    return { vendorId: vendor.vendorId, email: account.email, hasAccount: true, token: account.token };
  }

  /**
   * Merchant console sign-in (S15): store ID + the signing secret (issued once, at
   * registration) → a genesis-role actor token bound to the vendor's DID. @Public for the
   * same reason auth/login is: a caller cannot hold an actor token before signing in.
   */
  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit(20, 15 * 60)
  @Post('vendors/login')
  vendorLogin(@Body() dto: VendorLoginDto) {
    const vendor = this.vendors.login(dto.vendorId, dto.secret);
    // ONCE A STORE HAS AN ACCOUNT, ITS SECRET SIGNS NOBODY IN. Said only to somebody who holds the right secret, so
    // it tells a stranger nothing; and it is what makes the secret a machine's again rather than a second password.
    if (this.accounts.emailForDid(vendor.did)) throw new GlosError('FORBIDDEN', 'This store has an account: sign in with its email and password. The signing secret is for your own systems');
    return { ...VendorService.publicView(vendor), hasAccount: false, token: this.auth.mintActorToken({ role: 'genesis', did: vendor.did }) };
  }

  /**
   * Rotate the store's signing secret. The store's own token AND a second proof — a console left open is not
   * enough on its own. For a store with an account that proof is its PASSWORD, so a store that has lost its secret
   * can still replace it; for one without, it is the current secret, as before. The new secret is returned exactly
   * once, with a fresh sign-in for this device. The tries are counted: this asks for the password too, and a console
   * left open must not be a place to guess it from.
   */
  @UseGuards(RateLimitGuard)
  @RateLimit(20, 15 * 60)
  @Scopes('vendor:manage:self')
  @Post('vendors/:id/secret/rotate')
  rotateVendorSecret(@Param('id') id: string, @Body() dto: RotateSecretDto, @Actor() actor: IntrospectionResult) {
    this.assertVendorOwner(id, actor);
    const store = this.vendors.get(id);
    let vendor: ReturnType<VendorService['get']>;
    // A WRONG PROOF HERE IS A 403 OF ITS OWN, never a 401: the store is signed in, and every app reads a 401 as
    // "your sign-in ended" — one mistyped password would sign it out.
    if (this.accounts.emailForDid(store.did)) {
      if (!this.accounts.passwordOpens(store.did, dto.password)) throw new GlosError('PASSWORD_WRONG', 'That is not this store’s password');
      vendor = this.vendors.replaceSecret(id);
    } else {
      try {
        vendor = this.vendors.rotateSecret(id, dto.secret ?? '');
      } catch (err) {
        if (err instanceof GlosError && err.code === 'AUTH_FAILED') throw new GlosError('SECRET_WRONG', 'That is not this store’s current secret');
        throw err;
      }
    }
    return { vendorId: vendor.vendorId, secret: vendor.secret, secretRotatedAt: vendor.secretRotatedAt, token: this.auth.mintActorToken({ role: 'genesis', did: vendor.did }) };
  }

  @Roles('operator')
  @Get('vendors')
  listVendors() {
    return this.vendors.list();
  }

  /**
   * Load a single vendor (so the merchant console can sign back into an existing store via ?vendor=).
   * Returns the public view — the signing secret is issued once at registration and never re-exposed.
   */
  @Scopes('vendor:manage:self')
  @Get('vendors/:id')
  getVendor(@Param('id') id: string, @Actor() actor: IntrospectionResult) {
    // Its balance, the number to reach it on and where its systems are called: the store's own. Its id was all it took.
    this.assertVendorOwner(id, actor);
    const vendor = this.vendors.get(id);
    // Whether it has an account of its own — never the address: a console signed in the old way is told to set one up.
    return { ...VendorService.publicView(vendor), hasAccount: Boolean(this.accounts.emailForDid(vendor.did)) };
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

  /**
   * What only the SHOP does — its hours, shelf, prices, pin, papers, float, the bags it receives — from its own
   * sign-in, or network staff standing in for it. These took any valid token: any account could close a
   * shop, reprice it, move its pin, or credit its float.
   */
  private assertAgentActs(did: string, actor: IntrospectionResult): void {
    this.agents.get(did); // 404 if unknown
    if (actor?.role !== 'operator' && (!actor?.did || actor.did !== did)) {
      throw new GlosError('FORBIDDEN', 'Only the shop can do this, from its own sign-in');
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
  @Scopes('vendor:manage:self')
  @Post('vendors/:id/checkout')
  captureCheckout(@Param('id') id: string, @Body() dto: CheckoutDto, @Actor() actor: IntrospectionResult) {
    // THAT store's own sign-in (or staff). The id in the address was all it took: any account could file orders in any store's name.
    this.assertVendorOwner(id, actor);
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

  /* ----------------------------------------------- returning what nobody came for -- */

  /**
   * Returns waiting on this store's decision.
   *
   * A parcel nobody collected is still the BUYER'S — they paid for the goods — so this is not a store
   * choosing whether to abandon something. It is a store choosing whether to pay for its journey home.
   * Declining settles who is not paying; it settles nothing about whose goods they are.
   */
  @Scopes('shipment:create')
  @Get('vendors/:id/returns')
  vendorReturns(@Param('id') id: string, @Actor() actor: IntrospectionResult) {
    this.assertVendorOwner(id, actor);
    return { items: this.returns.pendingFor(id) };
  }

  /** Yes: mint the journey home, bill this store the figure the offer showed, and hand the shop its
   *  shelf slot back — which is the whole reason any of this exists. */
  @Scopes('shipment:create')
  @Post('vendors/:id/returns/:offerId/accept')
  acceptReturn(@Param('id') id: string, @Param('offerId') offerId: string, @Actor() actor: IntrospectionResult) {
    this.assertVendorOwner(id, actor);
    return this.returns.accept(offerId, id);
  }

  /** No. The parcel stays exactly where it is, because it is still somebody else's property. */
  @Scopes('shipment:create')
  @Post('vendors/:id/returns/:offerId/decline')
  declineReturn(@Param('id') id: string, @Param('offerId') offerId: string, @Body() dto: DeclineReturnDto, @Actor() actor: IntrospectionResult) {
    this.assertVendorOwner(id, actor);
    return this.returns.decline(offerId, id, dto.reason);
  }

  /**
   * A measurement off the query string, or undefined when there isn't a whole one.
   *
   * All four or none: three sides without a weight cannot say whether a box is books or bubble wrap, and
   * half a measurement priced as though it were whole is worse than the band it replaced. When it IS
   * whole the SIZE comes from it too, so a caller who sends dims and a contradicting `size` gets the one
   * the tape measure supports — the same precedence every mint in the system already applies.
   */
  private measuredFrom(l?: string, w?: string, h?: string, kg?: string): { size: 'S' | 'M' | 'L' | 'HEAVY'; factor: number } | undefined {
    const [dl, dw, dh, dkg] = [l, w, h, kg].map((v) => Number(v));
    if (![dl, dw, dh, dkg].every((n) => Number.isFinite(n) && n > 0)) return undefined;
    const dims = { l: dl, w: dw, h: dh, kg: dkg };
    const factor = measuredFactor(dims);
    return factor == null ? undefined : { size: classifySize(dims), factor };
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
  // The measurement, when the caller has one. Optional and declared so, because a required query
  // parameter that is not required is a lie a widget author finds out about at runtime.
  @ApiQuery({ name: 'l', required: false })
  @ApiQuery({ name: 'w', required: false })
  @ApiQuery({ name: 'h', required: false })
  @ApiQuery({ name: 'kg', required: false })
  @Get('quote')
  quote(@Query('origin') origin: string, @Query('dest') dest: string, @Query('size') size?: string, @Query('l') l?: string, @Query('w') w?: string, @Query('h') h?: string, @Query('kg') kg?: string) {
    if (!origin || !dest) throw new GlosError('FIELD_REQUIRED', 'origin and dest are required');
    const m = this.measuredFrom(l, w, h, kg);
    // `publicQuote`, not the raw quote: this endpoint is @Public(), and the raw shape carries the sister's
    // three rate layers, which were decided to be internal. A buyer sees a price; a merchant sees one fee.
    this.agents.assertNamedAtMint(origin);
    this.agents.assertNamedAtMint(dest);
    return publicQuote(this.routing.quoteShipment(origin, dest, m?.size ?? ((size as 'S' | 'M' | 'L' | 'HEAVY') || 'M'), m?.factor));
  }

  /**
   * Quote many candidates at once so each PUDO pin on the map carries a real total. Either fix the origin
   * and vary the destinations (buyer's map) or fix the destination and vary the origins (vendor's drop-off map).
   */
  @Public()
  // The measurement, when the caller has one. Optional and declared so, because a required query
  // parameter that is not required is a lie a widget author finds out about at runtime.
  @ApiQuery({ name: 'l', required: false })
  @ApiQuery({ name: 'w', required: false })
  @ApiQuery({ name: 'h', required: false })
  @ApiQuery({ name: 'kg', required: false })
  @Get('quote/options')
  quoteOptions(@Query('origin') origin: string, @Query('dest') dest: string, @Query('origins') origins: string, @Query('dests') dests: string, @Query('size') size?: string, @Query('l') l?: string, @Query('w') w?: string, @Query('h') h?: string, @Query('kg') kg?: string) {
    // ITEM 9 — the pins must price the parcel the SAME WAY the mint will. A map quoting bands beside a
    // mint quoting measurements would move the price between choosing a shop and paying for it, which
    // reads as a bait even though both numbers were honest.
    const m = this.measuredFrom(l, w, h, kg);
    const sz = m?.size ?? ((size as 'S' | 'M' | 'L' | 'HEAVY') || 'M');
    const list = (origin && dests) ? dests.split(',').map((d) => [origin, d] as const)
      : (dest && origins) ? origins.split(',').map((o) => [o, dest] as const)
        : null;
    if (!list) throw new GlosError('FIELD_REQUIRED', 'provide origin+dests or dest+origins');
    const variable = origin ? 1 : 0; // which side varies → the `did` the pin represents
    return { options: list.filter(([a, b]) => a && b).map(([o, d]) => {
      try { this.agents.assertNamedAtMint(o); this.agents.assertNamedAtMint(d); return { did: [o, d][variable], quote: publicQuote(this.routing.quoteShipment(o, d, sz, m?.factor)) }; }
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
  @SignedIn()
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
  @Roles('operator')
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
  @Roles('agent', 'operator')
  @Patch('agents/:did/pricing')
  setAgentPrice(@Param('did') did: string, @Body() dto: SetPriceDto, @Actor() actor: IntrospectionResult) {
    this.assertAgentActs(did, actor);
    return this.agents.setPrice(did, dto.price);
  }

  /** An MDP sets its open-data per-parcel sort price. */
  @Roles('mdp', 'operator')
  @Patch('mdps/:id/pricing')
  setMdpPrice(@Param('id') id: string, @Body() dto: SetPriceDto, @Actor() actor: IntrospectionResult) {
    this.assertMdpActs(id, actor);
    return this.mdps.setPrice(id, dto.price);
  }

  /**
   * What only the HUB does — its price, its bags, what is dropped and sorted at it — from its own sign-in, or
   * network staff standing in for it. These took any valid token and no identity: any account could reprice a
   * hub, mint bags into it, or empty and sort what stood in it. A hub's token carries its DID; the address
   * carries its id; the record ties the two.
   */
  private assertMdpActs(mdpId: string, actor: IntrospectionResult): void {
    const mdp = this.mdps.require(mdpId); // 404 if unknown
    if (actor?.role !== 'operator' && (!actor?.did || actor.did !== mdp.did)) {
      throw new GlosError('FORBIDDEN', 'Only the hub can do this, from its own sign-in');
    }
  }

  /**
   * A vehicle's open-data per-km rate, set by the fleet that owns it, the driver on a shift with it right
   * now, or an operator. It took any valid token before — a public rate is still not a public knob.
   */
  @Roles('fleet_manager', 'driver', 'operator')
  @Patch('vehicles/:id/pricing')
  setVehiclePrice(@Param('id') id: string, @Body() dto: SetPriceDto, @Actor() actor: IntrospectionResult) {
    const v = this.vehicles.get(id); // 404 if unknown
    // The fleet's MANAGER, not any token the fleet issued: a driver's token carries the fleet as its tenant too.
    const owner = actor?.role === 'fleet_manager' && Boolean(v.managerDid) && actingTenant(actor) === v.managerDid;
    const onIt = Boolean(actor?.did) && this.fleet.activeForVehicle(id)?.driverDid === actor.did;
    if (actor?.role !== 'operator' && !owner && !onIt) throw new GlosError('FORBIDDEN', 'Only the fleet that owns this vehicle, or the driver on shift with it, sets its rate');
    return this.vehicles.setPrice(id, dto.price);
  }

  /**
   * A store ASKS to prepay its balance with the per-country daughter company.
   *
   * The twin of the shop's top-up, and changed for the same reason: this used to credit the store's
   * prepaid balance with a number it typed itself. It now opens a funding request and waits for a rail
   * to confirm the payment. Owner-scoped, as it was.
   */
  @Scopes('vendor:manage:self')
  @Post('vendors/:id/top-up')
  topUpVendor(@Param('id') id: string, @Body() dto: TopUpDto, @Actor() actor: IntrospectionResult) {
    this.assertVendorOwner(id, actor);
    return this.funding.open({ payerKind: 'vendor', payerDid: id, amount: dto.amount, payerPhone: dto.phone });
  }

  /** What this store is waiting to have confirmed, and what has been confirmed lately. Owner-scoped. */
  @Scopes('vendor:read:self')
  @Get('vendors/:id/funding')
  vendorFunding(@Param('id') id: string, @Actor() actor: IntrospectionResult) {
    this.assertVendorOwner(id, actor);
    return {
      open: this.funding.openFor(id),
      items: this.funding.list({ payerDid: id }).slice(0, 10),
      terms: this.entities.topUpFeeFor(this.vendors.entityIdOf(this.vendors.get(id)), 0),
    };
  }

  /** A vendor's prepaid balance + settlement book (top-ups / billings / rebates). Owner-scoped — this is the
   *  store's money history. The searchable/paginated register is at .../ledger; this stays for the balance. */
  @Scopes('vendor:read:self')
  @Get('vendors/:id/settlement')
  vendorSettlement(@Param('id') id: string, @Actor() actor: IntrospectionResult) {
    this.assertVendorOwner(id, actor);
    return { balance: this.vendors.balanceOrNone(id), entries: this.vendors.settlementsFor(id) };
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
    return { ...this.vendors.vendorLedgerSummary(id, query), balance: this.vendors.balanceOrNone(id) };
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
    // FP6 — one link format for parcels and loads. Every consignment note has carried this link as a QR since
    // FP2, and until now it answered "no parcel for that key" for every load. A key names one thing; a freight
    // answers with kind 'freight', a parcel with none (the shape the parcel page has always read).
    const freight = this.dispatch.freightByTrackingKey(key);
    if (freight) return this.notes.trackView(freight);
    // Space booked on a run answers on the same link, in the same shape.
    const booked = this.departures.trackView(key);
    if (booked) return booked;
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
  /**
   * THE NETWORK, MEASURED — the front page's proof: trading shops, towns, parcels collected in the last 30 days, the
   * median time to the collection shop, the shops' rating, and one real recent journey between two public shops.
   * Counted, never typed; a median or an average is withheld below ten cases. Nothing in it names a person.
   */
  @Public()
  @Header('Cache-Control', 'public, max-age=300')
  @Get('network/pulse')
  networkPulse() {
    if (!this.pulse) throw new GlosError('NOT_FOUND', 'The network figures are not available on this server');
    return this.pulse.pulse();
  }

  /** A page per town: its trading shops, as anybody outside them could see. Read by the town pages and their build. */
  @Public()
  @Header('Cache-Control', 'public, max-age=300')
  @Get('network/towns')
  networkTowns() {
    if (!this.pulse) throw new GlosError('NOT_FOUND', 'The town pages are not available on this server');
    return { items: this.pulse.towns() };
  }

  @Public()
  @Get('network/points')
  networkPoints() {
    return this.agents.list().map((a) => this.shopCard(a));
  }

  /** A shop as anybody may see it: where it is, whether it is open, what it charges. Nothing it holds, owes or was asked for. */
  private shopCard(a: ReturnType<AgentService['list']>[number]) {
    return {
      did: a.did,
      shopName: a.shopName,
      zone: a.zone,
      // Which country the shop stands in — already implied by its pin, and needed explicitly so a sign-up
      // can suggest the areas of the country somebody is joining rather than every area on the network.
      country: this.agents.countryOf(a),
      location: a.location,
      landmark: a.landmark,
      openState: a.openState,
      // False: no NEW parcel can name this shop, as the place to hand in or to collect. It still hands out what it
      // holds — so it stays on the map for whoever is collecting — and a picker simply does not offer it.
      takesNew: !a.idHold,
      pricePerParcel: a.pricePerParcel,
      rating: this.ratings.agentRating(a.did),
      freeSlots: this.shelf.available(a.did),
      since: a.createdAt, // REP1 — a "serving since" trust signal for the public profile (an onboarding date, not PII)
    };
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
      for (const end of [origin, dest]) this.presence.require(this.agents.countryOf(end), 'takeIn'); // freight moves wherever goods may be taken in; a store no sister settles is not billed at claim
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
        // FB5 — a diverted e-commerce order really is palletised: it was picked and packed in a warehouse,
        // which is the one origin where that is known rather than assumed. Stated, not defaulted.
        packaging: 'palletised',
        shipperDid: dto.vendorId,
        // S32c: the freight's ends ARE these PUDOs — check they can actually HANDLE the cargo (a small shop
        // with only manual handling can't take a pallet), flagging a gap advisory for a Local Admin to resolve.
        originEquipment: origin.equipment,
        destEquipment: dest.equipment,
        // CA6 — the country at each end, so the rules of crossing a border can be asked of this load.
        pickupCountry: this.agents.countryOf(origin),
        destCountry: this.agents.countryOf(dest),
        // S32d: keep the buyer joined to their order so it stays in their "my shipments" with a tracking key.
        buyerMobile: dto.buyerMobile ?? handoff?.buyerMobile,
        externalOrderId: dto.externalOrderId ?? handoff?.externalOrderId,
        // FP8 — box 13 from the store's order, when it said anything.
        instructions: dto.instructions,
        deliveryWindow: dto.deliveryWindow,
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
    // ITEM 9 — a store's mint takes real centimetres, so the transport is priced on the measurement
    // rather than on the tier it happens to fall in. No dims (a store that only picked a size) → the band.
    const measured = dto.dimensionsCm ? measuredFactor({ ...dto.dimensionsCm, kg: weightKg }) : undefined;
    const dock = dto.originPudoDid ? undefined : this.vendors.requireCollection(dto.vendorId);
    const quote = dock
      ? this.routing.quoteShipmentFrom(
          { type: 'dock', id: vendor.did, label: dock.label, zone: dock.zone, country: this.vendors.dockCountryOf(vendor), location: dock.location },
          destPudoDid,
          size,
          this.vendors.entityIdOf(vendor),
          measured,
        )
      : this.routing.quoteShipment(dto.originPudoDid!, destPudoDid, size, measured);
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
  @Roles('agent', 'operator')
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
      // P3 — said in the same breath as the price: whose promise, who answers, and this parcel's own cover.
      ...(parcel.originAgentDid ? { terms: this.parcels.intakeTermsFor(parcel) } : {}),
    };
  }

  /** Destination PUDO shelves an arrived parcel → Ready_For_Pickup + buyer notified. */
  @Roles('agent', 'operator')
  @Post('parcels/:id/shelve')
  shelve(@Param('id') id: string, @Body() dto: ShelveDto, @Actor() actor: IntrospectionResult) {
    return this.parcels.shelve(id, actingDid(actor, dto.agentDid), dto.binId);
  }

  /** Buyer presents the collection QR → resolve the parcel + shelf slot (opens the handover screen). */
  @Roles('agent', 'operator')
  @Post('parcels/collect')
  collect(@Body() dto: CollectDto, @Actor() actor: IntrospectionResult) {
    return this.parcels.collect(dto.collectionCode, actingDid(actor, dto.agentDid));
  }

  /** Buyer confirms the parcel is correct → Delivered, order closed. */
  @Roles('agent', 'operator')
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

  /**
   * Control tower: the parcels whose owners gave up their claim and that nobody is paying to recover.
   *
   * A QUEUE rather than a status, because what happens to them is decided by the law of the sister's
   * jurisdiction rather than by this system. Modelling a disposal rule we do not know would be worse
   * than showing an operator the list and letting them apply the one they do.
   */
  /**
   * A store's public reputation — measured by us, and not theirs to switch off.
   *
   * @Public deliberately, and it is the load-bearing decision in this whole feature. If the profile
   * existed only inside the widget a merchant chooses to install, every badly-behaved merchant would
   * suppress it by not installing — and a score the badly-behaved can opt out of is not a score. So it
   * lives on a page of ours that anybody can read without an account, the same rule the public market
   * page already keeps.
   *
   * The other half of that rule binds US: we publish only what we measured, identically for everyone,
   * and there is no parameter here that could tune one merchant's numbers. If a merchant can hide a bad
   * score we are worthless to buyers; if we can adjust one, we are selling reputation.
   *
   * Carries no PII and no order detail — a scorecard about a business, never a list of its customers.
   */
  @Public()
  @Get('stores/:vendorId/reputation')
  storeReputation(@Param('vendorId') vendorId: string) {
    return this.merchants.scorecard(vendorId);
  }

  @Roles('operator')
  @Get('ops/disposal-queue')
  disposalQueue() {
    return { rows: this.unclaimed.awaitingDisposal() };
  }

  /**
   * Control tower: close out one of them, and settle what the shop is owed for having held it.
   *
   * The only path on which the NETWORK absorbs the holding fee. Everywhere else it is recovered from
   * whoever ended the situation; here nobody did, and the alternative is a shortfall settling quietly on
   * a shopkeeper who did the work and had no say in any of it.
   */
  @Roles('operator')
  @Post('parcels/:id/write-off')
  writeOffParcel(@Param('id') id: string, @Body() dto: WriteOffParcelDto, @Actor() actor: IntrospectionResult) {
    return this.unclaimed.writeOff(id, auditActor(actor, dto.by), dto.reason);
  }

  /** Buyer reports a discrepancy at collection → Disputed, with mandatory photo proof. */
  @Roles('agent', 'operator')
  @Post('parcels/:id/dispute')
  dispute(@Param('id') id: string, @Body() dto: DisputeDto, @Actor() actor: IntrospectionResult) {
    return this.parcels.dispute(id, actingDid(actor, dto.agentDid), dto.reason, dto.photoProofRef);
  }

  /** Tier-1 customer rates a delivered parcel → writes the agent composite to the shared core (graduation). */
  @Roles('agent', 'operator')
  @Post('parcels/:id/rate')
  rate(@Param('id') id: string, @Body() dto: RateDto, @Actor() actor: IntrospectionResult) {
    // Recorded at the counter of a shop that HANDLED this parcel, or by staff. Any signed-in account could rate any
    // parcel — and a rating is what a shop's standing is made of.
    const parcel = this.parcels.get(id); // 404 if unknown
    // The shops it passed through: where it was taken in, where it was collected. (A parcel born on a store's dock has no first.)
    const handledBy = [parcel.originAgentDid, parcel.destAgentDid].filter((did): did is string => Boolean(did));
    if (actor?.role !== 'operator' && !handledBy.includes(actor?.did ?? '')) {
      throw new GlosError('FORBIDDEN', 'A rating is recorded by a shop that handled this parcel');
    }
    return this.ratings.rate({ parcelId: id, stars: dto.stars, raterMobile: dto.raterMobile });
  }

  @SignedIn()
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
  @Roles('agent', 'operator')
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

  /* ---- the directory: one public page per participant, addressed by a handle ---- */

  /**
   * `GET /v1/sbg/profiles/:handle` — what `seebuyget.com/@fedex` renders.
   *
   * @Public, and it has to be: the gap this closes is that appointing a clearing agent meant typing a
   * company id somebody had to send you out of band, so a page nobody can read without an account would
   * close nothing. Every field is already public elsewhere (the reputation route, the network map) or is a
   * fact about OUR standing; nothing here comes out of the identity vault.
   *
   * It states what we know and never what we vouch for. The presence level travels with the identity
   * because a reader has no other way to know that `observed` means we match and hold nothing — and a
   * page that lets itself be read as an endorsement is the self-dealing §6 warns about in a new hat.
   */
  @Public()
  @Get('profiles/:handle')
  profile(@Param('handle') handle: string): ProfileView {
    // Issue anything missing first, so a shop that registered a minute ago is reachable at its page
    // without waiting for a restart. Idempotent, and skipped entirely when the population has not moved.
    this.handleDirectory.ensure();
    const held = this.handles.require(handle);
    const shop = held.kind === 'shop' ? this.agents.list().find((a) => a.did === held.id) : undefined;
    const hub = held.kind === 'hub' ? this.mdps.list().find((m) => m.did === held.id) : undefined;
    const fleet = held.kind === 'fleet' ? this.managers.list().find((m) => m.did === held.id) : undefined;
    const company = held.kind === 'company' ? this.entities.list().find((e) => e.entityId === held.id) : undefined;
    // An OWNER-DRIVER: a party the network contracts with directly, and the only kind of driver with a
    // page. The name is their display name — FleetDriver keeps the Golden Record in the vault, and this
    // is the non-PII label that exists so there is something to say in public.
    // STILL an owner-driver: a courier who has since joined a fleet keeps the handle they were issued, and the page
    // behind it closes — a handle follows the contract, and their work is now their fleet's to show.
    // Nor a driver a fleet took off: between fleets is not their own boss, and nobody contracted them as one.
    const driver = held.kind === 'driver' ? this.drivers.list().find((d) => d.did === held.id && !d.managerDid && !d.removedFrom) : undefined;

    const name = shop?.shopName ?? hub?.name ?? fleet?.companyName ?? company?.name ?? driver?.displayName;
    if (!name) throw new GlosError('NOT_FOUND', 'No such profile');
    const country = shop ? this.agents.countryOf(shop) : hub ? this.mdps.countryOf(hub) : (fleet?.jurisdiction ?? company?.jurisdiction ?? driver?.jurisdiction);
    // Only claim a standing where we know WHICH country to claim it in — resolve() answers 'observed' for
    // an unknown jurisdiction, which is right for the ladder and reads as a falsehood on a public page.
    const presence = country ? this.presence.resolve(country) : undefined;

    // CL4 — the mobilisation record, for the kinds that actually mobilise something. A FLEET moves loads
    // through the drivers it fields, so its record is the loads any of them took; a shop or a hub moves no
    // trucks and gets no record rather than a row of honest zeroes, which would read as a bad one.
    // An owner-driver mobilises exactly one vehicle, and the same record a fleet gets is the honest one
    // to show: the counts are theirs, and the RATES stay null while the record is thin, which is the
    // protection that matters most to somebody with few loads behind them.
    // The loads taken FOR this carrier — the fleet, or the owner-driver themselves — by whoever drove them then.
    const carrier = fleet?.did ?? driver?.did;
    const mobilises = fleet ? this.drivers.list({ managerDid: fleet.did }).length > 0 || this.dispatch.driversWhoCarriedFor(fleet.did).length > 0 : Boolean(driver);
    const moves = carrier && mobilises ? this.dispatch.mobilisationFor(carrier) : undefined;

    /*
     * CL4 item 1 — THE CLEARING AGENT'S RECORD, and the agent exists here for the first time.
     *
     * A clearing agent was never a KIND of participant in this system: they were a field on somebody
     * else's container. So being one is DERIVED, exactly as a country's `established` standing is derived
     * from a company existing and as this handle is derived from the verified name — a company that has
     * been appointed to clear a container is an agent, and the container is the evidence. CL2's first
     * draft had an agent registry with licences that expire, and the user's two imports showed why that
     * is the wrong shape: the job is foreknowledge, not a status we award.
     *
     * So no capability flag, no onboarding, and nothing to keep in step. A company with no appointments
     * gets no section at all rather than a row of zeroes, which would read as a bad record.
     */
    const clears = company && this.imports.isAgent(company.entityId) ? this.imports.agentRecord(company.entityId) : undefined;
    // WHAT THEY SAY THEY CLEAR, which is theirs and not ours. Shown even when the record is empty: an
    // agent who advertises air freight and has never been appointed through us is exactly the case the
    // finder exists for, and a page that hid the claim would leave them undiscoverable.
    const offer = company ? this.imports.offerOf(company.entityId) : undefined;
    /*
     * HOW TO REACH THEM, where the company wrote an entry — and only for a COMPANY.
     *
     * A shop's page carries a coarse pin and never a street address, which is a consumer-safety choice,
     * and this must not undo it from the side. A yard or a clearing agent publishing its own gate number
     * is a different act: a business asking to be telephoned, which is what a directory is for.
     */
    const contact = company ? this.contacts.of(company.entityId) : undefined;

    // A verified paper is named, with its date, and an empty list is a real answer shown as one. Only a
    // COMPANY has a document register; the rest carry what their own record can honestly attest.
    const verified = company
      ? this.companyDocuments
          .list(company.entityId)
          .filter((d) => d.status === 'verified')
          .map((d) => ({ what: d.kind.replace(/_/g, ' '), at: d.verifiedAt ?? d.uploadedAt }))
      : shop?.kyc
        ? [{ what: 'identity and trading licence', at: shop.kyc.submittedAt }]
        : [];

    // WHAT THE COMPANY PUT ON RECORD ITSELF since it was switched on. It counts — and nobody here checked it, so it
    // is said apart from what we checked: under one heading the page would vouch for a paper no member of staff has
    // looked at. (Only a paper a company keeps about itself is ever `declared`; a consignment's never is.)
    const onRecord = company
      ? this.companyDocuments
          .list(company.entityId)
          .filter((d) => d.status === 'declared')
          .map((d) => ({ what: d.kind.replace(/_/g, ' '), at: d.uploadedAt }))
      : [];

    return {
      handle: held.handle,
      kind: held.kind,
      name,
      ...(held.derivedFrom !== name ? { formerly: held.derivedFrom } : {}),
      ...(country ? { country } : {}),
      ...(shop ? { at: shop.location, area: shop.zone } : {}),
      ...(hub ? { at: hub.location } : {}),
      /*
       * NO PIN AND NO AREA FOR A DRIVER, deliberately, where every other kind gets one.
       *
       * A shop's pin is a place a customer walks to. A driver has no premises — the nearest thing on
       * their record is a home zone, and publishing where somebody sleeps beside a list of the corridors
       * they run is the movement-pattern harm the old no-drivers rule was right to worry about. The page
       * says what they carried and never where they are.
       */
      since: shop?.createdAt ?? hub?.createdAt ?? fleet?.createdAt ?? company?.createdAt ?? driver?.createdAt ?? new Date(0).toISOString(),
      ...(presence ? { presence: { level: presence.level, says: presenceSays(presence.level) } } : {}),
      // What they do, and for a company that clears containers it says so — which is the whole answer to
      // "how does an importer find an agent": the page can now state the work, not just the name.
      // An advertisement is enough to say what they do: waiting for an appointment before the page will
      // describe the business is the chicken-and-egg the directory exists to end.
      does: clears || offer ? profileDoes('clearing-agent') : profileDoes(held.kind),
      verified,
      ...(onRecord.length ? { onRecord } : {}),
      ...(moves ? { moves, movesMeasured: MOBILISATION_MEASURED } : {}),
      ...(clears ? { clears, clearsMeasured: AGENT_MEASURED } : {}),
      ...(offer ? { offer } : {}),
      ...(contact ? { contact: { ...contact, basis: CONTACT_BASIS } } : {}),
      ...(clears || offer ? { recordSays: RECORD_SAYS } : {}),
    };
  }

  /**
   * CL4 — every fleet's mobilisation record, with the half a shipper does not see.
   *
   * Operator-only, and what it adds is CONTEXT rather than a second set of numbers: `moves` is the exact
   * object the public page carries. The moment an operator's view can disagree with the public one, the
   * public one stops being worth anything and reciprocal visibility becomes a slogan.
   *
   * What it adds is the two things a person handling a complaint needs and a shipper must not have: the
   * REASON each load was handed back (a rest-hours hand-back is the safety rule working, and publishing it
   * would punish the honest use of a rule we wrote), and WHICH DRIVER — the public page names nobody,
   * because a driver identifiable as the one who gave a load back is a driver who stops taking hard ones.
   */
  @Roles('operator')
  @Get('fleet/movers')
  movers(): MoversView {
    this.handleDirectory.ensure();
    const items = this.managers
      .list()
      .map((fleet) => {
        const drivers = this.drivers.list({ managerDid: fleet.did });
        return {
          did: fleet.did,
          name: fleet.companyName,
          ...(this.handles.forId(fleet.did) ? { handle: this.handles.forId(fleet.did)!.handle } : {}),
          ...(fleet.jurisdiction ? { jurisdiction: fleet.jurisdiction } : {}),
          drivers: drivers.length,
          // The loads taken FOR this fleet — by whoever drove for it then. Not "every load its drivers of today
          // ever took", which would hand a moved driver's record to whichever fleet they joined.
          moves: this.dispatch.mobilisationFor(fleet.did),
          // Newest first: a complaint is almost always about the most recent one.
          handBacks: this.dispatch.handBacksFor(fleet.did).map((h) => ({ code: h.code, driver: this.anyDriverName(h.driverDid), reason: h.reason, at: h.at })),
          perDriver: this.dispatch
            .driversWhoCarriedFor(fleet.did)
            .map((did) => {
              const m = this.dispatch.mobilisationFor(fleet.did, did);
              return { driver: this.anyDriverName(did), claimed: m.claimed, handedBack: m.handedBack, kept: m.kept, delivered: m.delivered };
            })
            // A driver who has taken nothing is not a row worth reading, and listing them all turns a
            // fleet of forty into a wall nobody scans.
            .filter((d) => d.claimed > 0)
            .sort((a, b) => b.claimed - a.claimed || a.driver.localeCompare(b.driver)),
        };
      })
      // Busiest first. NOT ranked by performance — this is a work list, and ordering people by how well
      // they did is the league table §6 refuses.
      .sort((a, b) => b.moves.claimed - a.moves.claimed || a.name.localeCompare(b.name));

    return { items, measured: MOBILISATION_MEASURED };
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

  /**
   * The disputes waiting on a decision, oldest first — the case somebody has waited longest for is the
   * one that most needs an answer.
   *
   * Everything an adjudicator needs is on the parcel already: the merchant's photo of the contents at
   * mint, the drop-off photo, the delivery photo, and the claimant's photo of the problem, all held on
   * a dispute-evidence clock so none of it is swept while the case is open.
   */
  @Roles('operator')
  @Get('disputes')
  disputes() {
    return {
      disputes: this.parcels.openDisputes().map((p) => ({
        parcelId: p.parcelId,
        raisedAt: p.dispute?.raisedAt,
        origin: p.dispute?.origin ?? (p.buyerDisputeReason ? 'buyer' : 'counter'),
        reason: p.dispute?.reason ?? p.buyerDisputeReason ?? p.disputeReason,
        vendorId: p.vendorId,
        // What the shipment was sold for. NOT what the goods were worth, and never a cap — it is the
        // first money figure an adjudicator's eye lands on, so the screen has to label it as not one.
        shipmentCost: p.shipmentCost,
        currency: p.currency,
        // WHAT AN AWARD IS ACTUALLY CHECKED AGAINST, computed here so the queue and the refusal cannot
        // disagree. It was missing entirely: the screen read a `coverLimit` this projection never sent,
        // so every case rendered as "no cover — an award here is a goodwill decision" whether or not the
        // shipment was covered, and the only way to find out was to type an award and be refused.
        ...awardCapOf(p),
        evidence: [p.contentPhotoRef, p.dropoffPhotoRef, p.buyerPodPhotoRef, p.buyerDisputePhotoRef, p.disputePhotoRef].filter(Boolean),
      })),
    };
  }

  /**
   * Decide one. Upheld, partly upheld, or rejected — and every one of them carries a note, because a
   * person whose goods arrived broken is owed an explanation even when they are not owed money.
   *
   * An upheld award is paid to whoever CONTRACTED with the sister: the store for a merchant order, or a
   * recorded off-platform payable for a walk-up sender who paid cash and has no account here.
   */
  @Roles('operator')
  @Post('disputes/:parcelId/resolve')
  resolveDispute(@Param('parcelId') parcelId: string, @Body() dto: ResolveDisputeDto) {
    return this.parcels.resolveDispute(parcelId, dto);
  }

  /** PUDO coverage heatmap — points + density + open/closed counts (feeds journey-leg planning). */
  @Roles('operator')
  @Get('heatmap')
  heatmap() {
    return this.monitor.heatmap();
  }

  // --- routing: first-mile node + leg computation ---

  /** Assign a first-mile node: nearest open PUDO with free shelf capacity. No app asks this; network staff may. */
  @Roles('operator')
  @Post('routing/assign-node')
  assignNode(@Body() dto: AssignNodeDto) {
    return this.routing.assignFirstMileNode(dto);
  }

  /** Plan the journey: commit a first-mile node (given or assigned) and compute the legs + ETA. No app asks this; network staff may. */
  @Roles('operator')
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

  /** Register an MDP sort hub covering one or more zones. Network staff (and the seeder): it took any valid token. */
  @Roles('operator')
  @Post('mdps')
  registerMdp(@Body() dto: RegisterMdpDto) {
    return this.mdps.register(dto);
  }

  /** Every hub: where it is and what it charges. The hub itself and network staff also read its number and its bag count. */
  @SignedIn()
  @Get('mdps')
  listMdps(@Actor() actor: IntrospectionResult) {
    // The number to ring, the company a hub contracts with and how many bags stand there went to any sign-in that asked.
    return this.mdps.list().map((m) => {
      if (actor?.role === 'operator' || (actor?.did && actor.did === m.did)) return { ...m, totes: this.totes.list({ locationId: m.mdpId }).length };
      return { mdpId: m.mdpId, did: m.did, name: m.name, country: m.country, zones: m.zones, location: m.location, address: m.address, pricePerParcel: m.pricePerParcel };
    });
  }

  /** Register a fresh laminated tote (QR + human code) into the pool at this MDP. */
  @Roles('mdp', 'operator')
  @Post('mdps/:id/totes')
  registerTote(@Param('id') id: string, @Actor() actor: IntrospectionResult) {
    this.assertMdpActs(id, actor);
    return this.mdps.registerTote(id);
  }

  /** Totes currently at a location. A hub reads the bags standing at it; the whole pool (no location) is read by network staff. */
  @Roles('mdp', 'operator')
  @Get('totes')
  listTotes(@Actor() actor: IntrospectionResult, @Query('location') location?: string, @Query('status') status?: string) {
    // Any sign-in could read every bag on the network, with what is in each.
    if (actor?.role !== 'operator') {
      if (!location) throw new GlosError('FORBIDDEN', 'Name your own hub: the whole bag pool is read by network staff');
      this.assertMdpActs(location, actor);
    }
    return this.totes.list({ locationId: location, status: status as never });
  }

  @Roles('agent', 'mdp', 'driver', 'operator')
  @Get('totes/:code')
  getTote(@Param('code') code: string) {
    return this.totes.requireByCode(code);
  }

  /**
   * Link a free bag to a single next destination so it can start taking parcels.
   *
   * THE BAG ROUTES are for the trades that handle bags — a shop, a hub, and for loading a driver — and network
   * staff. The code printed on the bag is what the one holding it has; but a store, a business, a fleet's office or
   * somebody sending a parcel never holds one, and these took any valid token.
   */
  @Roles('agent', 'mdp', 'operator')
  @Post('totes/:code/assign')
  assignTote(@Param('code') code: string, @Body() dto: AssignToteDto) {
    return this.mdps.assignTote(code, dto.destinationNodeId, dto.destinationLabel);
  }

  /** Drop a parcel into a bag (capacity-checked) — connects bag ↔ parcel. */
  @Roles('agent', 'mdp', 'operator')
  @Post('totes/:code/fill')
  fillTote(@Param('code') code: string, @Body() dto: FillToteDto) {
    return this.mdps.fillTote(code, dto.parcelId);
  }

  /** Scan the bag onto a bus — one scan moves the whole tote + every parcel to On_Bus. */
  @Roles('agent', 'mdp', 'driver', 'operator')
  @Post('totes/:code/load')
  loadBag(@Param('code') code: string, @Body() dto: LoadBagDto) {
    return this.mdps.loadBag(code, dto.driverBadgeId);
  }

  /** A bus drops a bag at an MDP → scan the bag code, empty it; parcels become unsorted (At_MDP). */
  @Roles('mdp', 'operator')
  @Post('mdps/:id/drop-bag')
  dropBag(@Param('id') id: string, @Body() dto: DropBagDto, @Actor() actor: IntrospectionResult) {
    this.assertMdpActs(id, actor);
    return this.mdps.dropBag(id, dto.code);
  }

  /** Sort a parcel at an MDP → returns its next destination + the bag code to drop it in. */
  @Roles('mdp', 'operator')
  @Post('mdps/:id/sort')
  sortParcel(@Param('id') id: string, @Body() dto: SortParcelDto, @Actor() actor: IntrospectionResult) {
    this.assertMdpActs(id, actor);
    return this.mdps.sortParcel(id, dto.parcelId);
  }

  // --- fleet managers (the operator who owns the fleet — own onboarding + requirements) ---

  /** Register a fleet manager (eligibility: business reg + transport-operator licence + tax ID + depot). Network staff: it took any valid token. */
  @Roles('operator')
  @Post('fleet/managers')
  registerManager(@Body() dto: RegisterFleetManagerDto) {
    const manager = this.managers.register(dto);
    // S20: link the fleet operator to their person identity by phone (a manager can also send/drive).
    this.persons.tryAttachRole(manager.contactPhone, 'fleet_manager', manager.did, manager.did);
    return manager;
  }

  /**
   * The fleets on the network. Scoped, because the raw record carries the console credential.
   *
   * Left unrestricted, this returned every fleet's `loginCode` to any authenticated caller — and the
   * login code is the whole of the fleet console's authentication, so reading this list was signing in
   * as anybody. An operator sees everything; a fleet sees itself; everyone else gets the name and status
   * and nothing that could be used against the company.
   */
  @SignedIn()
  @Get('fleet/managers')
  listManagers(@Actor() actor: IntrospectionResult) {
    return this.managers.listScoped(this.officeOf(actor), actor?.role === 'operator');
  }

  /**
   * The fleet whose OFFICE is calling (staff: the one they name, or none). Never a driver's fleet: a fleet driver's
   * token names the fleet as its tenant too, and read as "the fleet itself" it was handed the fleet's whole record —
   * its papers, its depot, the number to ring — and every vehicle's documents and dashboard sticker.
   */
  private officeOf(actor: IntrospectionResult | undefined, named?: string): string | undefined {
    return actor?.role === 'operator' || actor?.role === 'fleet_manager' ? actingTenant(actor, named) : undefined;
  }

  /**
   * Fleet console, step one: WHICH FLEET. Names the company, and hands back nothing else.
   *
   * The code used to be the whole sign-in. One shared secret per company is a poor fit for a company
   * running twenty managers across as many depots: no record of who did what, no way to cut off one
   * leaver without re-issuing to everybody, and a code that is permanent access to whoever once saw it.
   * It selects the tenant now; the person proves who they are in step two.
   *
   * LIMITED, because it answers a guess with a company's name: twenty tries a quarter of an hour from one caller is
   * plenty for a manager who mistyped and no use for walking the code space. The code admits nobody any more — a
   * fleet takes drivers on by offering them a place — but a free "is this a fleet?" is still nobody's to hand out.
   */
  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit(20, 15 * 60)
  @Post('fleet/managers/login')
  managerLookup(@Body() dto: ManagerLoginDto) {
    const m = this.managers.lookup(dto.code);
    // S20: resolve this fleet to the registered operator's person (idempotent with registration), so a
    // company signing in for the first time has somebody who can complete step two.
    this.persons.tryAttachRole(m.contactPhone, 'fleet_manager', m.did, m.did);
    return { did: m.did, companyName: m.companyName, status: m.status };
  }

  /**
   * Fleet console, step two: WHICH PERSON — and the only step that mints anything.
   *
   * Checked against the identity spine, which already counts wrong PINs and locks out; the fleet code
   * never had either. The person must actually hold a fleet_manager role for THIS company, so knowing a
   * company code and holding some unrelated account is not a way in.
   *
   * The token still carries the manager DID as both did and tenant, so every fleet-scoped read behaves
   * exactly as before. Recording WHICH PERSON acted needs a claim the actor token does not have yet —
   * the response names them so the console can say who is signed in, and the audit trail does not.
   */
  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit(20, 15 * 60) // each PIN locks after five; this stops one caller spreading guesses across many phones
  @Post('fleet/managers/session')
  managerSession(@Body() dto: ManagerSessionDto) {
    const m = dto.code ? this.managers.login(dto.code) : this.managers.requireSignInByDid(dto.did);
    const { person } = this.persons.loginWithPin(dto.phone, dto.pin, dto.device);
    const holds = person.roles.some((r) => r.role === 'fleet_manager' && r.entityDid === m.did && r.status === 'active');
    // Not FORBIDDEN: telling somebody "right PIN, wrong company" confirms both the account and the code.
    if (!holds) throw new GlosError('AUTH_FAILED', 'That account cannot manage this fleet');
    // Carries the PERSON: every manager of this fleet shares its DID, and a PIN change must end only this person's sessions.
    // And their NAME, where they have given one: a plan accepted, a contract recorded, a load put on a driver are
    // then signed by the person, not by the company every manager of it shares.
    const view = this.persons.view(person);
    const name = (view as { displayName?: string }).displayName?.trim();
    const token = this.auth.mintActorToken({ role: 'fleet_manager', did: m.did, tenant: m.did, revocationKey: person.personDid, personDid: person.personDid, ...(name ? { actorName: name } : {}) });
    return { ...m, person: view, token };
  }

  /** Every fleet as the staff who set fleets up read them: where each stands in being set up, and what is next. */
  @Roles('operator')
  @Get('fleet/managers/setting-up')
  fleetsSettingUp(@Actor() actor: IntrospectionResult): { items: FleetSetupRow[] } {
    return { items: this.managers.settingUp(this.reader(actor)) };
  }

  /** Managers awaiting a KYC decision (the GLOS operator review queue). */
  @Roles('operator')
  @Get('fleet/managers/kyc-queue')
  managerKycQueue() {
    return this.managers.kycQueue();
  }

  /** One fleet — whole for the fleet itself and network staff, the outside view for anybody else. */
  @SignedIn()
  @Get('fleet/managers/:did')
  getManager(@Param('did') did: string, @Actor() actor: IntrospectionResult) {
    return this.managers.viewFor(this.managers.get(did), this.officeOf(actor), actor?.role === 'operator');
  }

  /**
   * Forgot the fleet code? Phone + PIN name the fleets this person manages, so they can choose one. Mints nothing:
   * the session is still granted by `fleet/managers/session`, which checks the PIN and the role again.
   */
  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit(20, 15 * 60)
  @Post('fleet/managers/mine')
  managerChoices(@Body() dto: ManagerChoicesDto) {
    const { person } = this.persons.loginWithPin(dto.phone, dto.pin, dto.device);
    const fleets = person.roles
      .filter((r) => r.role === 'fleet_manager' && r.status === 'active')
      .flatMap((r) => {
        try {
          const m = this.managers.get(r.entityDid);
          return [{ did: m.did, companyName: m.companyName, status: m.status }];
        } catch {
          return [];
        }
      });
    return { fleets };
  }

  /* ------------------------------------------------ FP1: what the fleet has earned, and where it is -- */

  /**
   * The fleet's own earnings register: every haul its drivers carried, searchable and paged, with the driver as a
   * column. A fleet is paid as ONE supplier for all of them (the payable is keyed to the fleet, never to the
   * driver — see DriverService.payeeOf), so this is the list that payday is reconciled against.
   */
  @Roles('fleet_manager', 'operator')
  @Get('fleet/managers/:did/earnings')
  fleetEarnings(@Param('did') did: string, @Query() query: FleetEarningsQueryDto, @Actor() actor: IntrospectionResult) {
    this.assertFleetSelf(did, actor);
    return this.dispatch.fleetJobsPage(did, this.anyDriverName, query);
  }

  /**
   * Totals for the filter, by driver and by month — and, apart from them, the MONEY: what the network has booked
   * as owed to this fleet, what is on its way, and what a rail confirmed leaving. Three different facts that one
   * screen used to blur into "paid".
   */
  @Roles('fleet_manager', 'operator')
  @Get('fleet/managers/:did/earnings/summary')
  fleetEarningsSummary(@Param('did') did: string, @Query() query: FleetEarningsQueryDto, @Actor() actor: IntrospectionResult) {
    this.assertFleetSelf(did, actor);
    const m = this.managers.get(did);
    const entityId = this.managers.entityIdOrNone(m);
    const currency = entityId ? this.entities.get(entityId).currency : undefined;
    // Owed = the sister's payable to this fleet, still standing. Null where no sister pays this fleet at all:
    // its jobs settle between the parties, and "0 owed" would be a false comfort.
    const owed = entityId ? Math.round(-this.books.balance(entityId, ACCOUNT_CODES.PAYABLE_PROVIDER, currency, did) * 100) / 100 : null;
    return {
      ...this.dispatch.fleetEarningsSummary(did, this.anyDriverName, query),
      settlement: { payeeDid: did, owed, ...this.payouts.forPayee(did), ...(currency ? { currency } : {}) },
    };
  }

  /** The whole matching set as CSV — the fleet's own statement, for its books. */
  @Roles('fleet_manager', 'operator')
  @Get('fleet/managers/:did/earnings/export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="fleet-earnings.csv"')
  fleetEarningsExport(@Param('did') did: string, @Query() query: FleetEarningsQueryDto, @Actor() actor: IntrospectionResult): string {
    this.assertFleetSelf(did, actor);
    return this.dispatch.fleetJobsCsv(did, this.anyDriverName, query);
  }

  /** The fleet itself (its token's tenant), or network staff. Anyone else is told the fleet is not theirs. */
  private assertFleetSelf(did: string, actor: IntrospectionResult): void {
    this.managers.get(did); // 404 if unknown
    if (actor?.role !== 'operator' && !this.isFleetOffice(actor, did)) throw new GlosError('FORBIDDEN', 'This fleet is not yours');
  }

  /**
   * FP5 — the fleet's dispatch view: who is on a shift, and the market as one of them would see it.
   *
   * The rows are the same board a driver reads (priced against THAT driver's vehicle, every reason it
   * cannot be taken marked), judged from where the driver last reported, or from the depot when the shift
   * has never said where it is — and the response says which, because every distance and price below
   * hangs off that point. The office sees exactly what the driver would, so the two cannot disagree about
   * whether a load can be taken.
   */
  @Roles('fleet_manager', 'operator')
  @Get('fleet/managers/:did/dispatch')
  fleetDispatch(@Param('did') did: string, @Query() q: FleetDispatchQueryDto, @Actor() actor: IntrospectionResult) {
    this.assertFleetSelf(did, actor);
    const manager = this.managers.get(did);
    const { dids, nameOf } = this.fleetDrivers(did);
    const drivers = this.fleet
      .list({ status: 'active' })
      .filter((a) => dids.has(a.driverDid))
      .map((a) => {
        const v = this.vehicles.list().find((x) => x.vehicleId === a.vehicleId);
        return {
          did: a.driverDid,
          name: nameOf(a.driverDid),
          vehicleId: a.vehicleId,
          plate: v?.plate ?? a.vehicleId,
          vehicleClass: v?.vehicleClass ?? '',
          truckSubtype: v?.truckSubtype,
          remainingKg: this.dispatch.remainingCapacity(a.driverDid),
          location: a.location,
          lastLocatedAt: a.lastLocatedAt,
        };
      });
    const chosen = q.driver && dids.has(q.driver) ? drivers.find((d) => d.did === q.driver) : undefined;
    const from = chosen?.location ?? manager.location;
    const rows = chosen ? this.dispatch.board({ driverDid: chosen.did, from, radiusKm: q.radiusKm }) : [];
    return { drivers, driver: chosen?.did ?? null, from: { ...from, source: chosen?.location ? 'driver' : 'depot' }, rows, total: rows.length };
  }

  /**
   * FP5 — put a load on one of this fleet's drivers. The driver must be the fleet's own and on a shift; the
   * service applies every gate a claim would. The office's name goes on the freight.
   */
  @Roles('fleet_manager', 'operator')
  @Post('fleet/managers/:did/dispatch')
  fleetAssign(@Param('did') did: string, @Body() dto: FleetAssignDto, @Actor() actor: IntrospectionResult) {
    this.assertFleetSelf(did, actor);
    const driver = this.drivers.get(dto.driverDid);
    if (driver.managerDid !== did) throw new GlosError('FORBIDDEN', 'This driver is not in your fleet');
    const name = actor?.actorName ?? this.managers.get(did).companyName;
    return this.dispatch.assign(dto.freightId, dto.driverDid, { managerDid: did, name });
  }

  /** The fleet's drivers as a set, and their names — the two things every fleet register needs. */
  /**
   * A driver's shop-floor name, whoever they drive for now. The register holds the hauls taken FOR a fleet, and a
   * driver who has since moved still drove them — their name stays on the row rather than turning into an id.
   */
  private readonly anyDriverName = (did: string): string => {
    try {
      return this.drivers.get(did).displayName;
    } catch {
      return did;
    }
  };

  /** Moving a driver between fleets — present in the running app; absent only in specs that build this controller by hand. */
  private mover(): FleetMoveService {
    if (!this.fleetMove) throw new GlosError('INVALID_STATE', 'Moving between fleets is not running in this deployment');
    return this.fleetMove;
  }

  private fleetDrivers(managerDid: string): { dids: Set<string>; nameOf: (did: string) => string } {
    const drivers = this.drivers.list({ managerDid });
    const names = new Map(drivers.map((d) => [d.did, d.displayName]));
    return { dids: new Set(names.keys()), nameOf: (did) => names.get(did) ?? did };
  }

  /** Issue the fleet a new code — the fleet itself, or network staff. The old code stops working at once. */
  @Roles('fleet_manager', 'operator')
  @Post('fleet/managers/:did/code/rotate')
  rotateManagerCode(@Param('did') did: string, @Actor() actor: IntrospectionResult) {
    this.assertFleetSelf(did, actor);
    const m = this.managers.rotateCode(did);
    // The fleet's contact address hears about it — without the code, which only the Fleet app shows.
    if (m.contactEmail) void this.mail?.send('fleet-code-issued', { address: m.contactEmail, name: m.companyName }, { company: m.companyName, when: m.codeRotatedAt!, byStaff: actor?.role === 'operator' });
    return { loginCode: m.loginCode, codeRotatedAt: m.codeRotatedAt };
  }

  /** Upload business KYC (registration cert, operator licence, owner ID, proof of address) → KYC_PENDING. */
  @Roles('fleet_manager', 'operator')
  @Post('fleet/managers/:did/submit-kyc')
  managerSubmitKyc(@Param('did') did: string, @Body() dto: ManagerKycDto, @Actor() actor: IntrospectionResult) {
    this.assertFleetSelf(did, actor);
    const fleet = this.managers.get(did);
    if (fleet.status !== 'DRAFT') throw new GlosError('INVALID_STATE', `Manager is ${fleet.status}, expected DRAFT`);
    // EACH PAPER IS A PICTURE ITS SENDER UPLOADED, as a shop's are: a name with no file behind it was taken as a paper
    // (the seeder sent four), and whoever approved the fleet was approving pictures nobody could open.
    const staff = actor?.role === 'operator';
    const sender = staff ? auditActor(actor) : actingDid(actor);
    const papers: Array<[string, 'kyc_registration' | 'kyc_licence' | 'kyc_id' | 'kyc_address']> = [
      [dto.businessRegCertRef, 'kyc_registration'],
      [dto.operatorLicenceRef, 'kyc_licence'],
      [dto.ownerIdRef, 'kyc_id'],
      [dto.proofOfAddressRef, 'kyc_address'],
    ];
    for (const [ref, kind] of papers) {
      if (!this.media.adopt(ref, sender, { type: 'fleet', id: did }, kind)) throw new GlosError('PHOTO_REQUIRED', 'That picture could not be attached — take the photograph again');
    }
    // A member of staff putting them on record is named, and held to it: somebody else approves (see decideKyc).
    return this.managers.submitKyc(did, dto, staff ? staffOf(actor) : undefined);
  }

  /** GLOS operator vetting of a fleet manager — a manager/driver token must never self-approve. */
  @Roles('operator')
  @Post('fleet/managers/:did/kyc-decision')
  managerDecideKyc(@Param('did') did: string, @Body() dto: ManagerKycDecisionDto, @Actor() actor: IntrospectionResult) {
    const who = staffOf(actor, dto.by);
    if (!dto.approve && !dto.reason?.trim()) throw new GlosError('REASON_REQUIRED', 'A refusal must say why: whoever puts the papers on record again reads it');
    return this.managers.decideKyc(did, dto.approve, who.name, dto.reason, who);
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
  @Roles('fleet_manager', 'operator')
  @Post('vehicles')
  registerVehicle(@Body() dto: RegisterVehicleDto, @Actor() actor: IntrospectionResult) {
    // A fleet's office registers into ITS OWN fleet, whatever fleet is typed; staff name the fleet (or none: an
    // independent courier's). It took any valid token and the typed fleet: any account could add vehicles to any fleet.
    const managerDid = actor?.role === 'operator' ? dto.managerDid : actingTenant(actor);
    if (actor?.role !== 'operator' && !managerDid) throw new GlosError('FORBIDDEN', 'A vehicle is registered by its fleet’s office');
    return this.vehicles.register({ ...dto, managerDid } as never);
  }

  /** A fleet manager sees only their own vehicles (actor.tenant); operator sees all. */
  @SignedIn()
  @Get('vehicles')
  listVehicles(@Actor() actor: IntrospectionResult, @Query('status') status?: string, @Query('class') vehicleClass?: string) {
    // Open-data marketplace list, but scoped: a fleet manager sees their own vehicles in full; a
    // non-owner sees only the public fields — never another tenant's owner id, docs, QR or photo mediaIds.
    return this.vehicles.listFor({ status: status as never, vehicleClass: vehicleClass as never, managerDid: this.officeOf(actor) }, this.officeOf(actor), actor?.role === 'operator');
  }

  /**
   * The truck sub-type catalog (label + capacity + handling capabilities) for registration UIs.
   *
   * @Public because the front door's join form needs it BEFORE anybody has an account, and a list of body
   * types is a catalogue rather than somebody's data. It was behind a token, so the only way to build a
   * registration form against it was to restate the enum in the client — which the join form did, wrongly,
   * with seven hand-typed names of which two were not real keys at all.
   */
  @Public()
  @Get('vehicles/truck-subtypes')
  truckSubtypes() {
    return Object.entries(TRUCK_SUBTYPE_CATALOG).map(([id, s]) => ({ id, ...s }));
  }

  @SignedIn()
  @Get('vehicles/:id')
  getVehicle(@Param('id') id: string, @Actor() actor: IntrospectionResult) {
    // Scope the detail to the viewer: owner/operator see the full record; others get the public
    // marketplace fields only — never the owner id, docs, dashboard QR or the S26 photo mediaIds.
    return this.vehicles.viewFor(id, this.officeOf(actor), actor?.role === 'operator');
  }

  /**
   * Upload / update registration docs — re-evaluates the verified (dispatch-priority) flag.
   *
   * FP4 made a document CONSEQUENTIAL: an insurance date that has passed takes the vehicle off the road. Until
   * now this route, like ground and retire below it, took any valid token — which would have let anyone with
   * a shop login park a competitor's fleet by typing last year's date. Owner or operator, all three.
   */
  @Roles('fleet_manager', 'operator')
  @Post('vehicles/:id/documents')
  updateVehicleDocs(@Param('id') id: string, @Body() dto: VehicleDocsDto, @Actor() actor: IntrospectionResult) {
    this.assertVehicleOwner(id, actor);
    return this.vehicles.viewFor(this.vehicles.updateDocuments(id, dto).vehicleId, actingTenant(actor), actor?.role === 'operator');
  }

  @Roles('fleet_manager', 'operator')
  @Post('vehicles/:id/ground')
  groundVehicle(@Param('id') id: string, @Actor() actor: IntrospectionResult) {
    this.assertVehicleOwner(id, actor);
    return this.vehicles.ground(id);
  }

  @Roles('fleet_manager', 'operator')
  @Post('vehicles/:id/retire')
  retireVehicle(@Param('id') id: string, @Actor() actor: IntrospectionResult) {
    this.assertVehicleOwner(id, actor);
    return this.vehicles.retire(id);
  }

  /** The vehicle's owning fleet, or an operator. A vehicle with no fleet (an independent courier's) is operator-only. */
  private assertVehicleOwner(vehicleId: string, actor: IntrospectionResult): void {
    const v = this.vehicles.get(vehicleId); // 404 if unknown
    if (actor?.role !== 'operator' && !this.isFleetOffice(actor, v.managerDid)) throw new GlosError('FORBIDDEN', 'This vehicle is not yours');
  }

  /**
   * THE FLEET'S OFFICE — the role says it is an office, the tenant says which one.
   *
   * A fleet DRIVER's token carries the fleet as its tenant too: it is how their app is scoped to their own
   * fleet's work. So "tenant matches" on its own let a driver record their OWN licence renewal — the one
   * thing that route says must never happen, because the date is there to replace the driver's word — and
   * a colleague's, and ground or retire the fleet's vehicles. One place already asked the right question
   * (the vehicle photos); now every check that means "the fleet office" asks it.
   */
  private isFleetOffice(actor: IntrospectionResult | undefined, managerDid: string | undefined): boolean {
    return actor?.role === 'fleet_manager' && Boolean(managerDid) && actingTenant(actor) === managerDid;
  }

  /**
   * Who may read one driver's own record and shift: the driver, their fleet's office, or network staff.
   *
   * These answered any signed-in caller who knew the DID — another courier included — and the record
   * carries a licence number, vetting flags, and what staff wrote about the papers somebody sent.
   */
  private assertDriverReader(did: string, actor: IntrospectionResult): FleetDriver {
    const driver = this.drivers.get(did); // 404 if unknown
    if (actor?.role === 'operator' || (actor?.did && actor.did === did) || this.isFleetOffice(actor, driver.managerDid)) return driver;
    throw new GlosError('FORBIDDEN', 'A driver’s record is theirs, their fleet office’s and the network’s to read');
  }

  /**
   * What only the DRIVER does — from their own sign-in — or network staff standing in for them.
   *
   * Where they are, whether their shift is running, which road they are taking, whether they want work
   * right now, the least a job must pay them. These took any valid token, so any account could end any
   * driver's shift, snooze them off the market, or move their dot on the map. Not the fleet office either:
   * a position is a claim about the driver's own phone, and the earnings floor is the driver's own decision
   * about their own time — the office has its own controls (couple, assign a corridor, dispatch a load).
   */
  private assertDriverActs(did: string, actor: IntrospectionResult): FleetDriver {
    const driver = this.drivers.get(did); // 404 if unknown
    if (actor?.role === 'operator' || (actor?.did && actor.did === did)) return driver;
    throw new GlosError('FORBIDDEN', 'Only the driver can do this, from their own sign-in');
  }

  // --- fleet: drivers (own ID, staged onboarding) ---

  /**
   * Register a driver. Bike/motorcycle → light registry (ACTIVE immediately); heavier → DRAFT + KYC.
   *
   * A FLEET OFFICE ADDS DRIVERS TO ITS OWN FLEET, and nobody else adds anybody to one. This route carried no role
   * and took the fleet from the body, so any signed-in account — a courier's, a shop's, a consumer's — could
   * register a driver straight into any fleet it named: a way onto somebody's trucks with no code at all. The
   * office's own token decides which fleet now; network staff may name one; a person signs THEMSELVES up at the
   * front door, never here.
   */
  @Roles('fleet_manager', 'operator')
  @Post('drivers/onboard')
  registerDriver(@Body() dto: RegisterDriverDto, @Actor() actor: IntrospectionResult) {
    if (actor?.role !== 'operator') {
      // The office, not a colleague: a fleet DRIVER's token names the fleet as its tenant too (see isFleetOffice).
      const own = actingTenant(actor);
      if (!this.isFleetOffice(actor, own) || (dto.managerDid && dto.managerDid !== own)) throw new GlosError('FORBIDDEN', 'You can add drivers to your own fleet only');
      dto.managerDid = own;
    }
    const driver = this.drivers.register(dto as never);
    // The phone the driver was registered with is how they sign in: link it to the person behind it now,
    // so the driver's first sign-in is "verify your phone, choose a PIN" — never a DID read off a badge.
    this.persons.tryAttachRole(dto.mobile, 'driver', driver.did, driver.managerDid);
    return driver;
  }

  /**
   * A driver signs in with their phone and PIN.
   *
   * The driver app used to mint its own token for whatever driver ID was typed in, which made the sign-in screen
   * decoration: the ID is printed on a badge, and anyone holding it could drive as that person. The PIN is the
   * credential now, checked by the identity spine that already counts wrong attempts and locks out; the token
   * carries the person, so a PIN change ends every session that PIN opened.
   *
   * ONE PHONE AT A TIME. Signing in as a driver ends that driver's other sessions. Somebody who has got hold of a
   * colleague's PIN cannot drive as them quietly alongside them: the colleague's own phone signs out the moment
   * they do, and the colleague signing back in throws them out in turn.
   */
  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit(60, 15 * 60) // a depot's morning from one address fits; spraying PINs across many phones does not
  @Post('drivers/session')
  driverSignIn(@Body() dto: DriverSessionDto) {
    const { person } = this.persons.loginWithPin(dto.phone, dto.pin, dto.device);
    const held = person.roles
      .filter((r) => r.role === 'driver' && r.status === 'active' && (!dto.did || r.entityDid === dto.did))
      .flatMap((link) => {
        try {
          return [{ link, driver: this.drivers.get(link.entityDid) }];
        } catch {
          return []; // a link to a driver record that no longer exists names nobody
        }
      });
    if (!held.length) throw new GlosError('ROLE_NOT_HELD', 'This phone is not registered to a driver. Ask your fleet to check the number they registered.');
    const { link, driver } = held[held.length - 1]; // the most recent registration, when a phone drove for several
    this.auth.revokeAll(driver.did); // one phone at a time: every earlier session of this driver ends here
    const token = this.auth.mintActorToken({ role: 'driver', did: driver.did, tenant: link.tenant, revocationKey: person.personDid, personDid: person.personDid });
    return { did: driver.did, displayName: driver.displayName, status: driver.status, person: this.persons.view(person), token };
  }

  /**
   * THE OFFERS WAITING ON THIS DRIVER — a fleet that wants them, until when, and what they would have to finish
   * before saying yes. The driver, or network staff helping them. Not their current fleet's office: that a
   * competitor wants somebody is the driver's business, not their employer's.
   */
  @Roles('driver', 'operator')
  @Get('drivers/:did/fleet-offers')
  fleetOffersForDriver(@Param('did') did: string, @Actor() actor: IntrospectionResult): DriverOfferView[] {
    this.assertDriverActs(did, actor);
    return this.offersOf().forDriver(did);
  }

  /**
   * YES. Only from the driver's OWN sign-in — not staff, not a fleet office, and not anybody who merely knows the
   * phone number the offer was addressed to. Moves now, or is refused by name.
   */
  @Roles('driver')
  @Post('drivers/:did/fleet-offers/:offerId/accept')
  acceptFleetOffer(@Param('did') did: string, @Param('offerId') offerId: string, @Actor() actor: IntrospectionResult): FleetMoveView {
    this.assertDriverSelf(did, actor, 'Only the driver can say yes to a place in a fleet, from their own sign-in');
    const { driver, companyName } = this.offersOf().accept(offerId, did);
    // Every session this driver held has just ended — each carried the old fleet. The phone that said yes is handed
    // a new one, as the new fleet's driver, on the same person.
    const token = this.auth.mintActorToken({ role: 'driver', did, tenant: driver.managerDid, ...(actor.personDid ? { revocationKey: actor.personDid, personDid: actor.personDid } : {}) });
    return { did, companyName, token };
  }

  /**
   * THE DRIVER LEAVES THEIR FLEET. Only from the driver's OWN sign-in: not their office (which has its own way to
   * take somebody off, with its own words), not staff, and not anybody standing in. Now, or refused by name.
   */
  @Roles('driver')
  @Post('drivers/:did/leave-fleet')
  leaveFleet(@Param('did') did: string, @Actor() actor: IntrospectionResult): FleetLeaveView {
    this.assertDriverSelf(did, actor, 'Only the driver can leave a fleet, from their own sign-in');
    const { companyName, runs } = this.mover().leave(did);
    // Every session this driver held has just ended — each carried the fleet. The phone that asked is handed a new
    // one that names no fleet, on the same person, so they are not thrown out of the app by their own decision.
    const token = this.auth.mintActorToken({ role: 'driver', did, ...(actor.personDid ? { revocationKey: actor.personDid, personDid: actor.personDid } : {}) });
    return { did, companyName, runs, token };
  }

  /** No — from the driver's own sign-in. The fleet hears it by the number it typed; nothing else changes. */
  @Roles('driver')
  @Post('drivers/:did/fleet-offers/:offerId/decline')
  declineFleetOffer(@Param('did') did: string, @Param('offerId') offerId: string, @Actor() actor: IntrospectionResult): { declined: true } {
    this.assertDriverSelf(did, actor, 'Only the driver can answer an offer, from their own sign-in');
    this.offersOf().decline(offerId, did);
    return { declined: true };
  }

  /** What the driver alone decides, from their own sign-in — the token's role AND subject, nothing standing in. */
  private assertDriverSelf(did: string, actor: IntrospectionResult, refusal: string): void {
    this.drivers.get(did); // 404 if unknown
    if (actor?.role !== 'driver' || actor.did !== did) throw new GlosError('FORBIDDEN', refusal);
  }

  private offersOf(): FleetOfferService {
    if (!this.fleetOffers) throw new GlosError('INVALID_STATE', 'Fleet offers are not running in this deployment');
    return this.fleetOffers;
  }

  /**
   * A FLEET OFFERS A PLACE to a driver already on the network, by the phone number they sign in with. The office
   * learns that the number is a driver's — which adding them already told it — and nothing more until they say yes.
   */
  @Roles('fleet_manager', 'operator')
  @Post('fleet/managers/:did/offers')
  makeFleetOffer(@Param('did') did: string, @Body() dto: FleetOfferDto, @Actor() actor: IntrospectionResult): FleetOfferView {
    this.assertFleetSelf(did, actor);
    return this.offersOf().offer(did, dto.phone, actor?.personDid);
  }

  /** The fleet's offers: open ones, and what became of the others in the last month. */
  @Roles('fleet_manager', 'operator')
  @Get('fleet/managers/:did/offers')
  fleetOffersMade(@Param('did') did: string, @Actor() actor: IntrospectionResult): FleetOfferView[] {
    this.assertFleetSelf(did, actor);
    return this.offersOf().forFleet(did);
  }

  /** Take an open offer back. The driver is told. */
  @Roles('fleet_manager', 'operator')
  @Post('fleet/managers/:did/offers/:offerId/withdraw')
  withdrawFleetOffer(@Param('did') did: string, @Param('offerId') offerId: string, @Actor() actor: IntrospectionResult): FleetOfferView {
    this.assertFleetSelf(did, actor);
    return this.offersOf().withdraw(offerId, did);
  }

  /**
   * THE FLEET TAKES A DRIVER OFF — its office, or network staff. Always with a reason the driver is shown; refused by
   * name while a load is in their hands or they are on one of the fleet's runs.
   */
  @Roles('fleet_manager', 'operator')
  @Post('fleet/managers/:did/drivers/:driverDid/remove')
  removeFleetDriver(@Param('did') did: string, @Param('driverDid') driverDid: string, @Body() dto: RemoveDriverDto, @Actor() actor: IntrospectionResult) {
    this.assertFleetSelf(did, actor);
    const left = this.mover().remove(did, driverDid, { reason: dto.reason, note: dto.note, by: actor?.personDid ?? auditActor(actor) });
    return { did: left.did, displayName: left.displayName, removedFrom: left.removedFrom };
  }

  /** A fleet manager sees only their own drivers (actor.tenant); operator sees all. */
  /**
   * This fleet's drivers — each with the work their VEHICLE'S RATE is costing them.
   *
   * The driver's own card says nothing about the rate, because a fleet driver cannot change it: the price
   * per km is on the vehicle and the vehicle is the manager's. Telling somebody their price is losing them
   * work when they hold no way to change it is an accusation, not information — so it arrives here, beside
   * the control that can actually answer it.
   *
   * Their earnings FLOOR is not here and should not be: that is the driver's own decision about their own
   * time, and putting it in front of the person who schedules them turns a setting into a negotiation.
   */
  @Roles('fleet_manager', 'operator')
  @Get('fleet/drivers')
  listFleetDrivers(@Actor() actor: IntrospectionResult) {
    /*
     * NETWORK STAFF SEE EVERYBODY; A FLEET'S OFFICE SEES ITS OWN; NOBODY ELSE SEES THE LIST AT ALL.
     *
     * It was scoped by the caller's tenant and nothing else — so a fleet DRIVER, whose token names the
     * fleet, got every colleague's record, and anyone with no tenant at all (an independent courier, a
     * shopper) passed "no fleet" as "no filter" and got every driver in the network: licence numbers,
     * vetting flags, vault references. The list is an office's working tool, and it now asks for one.
     */
    if (actor?.role !== 'operator' && !(actor?.role === 'fleet_manager' && actingTenant(actor))) {
      throw new GlosError('FORBIDDEN', 'The driver list belongs to a fleet office and the network');
    }
    return this.drivers
      .list({ managerDid: actingTenant(actor) })
      .map((d) => ({ ...d, rateReach: this.dispatch.rateReachFor(d.did), papers: driverPapers(d), offRoad: lapsedOf(driverPapers(d)).map(offRoadLine) }));
  }

  @Roles('operator')
  @Get('fleet/drivers/kyc-queue')
  driverKycQueue() {
    return this.drivers.kycQueue();
  }

  /**
   * FP4 — the papers only the network's staff can put right: couriers who ride without a fleet and
   * vehicles no fleet owns (nobody's office records their renewal), what the fleets are handling
   * themselves, and when the six-hourly check last ran.
   */
  @Roles('operator')
  @Get('fleet/papers')
  papersReport() {
    if (!this.papers) throw new GlosError('INVALID_STATE', 'The papers check is not running in this deployment');
    return this.papers.networkReport();
  }

  /** FP4 — run the papers check now rather than waiting for the clock. Answers what it did. */
  @Roles('operator')
  @Post('fleet/papers/sweep')
  async papersSweep() {
    if (!this.papers) throw new GlosError('INVALID_STATE', 'The papers check is not running in this deployment');
    const did = await this.papers.sweep();
    return { ...did, at: this.papers.lastRun?.at ?? new Date().toISOString() };
  }

  /**
   * Record the dates on a fleet OPERATOR's own papers — its transport licence and its goods-in-transit
   * cover. Staff only, like a courier's licence: a date that decides whether a company may trade is read
   * off a document by somebody here, never typed by the company it is about.
   */
  @Roles('operator')
  @Post('fleet/managers/:did/papers')
  recordCarrierPapers(@Param('did') did: string, @Body() dto: CarrierPapersRecordDto, @Actor() actor: IntrospectionResult) {
    const m = this.managers.recordPapers(did, dto, auditActor(actor));
    return { did: m.did, papers: this.managers.papersOf(did), notOffered: this.managers.tradingBlocks(did), recorded: m.papers };
  }

  /**
   * The fleet sends its renewed licence or policy from the fleet app. The FLEET OFFICE and nobody else:
   * staff sending one "on its behalf" would be the checker supplying the thing checked — the same line the
   * courier's renewed licence draws. The image must be one this session uploaded (see sendPaper).
   */
  @Roles('fleet_manager')
  @Post('fleet/managers/:did/papers/send')
  sendCarrierPaper(@Param('did') did: string, @Body() dto: SendCarrierPaperDto, @Actor() actor: IntrospectionResult) {
    this.managers.get(did);
    if (!this.isFleetOffice(actor, did)) throw new GlosError('FORBIDDEN', 'Only the fleet’s own office can send its papers');
    this.managers.sendPaper(did, dto, { ownerDid: actingDid(actor), by: auditActor(actor) });
    return this.carrierPapers(did, actor);
  }

  /** What a fleet sent is not accepted, with the reason it is shown. Network staff only. */
  @Roles('operator')
  @Post('fleet/managers/:did/papers/refuse')
  refuseCarrierPaper(@Param('did') did: string, @Body() dto: RefuseCarrierPaperDto, @Actor() actor: IntrospectionResult) {
    this.managers.refusePaper(did, dto.kind, dto.reason, auditActor(actor));
    return this.carrierPapers(did, actor);
  }

  /**
   * A fleet's own papers, and whether they are costing it work.
   *
   * Readable by the fleet itself as well as by staff, deliberately: the dates are ABOUT them, and a
   * carrier that cannot see the paper it is being refused over has been given a refusal it cannot fix.
   * `enforced` names what the sister behind them actually acts on — an empty list is the usual answer,
   * and saying so is the difference between "in date" and "nobody is checking".
   */
  @Roles('fleet_manager', 'operator')
  @Get('fleet/managers/:did/papers')
  carrierPapers(@Param('did') did: string, @Actor() actor: IntrospectionResult) {
    this.assertFleetSelf(did, actor);
    const m = this.managers.get(did);
    return {
      did,
      papers: this.managers.papersOf(did),
      recordedBy: m.papers?.recordedBy,
      recordedAt: m.papers?.recordedAt,
      enforced: this.managers.enforcedFor(m),
      notOffered: this.managers.tradingBlocks(did),
      // What the office sent and is waiting on, and why the last one was turned down — the only place the
      // fleet hears the answer, because the fleet app has no inbox. The media owner is plumbing, not news.
      sent: Object.fromEntries(Object.entries(m.papers?.sent ?? {}).map(([k, s]) => [k, { copyRef: s!.copyRef, expiresAt: s!.expiresAt, reference: s!.reference, sentAt: s!.sentAt }])),
      refused: m.papers?.refused ?? {},
    };
  }

  @Roles('driver', 'fleet_manager', 'operator')
  @Get('fleet/drivers/:did')
  getFleetDriver(@Param('did') did: string, @Actor() actor: IntrospectionResult) {
    const driver = this.assertDriverReader(did, actor);
    // REP4 — the driver's own rating + whether it has fallen below the enforcing floor, so the app can explain
    // WHY freight vanished (rather than the driver seeing an empty marketplace with no reason).
    const rating = this.ratings.driverRating(did);
    // FP4 — and the state of their licence, so the app can say why a shift will not start before they try.
    // And WHO they drive for, by name: the app says "You drive for Kilima Logistics" beside the way to move.
    let fleetName: string | undefined;
    try {
      fleetName = driver.managerDid ? this.managers.get(driver.managerDid).companyName : undefined;
    } catch {
      fleetName = undefined;
    }
    return { ...driver, ...(fleetName ? { fleetName } : {}), rating, freightPaused: belowFloor(rating), papers: driverPapers(driver), offRoad: lapsedOf(driverPapers(driver)).map(offRoadLine) };
  }

  /**
   * FP4 — the fleet office records a renewed driving licence. The DATE is what puts the driver back on the road
   * (papers.ts derives everything from it), so this is the whole of "renewal": no flag to clear, no re-vetting.
   * The fleet the driver belongs to, or an operator — never the driver, whose own word on their own licence is
   * exactly what the date is there to replace.
   */
  @Roles('fleet_manager', 'operator')
  @Post('fleet/drivers/:did/licence')
  renewDriverLicence(@Param('did') did: string, @Body() dto: RenewLicenceDto, @Actor() actor: IntrospectionResult) {
    const driver = this.drivers.get(did);
    if (actor?.role !== 'operator' && !this.isFleetOffice(actor, driver.managerDid)) {
      throw new GlosError('FORBIDDEN', actor?.did === did ? 'A licence is recorded by your fleet office or the network, never by the driver it belongs to' : 'This driver is not in your fleet');
    }
    const renewed = this.drivers.renewLicence(did, { number: dto.number, expiresAt: dto.expiresAt }, Date.now(), auditActor(actor, dto.by));
    return { ...renewed, papers: driverPapers(renewed), offRoad: lapsedOf(driverPapers(renewed)).map(offRoadLine) };
  }

  /**
   * FP4 — a courier without a fleet sends the renewed card from their app. The courier themselves and
   * nobody else: staff sending one "on their behalf" would be the checker supplying the thing checked.
   */
  @Roles('driver')
  @Post('fleet/drivers/:did/licence-renewal')
  sendLicenceRenewal(@Param('did') did: string, @Body() dto: SendLicenceRenewalDto, @Actor() actor: IntrospectionResult) {
    if (!actor?.did || actor.did !== did) throw new GlosError('FORBIDDEN', 'Only the courier can send their own licence');
    const sent = this.drivers.sendLicenceRenewal(did, { copyRef: dto.copyRef, expiresAt: dto.expiresAt, number: dto.number });
    return { ...sent, papers: driverPapers(sent), offRoad: lapsedOf(driverPapers(sent)).map(offRoadLine) };
  }

  /** FP4 — the card they sent is not accepted, with the reason they are shown. Network staff only. */
  @Roles('operator')
  @Post('fleet/drivers/:did/licence-renewal/refuse')
  refuseLicenceRenewal(@Param('did') did: string, @Body() dto: RefuseLicenceRenewalDto, @Actor() actor: IntrospectionResult) {
    const refused = this.drivers.refuseLicenceRenewal(did, dto.reason, auditActor(actor, dto.by));
    return { ...refused, papers: driverPapers(refused), offRoad: lapsedOf(driverPapers(refused)).map(offRoadLine) };
  }

  /**
   * FP4 — how to reach a courier without a fleet: their legal name and phone, from the identity vault.
   *
   * ONE COURIER AT A TIME, on purpose. The papers report lists everybody and carries no contact at all;
   * this is asked when a member of staff opens one courier, and each answer is a receipted reveal against
   * that staff account — so the vault's access log says who looked at whose number, and a list page never
   * turns into an export of phone numbers.
   */
  @Roles('operator')
  @Get('fleet/papers/couriers/:did/contact')
  courierContact(@Param('did') did: string, @Actor() actor: IntrospectionResult) {
    return this.drivers.contactFor(did, actor?.did ?? actor?.sub ?? 'operator');
  }

  /**
   * FP8 — the driver hands a claimed load back before pickup. Only the driver it is on (or staff); the service
   * unwinds the price and the charge and puts the load back on the market, and the sender is told why.
   */
  @Roles('driver', 'operator')
  @Post('dispatch/freight/:id/hand-back')
  handBackFreight(@Param('id') id: string, @Body() dto: HandBackDto, @Actor() actor: IntrospectionResult) {
    const f = this.dispatch.requireFreightPublic(id);
    if (actor?.role !== 'operator' && (!actor?.did || actor.did !== f.claimedBy)) throw new GlosError('FORBIDDEN', 'This load is not on you');
    const out = this.dispatch.handBack(id, f.claimedBy ?? actor.did!, dto.reason);
    return { freightId: out.freightId, code: out.code, status: out.status };
  }

  /** FP8 — the driver's own hours, as the app says them: on duty, the limit, whether it is passed. */
  @Roles('driver', 'fleet_manager', 'operator')
  @Get('fleet/drivers/:did/hours')
  driverHours(@Param('did') did: string, @Actor() actor: IntrospectionResult) {
    this.assertDriverReader(did, actor);
    return this.fleet.hoursFor(did);
  }

  /**
   * "TELL ME WHEN I CAN START" — a driver resting after a working day asks to be told the moment the rest is over.
   * Asked for, never assumed: that moment is usually in the small hours, and only somebody waiting for it wants it.
   * Answers with their hours as they now stand.
   */
  @Roles('driver', 'operator')
  @Post('fleet/drivers/:did/rest/tell-me')
  tellWhenRested(@Param('did') did: string, @Actor() actor: IntrospectionResult) {
    // The driver's own asking: their office may read their hours, and may not decide what wakes them.
    this.assertDriverActs(did, actor);
    this.fleet.askRestNotice(did);
    return this.fleet.hoursFor(did);
  }

  /**
   * FP7 — the sender's instructions (CMR box 13). Rewritten until the goods are taken over; added to once
   * they are on the road. The sender or the store that shipped it; the driver holding the load is told.
   */
  @SignedIn()
  @Patch('dispatch/freight/:id/instructions')
  setFreightInstructions(@Param('id') id: string, @Body() dto: FreightInstructionsDto, @Actor() actor: IntrospectionResult) {
    const by = this.assertFreightSender(id, actor);
    const f = this.dispatch.setInstructions(id, by.did, dto);
    const row = this.dispatch.postedBy(by.did).find((r) => r.freightId === f.freightId);
    return { freightId: f.freightId, code: f.code, instructions: row?.instructions ?? null, instructionsMode: row?.instructionsMode ?? 'none' };
  }

  /**
   * FP6 — the shipper rates the carrier on a delivered load. The sender or the store that shipped it, never a
   * stranger with the tracking link; the service holds it to delivered loads within the window.
   */
  @SignedIn()
  @Post('dispatch/freight/:id/rate')
  rateFreight(@Param('id') id: string, @Body() dto: RateFreightDto, @Actor() actor: IntrospectionResult) {
    const by = this.assertFreightSender(id, actor);
    const f = this.dispatch.rateFreight(id, by.did, { stars: dto.stars, issues: dto.issues });
    return { freightId: f.freightId, code: f.code, rating: f.rating };
  }

  /* ----------------------------------------------- F3: space for sale on a run that is happening -- */

  /**
   * A fleet puts a departure on one of its own published lines.
   *
   * This is the market running the other way. Everything until now has been a shipper posting a load and
   * carriers bidding; the cheapest capacity in the network is a truck that is leaving regardless with air
   * in the back, and there was no way to sell it.
   */
  @Roles('fleet_manager', 'operator')
  @Post('fleet/managers/:did/departures')
  declareDeparture(@Param('did') did: string, @Body() dto: DeclareDepartureDto, @Actor() actor: IntrospectionResult) {
    this.assertFleetSelf(did, actor);
    return this.departures.declare({ managerDid: did, ...dto });
  }

  /**
   * This fleet's own departures, soonest first, with who is aboard each.
   *
   * Carries the CURRENCY the fleet prices in, and whether that was a guess — because the form that asks
   * for a price has to say which currency it is asking in, and a fleet with no country on its record has
   * only ever been assumed into USD. See pricingCurrency.
   *
   * And `notOffered`, which is the board's own rule applied back to the fleet: a suspended or out-of-
   * licence carrier's runs are filtered off the shipper's board, and a fleet watching its screen would
   * otherwise see nothing wrong while nothing came in. Where the two sides differ, the document says so.
   */
  @Roles('fleet_manager', 'operator')
  @Get('fleet/managers/:did/departures')
  fleetDepartures(@Param('did') did: string, @Actor() actor: IntrospectionResult) {
    this.assertFleetSelf(did, actor);
    const { currency, assumed } = this.departures.pricingCurrency(did);
    const notOffered = this.managers.tradingBlocks(did);
    return { items: this.departures.forFleet(did), currency, currencyAssumed: assumed, ...(notOffered.length ? { notOffered } : {}) };
  }

  /**
   * F4 — the fleet puts a load it ALREADY HAD on its own run.
   *
   * Not a sale: nothing is quoted, no money moves, and the customer has no account here. The fleet is
   * telling us a load exists so the space it fills stops being offered to somebody else — which is what
   * makes the remaining-capacity figure on every F3 offer a fact instead of an advertisement.
   */
  @Roles('fleet_manager', 'operator')
  @Post('fleet/managers/:did/departures/:departureId/own-loads')
  addOwnLoad(@Param('did') did: string, @Param('departureId') departureId: string, @Body() dto: AddOwnLoadDto, @Actor() actor: IntrospectionResult) {
    this.assertFleetSelf(did, actor);
    return this.departures.addOwnLoad(departureId, did, dto).booking;
  }

  /**
   * Put another of the fleet's trucks on a run before it leaves. Final: done now, or refused by name — see
   * DepartureService.swapVehicle for what it checks.
   */
  @Roles('fleet_manager', 'operator')
  @Post('fleet/managers/:did/departures/:departureId/vehicle')
  swapDepartureVehicle(@Param('did') did: string, @Param('departureId') departureId: string, @Body() dto: SwapVehicleDto, @Actor() actor: IntrospectionResult) {
    this.assertFleetSelf(did, actor);
    return this.departures.swapVehicle(departureId, did, dto.vehicleId);
  }

  /** Stop selling, mark it gone, or call it off. The fleet's own call, on its own run. */
  @Roles('fleet_manager', 'operator')
  @Post('fleet/managers/:did/departures/:departureId/status')
  setDepartureStatus(@Param('did') did: string, @Param('departureId') departureId: string, @Body() dto: DepartureStatusDto, @Actor() actor: IntrospectionResult) {
    this.assertFleetSelf(did, actor);
    // A closure is filed on the hazard map by the run service, under the ordinary report procedure, as whoever is signed in.
    // Staff standing in carry no DID: actingDid threw for them on EVERY status — closing, departing — though only a
    // closure files a report. Their name is the attribution instead.
    return this.departures.setStatus(departureId, dto.status, did, { reason: dto.reason, note: dto.note, closure: dto.closureAt, reportedBy: actor?.did || auditActor(actor) });
  }

  /**
   * SPACE A SHIPPER CAN BUY — open runs that have not left, soonest first.
   *
   * Readable by anybody signed in, like the freight board: a shop, a store or a courier all ship things,
   * and which of them you are does not change what space is for sale. A full departure is simply absent.
   */
  @SignedIn()
  @Get('departures')
  departureOffers(@Query('from') from?: string, @Query('to') to?: string) {
    return { items: this.departures.offers({ ...(from ? { from } : {}), ...(to ? { to } : {}) }) };
  }

  /**
   * WHAT I BOOKED — the read this feature shipped without.
   *
   * There were three ways to read a departure and none of them was the shipper's: the fleet's own runs,
   * the public offer list, and the driver's roster. A shop took space, saw a toast, and the booking left
   * their world. This is the door back to it, and the only one that answers "was my truck called off".
   */
  @SignedIn()
  @Get('departures/mine')
  myDepartureBookings(@Actor() actor: IntrospectionResult) {
    const who = actingDid(actor);
    if (!who) throw new GlosError('FORBIDDEN', 'Sign in as the party whose goods these are');
    return { items: this.departures.forShipper(who) };
  }

  /** What this load would cost on that departure, and which axis of it the load fills — BEFORE booking. A sum: it names nobody and keeps nothing. */
  @SignedIn()
  @Post('departures/:departureId/quote')
  quoteDeparture(@Param('departureId') departureId: string, @Body() dto: BookDepartureDto) {
    return this.departures.quote(departureId, { weightKg: dto.weightKg, volumeM3: dto.volumeM3, nature: dto.nature });
  }

  /** Take space on it. The actor is the shipper — their own DID, never one they name. */
  @SignedIn()
  @Post('departures/:departureId/book')
  bookDeparture(@Param('departureId') departureId: string, @Body() dto: BookDepartureDto, @Actor() actor: IntrospectionResult) {
    const shipperDid = actingDid(actor);
    if (!shipperDid) throw new GlosError('FORBIDDEN', 'Sign in as the party whose goods these are');
    // B2 — a business books as itself; the person who did it is kept by name.
    const { forClientId, ...load } = dto;
    const { booking } = this.departures.book(departureId, { shipperDid, ...load, ...(actor?.role === 'business' && actor.actorName ? { bookedByName: actor.actorName } : {}), ...this.onBehalfOf(actor, forClientId) });
    return booking;
  }

  /** Give the space back — the shipper who took it, or the fleet that sold it. */
  @SignedIn()
  @Post('departures/:departureId/bookings/:bookingId/cancel')
  cancelDepartureBooking(
    @Param('departureId') departureId: string,
    @Param('bookingId') bookingId: string,
    @Body() dto: CancelBookingDto,
    @Actor() actor: IntrospectionResult,
  ) {
    const who = actingDid(actor);
    if (!who) throw new GlosError('FORBIDDEN', 'Sign in first');
    return this.departures.cancelBooking(departureId, bookingId, who, { reason: dto?.reason, note: dto?.note });
  }

  /* ---- waiting time: the one clock in freight that really does run by the hour ---- */

  /**
   * The fleet says who is driving this run.
   *
   * Separate from declaring it, because space is sold before a roster exists. It has to happen at all,
   * though: the waiting clock is started by the person standing at the gate, and until somebody is named
   * there is nobody holding a phone who is allowed to touch it.
   */
  @Roles('fleet_manager', 'operator')
  @Post('fleet/managers/:did/departures/:departureId/driver')
  assignDepartureDriver(
    @Param('did') did: string,
    @Param('departureId') departureId: string,
    @Body() dto: AssignDepartureDriverDto,
    @Actor() actor: IntrospectionResult,
  ) {
    this.assertFleetSelf(did, actor);
    const driver = this.drivers.get(dto.driverDid);
    // Their own driver, or the roster becomes a way to put another fleet's courier on the hook for a wait.
    if (driver.managerDid !== did) throw new GlosError('FORBIDDEN', 'That driver does not drive for you');
    return this.departures.assignDriver(departureId, did, { did: driver.did, name: driver.displayName });
  }

  /**
   * HANDED OVER — the ending a run did not have.
   *
   * The driver standing at the door, or the office on their behalf. Never the shipper: this is the
   * carrier saying what they did, and a delivery the receiving side can mark itself records nothing.
   */
  @SignedIn()
  @Post('departures/:departureId/bookings/:bookingId/delivered')
  deliverDepartureBooking(
    @Param('departureId') departureId: string,
    @Param('bookingId') bookingId: string,
    @Body() dto: DeliverDepartureDto,
    @Actor() actor: IntrospectionResult,
  ) {
    const who = actingDid(actor);
    if (!who) throw new GlosError('FORBIDDEN', 'Sign in first');
    return this.departures.deliver(departureId, bookingId, who, dto).booking;
  }

  /**
   * SECURED AND READY TO PULL AWAY — the other half of the board’s standard.
   *
   * A load that arrives broken is argued about at the far end of the journey, and the photograph that
   * settles it was taken hours earlier. Recorded at the loading gate, where the driver already is.
   */
  @SignedIn()
  @Post('departures/:departureId/bookings/:bookingId/secured')
  secureDepartureBooking(
    @Param('departureId') departureId: string,
    @Param('bookingId') bookingId: string,
    @Body() dto: SecureDepartureDto,
    @Actor() actor: IntrospectionResult,
  ) {
    const who = actingDid(actor);
    if (!who) throw new GlosError('FORBIDDEN', 'Sign in first');
    return this.departures.secured(departureId, bookingId, who, dto).booking;
  }

  /**
   * THE CONSIGNMENT NOTE for one booking on a run — the same document a board haul gets.
   *
   * The rule for FP2 was: implement the CMR, and let it be the standard where there is no standard. It
   * did not stop applying because the load arrived through a different door. Not a public document: a
   * note names both sides and describes the goods, so only the parties to the carriage may read it.
   */
  @SignedIn()
  @Get('departures/:departureId/bookings/:bookingId/consignment-note')
  departureNote(@Param('departureId') departureId: string, @Param('bookingId') bookingId: string, @Actor() actor: IntrospectionResult) {
    this.departureNotes.requireReader(departureId, bookingId, actor);
    return this.archive.latestForBooking(departureId, bookingId)?.note ?? this.departureNotes.note(departureId, bookingId, actor);
  }

  /** The same note, as the printable page a driver hands over or a shipper files. */
  @SignedIn()
  @Get('departures/:departureId/bookings/:bookingId/consignment-note.html')
  @Header('content-type', 'text/html; charset=utf-8')
  departureNoteHtml(@Param('departureId') departureId: string, @Param('bookingId') bookingId: string, @Actor() actor: IntrospectionResult) {
    this.departureNotes.requireReader(departureId, bookingId, actor);
    const frozen = this.archive.latestForBooking(departureId, bookingId);
    return frozen ? this.notes.htmlFor(frozen.note) : this.departureNotes.html(departureId, bookingId, actor);
  }

  /**
   * THE SHIPPER SAYS SOMETHING WENT WRONG.
   *
   * Recorded and evidenced; never adjudicated and never paid by us. On a board haul the network took
   * the money and can take some back off the carrier; here the fleet was paid directly and we hold no
   * cover, so an award of ours would be an award of somebody else’s money. What this gives two parties
   * is the record: a dated claim against a consignment note, beside the photographs, with the carrier’s
   * answer next to it — which is what a forwarder or an insurer can actually act on.
   */
  @SignedIn()
  @Post('departures/:departureId/bookings/:bookingId/claim')
  openDepartureClaim(
    @Param('departureId') departureId: string,
    @Param('bookingId') bookingId: string,
    @Body() dto: OpenBookingClaimDto,
    @Actor() actor: IntrospectionResult,
  ) {
    const who = actingDid(actor);
    if (!who) throw new GlosError('FORBIDDEN', 'Sign in as the party whose goods these were');
    return this.departures.openClaim(departureId, bookingId, who, dto).booking;
  }

  /** The carrier’s answer, in their own words. Ours to record and nobody’s to weigh. */
  @Roles('fleet_manager', 'operator')
  @Post('fleet/managers/:did/departures/:departureId/bookings/:bookingId/claim/answer')
  answerDepartureClaim(
    @Param('did') did: string,
    @Param('departureId') departureId: string,
    @Param('bookingId') bookingId: string,
    @Body() dto: AnswerBookingClaimDto,
    @Actor() actor: IntrospectionResult,
  ) {
    this.assertFleetSelf(did, actor);
    return this.departures.answerClaim(departureId, bookingId, did, dto.answer, dto.note).booking;
  }

  /** The runs this driver is rostered on. Theirs alone — a roster is not a public document. */
  @Roles('driver', 'fleet_manager', 'operator')
  @Get('fleet/drivers/:did/departures')
  driverDepartures(@Param('did') did: string, @Actor() actor: IntrospectionResult) {
    this.assertDriverInFleet(did, actor);
    // The checklists travel WITH the run, per booking: the phone must tick the server’s own list, in
    // the server’s own words, or a driver clears a gate the service then refuses.
    const items = this.departures.forDriver(did).map((d) => ({
      ...d,
      bookings: d.bookings.map((b) => ({ ...b, checklists: this.departures.checklistsFor(b) })),
    }));
    return { items };
  }

  /**
   * ARRIVED AT THE GATE, and LOADED / UNLOADED — the two taps the whole charge rests on.
   *
   * The time is the server's. A driver typing a time is making a claim in a dispute they have a stake in;
   * a driver tapping when it happens is making a record, and that difference is what lets a shipper accept
   * the number afterwards.
   */
  @SignedIn()
  @Post('departures/:departureId/bookings/:bookingId/arrived')
  departureArrived(
    @Param('departureId') departureId: string,
    @Param('bookingId') bookingId: string,
    @Body() dto: WaitingStopDto,
    @Actor() actor: IntrospectionResult,
  ) {
    const who = actingDid(actor);
    if (!who) throw new GlosError('FORBIDDEN', 'Sign in first');
    return this.departures.arrive(departureId, bookingId, dto.where, who).record;
  }

  @SignedIn()
  @Post('departures/:departureId/bookings/:bookingId/free-to-go')
  departureFreeToGo(
    @Param('departureId') departureId: string,
    @Param('bookingId') bookingId: string,
    @Body() dto: WaitingStopDto,
    @Actor() actor: IntrospectionResult,
  ) {
    const who = actingDid(actor);
    if (!who) throw new GlosError('FORBIDDEN', 'Sign in first');
    return this.departures.freeToGo(departureId, bookingId, dto.where, who).record;
  }

  /** The fleet lets a waiting charge go, with a reason. The record stays; only the amount goes to zero. */
  @Roles('fleet_manager', 'operator')
  @Post('fleet/managers/:did/departures/:departureId/bookings/:bookingId/waive-waiting')
  waiveDepartureWaiting(
    @Param('did') did: string,
    @Param('departureId') departureId: string,
    @Param('bookingId') bookingId: string,
    @Body() dto: WaiveWaitingDto,
    @Actor() actor: IntrospectionResult,
  ) {
    this.assertFleetSelf(did, actor);
    return this.departures.waiveWaiting(departureId, bookingId, dto.where, did, dto.reason);
  }

  /** Heavy registry: upload ID + licence copy → KYC_PENDING. */
  @Roles('driver', 'fleet_manager', 'operator')
  @Post('fleet/drivers/:did/submit-kyc')
  driverSubmitKyc(@Param('did') did: string, @Body() dto: DriverKycDto, @Actor() actor: IntrospectionResult) {
    this.assertDriverInFleet(did, actor);
    return this.drivers.submitKyc(did, dto);
  }

  @Roles('operator')
  @Post('fleet/drivers/:did/kyc-decision')
  driverDecideKyc(@Param('did') did: string, @Body() dto: DriverKycDecisionDto, @Actor() actor: IntrospectionResult) {
    return this.drivers.decideKyc(did, dto.approve, auditActor(actor, dto.by), dto.reason, dto.criminalRecordClear);
  }

  @Roles('operator')
  @Post('fleet/drivers/:did/suspend')
  suspendDriver(@Param('did') did: string) {
    return this.drivers.suspend(did);
  }

  @Roles('driver', 'operator')
  @Post('fleet/drivers/:did/ping')
  pingDriver(@Param('did') did: string, @Actor() actor: IntrospectionResult) {
    this.assertDriverActs(did, actor);
    return this.drivers.ping(did);
  }

  // --- fleet: flexible driver ↔ vehicle coupling ---

  /**
   * The fleet office says WHICH VEHICLE a driver takes today. It starts no shift.
   *
   * This route was `couple`: the office started a shift for a driver who might not be there, and whatever was
   * loaded next was on that driver's name. The driver is responsible for their load, so only the driver says they
   * are at the wheel — from their own sign-in, with their PIN (start-session). The office's own decision is the
   * vehicle, and that is all this does: it heads the driver's list, and they are told.
   */
  @Roles('fleet_manager', 'operator')
  @Post('fleet/drivers/:did/vehicle-for-today')
  suggestVehicle(@Param('did') did: string, @Body() dto: SuggestVehicleDto, @Actor() actor: IntrospectionResult) {
    const driver = this.drivers.get(did); // 404 if unknown
    if (actor?.role !== 'operator' && !this.isFleetOffice(actor, driver.managerDid)) throw new GlosError('FORBIDDEN', 'That driver is not in your fleet');
    return this.fleet.suggestVehicle(did, dto.vehicleId);
  }

  @Roles('driver', 'fleet_manager', 'operator')
  @Post('fleet/drivers/:did/uncouple')
  uncouple(@Param('did') did: string, @Actor() actor: IntrospectionResult) {
    this.assertDriverInFleet(did, actor);
    return this.fleet.uncouple(did);
  }

  /**
   * A fleet moves only its own drivers. These routes carried no label and no owner check, so any valid token
   * could couple, end or re-route anybody's shift — found while giving fleets lines of their own, which is
   * the moment "whose driver is this" started to decide which routes they may run.
   */
  private assertDriverInFleet(did: string, actor: IntrospectionResult): void {
    if (actor?.role === 'operator' || actor?.did === did) return;
    const driver = this.drivers.get(did);
    // The office, not a colleague: a fleet driver's token names the fleet too (see isFleetOffice).
    if (!this.isFleetOffice(actor, driver.managerDid)) throw new GlosError('FORBIDDEN', 'That driver is not in your fleet');
  }

  /**
   * Driver starts a shift by scanning the vehicle's dashboard QR → couples them for the day.
   *
   * WITH THEIR PIN, when they start their own. The start of a shift is where the network writes down who is driving
   * which vehicle, and an open app is not proof of who is holding the phone: a colleague who picks up a phone left
   * signed in — in a cab, on a depot charger — must not be able to start a day's work in somebody else's name. The
   * same counter and lock as the door. Staff standing in name no PIN; they are not the driver and are audited as staff.
   * The fleet office cannot start one at all: it says which vehicle (vehicle-for-today) and the driver starts.
   */
  @Roles('driver', 'operator')
  @Post('fleet/drivers/:did/start-session')
  startSession(@Param('did') did: string, @Body() dto: StartSessionDto, @Actor() actor: IntrospectionResult) {
    this.assertDriverActs(did, actor);
    if (actor?.role !== 'operator') {
      if (!actor?.personDid) throw new GlosError('FORBIDDEN', 'Sign in with your phone and PIN to start a shift');
      if (!dto.pin?.trim()) throw new GlosError('FIELD_REQUIRED', 'Enter your PIN to start the shift', { field: 'pin' });
      this.persons.confirmPin(actor.personDid, dto.pin.trim());
    }
    // Naming a vehicle they have driven before is the same act as scanning it — the coupling rules (licence,
    // usable vehicle, nobody else on it) are what actually protect this, and they run either way.
    if (dto.vehicleId?.trim()) return this.fleet.couple(did, dto.vehicleId.trim(), undefined, dto.leg);
    if (!dto.vehicleQr?.trim()) throw new GlosError('FIELD_REQUIRED', 'Scan the vehicle QR, or pick one you have driven before');
    return this.fleet.startSession(did, dto.vehicleQr, dto.leg);
  }

  /** The vehicles this driver has driven before — the "which one today?" list, before they reach the yard. */
  @Roles('driver', 'fleet_manager', 'operator')
  @Get('fleet/drivers/:did/vehicles')
  driverVehicles(@Param('did') did: string, @Actor() actor: IntrospectionResult) {
    this.assertDriverReader(did, actor);
    return { vehicles: this.fleet.recentVehicles(did) };
  }

  /**
   * Say (or re-say) where this shift is going. Re-declaring mid-shift is the normal case: a driver who has
   * reached Addis turns round, and the loads worth telling them about are now the ones on the road back.
   */
  @Roles('driver', 'operator')
  @Post('fleet/drivers/:did/leg')
  declareLeg(@Param('did') did: string, @Body() dto: DeclareLegDto, @Actor() actor: IntrospectionResult) {
    this.assertDriverActs(did, actor);
    return this.fleet.declareLeg(did, dto);
  }

  /**
   * Switch off (or back on) the road we worked out from a load the driver took.
   *
   * A switch rather than a question. Taking a load already said where they are going, so asking again — in
   * a vehicle, at the moment they are least able to answer — would spend an interruption on something we
   * already know. This is the way back for the driver who was only doing that one bag as a favour.
   */
  @Roles('driver', 'operator')
  @Post('fleet/drivers/:did/derived-leg')
  setDerivedLeg(@Param('did') did: string, @Body() dto: DerivedLegDto, @Actor() actor: IntrospectionResult) {
    this.assertDriverActs(did, actor);
    return this.fleet.setDerivedLeg(did, dto.on);
  }

  /** The roads this driver has run before — offered instead of making them name two places every morning. */
  @Roles('driver', 'fleet_manager', 'operator')
  @Get('fleet/drivers/:did/legs')
  driverLegs(@Param('did') did: string, @Actor() actor: IntrospectionResult) {
    this.assertDriverReader(did, actor);
    return { legs: this.fleet.recentLegs(did) };
  }

  /**
   * Declare a PATCH instead of a road: "I take work within this many km of me". For a bike or a bajaj there
   * is no corridor to name — there is a district, and it moves with them.
   */
  @Roles('driver', 'operator')
  @Post('fleet/drivers/:did/area')
  declareArea(@Param('did') did: string, @Body() dto: DeclareAreaDto, @Actor() actor: IntrospectionResult) {
    this.assertDriverActs(did, actor);
    return this.fleet.declareArea(did, dto.radiusKm);
  }

  /**
   * Hold new offers for a while — lunch, a fare of their own, a puncture, the last hour of a long day.
   * Stops NEW work only: whatever they are already carrying is still theirs to hand over and deliver.
   */
  @Roles('driver', 'operator')
  @Post('fleet/drivers/:did/snooze')
  snoozeWork(@Param('did') did: string, @Body() dto: SnoozeDto, @Actor() actor: IntrospectionResult) {
    this.assertDriverActs(did, actor);
    return this.fleet.snooze(did, dto.minutes);
  }

  /** Take work again, now. */
  @Roles('driver', 'operator')
  @Post('fleet/drivers/:did/resume')
  resumeWork(@Param('did') did: string, @Actor() actor: IntrospectionResult) {
    this.assertDriverActs(did, actor);
    return this.fleet.resume(did);
  }

  /** Find work AROUND me rather than along a road — the same marketplace, matched by distance. */
  @Roles('driver', 'operator')
  @Post('fleet/drivers/:did/suggest-nearby')
  suggestNearby(@Param('did') did: string, @Body() dto: SuggestNearbyDto, @Actor() actor: IntrospectionResult) {
    this.assertDriverActs(did, actor); // it moves their dot on the map as well as reading offers
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
  @Roles('driver', 'operator')
  @Post('fleet/drivers/:did/end-session')
  endSession(@Param('did') did: string, @Actor() actor: IntrospectionResult) {
    this.assertDriverActs(did, actor);
    return this.fleet.endSession(did);
  }

  /**
   * "Do not wake me for less than this", all in, for both bags and freight.
   *
   * A STANDING setting on the driver, not a filter on a search. The list views already had a minimum, but
   * it was a box typed into the request — so the one surface that speaks first, the lock-screen nudge off
   * a GPS fix, had nothing to read and applied none. A driver could set a minimum, watch the list obey it,
   * and still be interrupted at the wheel for a job beneath it.
   */
  @Roles('driver', 'operator')
  @Post('fleet/drivers/:did/min-earn')
  setNudgeMinEarn(@Param('did') did: string, @Body() dto: NudgeMinEarnDto, @Actor() actor: IntrospectionResult) {
    this.assertDriverActs(did, actor); // the driver's own floor — never the office's to set
    return this.drivers.setNudgeMinEarn(did, dto.amount);
  }

  /** The driver's current shift session (active coupling + vehicle), or { active:false } off duty.
   *
   *  Carries WHY TODAY WAS QUIET, split by cause. A setting that silences a phone without ever saying so is
   *  how somebody hears nothing for a week and blames the network — so the two things the network knows and
   *  was never saying, their own floor and their own rate, travel with the card that shows them. */
  @Roles('driver', 'fleet_manager', 'operator')
  @Get('fleet/drivers/:did/session')
  driverSession(@Param('did') did: string, @Actor() actor: IntrospectionResult) {
    this.assertDriverReader(did, actor);
    // FP8 — the shift clock rides with the session: the home screen reads it without a second call.
    return { ...this.fleet.sessionFor(did), quiet: this.dispatch.quietReport(did), hours: this.fleet.hoursFor(did) };
  }

  @Roles('driver', 'fleet_manager', 'operator')
  @Post('fleet/drivers/:did/assign-corridor')
  assignDriverCorridor(@Param('did') did: string, @Body() dto: AssignCorridorDto, @Actor() actor: IntrospectionResult) {
    this.assertDriverInFleet(did, actor);
    return this.fleet.assignCorridor(did, dto.corridorId);
  }

  /** Who is on which vehicle, and where they last were: a fleet office reads its own drivers' shifts, network staff read them all. */
  @Roles('fleet_manager', 'operator')
  @Get('fleet/assignments')
  listAssignments(@Actor() actor: IntrospectionResult, @Query('status') status?: string) {
    // It answered any sign-in with every shift of every fleet — a shop, a store or another fleet's office could
    // follow any driver's position. (The same defect as the driver list: see listFleetDrivers.)
    const all = this.fleet.list({ status: status as never });
    if (actor?.role === 'operator') return all;
    const fleet = actingTenant(actor);
    if (!fleet) throw new GlosError('FORBIDDEN', 'The shift list belongs to a fleet office and the network');
    const own = new Set(this.drivers.list({ managerDid: fleet }).map((d) => d.did));
    return all.filter((a) => own.has(a.driverDid));
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
  @Roles('agent', 'operator')
  @Post('agents/:did/totes')
  registerAgentTote(@Param('did') did: string, @Body() dto: OpenBagDto, @Actor() actor: IntrospectionResult) {
    this.assertAgentActs(did, actor);
    // Every field is optional, so a bodyless call still means "just a bare tote" — and unlike a union
    // type, this one the schema emitter can actually describe.
    if (dto?.destZone) return this.mdps.openShopBag(did, dto.destZone);
    this.agents.get(did); // 404 if unknown
    return this.totes.register(did);
  }

  /** Publish a filling tote to the claim marketplace early (before it is full / 24 h). */
  @Roles('agent', 'mdp', 'operator')
  @Post('totes/:code/release')
  releaseTote(@Param('code') code: string) {
    return this.dispatch.release(code);
  }

  /** Sweep: publish every tote that is full or has waited ≥ 24 h. The network's own sweep, run by staff: it took any valid token. */
  @Roles('operator')
  @Post('dispatch/publish-ready')
  publishReady() {
    return { published: this.dispatch.publishReady() };
  }

  /** Register a bulk freight job (trucks only) into the same marketplace as totes. */
  @SignedIn()
  @Post('dispatch/freight')
  registerFreight(@Body() dto: RegisterFreightDto, @Actor() actor: IntrospectionResult) {
    // FB0b — the DTO carries dimensions as {l,w,h} (the shape every other measured route uses); the service
    // takes the orientation-free tuple. Convert here, as createInbound/accept already do.
    const dimensionsCm: [number, number, number] | undefined = dto.dimensionsCm ? [dto.dimensionsCm.l, dto.dimensionsCm.w, dto.dimensionsCm.h] : undefined;
    // FB0c — whoever posted it is who negotiates for it. Read straight off the actor rather than through
    // actingDid: a bulletin freight posted with no identity legitimately has no owner, and must not 403 here.
    // CL1 — refuse a term this country has not switched on, before the load exists rather than after.
    this.requireActiveTerm(dto.incoterm, dto.pickupCountry, dto.destCountry);
    // B2 — a business's DID is shared by everybody in it, so the person who posted is kept by name as well.
    const { forClientId, contractId, deliverOn, orderRef, ...load } = dto;
    const posted = this.dispatch.registerFreight({ ...load, dimensionsCm, ...this.contractOrder(actor, contractId, deliverOn, orderRef), bodyHint: dto.bodyHint as never, excludedBodies: dto.excludedBodies as never, postedByDid: actor?.did, ...(actor?.role === 'business' && actor.actorName ? { postedByName: actor.actorName } : {}), ...this.onBehalfOf(actor, forClientId) });
    // …and WHICH person, kept by the business itself and never on the load, which every carrier on the board reads:
    // it is who the receipt goes to when the load is delivered.
    this.businesses?.notePosted(posted.freightId, actor);
    return posted;
  }

  @Roles('operator')
  @Get('dispatch/freight')
  listFreight(@Query('status') status?: string) {
    // P1 — an order under a contract is the two parties' and that fleet's, never part of a list anybody may read.
    return this.dispatch.listFreight({ status: status as never }).filter((f) => !this.dispatch.isPrivateOrder(f));
  }

  /**
   * FB1 — the open freight board: the whole market from where the operator is standing.
   *
   * Every load an operator cannot take comes back MARKED rather than removed, because the loads you cannot
   * take are the ones that tell you what to buy. `radiusKm` is the OPERATOR's own filter — omit it and the
   * answer is the entire market, with no 15 km clamp anywhere near it (that number governs interruptions,
   * and browsing is not an interruption).
   */
  @SignedIn()
  @Get('dispatch/board')
  freightBoard(@Query() q: FreightBoardQueryDto, @Actor() actor: IntrospectionResult): FreightBoardResponse {
    // Judged against the caller's own vehicle unless an operator names someone else's.
    // …and only an operator: a driver named in the request had the board answered for THEIR vehicle, reasons and all.
    const driverDid = actor?.role === 'operator' ? q.driverDid : actor?.did;
    const items = this.dispatch.board({ driverDid, from: { lat: Number(q.lat), lng: Number(q.lng) }, radiusKm: q.radiusKm });
    return { items, total: items.length };
  }

  // ── The crowd-sourced road map ────────────────────────────────────────────────────────────────────
  //
  // Nobody sells bridge clearances for these corridors, so the fleet that needs the map builds it. The
  // asymmetry that governs the whole feature lives in the service; what the HTTP surface has to get right
  // is who may do which half. Reporting, confirming and refuting are open to any authenticated driver —
  // that is the point, and the cost of a bad report is a detour. CLEARING is operator-only, because it is
  // the one action that takes a warning off everybody's map.

  /**
   * One tap from the cab: there is something on this road.
   *
   * Who reported it comes from the token, never the body — a hazard map with self-asserted attribution is
   * one anybody can poison anonymously. Reports of the same obstacle from different laybys fold into one
   * constraint and count as corroboration; the service handles that, so the client may report freely.
   */
  @SignedIn()
  @Post('route-constraints')
  reportConstraint(@Body() dto: ReportConstraintDto, @Actor() actor: IntrospectionResult): ConstraintView {
    return this.constraints.report({ kind: dto.kind, at: dto.at, value: dto.value, note: dto.note, photoRef: dto.photoRef, by: actingDid(actor) });
  }

  /** A later passer-by agrees it is there. One vote each, and never the original reporter's own. */
  @SignedIn()
  @Post('route-constraints/:id/confirm')
  confirmConstraint(@Param('id') id: string, @Body() dto: ConfirmConstraintDto, @Actor() actor: IntrospectionResult): ConstraintView {
    return this.constraints.confirm(id, actingDid(actor), dto?.note, dto?.photoRef);
  }

  /**
   * A driver says it is not there — and it KEEPS WARNING.
   *
   * Deliberately NOT a delete, and this endpoint is the reason the distinction has to survive the HTTP
   * layer too. Refuting moves a constraint to `disputed`, which still appears and still blocks, and puts
   * it in front of an operator. Letting the crowd remove a hazard would mean one mistaken tap — or one
   * driver who wanted a shorter route — could take a low bridge off everybody's map.
   */
  @SignedIn()
  @Post('route-constraints/:id/refute')
  refuteConstraint(@Param('id') id: string, @Body() dto: RefuteConstraintDto, @Actor() actor: IntrospectionResult): ConstraintView {
    return this.constraints.refute(id, actingDid(actor), dto.note, dto.photoRef);
  }

  /**
   * The operator clears it — the ONLY way a constraint stops warning, and operator-only for that reason.
   *
   * With a reason, always, and the reason is kept: "either forgive or regret and we don't want both".
   * A crowd-sourced hazard map must have an auditable way back, or it can never be corrected at all.
   */
  @Roles('operator')
  @Post('route-constraints/:id/clear')
  clearConstraint(@Param('id') id: string, @Body() dto: ClearConstraintDto, @Actor() actor: IntrospectionResult): ConstraintView {
    return this.constraints.clear(id, auditActor(actor, dto.by), dto.reason);
  }

  /** What is around here. Cleared constraints are gone; disputed ones are still shown, and say so. */
  @SignedIn()
  @Get('route-constraints')
  constraintsNear(@Query() q: ConstraintsNearQueryDto): ConstraintsResponse {
    const items = this.constraints.near({ lat: Number(q.lat), lng: Number(q.lng) }, q.radiusKm);
    return { items, total: items.length };
  }

  /**
   * What sits on the corridor a driver is about to run.
   *
   * An empty list means only that nothing has been REPORTED on this line — never that the road is clear.
   * The board pairs this with a caveat it cannot switch off; a client rendering this list on its own must
   * carry the same warning, because absence of a report is not clearance.
   */
  @SignedIn()
  @Get('route-constraints/route')
  constraintsAlongRoute(@Query() q: ConstraintsRouteQueryDto): RouteConstraintsResponse {
    const items = this.constraints.alongRoute(
      { lat: Number(q.fromLat), lng: Number(q.fromLng) },
      { lat: Number(q.toLat), lng: Number(q.toLng) },
    );
    return { items, total: items.length, basis: 'reported-by-drivers-never-surveyed' };
  }

  /** The operator's queue: live hazards somebody says are not there. Nothing else resolves these. */
  @Roles('operator')
  @Get('route-constraints/disputed')
  disputedConstraints(): ConstraintsResponse {
    const items = this.constraints.disputed();
    return { items, total: items.length };
  }

  /**
   * FB3b — the open market, to anyone at all.
   *
   * @Public, and that is the feature. The people who most need to know what freight moves on a corridor are
   * the ones who do not yet own a truck to move it with: an operator deciding what body to buy, someone
   * weighing up a move to another city (user, 2026-08-30). Requiring an account to answer that would put the
   * data behind exactly the door that keeps it from the people it is for.
   *
   * What is published is the WORK — bodies needed, equipment, weights, both distances, indicative money.
   * What is not is WHERE any single load sits: a town, a pin rounded to about 5 km, and no code, shop name
   * or description. Prices are the network's default rate card, and the response says so in `basis` rather
   * than leaving a client free to render them as offers.
   */
  @Public()
  @Get('market')
  publicMarket(@Query() q: MarketQueryDto): MarketResponse {
    const items = this.dispatch.publicMarket({ from: { lat: Number(q.lat), lng: Number(q.lng) }, radiusKm: q.radiusKm });
    return { items, total: items.length, basis: 'indicative-network-default' };
  }

  /**
   * FB4 — the market series: kilometres of each body ASKED FOR, against kilometres actually MOVED.
   *
   * @Public for the same reason the market board is, and more so. The list of open loads is a snapshot
   * anybody could assemble by watching; this is the shape of a market over time, and it is the thing nobody
   * else can hold, because it needs both halves — what shippers needed, and what the fleet that exists could
   * actually take. Giving it away is the moat, not a leak of one (user, 2026-08-30: entrepreneurs should get
   * that data from us, and that is how we become irreplaceable).
   *
   * Nothing here identifies a load, a shipper or a driver: it is counts and kilometres, bucketed by truck
   * body. That is what lets an aggregate be public where the individual rows behind it are coarsened.
   */
  @Public()
  @Get('market/series')
  marketSeries(@Query() q: MarketSeriesQueryDto): MarketSeries {
    const until = q.until ? Date.parse(q.until) : Date.now();
    // Twelve months back by default — the period the question is actually asked in ("yearly km of flatbed").
    const since = q.since ? Date.parse(q.since) : until - 365 * 24 * 3_600_000;
    if (!Number.isFinite(since) || !Number.isFinite(until) || since > until) {
      throw new GlosError('INVALID_INPUT', 'The period must start before it ends');
    }
    const from = q.lat != null && q.lng != null ? { lat: Number(q.lat), lng: Number(q.lng) } : undefined;
    return this.dispatch.marketSeries({ from, radiusKm: q.radiusKm, since, until });
  }

  /**
   * WHO CARRIED ON ONE LANE — the fleets, alphabetical, each with the public page it already has.
   *
   * NOT @Public, and the reason is the sentence directly above that makes the series public: "nothing here
   * identifies a load, a shipper or a driver". Naming the carriers on a lane identifies somebody, so it
   * cannot ride on that justification and does not try to. It is for people signed into the market —
   * network staff and the companies trading in it.
   *
   * It names WHOEVER THE NETWORK CONTRACTED WITH: the fleet that fielded the vehicle, or the owner-driver
   * who is their own. Both hold a handle and both get named — the alternative gives the incorporated an
   * address and the individual an anonymous residue, on a network built for informal carriers. A driver
   * EMPLOYED by a fleet is never named here: the load was taken from their fleet, and publishing an
   * employment record is the thing this network does not do.
   *
   * ALPHABETICAL, NEVER BY VOLUME. The same rule as the directory: this network states what it measured
   * and does not publish a ranking of the people in it. The counts are there because they are measured and
   * a reader can check them; the ORDER makes no claim.
   */
  @Roles('operator', 'entity_admin', 'business')
  @Get('market/lane-carriers')
  laneCarriers(@Query() q: LaneCarriersQueryDto): LaneCarriers {
    const until = q.until ? Date.parse(q.until) : Date.now();
    const since = q.since ? Date.parse(q.since) : until - 365 * 24 * 3_600_000;
    if (!Number.isFinite(since) || !Number.isFinite(until) || since > until) {
      throw new GlosError('INVALID_INPUT', 'The period must start before it ends');
    }
    this.handleDirectory.ensure();
    const found = this.dispatch.laneCarriage({ from: q.from, to: q.to, since, until });
    const carriers = found.carriers
      .map((c) => {
        // A fleet answers with its trading name; an owner-driver with their display name, which is the
        // non-PII label FleetDriver keeps precisely so there is something to say in public.
        const name =
          c.kind === 'fleet'
            ? (this.managers.list().find((m) => m.did === c.id)?.companyName ?? c.id)
            : (this.drivers.list().find((d) => d.did === c.id)?.displayName ?? c.id);
        const handle = this.handles.forId(c.id)?.handle;
        return { name, kind: c.kind, ...(handle ? { handle } : {}), loads: c.loads };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    return {
      lane: q.from + ' → ' + q.to,
      from: q.from,
      to: q.to,
      claimedLoads: found.claimedLoads,
      carriers,
      unattributedLoads: found.unattributedLoads,
      basis: 'Whoever claimed a load on this lane in this window — the fleet that fielded the vehicle, or the owner-driver who is their own. Alphabetical, and nothing here is a recommendation.',
    };
  }

  /**
   * The fee-response curve: what share of offers at each price were actually taken.
   *
   * Operator-gated, and not for drivers. It is a picture of how the whole market answers a price, and the
   * one legitimate use is deciding how dense the node network has to be — not telling any individual what
   * to charge. A driver's own view of the same machinery is their reach, on their own card.
   */
  @Roles('operator')
  @ApiQuery({ name: 'kind', required: false, enum: ['tote', 'freight'] })
  @Get('offers/response')
  offerResponse(@Query('kind') kind?: string) {
    const k = kind === 'tote' || kind === 'freight' ? kind : undefined;
    return this.dispatch.offerResponse({ kind: k });
  }

  /* ------------------------------------------- FB0c: negotiate before commit -- */

  /**
   * FB2b — the loads this shop or vendor posted, each with how many prices are waiting for an answer.
   *
   * Scoped at the source, never by filtering the public list: an operator may name another party, everyone
   * else is pinned to their own token.
   */
  @SignedIn()
  @Get('dispatch/posted')
  postedFreight(@Query('did') did: string | undefined, @Actor() actor: IntrospectionResult): PostedFreightResponse {
    const who = actingDid(actor, did);
    // …and a store's own freight is recorded under its store id, so it is looked up under both.
    const store = this.vendors.byDid(who);
    const rows = store ? [...this.dispatch.postedBy(who), ...this.dispatch.postedBy(store.vendorId)] : this.dispatch.postedBy(who);
    // Where its note is in the archive, once there is a copy this party may read: what the note's links hang on.
    // Said here so that no screen builds a document's id.
    return { items: rows.map((r) => (this.archive.hasFor(boardDocId(r.freightId), who) ? { ...r, noteId: boardDocId(r.freightId) } : r)) };
  }

  /** A driver names their price for a load posted 'negotiate'. Reserves nothing — the poster's accept claims it. */
  @Roles('driver', 'operator')
  @Post('dispatch/freight/:id/proposals')
  proposeForFreight(@Param('id') id: string, @Body() dto: ProposeFreightDto, @Actor() actor: IntrospectionResult) {
    return this.dispatch.propose({ freightId: id, driverDid: actingDid(actor, dto.driverDid), from: dto.from, price: dto.price, note: dto.note });
  }

  /** The prices offered on a load. Restricted to the side that can act on them — the poster, or an operator. */
  @SignedIn()
  @Get('dispatch/freight/:id/proposals')
  listFreightProposals(@Param('id') id: string, @Actor() actor: IntrospectionResult): FreightProposalsResponse {
    this.requireNegotiator(id, actor);
    return { items: this.dispatch.proposalsFor(id) };
  }

  /** The poster takes a price — and that acceptance is what claims the load. */
  @SignedIn()
  @Post('dispatch/proposals/:id/accept')
  acceptFreightProposal(@Param('id') id: string, @Actor() actor: IntrospectionResult) {
    this.requireNegotiator(this.dispatch.requireProposalPublic(id).freightId, actor);
    return this.dispatch.acceptProposal(id);
  }

  /** The poster says no to one price. The load, and every other proposal on it, stay open. */
  @SignedIn()
  @Post('dispatch/proposals/:id/decline')
  declineFreightProposal(@Param('id') id: string, @Actor() actor: IntrospectionResult) {
    this.requireNegotiator(this.dispatch.requireProposalPublic(id).freightId, actor);
    return this.dispatch.declineProposal(id);
  }

  /** A driver pulls back their own price. */
  @Roles('driver', 'operator')
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
    // A store's diverted order records its STORE ID as shipper while the store signs in as its DID — compared
    // raw, no store could ever answer a price on its own freight. Found building the store's conversations.
    const ownerDid = !f.postedByDid && owner && this.vendors.has(owner) ? this.vendors.get(owner).did : owner;
    if (!ownerDid || !actor?.did || actor.did !== ownerDid) throw new GlosError('FORBIDDEN', 'Only the shipper who posted this load can answer the prices offered on it');
  }

  /**
   * Bulk freight pickup (claimed → in_transit). The driver is verified against claimedBy.
   *
   * WHO THE DRIVER IS comes from the sign-in, never from the request: these four took any valid token and a driver
   * typed into the body, so anybody who knew which driver had claimed a load could mark it picked up, delivered or
   * failed in that driver's name. Network staff standing in name the driver.
   */
  @Roles('driver', 'operator')
  @Post('dispatch/freight/:id/pickup')
  freightPickup(@Param('id') id: string, @Body() dto: FreightActionDto, @Actor() actor: IntrospectionResult) {
    return this.dispatch.pickupFreight(id, actingDid(actor, dto.driverDid), { confirmed: dto.confirmed, securementPhotoId: dto.securementPhotoId, reservations: dto.reservations });
  }

  /** Bulk freight delivery (in_transit → delivered; releases the driver's reserved capacity). */
  @Roles('driver', 'operator')
  @Post('dispatch/freight/:id/deliver')
  freightDeliver(@Param('id') id: string, @Body() dto: FreightActionDto, @Actor() actor: IntrospectionResult) {
    return this.dispatch.deliverFreight(id, actingDid(actor, dto.driverDid), { confirmed: dto.confirmed, receiverName: dto.receiverName, podPhotoId: dto.podPhotoId, remarks: dto.remarks });
  }

  /**
   * FP3 — the sender withdraws a load before the goods are taken over. The poster, the shipper (a store's order
   * under its store id) or staff; anybody else is told the load does not exist. Answers with the outcome, never
   * the freight record (it carries the buyer's hash).
   */
  @SignedIn()
  @Post('dispatch/freight/:id/cancel')
  freightCancel(@Param('id') id: string, @Body() dto: CancelFreightDto, @Actor() actor: IntrospectionResult): FreightCancelledResponse {
    const { did, role } = this.assertFreightSender(id, actor);
    const done = this.dispatch.cancelFreight(id, { did, role }, dto.reason);
    return { freightId: done.freightId, code: done.code, status: done.status, cancelledAt: done.cancelledAt ?? new Date().toISOString(), ...(done.cancellation?.refunded != null ? { refunded: done.cancellation.refunded } : {}) };
  }

  /** FP3 — the poster, the shipper (a store's order under its store id) or staff; anybody else is told the load does not exist. */
  /**
   * CL1 — WHO MAY OPEN A CLAIM ON THIS LOAD. The defect this slice exists to close.
   *
   * Until now this was assertFreightSender, which assumed the sender still carried the risk when the goods
   * were damaged. Under a C term they do not: the seller pays the carriage to the destination while risk
   * passed to the buyer at origin, so a loss in transit belongs to the receiver and the sender is being
   * handed money for goods that were not theirs. Since the carrier clawback shipped, that mistake takes pay
   * off a driver.
   *
   * So standing follows the agreed term. No term recorded means the sender, which is what every load already
   * on the record is entitled to and is what keeps this change from rewriting history.
   *
   * Where the receiver owns the loss and this load records no receiver we can recognise, the refusal SAYS SO
   * rather than failing quietly — a walk-in receiver with no account is a real case, and §11 of the design
   * note carries it as open.
   */
  private assertFreightClaimant(freightId: string, actor: IntrospectionResult): { did: string; why: string } {
    const f = this.dispatch.requireFreightPublic(freightId);
    const standing = this.dispatch.claimantOf(f);
    if (actor?.role === 'operator') return { did: actor.did ?? 'operator', why: standing.why };
    if (standing.party === 'sender') return { did: this.assertFreightSender(freightId, actor).did, why: standing.why };
    // A freight records its buyer as the number they gave — and, once one is certain, the account that number was —
    // and never as a party, so that is the only honest way to recognise the receiver.
    if (!f.buyerPhoneHash) {
      throw new GlosError(
        'NOT_THE_CLAIMANT',
        standing.why + ', and this load records no receiver we can identify. A claim here is settled between the sender and the receiver directly.',
      );
    }
    const mine = actor?.did ? this.accounts.phoneHashForDid(actor.did) : undefined;
    // By the account where the order belongs to one: a sign-in that moved to a new number is still the receiver, and
    // whoever has the old number now is not.
    if (!mine || !isFor(this.dispatch.buyerOf(f), { phoneHash: mine, personDid: this.persons.findByHash(mine)?.personDid })) {
      throw new GlosError('NOT_THE_CLAIMANT', standing.why + '. Sign in as the receiver of these goods to claim for them.');
    }
    return { did: actor.did!, why: standing.why };
  }

  private assertFreightSender(freightId: string, actor: IntrospectionResult): { did: string; role: 'shipper' | 'operator' } {
    const f = this.dispatch.requireFreightPublic(freightId);
    const did = actor.did;
    if (actor.role === 'operator') return { did: did ?? 'operator', role: 'operator' };
    const store = did ? this.vendors.byDid(did) : undefined;
    const mine = Boolean(did) && (f.postedByDid === did || f.shipperDid === did || (store != null && f.shipperDid === store.vendorId));
    if (!mine || !did) throw new GlosError('NOT_FOUND', 'Freight not found');
    return { did, role: 'shipper' };
  }

  /** FP3b — the driver stood at the door and could not hand over. The load stays on the van; the sender is told. */
  @Roles('driver', 'operator')
  @Post('dispatch/freight/:id/delivery-failed')
  freightDeliveryFailed(@Param('id') id: string, @Body() dto: FreightDeliveryFailedDto, @Actor() actor: IntrospectionResult) {
    return this.dispatch.failDelivery(id, actingDid(actor, dto.driverDid), { outcome: dto.outcome, note: dto.note });
  }

  /** FP3b — the sender's claim against a delivered load: damaged, short, or not received. Answers with the claim, never the record. */
  @SignedIn()
  @Post('dispatch/freight/:id/claim')
  freightClaim(@Param('id') id: string, @Body() dto: OpenFreightClaimDto, @Actor() actor: IntrospectionResult): FreightClaimResponse {
    const { did } = this.assertFreightClaimant(id, actor);
    const f = this.dispatch.openFreightClaim(id, did, { kind: dto.kind, description: dto.description, photoRef: dto.photoRef });
    return { freightId: f.freightId, code: f.code, claim: f.claim! };
  }

  /** FP3b — the freight claims waiting on a person, oldest first. */
  @Roles('operator')
  @Get('freight-claims')
  freightClaims(): { claims: FreightClaimQueueRow[] } {
    return {
      claims: this.dispatch.openFreightClaims().map((f) => this.dispatch.freightClaimRowOf(f, { sender: this.freightSenderName(f), carrier: this.freightCarrierName(f) })),
    };
  }

  /** FP3b — decide one. Every ending carries a note the claimant is shown; an award only where a sister billed the load. */
  @Roles('operator')
  @Post('freight-claims/:id/resolve')
  resolveFreightClaim(@Param('id') id: string, @Body() dto: ResolveDisputeDto): FreightClaimResponse {
    const f = this.dispatch.resolveFreightClaim(id, dto);
    return { freightId: f.freightId, code: f.code, claim: f.claim! };
  }

  private freightSenderName(f: { shipperDid?: string; postedByDid?: string }): string {
    if (f.shipperDid && this.vendors.has(f.shipperDid)) return this.vendors.get(f.shipperDid).name;
    const did = f.postedByDid ?? f.shipperDid;
    if (did) {
      try {
        return this.agents.get(did).shopName;
      } catch {
        return did;
      }
    }
    return 'Sender not recorded';
  }

  private freightCarrierName(f: { claimedBy?: string }): string | undefined {
    if (!f.claimedBy) return undefined;
    try {
      return this.drivers.get(f.claimedBy).displayName;
    } catch {
      return f.claimedBy;
    }
  }

  /** S33b — log a temperature reading for a cold-chain freight in transit (a breach flags it for the tower). */
  /**
   * FP2 — THE CONSIGNMENT NOTE of a load, as data. Read by the sender, the carrier (driver or their fleet) and network
   * staff; anybody else is told the load does not exist. The CMR layout everywhere, the CMR itself across a border.
   */
  @SignedIn()
  @Get('dispatch/freight/:id/consignment-note')
  consignmentNote(@Param('id') id: string, @Actor() actor: IntrospectionResult) {
    this.notes.requireReader(id, actor);
    // ONCE A COPY HAS BEEN FROZEN, THAT IS THE NOTE. A live re-render against today's facts is not the
    // document anybody signed — see note-archive.types.ts. Before the goods move there is nothing to
    // freeze, and the load's own record is the only truth there is.
    return this.archive.latestForFreight(id)?.note ?? this.notes.noteFor(id);
  }

  /** The same note as a printable page. */
  @SignedIn()
  @Get('dispatch/freight/:id/consignment-note.html')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'private, no-store')
  consignmentNoteHtml(@Param('id') id: string, @Actor() actor: IntrospectionResult): string {
    this.notes.requireReader(id, actor);
    return this.notes.htmlFor(this.archive.latestForFreight(id)?.note ?? this.notes.noteFor(id));
  }

  /* ------------------------------------------------------------ THE SHIPMENT ARCHIVE -- */

  /**
   * EVERY CONSIGNMENT NOTE THE CALLER WAS A PARTY TO — searchable, filterable, paginated.
   *
   * Countries that require transport documents to be kept require them to be findable; an archive nobody
   * can search is a drawer nobody can produce. No `:did` in the path: a document's readers were frozen
   * WITH it, so the archive answers for whoever is asking rather than for a relationship looked up today.
   */
  @SignedIn()
  @Get('consignment-notes')
  noteArchive(@Query() query: NoteArchiveQueryDto, @Actor() actor: IntrospectionResult) {
    return this.archive.register(actor, query);
  }

  /** The whole match as a spreadsheet — every page, current filters, never just the page in front of them. */
  @SignedIn()
  @Get('consignment-notes/export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="consignment-notes.csv"')
  noteArchiveExport(@Query() query: NoteArchiveQueryDto, @Actor() actor: IntrospectionResult): string {
    return this.archive.registerCsv(actor, query);
  }

  /**
   * ONE DOCUMENT AS A FOLDER SOMEBODY CAN KEEP — every copy, every photograph, and a manifest.
   *
   * "Can I have a copy" does not mean a link in freight. A link needs an account and this network still
   * running, and it points at photographs on a clock the document outlives. This is the copy that keeps
   * working on a laptop with no network, which is the only kind worth calling an export.
   */
  @SignedIn()
  @Get('consignment-notes/:docId/bundle.zip')
  noteBundle(@Param('docId') docId: string, @Actor() actor: IntrospectionResult, @Res({ passthrough: true }) res: Response): StreamableFile {
    const file = this.bundles.one(docId, actor);
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    return new StreamableFile(file.bytes, { type: 'application/zip' });
  }

  /** The same, for everything matching a filter — the shape an audit asks for: "everything you moved in 2026". */
  @SignedIn()
  @Get('consignment-notes/bundle.zip')
  noteBundles(@Query() query: NoteArchiveQueryDto, @Actor() actor: IntrospectionResult, @Res({ passthrough: true }) res: Response): StreamableFile {
    const file = this.bundles.many(actor, query);
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    return new StreamableFile(file.bytes, { type: 'application/zip' });
  }

  /* ---------------------------------------------------- PLUG YOUR OWN STORAGE -- */

  /**
   * WHERE THIS ACCOUNT'S CONSIGNMENT NOTES GET PUT, besides here.
   *
   * A protocol rather than a vendor — S3-compatible, WebDAV, or a signed webhook — because "any other"
   * is the requirement and a connector per provider is a treadmill. The documents are deleted at twelve
   * months, so a copy that arrives somewhere by itself is what makes that defensible.
   */
  @SignedIn()
  @Get('consignment-notes/destination')
  destination(@Actor() actor: IntrospectionResult) {
    return this.destinations.view(actor) ?? { connected: false };
  }

  @SignedIn()
  @Post('consignment-notes/destination')
  connectDestination(@Body() dto: ConnectDestinationDto, @Actor() actor: IntrospectionResult) {
    return this.destinations.connect(actor, dto);
  }

  @SignedIn()
  @Delete('consignment-notes/destination')
  disconnectDestination(@Actor() actor: IntrospectionResult) {
    this.destinations.disconnect(actor);
    return { connected: false };
  }

  /** The webhook signing secret, for setting the far end up. Shown to the owner, nobody else. */
  @SignedIn()
  @Get('consignment-notes/destination/secret')
  destinationSecret(@Actor() actor: IntrospectionResult) {
    return this.destinations.webhookSecret(actor);
  }

  /**
   * Write a real file and report what happened.
   *
   * Not a ping: the failures people hit are credentials that read but cannot write, and a bucket that
   * exists with a prefix that is denied. Only a real PUT finds those, and finding them now rather than
   * a year later — when the document has gone — is the entire point of the button.
   */
  @SignedIn()
  @Post('consignment-notes/destination/test')
  testDestination(@Actor() actor: IntrospectionResult) {
    return this.destinations.test(actor);
  }

  /** What has been delivered and what is still owed — so a destination that stopped working is visible. */
  @SignedIn()
  @Get('consignment-notes/deliveries')
  deliveries(@Actor() actor: IntrospectionResult) {
    return { items: this.destinations.deliveriesFor(actor) };
  }

  /**
   * IS THIS THE DOCUMENT YOU ISSUED? — public, and deliberately so.
   *
   * The people who most need this answer have no account here and never will: an insurer weighing a
   * claim, a forwarder, a magistrate, the other side's lawyer. A fingerprint cannot be guessed or
   * reversed, so whoever is asking already holds the document; there is nothing here to probe at. It
   * answers about the fingerprint alone — never the note, never the parties, never the route — and it
   * keeps answering for good, long after the document itself has been deleted at the end of its window.
   */
  @Public()
  @Post('consignment-notes/verify')
  verifyNote(@Body() dto: VerifyNoteDto) {
    return this.archive.verify({ sha256: dto.sha256, note: dto.note as never });
  }

  /** One document: what it is, and every copy of it with its fingerprint. The notes stay behind the copies. */
  @SignedIn()
  @Get('consignment-notes/:docId')
  noteArchiveDocument(@Param('docId') docId: string, @Actor() actor: IntrospectionResult) {
    return this.archive.document(docId, actor);
  }

  /** One copy, exactly as it was frozen. `0` is the newest. */
  @SignedIn()
  @Get('consignment-notes/:docId/copies/:seq')
  noteArchiveCopy(@Param('docId') docId: string, @Param('seq') seq: string, @Actor() actor: IntrospectionResult) {
    return this.archive.version(docId, Number(seq) || 0, actor);
  }

  /** The same copy as the printable page a party files — rendered from what was frozen, never from the load. */
  @SignedIn()
  @Get('consignment-notes/:docId/copies/:seq/print.html')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'private, no-store')
  noteArchiveCopyHtml(@Param('docId') docId: string, @Param('seq') seq: string, @Actor() actor: IntrospectionResult): string {
    return this.archive.html(docId, Number(seq) || 0, actor);
  }

  @Roles('driver', 'operator')
  @Post('dispatch/freight/:id/temperature')
  freightTemp(@Param('id') id: string, @Body() dto: RecordTempDto, @Actor() actor: IntrospectionResult) {
    return this.dispatch.recordTemp(id, dto.celsius, actingDid(actor, dto.driverDid));
  }

  // --- F3: consolidation consignments (durable dry commodities) — the bulk analogue of totes ---

  /** F3 — a cooperative opens a consolidation LOT for a durable dry commodity: members deposit toward a
   *  truckload, and when it is full or aged it posts itself as one bulk freight (off-platform, like an F2
   *  counter freight). Owner-scoped: the acting agent (operator may override) is the aggregating PUDO, and its
   *  site is the freight's pickup. A perishable commodity is refused here — it books freight directly. */
  @Roles('agent', 'operator')
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
  @Roles('agent', 'operator')
  @Post('consignments/:code/deposit')
  depositConsignment(@Param('code') code: string, @Body() dto: ConsignmentDepositDto, @Actor() actor: IntrospectionResult) {
    const lot = this.consignments.requireByCode(code); // 404 unknown
    this.assertAgentOwner(lot.ownerDid, actor);
    return this.consignments.deposit(code, dto.memberRef, dto.weightKg);
  }

  /** F3 — a cooperative's own consolidation lots (owner-scoped; an operator must name the owner). */
  @Roles('agent', 'operator')
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

  /**
   * A driver declares a route A→B → the platform suggests the loads sitting on the way.
   *
   * A ROUTE IS A PLAN, NOT A POSITION. This used to write A into the live map as where the driver was —
   * stamped with a fresh "located at" time, so it read as a reading rather than a guess — while the driver
   * could be planning tomorrow's run from home. It did worse than guess: it OVERWROTE the real fix the
   * phone reports while on shift (see /locate), and it published DriverMoved, which is what nudges a
   * driver about a load they are "about to drive past" — past a place they were never at. Where the driver
   * is comes only from the phone. With location refused, the map shows no position rather than a made-up one.
   */
  @Roles('driver', 'operator')
  @Post('fleet/drivers/:did/suggest-work')
  suggestWork(@Param('did') did: string, @Body() dto: SuggestRouteDto, @Actor() actor: IntrospectionResult) {
    this.assertDriverActs(did, actor); // their capacity, their minimum earning, their rating — nobody else's
    const offers = this.dispatch.suggest(did, dto, Date.now(), dto.minEarn); // S34c — the driver's min-earning filter
    // F3 — what is COMING but cannot be taken yet: consolidation lots still filling along this route. Advisory
    // only (no offer, nothing to claim), so a trucker can plan a return leg around a lot that is nearly full.
    const expected = this.forthcoming.nearRoute(did, dto);
    // REP4 — return the LIVE freight-bar verdict alongside the offers, so the app's "freight is paused" note
    // comes from the SAME read as the loads it sits next to (never stale: missing when a pause just began, or
    // contradicting freight cards after it lifted).
    return { remainingCapacityKg: this.dispatch.remainingCapacity(did), remainingTotes: this.dispatch.remainingTotes(did), offers, expected, freightPaused: belowFloor(this.ratings.driverRating(did)) };
  }

  /** Driver GPS heartbeat — updates the vehicle's position on the live fleet map. */
  @Roles('driver', 'operator')
  @Post('fleet/drivers/:did/locate')
  locate(@Param('did') did: string, @Body() dto: LocateDto, @Actor() actor: IntrospectionResult) {
    this.assertDriverActs(did, actor);
    const a = this.fleet.reportLocation(did, dto);
    return { located: Boolean(a), location: a?.location };
  }

  /** Fleet-manager dashboard: vehicle/driver/session counts, working hours, live positions + cargo.
   * A fleet manager sees ONLY their own fleet (actor.tenant); the ?manager= scope and the omit-for-all
   * view are operator-only. Before S3 anyone could pass ?manager= to read a competitor's fleet. */
  @Roles('fleet_manager', 'operator')
  @Get('fleet/dashboard')
  fleetDashboard(@Actor() actor: IntrospectionResult, @Query('manager') managerQuery?: string) {
    const managerDid = this.officeOf(actor, managerQuery);
    // "No fleet" is the network's whole picture — every shift, every position, every load on the road — and it was
    // handed to any sign-in that had no fleet: a shop, a store, a courier on their own. A fleet's own drivers got theirs.
    if (actor?.role !== 'operator' && !managerDid) throw new GlosError('FORBIDDEN', 'The dashboard belongs to a fleet office and the network');
    const overview = this.fleet.overview(managerDid);
    const driverDids = managerDid ? new Set(this.drivers.list().filter((d) => d.managerDid === managerDid).map((d) => d.did)) : undefined;
    const cargo = this.dispatch.activeCargo(driverDids);
    const items = cargo.items.map((c) => ({ ...c, driver: this.driverNameOf(c.driverDid) }));
    // FP4 — what is off the road and what is running out, read live from the same rules the sweep enforces.
    const papers = managerDid && this.papers ? this.papers.reportFor(managerDid) : null;
    return { managerDid: managerDid ?? null, ...overview, cargo: { ...cargo, items }, papers };
  }

  private driverNameOf(did: string): string {
    try { return this.drivers.get(did).displayName; } catch { return '—'; }
  }

  @Roles('driver', 'fleet_manager', 'operator')
  @Get('fleet/drivers/:did/offers')
  driverOffers(@Param('did') did: string, @Actor() actor: IntrospectionResult) {
    this.assertDriverReader(did, actor);
    return this.dispatch.activeOffersFor(did);
  }

  @Roles('driver', 'fleet_manager', 'operator')
  @Get('fleet/drivers/:did/claims')
  driverClaims(@Param('did') did: string, @Actor() actor: IntrospectionResult) {
    this.assertDriverReader(did, actor);
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

  /**
   * Running totals for the current filter, and — separately — what has actually been PAID.
   *
   * They are two different questions and the screen used to answer only one of them under the other's
   * name. `earned`/`paid`/`unpaid` come from the jobs themselves, where "paid" means the network booked
   * what it owes at the moment of delivery. `settlement` comes from the payouts, where paid means a rail
   * confirmed money leaving. Until settlement existed there was nothing to tell apart; now there is, and
   * conflating them would tell somebody they have their money when it is still in the sister's account.
   */
  @Scopes('driver:read:self')
  @Get('fleet/drivers/:did/jobs/summary')
  driverJobsSummaryRoute(@Param('did') did: string, @Query() query: DriverJobsQueryDto, @Actor() actor: IntrospectionResult) {
    this.assertDriverOwner(did, actor);
    return { ...this.dispatch.driverJobsSummary(did, query), settlement: this.drivers.settlementFor(did, this.payouts) };
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

  /**
   * Driver accepts a suggestion → reserves the load + its weight against the vehicle's capacity.
   *
   * AN OFFER IS MADE TO ONE DRIVER, and is theirs to take or leave — from their own sign-in, or network staff
   * standing in. Its id was all these two took: any account could accept a load onto somebody's van, or throw
   * somebody's offers away.
   */
  @Roles('driver', 'operator')
  @Post('dispatch/offers/:id/claim')
  claimOffer(@Param('id') id: string, @Actor() actor: IntrospectionResult) {
    this.assertDriverActs(this.dispatch.offerDriver(id), actor);
    return this.dispatch.claim(id);
  }

  /** Driver declines a suggestion. */
  @Roles('driver', 'operator')
  @Post('dispatch/offers/:id/ignore')
  ignoreOffer(@Param('id') id: string, @Actor() actor: IntrospectionResult) {
    this.assertDriverActs(this.dispatch.offerDriver(id), actor);
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

/**
 * What somebody is told when their code could not be texted. One sentence whether the provider was not there,
 * refused us, or is not set up at all: none of that is theirs to tell apart, and none of it is theirs to put right.
 * The apps say the same words for `SMS_NOT_SENT`, so it is never shown twice.
 */
export const CODE_NOT_SENT = 'We could not send the code just now. Try again in a little while.';
