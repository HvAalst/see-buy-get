import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Roles } from '../../foundation/auth/scopes.decorator';
import { Actor } from '../../foundation/auth/actor.decorator';
import { IntrospectionResult } from '../../foundation/auth/auth.types';
import { actingTenant } from '../../foundation/auth/acting';
import { GlosError } from '../../foundation/http/glos-error';
import { FleetManagerService } from './fleet-manager.service';
import { FleetSiteService } from './fleet-site.service';
import { SiteDto, SiteHomeDto } from './fleet-site.dto';
import { FleetSitesView } from './fleet-site.types';

/**
 * A FLEET'S SITES, over the wire (see fleet-site.types.ts). The fleet's own record: its office reads and changes it;
 * staff read it and change none of it, as with a fleet's upkeep.
 */
@Controller('sbg')
export class FleetSiteController {
  constructor(
    private readonly sites: FleetSiteService,
    private readonly managers: FleetManagerService,
  ) {}

  @Roles('fleet_manager', 'operator')
  @Get('fleet/managers/:did/sites')
  list(@Param('did') did: string, @Actor() actor: IntrospectionResult): FleetSitesView {
    this.reads(did, actor);
    return this.sites.view(did);
  }

  @Roles('fleet_manager')
  @Post('fleet/managers/:did/sites')
  add(@Param('did') did: string, @Body() dto: SiteDto, @Actor() actor: IntrospectionResult): FleetSitesView {
    return this.sites.add(did, dto, this.office(did, actor));
  }

  @Roles('fleet_manager')
  @Post('fleet/managers/:did/sites/:siteId')
  update(@Param('did') did: string, @Param('siteId') siteId: string, @Body() dto: SiteDto, @Actor() actor: IntrospectionResult): FleetSitesView {
    return this.sites.update(did, siteId, dto, this.office(did, actor));
  }

  @Roles('fleet_manager')
  @Post('fleet/managers/:did/sites/:siteId/close')
  close(@Param('did') did: string, @Param('siteId') siteId: string, @Actor() actor: IntrospectionResult): FleetSitesView {
    return this.sites.close(did, siteId, this.office(did, actor));
  }

  /** Where a vehicle or a driver works from. */
  @Roles('fleet_manager')
  @Post('fleet/managers/:did/site-homes')
  setHome(@Param('did') did: string, @Body() dto: SiteHomeDto, @Actor() actor: IntrospectionResult): FleetSitesView {
    return this.sites.setHome(did, dto.kind, dto.id, dto.siteId, this.office(did, actor));
  }

  private reads(did: string, actor: IntrospectionResult): void {
    this.managers.get(did); // 404 if unknown
    if (actor?.role === 'operator') return;
    this.office(did, actor);
  }

  /** The fleet's own office — and the name what it does is signed with. Staff and anybody else: refused. */
  private office(did: string, actor: IntrospectionResult): string {
    const fleet = this.managers.get(did); // 404 if unknown
    if (actor?.role === 'operator') throw new GlosError('FORBIDDEN', 'Staff read a fleet’s sites and change none of them: its own office keeps the record');
    if (actor?.role === 'fleet_manager' && actingTenant(actor) === did) return actor.actorName || fleet.companyName;
    throw new GlosError('FORBIDDEN', 'This fleet is not yours');
  }
}
