import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { Actor } from '../../foundation/auth/actor.decorator';
import { actingTenant } from '../../foundation/auth/acting';
import type { IntrospectionResult } from '../../foundation/auth/auth.types';
import { Roles } from '../../foundation/auth/scopes.decorator';
import { GlosError } from '../../foundation/http/glos-error';
import { FleetManagerService } from './fleet-manager.service';
import { FleetHookMessageView, FleetSystemView } from './fleet-hook.types';
import { FleetHookService, type ActingManager } from './fleet-hooks.service';
import { FleetPositionsDto, FleetSystemDto } from './fleet-system.dto';
import { CompanyKeyService } from './company-key.service';
import { CompanyKeyIssued, CompanyKeyList, CompanyKeyView, IssueCompanyKeyDto } from './company-key.types';

/**
 * A FLEET'S OWN SYSTEM, TOLD OF ITS WORK (round 11). Any manager of the fleet reads it and does every act on it — gives the
 * address, makes a new secret, turns where its vehicles are on or off, sends one again, sends a test — each recorded
 * under their own name, so the other managers see who did it. The fleet's office only: network staff read counts under
 * Fleets, and act in no fleet's name.
 */
@Controller('sbg')
export class FleetSystemController {
  constructor(
    private readonly managers: FleetManagerService,
    private readonly hooks: FleetHookService,
    private readonly keyring: CompanyKeyService,
  ) {}

  @Roles('fleet_manager')
  @Get('fleet/managers/:did/system')
  view(@Param('did') did: string, @Actor() actor: IntrospectionResult): FleetSystemView {
    return this.hooks.view(this.acting(did, actor).fleetDid);
  }

  /** Where its system is told. The first address makes the signing secret, shown in this answer only. Empty stops the messages. */
  @Roles('fleet_manager')
  @Put('fleet/managers/:did/system')
  setAddress(@Param('did') did: string, @Body() dto: FleetSystemDto, @Actor() actor: IntrospectionResult): FleetSystemView {
    return this.hooks.setAddress(this.acting(did, actor), dto.url);
  }

  /** A new signing secret, shown in this answer only. */
  @Roles('fleet_manager')
  @Post('fleet/managers/:did/system/secret')
  turnSecret(@Param('did') did: string, @Actor() actor: IntrospectionResult): FleetSystemView {
    return this.hooks.turnSecret(this.acting(did, actor));
  }

  /** Where its vehicles are, sent to its system: 0 for off, or at most every 1, 5 or 15 minutes a vehicle. The fleet's choice. */
  @Roles('fleet_manager')
  @Put('fleet/managers/:did/system/positions')
  setPositions(@Param('did') did: string, @Body() dto: FleetPositionsDto, @Actor() actor: IntrospectionResult): FleetSystemView {
    return this.hooks.setPositions(this.acting(did, actor), dto.everyMin);
  }

  @Roles('fleet_manager')
  @Post('fleet/managers/:did/system/test')
  test(@Param('did') did: string, @Actor() actor: IntrospectionResult): Promise<FleetHookMessageView> {
    return this.hooks.test(this.acting(did, actor));
  }

  @Roles('fleet_manager')
  @Post('fleet/managers/:did/system/messages/:messageId/resend')
  resend(@Param('did') did: string, @Param('messageId') messageId: string, @Actor() actor: IntrospectionResult): Promise<FleetHookMessageView> {
    return this.hooks.resend(this.acting(did, actor), messageId);
  }

  /* -- round 12: its keys, for its own system to send orders in, read its plan and take loads (company-api.controller.ts) -- */

  @Roles('fleet_manager')
  @Get('fleet/managers/:did/keys')
  keys(@Param('did') did: string, @Actor() actor: IntrospectionResult): CompanyKeyList {
    return { items: this.keyring.list({ kind: 'fleet', id: this.acting(did, actor).fleetDid }) };
  }

  /** A new key — any manager's act, under their name. The key itself is in this answer only. */
  @Roles('fleet_manager')
  @Post('fleet/managers/:did/keys')
  issueKey(@Param('did') did: string, @Body() dto: IssueCompanyKeyDto, @Actor() actor: IntrospectionResult): CompanyKeyIssued {
    const acting = this.acting(did, actor);
    return this.keyring.issue({ kind: 'fleet', id: acting.fleetDid }, dto.mode, dto.label, acting.name);
  }

  /** Take a key away, now — any manager's act, under their name. */
  @Roles('fleet_manager')
  @Post('fleet/managers/:did/keys/:keyId/revoke')
  revokeKey(@Param('did') did: string, @Param('keyId') keyId: string, @Actor() actor: IntrospectionResult): CompanyKeyView {
    const acting = this.acting(did, actor);
    return this.keyring.revoke({ kind: 'fleet', id: acting.fleetDid }, keyId, acting.name);
  }

  /** The fleet's own office, and the manager acting: their name where they gave one, the company's where the sign-in carries none. */
  private acting(did: string, actor: IntrospectionResult): ActingManager {
    if (actor?.role === 'operator') throw new GlosError('FORBIDDEN', 'Network staff read a fleet’s system under Fleets; they change nothing in it');
    const fleet = this.managers.get(did); // 404 if unknown
    if (actor?.role !== 'fleet_manager' || actingTenant(actor) !== did) throw new GlosError('FORBIDDEN', 'This fleet is not yours');
    return { fleetDid: did, name: actor.actorName?.trim() || fleet.companyName };
  }
}
