import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsNumber, IsOptional, IsString, Max, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator';
import { Actor } from '../../foundation/auth/actor.decorator';
import { actingTenant, auditActor } from '../../foundation/auth/acting';
import type { IntrospectionResult } from '../../foundation/auth/auth.types';
import { Roles } from '../../foundation/auth/scopes.decorator';
import { GlosError } from '../../foundation/http/glos-error';
import { DriverService } from './driver.service';
import { FleetManagerService } from './fleet-manager.service';
import { FleetService } from './fleet.service';
import { TOWING_KINDS } from './trailer-rules';
import { TrailerService, type TrailerView } from './trailer.service';
import { VehicleService } from './vehicle.service';

/** 2026-11-13 — a trailer as typed: kept, or hired for the day (trailer plan D1–D2). Litres: its load space, where measured. */
export class TrailerDto {
  @ApiProperty() @IsString() @MaxLength(20) plate!: string;
  @ApiProperty() @IsNumber() @Min(100) @Max(3500) maxKg!: number;
  @ApiProperty() @IsNumber() @Min(20) @Max(3500) emptyKg!: number;
  @ApiProperty() @IsBoolean() braked!: boolean;
  @ApiProperty() @IsBoolean() closed!: boolean;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(1) @Max(60000) litres?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() ramp?: boolean;
  /** Its registration card's photo, where it carries a plate of its own. */
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) registrationRef?: string;
}

/** 2026-11-13 — which trailer to hitch: one kept, or one hired for the day. */
export class HitchDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) trailerId?: string;
  @ApiPropertyOptional({ type: TrailerDto }) @IsOptional() @ValidateNested() @Type(() => TrailerDto) hire?: TrailerDto;
}

/** 2026-11-13 — what a licence covers for towing: the whole list. */
export class TowingKindsDto {
  @ApiProperty({ enum: TOWING_KINDS, isArray: true }) @IsArray() @ArrayMaxSize(3) @IsIn([...TOWING_KINDS], { each: true }) kinds!: string[];
}

/** 2026-11-13 — what a vehicle may tow, from its registration. */
export class TowLimitsDto {
  @ApiProperty() @IsNumber() @Min(0) @Max(3500) brakedKg!: number;
  @ApiProperty() @IsNumber() @Min(0) @Max(750) unbrakedKg!: number;
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber() @Min(500) @Max(7500) grossKg?: number | null;
}

/**
 * 2026-11-13 — TRAILERS (the owner: "consider a trailer for VANs especially — movers use vans and trailers in cities"; plan D1–D3, "build
 * as recommended"). A courier keeps theirs, a fleet its own; the driver hitches one on a shift — kept, or hired for the day — and
 * unhitches it; what a licence covers for towing, and what a vehicle may tow, are said by whose they are.
 */
@Controller('sbg')
export class TrailerController {
  constructor(
    private readonly trailers: TrailerService,
    private readonly fleet: FleetService,
    private readonly drivers: DriverService,
    private readonly managers: FleetManagerService,
    private readonly vehicles: VehicleService,
  ) {}

  /** A courier's own trailers and their fleet's; a fleet's own. */
  @Roles('driver', 'fleet_manager')
  @Get('trailers')
  list(@Actor() actor: IntrospectionResult): TrailerView[] {
    return this.trailers.listFor(this.ownerOf(actor, true));
  }

  @Roles('driver', 'fleet_manager')
  @Post('trailers')
  register(@Body() dto: TrailerDto, @Actor() actor: IntrospectionResult): TrailerView {
    const owner = this.ownerOf(actor, false);
    const country = owner.managerDid ? this.managers.get(owner.managerDid).jurisdiction : this.drivers.countryOfWork(owner.driverDid!);
    return this.trailers.register(owner, dto, { country, by: auditActor(actor), photoOwnerDid: actor.did! });
  }

  @Roles('driver', 'fleet_manager')
  @Delete('trailers/:id')
  retire(@Param('id') id: string, @Actor() actor: IntrospectionResult): TrailerView {
    return this.trailers.retire(id, this.ownerOf(actor, false));
  }

  /** The driver, on their own shift: never staff, who are at nobody's wheel. */
  @Roles('driver')
  @Post('fleet/drivers/:did/hitch')
  hitch(@Param('did') did: string, @Body() dto: HitchDto, @Actor() actor: IntrospectionResult) {
    this.assertTheDriver(did, actor);
    return this.fleet.hitch(did, { ...(dto.trailerId ? { trailerId: dto.trailerId } : {}), ...(dto.hire ? { hire: dto.hire } : {}) });
  }

  @Roles('driver')
  @Post('fleet/drivers/:did/unhitch')
  unhitch(@Param('did') did: string, @Actor() actor: IntrospectionResult) {
    this.assertTheDriver(did, actor);
    return this.fleet.unhitch(did);
  }

  /** What the driver's licence covers for towing: said by the driver, their fleet, or staff. */
  @Roles('driver', 'fleet_manager', 'operator')
  @Patch('fleet/drivers/:did/towing')
  towing(@Param('did') did: string, @Body() dto: TowingKindsDto, @Actor() actor: IntrospectionResult) {
    const driver = this.drivers.get(did); // 404 if unknown
    const self = actor?.role === 'driver' && actor.did === did;
    const theirFleet = actor?.role === 'fleet_manager' && Boolean(driver.managerDid) && actingTenant(actor) === driver.managerDid;
    if (actor?.role !== 'operator' && !self && !theirFleet) throw new GlosError('FORBIDDEN', 'Only the driver, their fleet or staff say what their licence covers');
    return { did, towing: this.drivers.setTowing(did, dto.kinds).licence?.towing ?? [] };
  }

  /** What a vehicle may tow, from its registration: said by whose it is, the driver on shift with it, or staff (as its load space). */
  @Roles('fleet_manager', 'driver', 'operator')
  @Patch('vehicles/:id/towing')
  towLimits(@Param('id') id: string, @Body() dto: TowLimitsDto, @Actor() actor: IntrospectionResult) {
    const v = this.vehicles.get(id); // 404 if unknown
    const fleet = actor?.role === 'fleet_manager' && Boolean(v.managerDid) && actingTenant(actor) === v.managerDid;
    const driver = actor?.role === 'driver' && Boolean(actor?.did) && (v.ownerDriverDid === actor.did || this.fleet.activeForVehicle(id)?.driverDid === actor.did);
    if (actor?.role !== 'operator' && !fleet && !driver) throw new GlosError('FORBIDDEN', 'Only the fleet that owns this vehicle, the driver who owns it, or the driver on shift with it, says what it may tow');
    return this.vehicles.setTowLimits(id, { brakedKg: dto.brakedKg, unbrakedKg: dto.unbrakedKg, ...(dto.grossKg !== undefined ? { grossKg: dto.grossKg } : {}) }, { name: auditActor(actor), role: actor?.role === 'operator' ? 'staff' : fleet ? 'fleet' : 'driver' });
  }

  /** A courier is the owner of their own; a fleet's people — its manager — of the fleet's. A fleet's driver reads its fleet's too. */
  private ownerOf(actor: IntrospectionResult, reading: boolean): { driverDid?: string; managerDid?: string } {
    if (actor?.role === 'fleet_manager') return { managerDid: actingTenant(actor) };
    const driver = this.drivers.get(actor.did!);
    if (!reading && driver.managerDid) throw new GlosError('FORBIDDEN', 'Your fleet keeps your trailers: ask it to add one, or hire one for the day');
    return { driverDid: driver.did, ...(reading && driver.managerDid ? { managerDid: driver.managerDid } : {}) };
  }

  private assertTheDriver(did: string, actor: IntrospectionResult): void {
    this.drivers.get(did); // 404 if unknown
    if (actor?.role !== 'driver' || actor.did !== did) throw new GlosError('FORBIDDEN', 'Only the driver hitches a trailer, on their own shift');
  }
}
