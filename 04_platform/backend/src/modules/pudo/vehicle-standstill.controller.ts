import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { actingTenant } from '../../foundation/auth/acting';
import { Actor } from '../../foundation/auth/actor.decorator';
import type { IntrospectionResult } from '../../foundation/auth/auth.types';
import { Roles } from '../../foundation/auth/scopes.decorator';
import { GlosError } from '../../foundation/http/glos-error';
import { FleetManagerService } from './fleet-manager.service';
import { VehicleStandstillService } from './vehicle-standstill.service';
import { AnswerStandstillDto, StandstillCaseView, StandstillSettingsDto, StandstillSettingsView, StandstillView } from './vehicle-standstill.types';

const STAFF_READ_ONLY = 'Staff read a fleet’s watch on its vehicles and change none of it: its own office keeps it';

/**
 * A VEHICLE STANDING STILL (round 16). The fleet's own office reads its cases and its setting, sets how long is too long
 * (or turns the watch off), and says how it was when it called the driver. Staff read and change none of it. Nobody else:
 * where a fleet's vehicles are is the fleet's.
 */
@Controller('sbg')
export class VehicleStandstillController {
  constructor(
    private readonly standstill: VehicleStandstillService,
    private readonly managers: FleetManagerService,
  ) {}

  @Roles('fleet_manager', 'operator')
  @Get('fleet/managers/:did/standstill')
  read(@Param('did') did: string, @Actor() actor: IntrospectionResult): StandstillView {
    this.officeReads(did, actor);
    return { settings: this.standstill.settingsOf(did), cases: this.standstill.casesFor(did) };
  }

  @Roles('fleet_manager')
  @Put('fleet/managers/:did/standstill/settings')
  set(@Param('did') did: string, @Body() dto: StandstillSettingsDto, @Actor() actor: IntrospectionResult): StandstillSettingsView {
    const by = this.officeOf(did, actor);
    return this.standstill.setSettings(did, { on: dto.on, afterMin: dto.afterMin }, by);
  }

  @Roles('fleet_manager')
  @Post('fleet/managers/:did/standstill/:caseId/answer')
  answer(@Param('did') did: string, @Param('caseId') caseId: string, @Body() dto: AnswerStandstillDto, @Actor() actor: IntrospectionResult): StandstillCaseView {
    const by = this.officeOf(did, actor);
    return this.standstill.answer(did, caseId, { outcome: dto.outcome, note: dto.note }, by);
  }

  /** The fleet's own office, acting — and the name what it does is signed with. Staff: refused by name. */
  private officeOf(fleetDid: string, actor: IntrospectionResult): string {
    const m = this.managers.get(fleetDid); // 404 if unknown
    if (actor?.role === 'operator') throw new GlosError('FORBIDDEN', STAFF_READ_ONLY);
    if (actor?.role === 'fleet_manager' && actingTenant(actor) === fleetDid) return actor.actorName || m.companyName;
    throw new GlosError('FORBIDDEN', 'This fleet is not yours');
  }

  private officeReads(fleetDid: string, actor: IntrospectionResult): void {
    this.managers.get(fleetDid);
    if (actor?.role === 'operator') return;
    this.officeOf(fleetDid, actor);
  }
}
