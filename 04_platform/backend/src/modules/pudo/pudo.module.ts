import { FleetOverflowController } from './fleet-overflow.controller';
import { FleetOverflowService } from './fleet-overflow.service';
import { FleetPartnerService } from './fleet-partner.service';
import { FleetPlanService } from './fleet-plan.service';
import { FleetRosterService } from './fleet-roster.service';
import { FleetRosterController } from './fleet-roster.controller';
import { FleetSiteController } from './fleet-site.controller';
import { FleetSiteService } from './fleet-site.service';
import { FleetUseService } from './fleet-use.service';
import { VehicleCareService } from './vehicle-care.service';
import { VehicleBreakdownService } from './vehicle-breakdown.service';
import { VehicleCareController } from './vehicle-care.controller';
import { ClaudeGateway } from './claude.gateway';
import { PlanAdviserService } from './plan-adviser.service';
import { OrderImportService } from './order-import.service';
import { CarriageContractController } from './carriage-contract.controller';
import { CarriageContractService } from './carriage-contract.service';
import { PapersWatchService } from './papers-watch.service';
import { HandleDirectory } from './handle-directory.service';
import { ConsignmentNoteService } from './consignment-note.service';
import { CommercialInvoiceService } from './commercial-invoice.service';
import { ShipperCodesService } from './shipper-codes.service';
import { ShippingPapersController } from './shipping-papers.controller';
import { FlagCaseController } from './flag-case.controller';
import { FlagCaseService } from './flag-case.service';
import { PayoutNumberController } from './payout-number.controller';
import { PayoutNumberService } from './payout-number.service';
import { CounterLogInterceptor, ShopStaffController } from './shop-staff.controller';
import { LostParcelController } from './lost-parcel.controller';
import { LostParcelService } from './lost-parcel.service';
import { PilotController } from './pilot.controller';
import { EvidenceController } from './evidence.controller';
import { PilotService } from './pilot.service';
import { ShopStaffService } from './shop-staff.service';
import { CredentialReminderService } from './credential-reminder.service';
import { Module } from '@nestjs/common';
import { BorderRuleService } from './border-rules.service';
import { M1Module } from '../m1/m1.module';
import { M4Module } from '../m4/m4.module';
import { M7Module } from '../m7/m7.module';
import { SbgController } from './pudo.controller';
import { IdentityController } from './identity.controller';
import { AccountController } from './account.controller';
import { AccountMoveController } from './account-move.controller';
import { AccountMoveService } from './account-move.service';
import { IdDisputeController } from './id-dispute.controller';
import { CompanyPaperReportController } from './company-paper-report.controller';
import { IdDisputeService } from './id-dispute.service';
import { MediaController } from './media.controller';
import { HelpController } from './help.controller';
import { HelpMediaService } from './help-media.service';
import { NotificationsController } from './notifications.controller';
import { NotificationService } from './notification.service';
import { NotificationDispatcher } from './notification-dispatcher.service';
import { OutboxPushSender } from './push-sender';
import { WebPushSender, choosePushSender } from './web-push';
import { PUSH_SENDER } from './notification.types';
import { GazetteerGeocoder } from './geocoder';
import { GEOCODER } from './geocoder';
import { HeuristicRouter, ROUTER } from './router';
import { OsrmRoadMatrix, ROAD_MATRIX } from './road-matrix';
import { ConnectionsController } from './connections.controller';
import { DocumentLinkController } from './document-link.controller';
import { DocumentLinkService } from './document-link.service';
import { DamageReportController } from './damage-report.controller';
import { DamageReportService } from './damage-report.service';
import { MediaService } from './media.service';
import { PersonService } from './person.service';
import { InviteService } from './invite.service';
import { DepartureService } from './departure.service';
import { DepartureNoteService } from './departure-note.service';
import { NoteArchiveService } from './note-archive.service';
import { NoteBundleService } from './note-bundle.service';
import { DestinationService } from './destination.service';
import { FleetMoveService } from './fleet-move.service';
import { FleetOfferService } from './fleet-offer.service';
import { NetworkPulseService } from './network-pulse.service';
import { EmailCodeService } from './email-code.service';
import { AccountRecoveryService } from './account-recovery.service';
import { AgentService } from './agent.service';
import { WalletGateService } from './wallet-gate.service';
import { PayeeStandingRegistrar } from './payee-standing';
import { FundingPayerRegistrar } from './funding-payers';
import { ConversationService } from './conversation.service';
import { ConversationController } from './conversation.controller';
import { CorridorService } from './corridor.service';
import { ParcelService } from './parcel.service';
import { ReturnService } from './return.service';
import { UnclaimedService } from './unclaimed.service';
import { MerchantRatingService } from './merchant-rating.service';
import { RouteConstraintService } from './route-constraint.service';
import { MonitorService } from './monitor.service';
import { RatingService } from './rating.service';
import { GraduationService } from './graduation.service';
import { VendorService } from './vendor.service';
import { VendorCallbackService } from './vendor-callback.service';
import { ShelfService } from './shelf.service';
import { RoutingService } from './routing.service';
import { MdpService } from './mdp.service';
import { ToteService } from './tote.service';
import { ConsignmentService } from './consignment.service';
import { ImportService } from './import.service';
import { SiteService } from './site.service';
import { TransitAuthorityService } from './transit-authority.service';
import { FieldObservationService } from './field-observation.service';
import { ContainerBoxService } from './container-box.service';
import { ContainerClockService } from './container-clock.service';
import { EmptyDepotService } from './empty-depot.service';
import { ContactCardService } from './contact-card.service';
import { CountryNoticeService } from './country-notice.service';
import { JourneyPlanService } from './journey-plan.service';
import { VehicleService } from './vehicle.service';
import { DriverService } from './driver.service';
import { FleetService } from './fleet.service';
import { DispatchService } from './dispatch.service';
import { MarketPulseStore } from './market-pulse.store';
import { MarketPulseService } from './market-pulse.service';
import { FleetManagerService } from './fleet-manager.service';
import { AccountService } from './account.service';
import { OtpService } from './otp.service';
import { CargoService } from './cargo.service';
import { BagPlanService } from './bag-plan.service';
import { ForthcomingService } from './forthcoming.service';
import { DockService } from './dock.service';
import { ShippingApiService } from './shipping-api.service';
import { ApiKeyService } from './api-key.service';
import { QuoteBookService } from './quote-book.service';
import { ApiKeyGuard } from './api-key.guard';
import { ShippingApiController } from './shipping-api.controller';
import { RateLimitGuard } from '../../foundation/http/rate-limit.guard';
import { IdempotencyService } from '../../foundation/http/idempotency.service';
import { BusinessService } from './business.service';
import { BusinessMemberGuard } from './business-member.guard';
import { BusinessController } from './business.controller';
import { QuoteService } from './quote.service';
import { BusinessClientService } from './business-client.service';
import { QuoteController } from './quote.controller';

/**
 * PUDO Light — emerging-market Tier 1/2 on-ramp (Compendium Ch 12–19).
 * GLOS Phase 1 deliberately constrained for high-friction environments ("resilience > efficiency").
 * Reuses the GLOS backbone: imports M1Module for the WalletService (pre-paid wallet); DidService,
 * IdentityVault, OperationalStore, EventBus and LedgerService come from the global foundation
 * modules. Adds the PUDO domain — agents, corridors, the light parcel flow, the pre-paid gate, and
 * the operator control-tower data. Built as a strict subset that graduates onto the full modules.
 */
@Module({
  imports: [M1Module, M4Module, M7Module],
  controllers: [SbgController, IdentityController, AccountController, AccountMoveController, IdDisputeController, CompanyPaperReportController, MediaController, HelpController, NotificationsController, ShippingApiController, ConversationController, BusinessController, ShippingPapersController, FlagCaseController, LostParcelController, PilotController, EvidenceController, PayoutNumberController, ShopStaffController, QuoteController, CarriageContractController, FleetRosterController, FleetSiteController, VehicleCareController, FleetOverflowController, ConnectionsController, DocumentLinkController, DamageReportController],
  providers: [AccountMoveService, IdDisputeService, DepartureService, DepartureNoteService, NoteArchiveService, NoteBundleService, DocumentLinkService, DamageReportService, DestinationService, AgentService, PayeeStandingRegistrar, FundingPayerRegistrar, ConversationService, WalletGateService, CorridorService, ParcelService, ReturnService, UnclaimedService, MerchantRatingService, RouteConstraintService, MonitorService, RatingService, GraduationService, VendorService, VendorCallbackService, ShelfService, RoutingService, MdpService, BagPlanService, ForthcomingService, DockService, ShippingApiService, QuoteBookService, ApiKeyService, ApiKeyGuard, RateLimitGuard, ToteService, ConsignmentService, ImportService, SiteService, TransitAuthorityService, FieldObservationService, ContainerBoxService, ContainerClockService, EmptyDepotService, ContactCardService, CountryNoticeService, JourneyPlanService, VehicleService, DriverService, FleetService, DispatchService, BorderRuleService, MarketPulseStore, MarketPulseService, FleetManagerService, FleetMoveService, FleetOfferService, NetworkPulseService, EmailCodeService, AccountRecoveryService, AccountService, OtpService, PersonService, InviteService, MediaService, HelpMediaService, CargoService, NotificationService, NotificationDispatcher, CredentialReminderService, PapersWatchService, HandleDirectory, BusinessService, BusinessMemberGuard, QuoteService, BusinessClientService, CarriageContractService, OrderImportService, FleetSiteService, FleetUseService, FleetRosterService, VehicleCareService, VehicleBreakdownService, FleetPlanService, ClaudeGateway, PlanAdviserService, FleetPartnerService, FleetOverflowService, ConsignmentNoteService, ShipperCodesService, CommercialInvoiceService, FlagCaseService, LostParcelService, PilotService, PayoutNumberService, ShopStaffService, CounterLogInterceptor, OutboxPushSender, { provide: WebPushSender, useFactory: () => new WebPushSender() }, { provide: PUSH_SENDER, useFactory: choosePushSender, inject: [OutboxPushSender, WebPushSender] }, GazetteerGeocoder, { provide: GEOCODER, useExisting: GazetteerGeocoder }, HeuristicRouter, { provide: ROUTER, useExisting: HeuristicRouter }, OsrmRoadMatrix, { provide: ROAD_MATRIX, useExisting: OsrmRoadMatrix }],
  exports: [AgentService, ParcelService, ReturnService, UnclaimedService, MerchantRatingService, RouteConstraintService, MonitorService, RatingService, MdpService, BagPlanService, ForthcomingService, DockService, ToteService, ImportService, VehicleService, DriverService, FleetService, DispatchService, BorderRuleService, MarketPulseStore, MarketPulseService, FleetManagerService, AccountService, OtpService, PersonService, InviteService, MediaService, CargoService, NotificationService, OutboxPushSender],
})
export class PudoModule {}
