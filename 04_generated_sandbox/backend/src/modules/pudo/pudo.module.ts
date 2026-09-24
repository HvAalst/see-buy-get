import { PapersWatchService } from './papers-watch.service';
import { HandleDirectory } from './handle-directory.service';
import { ConsignmentNoteService } from './consignment-note.service';
import { CredentialReminderService } from './credential-reminder.service';
import { Module } from '@nestjs/common';
import { BorderRuleService } from './border-rules.service';
import { M1Module } from '../m1/m1.module';
import { M4Module } from '../m4/m4.module';
import { M7Module } from '../m7/m7.module';
import { SbgController } from './pudo.controller';
import { IdentityController } from './identity.controller';
import { MediaController } from './media.controller';
import { HelpController } from './help.controller';
import { HelpMediaService } from './help-media.service';
import { NotificationsController } from './notifications.controller';
import { NotificationService } from './notification.service';
import { NotificationDispatcher } from './notification-dispatcher.service';
import { OutboxPushSender } from './push-sender';
import { PUSH_SENDER } from './notification.types';
import { GazetteerGeocoder } from './geocoder';
import { GEOCODER } from './geocoder';
import { HeuristicRouter, ROUTER } from './router';
import { MediaService } from './media.service';
import { PersonService } from './person.service';
import { InviteService } from './invite.service';
import { DepartureService } from './departure.service';
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
  controllers: [SbgController, IdentityController, MediaController, HelpController, NotificationsController, ShippingApiController, ConversationController],
  providers: [DepartureService, AgentService, PayeeStandingRegistrar, FundingPayerRegistrar, ConversationService, WalletGateService, CorridorService, ParcelService, ReturnService, UnclaimedService, MerchantRatingService, RouteConstraintService, MonitorService, RatingService, GraduationService, VendorService, VendorCallbackService, ShelfService, RoutingService, MdpService, BagPlanService, ForthcomingService, DockService, ShippingApiService, QuoteBookService, ApiKeyService, ApiKeyGuard, RateLimitGuard, ToteService, ConsignmentService, ImportService, SiteService, TransitAuthorityService, FieldObservationService, ContainerBoxService, ContainerClockService, EmptyDepotService, ContactCardService, VehicleService, DriverService, FleetService, DispatchService, BorderRuleService, MarketPulseStore, MarketPulseService, FleetManagerService, AccountService, OtpService, PersonService, InviteService, MediaService, HelpMediaService, CargoService, NotificationService, NotificationDispatcher, CredentialReminderService, PapersWatchService, HandleDirectory, ConsignmentNoteService, OutboxPushSender, { provide: PUSH_SENDER, useExisting: OutboxPushSender }, GazetteerGeocoder, { provide: GEOCODER, useExisting: GazetteerGeocoder }, HeuristicRouter, { provide: ROUTER, useExisting: HeuristicRouter }],
  exports: [AgentService, ParcelService, ReturnService, UnclaimedService, MerchantRatingService, RouteConstraintService, MonitorService, RatingService, MdpService, BagPlanService, ForthcomingService, DockService, ToteService, ImportService, VehicleService, DriverService, FleetService, DispatchService, BorderRuleService, MarketPulseStore, MarketPulseService, FleetManagerService, AccountService, OtpService, PersonService, InviteService, MediaService, CargoService, NotificationService, OutboxPushSender],
})
export class PudoModule {}
