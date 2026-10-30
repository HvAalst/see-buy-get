import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Roles } from '../../foundation/auth/scopes.decorator';
import { Actor } from '../../foundation/auth/actor.decorator';
import { IntrospectionResult } from '../../foundation/auth/auth.types';
import { Public } from '../../foundation/auth/public.decorator';
import { actingTenant, auditActor } from '../../foundation/auth/acting';
import { GlosError } from '../../foundation/http/glos-error';
import { BusinessService } from './business.service';
import { DirectoryService } from './directory.service';
import { FleetManagerService } from './fleet-manager.service';
import { ContractAskView, DirectoryChoiceView, DirectoryChooseQueryDto, DirectoryCountryView, DirectoryIndex, DirectoryListingDto, DirectoryListingView, FleetDirectoryDto } from './directory.types';

/**
 * THE DIRECTORY (the user, 2026-10-30): read by anybody, without an account — a directory nobody can read is no
 * directory — and written only by the firm itself, about itself: whether it is shown, and its own line. Staff write
 * nothing in a firm's name here.
 */
@Controller('sbg')
export class DirectoryController {
  constructor(
    private readonly directory: DirectoryService,
    private readonly businesses: BusinessService,
    private readonly managers: FleetManagerService,
  ) {}

  /** The countries with firms listed, and how many of each kind — the map and the list of countries. */
  @Public()
  @Get('directory')
  index(): DirectoryIndex {
    return this.directory.index();
  }

  /**
   * The firms to choose from inside the apps — appointing a clearing agent, finding a haulier — every country, each with
   * its id. Signed in: a business (never offered itself) or our staff.
   */
  @Roles('business', 'operator')
  @Get('directory/choose')
  choose(@Query() q: DirectoryChooseQueryDto, @Actor() actor: IntrospectionResult): DirectoryChoiceView {
    const own = actor?.role === 'business' ? this.businesses.requireMember(actor).entity.entityId : undefined;
    return this.directory.choose(q.kind, own);
  }

  /** A business asks a haulier it found for a carriage contract — the haulier's bell says so. An owner's to ask. */
  @Roles('business')
  @Post('business/me/directory/ask/:fleetDid')
  ask(@Param('fleetDid') fleetDid: string, @Actor() actor: IntrospectionResult): Promise<ContractAskView> {
    const acting = this.businesses.requireMember(actor);
    if (acting.member.role !== 'owner') throw new GlosError('FORBIDDEN', 'Only an owner asks a carrier for a contract');
    return this.directory.askContract(acting.entity.entityId, fleetDid, acting.member.name ?? auditActor(actor));
  }

  /** One country's firms, alphabetical. */
  @Public()
  @Get('directory/:country')
  country(@Param('country') country: string): DirectoryCountryView {
    return this.directory.country(country);
  }

  /** A business's own place in the directory. */
  @Roles('business')
  @Get('business/me/directory')
  mine(@Actor() actor: IntrospectionResult): DirectoryListingView {
    return this.directory.companyListing(this.businesses.requireMember(actor).entity.entityId);
  }

  /** Shown or taken off, and its own line — an owner's to say. */
  @Roles('business')
  @Post('business/me/directory')
  setMine(@Body() dto: DirectoryListingDto, @Actor() actor: IntrospectionResult): DirectoryListingView {
    const acting = this.businesses.requireMember(actor);
    if (acting.member.role !== 'owner') throw new GlosError('FORBIDDEN', 'Only an owner says whether the business is in the directory');
    return this.directory.setCompanyListing(acting.entity.entityId, dto, acting.member.name ?? auditActor(actor));
  }

  /** A fleet's own place in the directory. */
  @Roles('fleet_manager', 'operator')
  @Get('fleet/managers/:did/directory')
  fleet(@Param('did') did: string, @Actor() actor: IntrospectionResult): DirectoryListingView {
    this.assertFleet(did, actor, false);
    return this.directory.fleetListing(did);
  }

  /** Shown or taken off, its line, and the contact it ticks to show — the fleet office's to say, never staff's. */
  @Roles('fleet_manager')
  @Post('fleet/managers/:did/directory')
  setFleet(@Param('did') did: string, @Body() dto: FleetDirectoryDto, @Actor() actor: IntrospectionResult): DirectoryListingView {
    const fleet = this.assertFleet(did, actor, true);
    return this.directory.setFleetListing(did, dto, actor?.actorName || fleet.companyName);
  }

  private assertFleet(did: string, actor: IntrospectionResult, write: boolean) {
    const fleet = this.managers.get(did);
    const office = actor?.role === 'fleet_manager' && actingTenant(actor) === did;
    if (!office && (write || actor?.role !== 'operator')) throw new GlosError('FORBIDDEN', 'This fleet is not yours');
    return fleet;
  }
}
