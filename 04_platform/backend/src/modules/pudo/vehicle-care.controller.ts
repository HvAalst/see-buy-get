import { Body, Controller, Get, Header, Param, Post, Query, StreamableFile } from '@nestjs/common';
import { Roles } from '../../foundation/auth/scopes.decorator';
import { Actor } from '../../foundation/auth/actor.decorator';
import { IntrospectionResult } from '../../foundation/auth/auth.types';
import { actingTenant, auditActor } from '../../foundation/auth/acting';
import { GlosError } from '../../foundation/http/glos-error';
import { DriverService } from './driver.service';
import { FleetManagerService } from './fleet-manager.service';
import { VehicleService } from './vehicle.service';
import { VehicleCareService } from './vehicle-care.service';
import { CareSettingsDto, CheckSheetQueryDto, DecideDefectDto, RecordReadingDto, ReportDefectDto, TakeOffRoadDto, VehicleCheckDto } from './vehicle-care.dto';
import { CareSettings, CheckResult, CheckSheet, VehicleCareView, VehicleDefect } from './vehicle-care.types';
import { FleetService } from './fleet.service';

/**
 * A VEHICLE'S UPKEEP, over the wire. Its owner's to read and change: the fleet's office for a fleet's vehicle, the
 * owner-driver for their own — and network staff.
 */
@Controller('sbg')
export class VehicleCareController {
  constructor(
    private readonly care: VehicleCareService,
    private readonly vehicles: VehicleService,
    private readonly managers: FleetManagerService,
    private readonly drivers: DriverService,
    private readonly fleet: FleetService,
  ) {}

  @Roles('fleet_manager', 'driver', 'operator')
  @Get('vehicles/:id/care')
  careOf(@Param('id') id: string, @Actor() actor: IntrospectionResult): VehicleCareView {
    this.ownerOf(id, actor);
    return this.care.view(id);
  }

  @Roles('fleet_manager', 'driver', 'operator')
  @Post('vehicles/:id/off-road')
  takeOffRoad(@Param('id') id: string, @Body() dto: TakeOffRoadDto, @Actor() actor: IntrospectionResult): VehicleCareView {
    return this.care.takeOffRoad(id, dto, this.ownerOf(id, actor));
  }

  @Roles('fleet_manager', 'driver', 'operator')
  @Post('vehicles/:id/off-road/:spellId/end')
  endSpell(@Param('id') id: string, @Param('spellId') spellId: string, @Actor() actor: IntrospectionResult): VehicleCareView {
    return this.care.endSpell(id, spellId, this.ownerOf(id, actor));
  }

  @Roles('fleet_manager', 'driver', 'operator')
  @Post('vehicles/:id/back-on-road')
  backOnTheRoad(@Param('id') id: string, @Actor() actor: IntrospectionResult): VehicleCareView {
    return this.care.backOnTheRoad(id, this.ownerOf(id, actor));
  }

  /** The office's reading: at a service, or a new meter (which may be lower than the last). */
  @Roles('fleet_manager', 'driver', 'operator')
  @Post('vehicles/:id/readings')
  recordReading(@Param('id') id: string, @Body() dto: RecordReadingDto, @Actor() actor: IntrospectionResult): VehicleCareView {
    this.care.recordReading(id, dto.km, { by: this.ownerOf(id, actor), source: 'office', ...(dto.newMeter ? { newMeter: true } : {}) });
    return this.care.view(id);
  }

  /* ------------------------------------------------------------------- the daily check, defects -- */

  /** What the driver is asked before a shift in a vehicle: named as picked, or by its QR. The driver's own, or staff. */
  @Roles('driver', 'operator')
  @Get('fleet/drivers/:did/vehicle-check')
  checkSheet(@Param('did') did: string, @Query() q: CheckSheetQueryDto, @Actor() actor: IntrospectionResult): CheckSheet {
    this.driverActs(did, actor);
    return this.care.checkSheet(did, q);
  }

  @Roles('driver', 'operator')
  @Post('fleet/drivers/:did/vehicle-check')
  submitCheck(@Param('did') did: string, @Body() dto: VehicleCheckDto, @Actor() actor: IntrospectionResult): CheckResult {
    this.driverActs(did, actor);
    return this.care.submitCheck(did, { vehicleId: dto.vehicleId, vehicleQr: dto.vehicleQr }, dto.answers);
  }

  /** A defect reported by the driver, on the vehicle named or the one they are out in. */
  @Roles('driver', 'operator')
  @Post('fleet/drivers/:did/defects')
  reportByDriver(@Param('did') did: string, @Body() dto: ReportDefectDto, @Actor() actor: IntrospectionResult): VehicleDefect {
    this.driverActs(did, actor);
    const vehicleId = dto.vehicleId ?? this.fleet.activeForDriver(did)?.vehicleId;
    if (!vehicleId) throw new GlosError('FIELD_REQUIRED', 'Name the vehicle — you are not on a shift in one', { field: 'vehicleId' });
    const sheet = this.care.checkSheet(did, { vehicleId }); // refuses a vehicle that is not theirs to drive
    const { item, note, photoRef, safe } = dto;
    return this.care.reportDefect(sheet.vehicleId, { by: this.drivers.get(did).displayName, byDid: did }, { item, note, photoRef, safe });
  }

  /** A defect reported by the office (or an owner-driver for their own vehicle) — it says whether it is safe to drive. */
  @Roles('fleet_manager', 'driver', 'operator')
  @Post('vehicles/:id/defects')
  reportByOwner(@Param('id') id: string, @Body() dto: ReportDefectDto, @Actor() actor: IntrospectionResult): VehicleDefect {
    const by = this.ownerOf(id, actor);
    const { item, note, safe } = dto;
    return this.care.reportDefect(id, { by }, { item, note, safe });
  }

  /** The office's word on a defect: fixed, or safe to drive as it is. */
  @Roles('fleet_manager', 'driver', 'operator')
  @Post('vehicles/:id/defects/:defectId/decide')
  decideDefect(@Param('id') id: string, @Param('defectId') defectId: string, @Body() dto: DecideDefectDto, @Actor() actor: IntrospectionResult): VehicleCareView {
    return this.care.decideDefect(id, defectId, dto.decision, dto.note, this.ownerOf(id, actor));
  }

  /** A defect's photograph, to the vehicle's owner — asked of the defect, never of the photo, so it stays the vehicle's. */
  @Roles('fleet_manager', 'driver', 'operator')
  @Get('vehicles/:id/defects/:defectId/photo')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  defectPhoto(@Param('id') id: string, @Param('defectId') defectId: string, @Query('variant') variant: string | undefined, @Actor() actor: IntrospectionResult): StreamableFile {
    this.ownerOf(id, actor);
    const { bytes, contentType } = this.care.defectPhoto(id, defectId, variant === 'thumb' ? 'thumb' : 'full');
    return new StreamableFile(bytes, { type: contentType });
  }

  /** A fleet's own rules for its vehicles' upkeep: its office's and staff's to read and set. */
  @Roles('fleet_manager', 'operator')
  @Get('fleet/managers/:did/care-settings')
  careSettings(@Param('did') did: string, @Actor() actor: IntrospectionResult): CareSettings {
    this.officeOf(did, actor);
    return this.care.settingsOf(did);
  }

  @Roles('fleet_manager', 'operator')
  @Post('fleet/managers/:did/care-settings')
  setCareSettings(@Param('did') did: string, @Body() dto: CareSettingsDto, @Actor() actor: IntrospectionResult): CareSettings {
    this.officeOf(did, actor);
    return this.care.setSettings(did, dto);
  }

  /** The driver themselves, from their own sign-in — or staff standing in. */
  private driverActs(did: string, actor: IntrospectionResult): void {
    this.drivers.get(did); // 404 if unknown
    if (actor?.role === 'operator') return;
    if (actor?.role === 'driver' && actor.did === did) return;
    throw new GlosError('FORBIDDEN', 'Only the driver checks the vehicle they are about to drive');
  }

  private officeOf(fleetDid: string, actor: IntrospectionResult): void {
    this.managers.get(fleetDid); // 404 if unknown
    if (actor?.role === 'operator') return;
    if (actor?.role === 'fleet_manager' && actingTenant(actor) === fleetDid) return;
    throw new GlosError('FORBIDDEN', 'This fleet is not yours');
  }

  /** The vehicle's owner, or staff — and the name what they do is signed with. Anybody else: refused. */
  private ownerOf(vehicleId: string, actor: IntrospectionResult): string {
    const v = this.vehicles.get(vehicleId); // 404 if unknown
    if (actor?.role === 'operator') return auditActor(actor);
    if (actor?.role === 'fleet_manager' && v.managerDid && actingTenant(actor) === v.managerDid) return actor.actorName || this.managers.get(v.managerDid).companyName;
    if (actor?.role === 'driver' && v.ownerDriverDid && actor.did === v.ownerDriverDid) return this.drivers.get(actor.did).displayName;
    throw new GlosError('FORBIDDEN', 'This vehicle is not yours');
  }
}
