import { Module } from '@nestjs/common';
import { M1Module } from '../m1/m1.module';
import { M4Module } from '../m4/m4.module';
import { M7Module } from '../m7/m7.module';
import { SbgController } from './pudo.controller';
import { IdentityController } from './identity.controller';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';
import { PersonService } from './person.service';
import { InviteService } from './invite.service';
import { AgentService } from './agent.service';
import { WalletGateService } from './wallet-gate.service';
import { CorridorService } from './corridor.service';
import { ParcelService } from './parcel.service';
import { MonitorService } from './monitor.service';
import { RatingService } from './rating.service';
import { GraduationService } from './graduation.service';
import { VendorService } from './vendor.service';
import { VendorCallbackService } from './vendor-callback.service';
import { ShelfService } from './shelf.service';
import { RoutingService } from './routing.service';
import { MdpService } from './mdp.service';
import { ToteService } from './tote.service';
import { VehicleService } from './vehicle.service';
import { DriverService } from './driver.service';
import { FleetService } from './fleet.service';
import { DispatchService } from './dispatch.service';
import { FleetManagerService } from './fleet-manager.service';
import { AccountService } from './account.service';
import { OtpService } from './otp.service';
import { CargoService } from './cargo.service';

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
  controllers: [SbgController, IdentityController, MediaController],
  providers: [AgentService, WalletGateService, CorridorService, ParcelService, MonitorService, RatingService, GraduationService, VendorService, VendorCallbackService, ShelfService, RoutingService, MdpService, ToteService, VehicleService, DriverService, FleetService, DispatchService, FleetManagerService, AccountService, OtpService, PersonService, InviteService, MediaService, CargoService],
  exports: [AgentService, ParcelService, MonitorService, RatingService, MdpService, ToteService, VehicleService, DriverService, FleetService, DispatchService, FleetManagerService, AccountService, OtpService, PersonService, InviteService, MediaService, CargoService],
})
export class PudoModule {}
