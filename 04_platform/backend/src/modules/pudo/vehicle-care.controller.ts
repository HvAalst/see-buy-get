import { Body, Controller, Get, Header, Param, Post, Query, StreamableFile } from '@nestjs/common';
import { Roles } from '../../foundation/auth/scopes.decorator';
import { Actor } from '../../foundation/auth/actor.decorator';
import { IntrospectionResult } from '../../foundation/auth/auth.types';
import { actingDid, actingTenant } from '../../foundation/auth/acting';
import { GlosError } from '../../foundation/http/glos-error';
import { DriverService } from './driver.service';
import { FleetManagerService } from './fleet-manager.service';
import { VehicleService } from './vehicle.service';
import { VehicleCareService } from './vehicle-care.service';
import { CareSettingsDto, CheckSheetQueryDto, DecideDefectDto, HandOverDto, RecordReadingDto, ReportBreakdownDto, ReportDefectDto, ResolveBreakdownDto, ServicePlanDto, ServiceRecordDto, TakeOffRoadDto, TakeOverDto, VehicleCheckDto } from './vehicle-care.dto';
import { BreakdownTaker, BreakdownToTakeOver, CareSettings, CheckResult, CheckSheet, TakeOverResult, VehicleBreakdown, VehicleCareView, VehicleDefect } from './vehicle-care.types';
import { VehicleBreakdownService } from './vehicle-breakdown.service';
import { FleetService } from './fleet.service';

/**
 * A VEHICLE'S UPKEEP, over the wire. Its owner's to read and change: the fleet's office for a fleet's vehicle, the
 * owner-driver for their own. Network staff READ it and change nothing (the user, 2026-10-16: "Staff should not be
 * able to change upkeep records") — a company keeps its own record; staff act only on a report, through their own
 * procedures. So no write route here names staff among its roles, and each acting check refuses them as well.
 */
/** What staff are told at any door that would change a fleet's upkeep. */
const STAFF_READ_ONLY = 'Staff read a fleet’s upkeep and change none of it: its own office keeps the record';

@Controller('sbg')
export class VehicleCareController {
  constructor(
    private readonly care: VehicleCareService,
    private readonly vehicles: VehicleService,
    private readonly managers: FleetManagerService,
    private readonly drivers: DriverService,
    private readonly fleet: FleetService,
    private readonly breakdowns: VehicleBreakdownService,
  ) {}

  @Roles('fleet_manager', 'driver', 'operator')
  @Get('vehicles/:id/care')
  careOf(@Param('id') id: string, @Actor() actor: IntrospectionResult): VehicleCareView {
    this.ownerReads(id, actor);
    return this.care.view(id);
  }

  @Roles('fleet_manager', 'driver')
  @Post('vehicles/:id/off-road')
  takeOffRoad(@Param('id') id: string, @Body() dto: TakeOffRoadDto, @Actor() actor: IntrospectionResult): VehicleCareView {
    return this.care.takeOffRoad(id, dto, this.ownerOf(id, actor));
  }

  @Roles('fleet_manager', 'driver')
  @Post('vehicles/:id/off-road/:spellId/end')
  endSpell(@Param('id') id: string, @Param('spellId') spellId: string, @Actor() actor: IntrospectionResult): VehicleCareView {
    return this.care.endSpell(id, spellId, this.ownerOf(id, actor));
  }

  @Roles('fleet_manager', 'driver')
  @Post('vehicles/:id/back-on-road')
  backOnTheRoad(@Param('id') id: string, @Actor() actor: IntrospectionResult): VehicleCareView {
    return this.care.backOnTheRoad(id, this.ownerOf(id, actor));
  }

  /** The office's reading: at a service, or a new meter (which may be lower than the last). */
  @Roles('fleet_manager', 'driver')
  @Post('vehicles/:id/readings')
  recordReading(@Param('id') id: string, @Body() dto: RecordReadingDto, @Actor() actor: IntrospectionResult): VehicleCareView {
    this.care.recordReading(id, dto.km, { by: this.ownerOf(id, actor), source: 'office', ...(dto.newMeter ? { newMeter: true } : {}) });
    return this.care.view(id);
  }

  /* ----------------------------------------------------------------------------------- services -- */

  /** How often it is serviced: every so many km or months — or back to its class's usual. */
  @Roles('fleet_manager', 'driver')
  @Post('vehicles/:id/service-plan')
  setServicePlan(@Param('id') id: string, @Body() dto: ServicePlanDto, @Actor() actor: IntrospectionResult): VehicleCareView {
    return this.care.setServicePlan(id, dto, this.ownerOf(id, actor));
  }

  /** What was done to it, and when: a service, a repair, tyres, an inspection — with its job card. */
  @Roles('fleet_manager', 'driver')
  @Post('vehicles/:id/services')
  recordService(@Param('id') id: string, @Body() dto: ServiceRecordDto, @Actor() actor: IntrospectionResult): VehicleCareView {
    const by = this.ownerOf(id, actor);
    // The job card is the uploader's until it is attached: the same principal the upload was kept under.
    return this.care.recordService(id, dto, { by, byDid: actingDid(actor) });
  }

  /** A service's job card, to the vehicle's owner — asked of the service, never of the photo, so it stays the vehicle's. */
  @Roles('fleet_manager', 'driver', 'operator')
  @Get('vehicles/:id/services/:recordId/photo')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  servicePhoto(@Param('id') id: string, @Param('recordId') recordId: string, @Query('variant') variant: string | undefined, @Actor() actor: IntrospectionResult): StreamableFile {
    this.ownerReads(id, actor);
    const { bytes, contentType } = this.care.servicePhoto(id, recordId, variant === 'thumb' ? 'thumb' : 'full');
    return new StreamableFile(bytes, { type: contentType });
  }

  /* --------------------------------------------------------------------------------- breakdowns -- */

  /** Broken down on the road: the driver, of the vehicle they are out in — with where the phone is now, when it can say. */
  @Roles('driver')
  @Post('fleet/drivers/:did/breakdown')
  reportBreakdown(@Param('did') did: string, @Body() dto: ReportBreakdownDto, @Actor() actor: IntrospectionResult): VehicleBreakdown {
    this.driverActs(did, actor);
    const vehicleId = this.fleet.activeForDriver(did)?.vehicleId;
    if (!vehicleId) throw new GlosError('INVALID_STATE', 'You are not on a shift: a breakdown is reported from the vehicle you are out in');
    const { cause, note, photoRef, lat, lng, observedAt } = dto;
    return this.breakdowns.report(vehicleId, { by: this.drivers.get(did).displayName, byDid: did }, { cause, note, photoRef, lat, lng, observedAt });
  }

  /** A breakdown the office heard of by telephone — or an owner-driver's own vehicle. */
  @Roles('fleet_manager', 'driver')
  @Post('vehicles/:id/breakdowns')
  recordBreakdown(@Param('id') id: string, @Body() dto: ReportBreakdownDto, @Actor() actor: IntrospectionResult): VehicleCareView {
    const by = this.ownerOf(id, actor);
    const { cause, note, lat, lng } = dto;
    this.breakdowns.report(id, { by }, { cause, note, lat, lng });
    return this.care.view(id);
  }

  /** How it ended: back on the road, or into the workshop — with what was done. */
  @Roles('fleet_manager', 'driver')
  @Post('vehicles/:id/breakdowns/:breakdownId/resolve')
  resolveBreakdown(@Param('id') id: string, @Param('breakdownId') breakdownId: string, @Body() dto: ResolveBreakdownDto, @Actor() actor: IntrospectionResult): VehicleCareView {
    return this.care.resolveBreakdown(id, breakdownId, dto, this.ownerOf(id, actor));
  }

  /** A breakdown's photograph, to the vehicle's owner — asked of the breakdown, never of the photo. */
  @Roles('fleet_manager', 'driver', 'operator')
  @Get('vehicles/:id/breakdowns/:breakdownId/photo')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  breakdownPhoto(@Param('id') id: string, @Param('breakdownId') breakdownId: string, @Query('variant') variant: string | undefined, @Actor() actor: IntrospectionResult): StreamableFile {
    this.ownerReads(id, actor);
    const { bytes, contentType } = this.breakdowns.photo(id, breakdownId, variant === 'thumb' ? 'thumb' : 'full');
    return new StreamableFile(bytes, { type: contentType });
  }

  /** The broken-down vehicles of the driver's own fleet with loads still to take over — for the driver coming for them. */
  @Roles('driver', 'operator')
  @Get('fleet/drivers/:did/breakdowns')
  toTakeOver(@Param('did') did: string, @Actor() actor: IntrospectionResult): BreakdownToTakeOver[] {
    this.driverReads(did, actor);
    return this.breakdowns.toTakeOver(did);
  }

  /** Taking a broken-down vehicle's loads over, at the vehicle, with the pass of the driver handing them over. */
  @Roles('driver')
  @Post('fleet/drivers/:did/take-over')
  takeOver(@Param('did') did: string, @Body() dto: TakeOverDto, @Actor() actor: IntrospectionResult): TakeOverResult {
    this.driverActs(did, actor);
    const { pass, lat, lng } = dto;
    return this.breakdowns.takeOverByPass(dto.breakdownId, did, { pass, lat, lng });
  }

  /** Who of the fleet could take a breakdown's loads: out in another vehicle on the road now, and the room each has. */
  @Roles('fleet_manager', 'operator')
  @Get('vehicles/:id/breakdowns/:breakdownId/takers')
  takers(@Param('id') id: string, @Param('breakdownId') breakdownId: string, @Actor() actor: IntrospectionResult): BreakdownTaker[] {
    this.ownerReads(id, actor);
    return this.breakdowns.takersFor(id, breakdownId);
  }

  /** The office moves a breakdown's loads to a driver of the fleet out in another vehicle. */
  @Roles('fleet_manager')
  @Post('vehicles/:id/breakdowns/:breakdownId/hand-over')
  handOver(@Param('id') id: string, @Param('breakdownId') breakdownId: string, @Body() dto: HandOverDto, @Actor() actor: IntrospectionResult): VehicleCareView {
    this.breakdowns.handOverByOffice(id, breakdownId, dto.toDriverDid, this.ownerOf(id, actor));
    return this.care.view(id);
  }

  /** A fleet's vehicles broken down now: its office's and staff's to read. */
  @Roles('fleet_manager', 'operator')
  @Get('fleet/managers/:did/breakdowns')
  fleetBreakdowns(@Param('did') did: string, @Actor() actor: IntrospectionResult): VehicleBreakdown[] {
    this.officeReads(did, actor);
    return this.breakdowns.openForFleet(did);
  }

  /* ------------------------------------------------------------------- the daily check, defects -- */

  /** What the driver is asked before a shift in a vehicle: named as picked, or by its QR. The driver's own, or staff. */
  @Roles('driver', 'operator')
  @Get('fleet/drivers/:did/vehicle-check')
  checkSheet(@Param('did') did: string, @Query() q: CheckSheetQueryDto, @Actor() actor: IntrospectionResult): CheckSheet {
    this.driverReads(did, actor);
    return this.care.checkSheet(did, q);
  }

  @Roles('driver')
  @Post('fleet/drivers/:did/vehicle-check')
  submitCheck(@Param('did') did: string, @Body() dto: VehicleCheckDto, @Actor() actor: IntrospectionResult): CheckResult {
    this.driverActs(did, actor);
    return this.care.submitCheck(did, { vehicleId: dto.vehicleId, vehicleQr: dto.vehicleQr }, dto.answers);
  }

  /** A defect reported by the driver, on the vehicle named or the one they are out in. */
  @Roles('driver')
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
  @Roles('fleet_manager', 'driver')
  @Post('vehicles/:id/defects')
  reportByOwner(@Param('id') id: string, @Body() dto: ReportDefectDto, @Actor() actor: IntrospectionResult): VehicleDefect {
    const by = this.ownerOf(id, actor);
    const { item, note, safe } = dto;
    return this.care.reportDefect(id, { by }, { item, note, safe });
  }

  /** The office's word on a defect: fixed, or safe to drive as it is. */
  @Roles('fleet_manager', 'driver')
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
    this.ownerReads(id, actor);
    const { bytes, contentType } = this.care.defectPhoto(id, defectId, variant === 'thumb' ? 'thumb' : 'full');
    return new StreamableFile(bytes, { type: contentType });
  }

  /** A fleet's own rules for its vehicles' upkeep: its office's and staff's to read and set. */
  @Roles('fleet_manager', 'operator')
  @Get('fleet/managers/:did/care-settings')
  careSettings(@Param('did') did: string, @Actor() actor: IntrospectionResult): CareSettings {
    this.officeReads(did, actor);
    return this.care.settingsOf(did);
  }

  @Roles('fleet_manager')
  @Post('fleet/managers/:did/care-settings')
  setCareSettings(@Param('did') did: string, @Body() dto: CareSettingsDto, @Actor() actor: IntrospectionResult): CareSettings {
    this.officeOf(did, actor);
    return this.care.setSettings(did, dto);
  }

  /** The driver themselves, from their own sign-in. Never staff standing in: a check, a defect, a breakdown are the driver's word. */
  private driverActs(did: string, actor: IntrospectionResult): void {
    this.drivers.get(did); // 404 if unknown
    if (actor?.role === 'operator') throw new GlosError('FORBIDDEN', STAFF_READ_ONLY);
    if (actor?.role === 'driver' && actor.did === did) return;
    throw new GlosError('FORBIDDEN', 'Only the driver checks the vehicle they are about to drive');
  }

  /** What the driver reads: theirs — or staff, who read. */
  private driverReads(did: string, actor: IntrospectionResult): void {
    this.drivers.get(did); // 404 if unknown
    if (actor?.role === 'operator') return;
    this.driverActs(did, actor);
  }

  /** The fleet's own office, changing its own rules. */
  private officeOf(fleetDid: string, actor: IntrospectionResult): void {
    this.managers.get(fleetDid); // 404 if unknown
    if (actor?.role === 'operator') throw new GlosError('FORBIDDEN', STAFF_READ_ONLY);
    if (actor?.role === 'fleet_manager' && actingTenant(actor) === fleetDid) return;
    throw new GlosError('FORBIDDEN', 'This fleet is not yours');
  }

  /** The fleet's own office — or staff, who read. */
  private officeReads(fleetDid: string, actor: IntrospectionResult): void {
    this.managers.get(fleetDid); // 404 if unknown
    if (actor?.role === 'operator') return;
    this.officeOf(fleetDid, actor);
  }

  /** The vehicle's owner, changing its record — and the name what they do is signed with. Staff and anybody else: refused. */
  private ownerOf(vehicleId: string, actor: IntrospectionResult): string {
    const v = this.vehicles.get(vehicleId); // 404 if unknown
    if (actor?.role === 'operator') throw new GlosError('FORBIDDEN', STAFF_READ_ONLY);
    if (actor?.role === 'fleet_manager' && v.managerDid && actingTenant(actor) === v.managerDid) return actor.actorName || this.managers.get(v.managerDid).companyName;
    if (actor?.role === 'driver' && v.ownerDriverDid && actor.did === v.ownerDriverDid) return this.drivers.get(actor.did).displayName;
    throw new GlosError('FORBIDDEN', 'This vehicle is not yours');
  }

  /** The vehicle's owner — or staff, who read. */
  private ownerReads(vehicleId: string, actor: IntrospectionResult): void {
    this.vehicles.get(vehicleId); // 404 if unknown
    if (actor?.role === 'operator') return;
    this.ownerOf(vehicleId, actor);
  }
}
