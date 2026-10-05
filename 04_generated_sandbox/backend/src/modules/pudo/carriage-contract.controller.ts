import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Roles } from '../../foundation/auth/scopes.decorator';
import { Actor } from '../../foundation/auth/actor.decorator';
import { IntrospectionResult } from '../../foundation/auth/auth.types';
import { actingTenant, auditActor } from '../../foundation/auth/acting';
import { GlosError } from '../../foundation/http/glos-error';
import { BusinessMemberGuard } from './business-member.guard';
import { BusinessService } from './business.service';
import { CarriageContractService } from './carriage-contract.service';
import { CarriageContractList, CarriageContractView, ContractInviteIssued } from './carriage-contract.types';
import { CreateContractDto, EndContractDto, FleetOrdersQueryDto, LinkContractDto } from './carriage-contract.dto';
import { DispatchService } from './dispatch.service';
import { FleetOrderList } from './dispatch.types';
import { FleetManagerService } from './fleet-manager.service';

/**
 * P1 — STANDING CONTRACTS, AND THE ORDERS THAT ARRIVE UNDER THEM.
 *
 * Two sides, and the routes say which. The FLEET records a contract, sends the shipper's business a code to link it,
 * and reads the orders it must carry. The shipper's BUSINESS links the contract and from then on orders under it (on
 * the ordinary load route, naming the contract). Either may end it; ending stops new orders, never the delivery of
 * ones already placed.
 */
@Controller('sbg')
@UseGuards(BusinessMemberGuard)
export class CarriageContractController {
  constructor(
    private readonly contracts: CarriageContractService,
    private readonly managers: FleetManagerService,
    private readonly dispatch: DispatchService,
    private readonly businesses: BusinessService,
  ) {}

  /* ------------------------------------------------------------- the fleet -- */

  @Roles('fleet_manager', 'operator')
  @Get('fleet/managers/:did/contracts')
  fleetList(@Param('did') did: string, @Actor() actor: IntrospectionResult): CarriageContractList {
    this.assertFleet(did, actor);
    return { items: this.contracts.forFleet(did).map((c) => this.contracts.view(c)) };
  }

  @Roles('fleet_manager', 'operator')
  @Post('fleet/managers/:did/contracts')
  create(@Param('did') did: string, @Body() dto: CreateContractDto, @Actor() actor: IntrospectionResult): CarriageContractView {
    const fleet = this.assertFleet(did, actor);
    return this.contracts.view(this.contracts.create({ did, name: fleet.companyName }, dto, this.fleetPerson(actor, fleet.companyName)));
  }

  /** A code for the shipper's business to link the contract with. Shown once; a new one replaces the last. */
  @Roles('fleet_manager', 'operator')
  @Post('fleet/managers/:did/contracts/:contractId/invite')
  invite(@Param('did') did: string, @Param('contractId') contractId: string, @Actor() actor: IntrospectionResult): ContractInviteIssued {
    this.assertFleet(did, actor);
    return this.contracts.issueInvite(did, contractId);
  }

  @Roles('fleet_manager', 'operator')
  @Post('fleet/managers/:did/contracts/:contractId/end')
  fleetEnd(@Param('did') did: string, @Param('contractId') contractId: string, @Body() dto: EndContractDto, @Actor() actor: IntrospectionResult): CarriageContractView {
    const fleet = this.assertFleet(did, actor);
    return this.contracts.view(this.contracts.end(this.contracts.requireForFleet(did, contractId), 'fleet', this.fleetPerson(actor, fleet.companyName), dto.reason));
  }

  /** The orders this fleet must carry, by the day they must arrive. */
  @Roles('fleet_manager', 'operator')
  @Get('fleet/managers/:did/orders')
  orders(@Param('did') did: string, @Query() q: FleetOrdersQueryDto, @Actor() actor: IntrospectionResult): FleetOrderList {
    this.assertFleet(did, actor);
    const items = this.dispatch.ordersForFleet(did, q);
    return { items, total: items.length };
  }

  /* ----------------------------------------------------------- the shipper -- */

  @Roles('business')
  @Get('business/me/contracts')
  shipperList(@Actor() actor: IntrospectionResult): CarriageContractList {
    const acting = this.businesses.requireMember(actor);
    return { items: this.contracts.forShipper(acting.entity.entityId).map((c) => this.contracts.view(c)) };
  }

  /** Link a contract with the fleet's code. An owner's act: it commits the business to the fleet as its carrier. */
  @Roles('business')
  @Post('business/me/contracts/link')
  link(@Body() dto: LinkContractDto, @Actor() actor: IntrospectionResult): CarriageContractView {
    const acting = this.businesses.requireMember(actor);
    if (acting.member.role !== 'owner') throw new GlosError('FORBIDDEN', 'Only an owner of the business links a contract');
    return this.contracts.view(this.contracts.link({ entityId: acting.entity.entityId, name: acting.entity.name }, dto.code, acting.member.name));
  }

  @Roles('business')
  @Post('business/me/contracts/:contractId/end')
  shipperEnd(@Param('contractId') contractId: string, @Body() dto: EndContractDto, @Actor() actor: IntrospectionResult): CarriageContractView {
    const acting = this.businesses.requireMember(actor);
    if (acting.member.role !== 'owner') throw new GlosError('FORBIDDEN', 'Only an owner of the business ends a contract');
    return this.contracts.view(this.contracts.end(this.contracts.requireForShipper(acting.entity.entityId, contractId), 'shipper', acting.member.name, dto.reason));
  }

  /* -------------------------------------------------------------- helpers -- */

  /** The fleet's own office, or network staff. Anybody else is told this fleet is not theirs. */
  private assertFleet(did: string, actor: IntrospectionResult) {
    const fleet = this.managers.get(did); // 404 if unknown
    const office = actor?.role === 'fleet_manager' && actingTenant(actor) === did;
    if (actor?.role !== 'operator' && !office) throw new GlosError('FORBIDDEN', 'This fleet is not yours');
    return fleet;
  }

  /** The person at the office's keyboard, by name where the token has one. */
  private fleetPerson(actor: IntrospectionResult, company: string): string {
    return actor?.actorName || (actor?.role === 'operator' ? auditActor(actor) : company);
  }
}
