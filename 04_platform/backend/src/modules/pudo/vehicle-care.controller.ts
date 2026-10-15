import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Roles } from '../../foundation/auth/scopes.decorator';
import { Actor } from '../../foundation/auth/actor.decorator';
import { IntrospectionResult } from '../../foundation/auth/auth.types';
import { actingTenant, auditActor } from '../../foundation/auth/acting';
import { GlosError } from '../../foundation/http/glos-error';
import { DriverService } from './driver.service';
import { FleetManagerService } from './fleet-manager.service';
import { VehicleService } from './vehicle.service';
import { VehicleCareService } from './vehicle-care.service';
import { RecordReadingDto, TakeOffRoadDto } from './vehicle-care.dto';
import { VehicleCareView } from './vehicle-care.types';

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

  /** The vehicle's owner, or staff — and the name what they do is signed with. Anybody else: refused. */
  private ownerOf(vehicleId: string, actor: IntrospectionResult): string {
    const v = this.vehicles.get(vehicleId); // 404 if unknown
    if (actor?.role === 'operator') return auditActor(actor);
    if (actor?.role === 'fleet_manager' && v.managerDid && actingTenant(actor) === v.managerDid) return actor.actorName || this.managers.get(v.managerDid).companyName;
    if (actor?.role === 'driver' && v.ownerDriverDid && actor.did === v.ownerDriverDid) return this.drivers.get(actor.did).displayName;
    throw new GlosError('FORBIDDEN', 'This vehicle is not yours');
  }
}
