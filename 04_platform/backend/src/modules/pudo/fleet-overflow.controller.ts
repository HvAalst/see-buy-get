import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Roles } from '../../foundation/auth/scopes.decorator';
import { Actor } from '../../foundation/auth/actor.decorator';
import { IntrospectionResult } from '../../foundation/auth/auth.types';
import { actingTenant, auditActor } from '../../foundation/auth/acting';
import { GlosError } from '../../foundation/http/glos-error';
import { HandBackOrderDto, HandOnOrdersDto, InvitePartnerDto, LinkContractDto, SetPassOnDto } from './carriage-contract.dto';
import { FleetManagerService } from './fleet-manager.service';
import { FleetOverflowService } from './fleet-overflow.service';
import { HandOnBatchResult } from './fleet-overflow.types';
import { FleetPartnerService } from './fleet-partner.service';
import { FleetPartnerLists, FleetPartnershipView, PartnerInviteIssued } from './fleet-partner.types';

/**
 * P4 — A FLEET'S PARTNERS, AND HANDING ORDERS ON TO THEM OR TO THE OPEN BOARD.
 *
 * Every route is a fleet office's, acting for its own fleet. Which SIDE of a partnership or an offer it is on is read
 * from the record, never from the route: a fleet that was not offered an order is told there is no such offer.
 */
@Controller('sbg')
export class FleetOverflowController {
  constructor(
    private readonly partners: FleetPartnerService,
    private readonly overflow: FleetOverflowService,
    private readonly managers: FleetManagerService,
  ) {}

  /* ------------------------------------------------------------ partners -- */

  @Roles('fleet_manager', 'operator')
  @Get('fleet/managers/:did/partners')
  list(@Param('did') did: string, @Actor() actor: IntrospectionResult): FleetPartnerLists {
    this.fleetOf(did, actor);
    return this.partners.lists(did);
  }

  /** Name a fleet to hand overflow to. The answer carries the code to pass on — shown this once. */
  @Roles('fleet_manager', 'operator')
  @Post('fleet/managers/:did/partners')
  invite(@Param('did') did: string, @Body() dto: InvitePartnerDto, @Actor() actor: IntrospectionResult): PartnerInviteIssued {
    const fleet = this.fleetOf(did, actor);
    return this.partners.invite({ fleetDid: did, fleetName: fleet.name }, dto, this.person(actor, fleet.name));
  }

  @Roles('fleet_manager', 'operator')
  @Post('fleet/managers/:did/partners/link')
  link(@Param('did') did: string, @Body() dto: LinkContractDto, @Actor() actor: IntrospectionResult): FleetPartnershipView {
    const fleet = this.fleetOf(did, actor);
    return this.partners.view(this.partners.link({ fleetDid: did, fleetName: fleet.name }, dto.code, this.person(actor, fleet.name)));
  }

  @Roles('fleet_manager', 'operator')
  @Post('fleet/managers/:did/partners/:partnershipId/invite')
  reissue(@Param('did') did: string, @Param('partnershipId') partnershipId: string, @Actor() actor: IntrospectionResult): PartnerInviteIssued {
    this.fleetOf(did, actor);
    return this.partners.reissue(did, partnershipId);
  }

  @Roles('fleet_manager', 'operator')
  @Post('fleet/managers/:did/partners/:partnershipId/end')
  end(@Param('did') did: string, @Param('partnershipId') partnershipId: string, @Actor() actor: IntrospectionResult): FleetPartnershipView {
    const fleet = this.fleetOf(did, actor);
    return this.partners.view(this.overflow.endPartnership(did, partnershipId, this.person(actor, fleet.name)));
  }

  /**
   * May this partner pass your orders on to a fleet of its own. The offering fleet's switch, off until it is turned
   * on. Turned off, an order already passed on stays with whoever carries it; offers still open are taken back.
   */
  @Roles('fleet_manager', 'operator')
  @Post('fleet/managers/:did/partners/:partnershipId/pass-on')
  setPassOn(@Param('did') did: string, @Param('partnershipId') partnershipId: string, @Body() dto: SetPassOnDto, @Actor() actor: IntrospectionResult): FleetPartnershipView {
    const fleet = this.fleetOf(did, actor);
    return this.partners.view(this.overflow.setPassOn({ did, name: fleet.name }, partnershipId, dto.allowed));
  }

  /* ----------------------------------------------------- handing orders on -- */

  /** Offer orders to every partner this fleet has. The first to take one carries it. */
  @Roles('fleet_manager', 'operator')
  @Post('fleet/managers/:did/orders/offer')
  offer(@Param('did') did: string, @Body() dto: HandOnOrdersDto, @Actor() actor: IntrospectionResult): HandOnBatchResult {
    const fleet = this.fleetOf(did, actor);
    return this.overflow.offer({ did, name: fleet.name }, dto.freightIds, this.person(actor, fleet.name));
  }

  /** A partner that took orders offers them on to its own partners — where the fleet they came from allows it. */
  @Roles('fleet_manager', 'operator')
  @Post('fleet/managers/:did/orders/pass-on')
  passOn(@Param('did') did: string, @Body() dto: HandOnOrdersDto, @Actor() actor: IntrospectionResult): HandOnBatchResult {
    const fleet = this.fleetOf(did, actor);
    return this.overflow.passOn({ did, name: fleet.name }, dto.freightIds, this.person(actor, fleet.name));
  }

  @Roles('fleet_manager', 'operator')
  @Post('fleet/managers/:did/orders/:freightId/offer/withdraw')
  withdrawOffer(@Param('did') did: string, @Param('freightId') freightId: string, @Actor() actor: IntrospectionResult): { withdrawn: true } {
    const fleet = this.fleetOf(did, actor);
    this.overflow.withdrawOffer({ did, name: fleet.name }, freightId);
    return { withdrawn: true };
  }

  /** A partner takes an order it was offered. */
  @Roles('fleet_manager', 'operator')
  @Post('fleet/managers/:did/orders/:freightId/offer/take')
  take(@Param('did') did: string, @Param('freightId') freightId: string, @Actor() actor: IntrospectionResult): { taken: true } {
    const fleet = this.fleetOf(did, actor);
    this.overflow.answer({ did, name: fleet.name }, freightId, true, this.person(actor, fleet.name));
    return { taken: true };
  }

  /** A partner leaves an order it was offered. */
  @Roles('fleet_manager', 'operator')
  @Post('fleet/managers/:did/orders/:freightId/offer/leave')
  leave(@Param('did') did: string, @Param('freightId') freightId: string, @Actor() actor: IntrospectionResult): { left: true } {
    const fleet = this.fleetOf(did, actor);
    this.overflow.answer({ did, name: fleet.name }, freightId, false, this.person(actor, fleet.name));
    return { left: true };
  }

  /** A partner gives back an order it had taken, before it is on a truck — with a reason. */
  @Roles('fleet_manager', 'operator')
  @Post('fleet/managers/:did/orders/:freightId/hand-back')
  handBack(@Param('did') did: string, @Param('freightId') freightId: string, @Body() dto: HandBackOrderDto, @Actor() actor: IntrospectionResult): { handedBack: true } {
    const fleet = this.fleetOf(did, actor);
    this.overflow.handBack({ did, name: fleet.name }, freightId, dto.reason);
    return { handedBack: true };
  }

  /** Release orders to the open board: any checked carrier may take them. */
  @Roles('fleet_manager', 'operator')
  @Post('fleet/managers/:did/orders/release')
  release(@Param('did') did: string, @Body() dto: HandOnOrdersDto, @Actor() actor: IntrospectionResult): HandOnBatchResult {
    const fleet = this.fleetOf(did, actor);
    return this.overflow.release({ did, name: fleet.name }, dto.freightIds, this.person(actor, fleet.name));
  }

  /** Take an order back off the open board, while nobody has taken it. */
  @Roles('fleet_manager', 'operator')
  @Post('fleet/managers/:did/orders/:freightId/take-back')
  takeBack(@Param('did') did: string, @Param('freightId') freightId: string, @Actor() actor: IntrospectionResult): { takenBack: true } {
    const fleet = this.fleetOf(did, actor);
    this.overflow.takeBack({ did, name: fleet.name }, freightId);
    return { takenBack: true };
  }

  /* -------------------------------------------------------------- helpers -- */

  /** The fleet's own office, or network staff; and the fleet's trading name. */
  private fleetOf(did: string, actor: IntrospectionResult): { name: string } {
    const fleet = this.managers.get(did); // 404 if unknown
    const office = actor?.role === 'fleet_manager' && actingTenant(actor) === did;
    if (actor?.role !== 'operator' && !office) throw new GlosError('FORBIDDEN', 'This fleet is not yours');
    return { name: fleet.companyName };
  }

  private person(actor: IntrospectionResult, company: string): string {
    return actor?.actorName || (actor?.role === 'operator' ? auditActor(actor) : company);
  }
}
