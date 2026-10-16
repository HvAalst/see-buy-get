import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Roles } from '../../foundation/auth/scopes.decorator';
import { Actor } from '../../foundation/auth/actor.decorator';
import { IntrospectionResult } from '../../foundation/auth/auth.types';
import { actingTenant, auditActor } from '../../foundation/auth/acting';
import { GlosError } from '../../foundation/http/glos-error';
import { DriverService } from './driver.service';
import { FleetManagerService } from './fleet-manager.service';
import { FleetRosterService } from './fleet-roster.service';
import { RosterDayQueryDto, SetRosterDto } from './fleet-roster.dto';
import { DriverRosterView, RosterView } from './fleet-roster.types';

/**
 * WHO DRIVES ON WHICH DAY (see RosterDay). The office reads and sets a day; a driver reads their own coming days.
 * Network staff may do either, as they may with the day's plan the roster feeds.
 */
@Controller('sbg')
export class FleetRosterController {
  constructor(
    private readonly roster: FleetRosterService,
    private readonly managers: FleetManagerService,
    private readonly drivers: DriverService,
  ) {}

  @Roles('fleet_manager', 'operator')
  @Get('fleet/managers/:did/roster')
  dayRoster(@Param('did') did: string, @Query() q: RosterDayQueryDto, @Actor() actor: IntrospectionResult): RosterView {
    this.assertFleet(did, actor);
    return this.roster.view(did, q.day);
  }

  @Roles('fleet_manager', 'operator')
  @Post('fleet/managers/:did/roster')
  setDayRoster(@Param('did') did: string, @Body() dto: SetRosterDto, @Actor() actor: IntrospectionResult): RosterView {
    const fleet = this.assertFleet(did, actor);
    const by = actor?.actorName || (actor?.role === 'operator' ? auditActor(actor) : fleet.companyName);
    return this.roster.set(did, dto.day, dto.driverDids, by, Date.now(), dto.starts ?? []);
  }

  /** A driver's own coming days. Theirs, their fleet office's and the network's to read — as their hours are. */
  @Roles('driver', 'fleet_manager', 'operator')
  @Get('fleet/drivers/:did/roster')
  driverRoster(@Param('did') did: string, @Actor() actor: IntrospectionResult): DriverRosterView {
    const driver = this.drivers.get(did); // 404 if unknown
    const office = actor?.role === 'fleet_manager' && Boolean(driver.managerDid) && actingTenant(actor) === driver.managerDid;
    if (actor?.role !== 'operator' && actor?.did !== did && !office) throw new GlosError('FORBIDDEN', 'A driver’s days are theirs, their fleet office’s and the network’s to read');
    return this.roster.forDriver(did);
  }

  private assertFleet(did: string, actor: IntrospectionResult) {
    const fleet = this.managers.get(did); // 404 if unknown
    const office = actor?.role === 'fleet_manager' && actingTenant(actor) === did;
    if (actor?.role !== 'operator' && !office) throw new GlosError('FORBIDDEN', 'This fleet is not yours');
    return fleet;
  }
}
