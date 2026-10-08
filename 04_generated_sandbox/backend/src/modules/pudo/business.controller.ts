import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { BusinessClientService } from './business-client.service';
import { BusinessClient } from './business-client.types';
import { Roles } from '../../foundation/auth/scopes.decorator';
import { Actor } from '../../foundation/auth/actor.decorator';
import { staffOf } from './staff-of';
import { IntrospectionResult } from '../../foundation/auth/auth.types';
import { auditActor } from '../../foundation/auth/acting';
import { GlosError } from '../../foundation/http/glos-error';
import { isSandbox } from '../../foundation/runtime/sandbox';
import { BusinessService } from './business.service';
import { AnyMember, BusinessMemberGuard } from './business-member.guard';
import { ApproveBusinessDto, ArchiveClientDto, BusinessClientDto, UpdateBusinessClientDto, CreateBusinessDto, InviteMemberDto, MemberRoleDto, RefuseBusinessDto, UpdateBusinessDto } from './business.dto';
import { BusinessMemberView, BusinessMembershipList, BusinessMembershipView, BusinessSession, BusinessStaffList, BusinessStaffRow, BusinessView } from './business.types';

/**
 * B1 — A CUSTOMER'S BUSINESS: setting one up, the people in it, and SeeBuyGet checking who it is.
 *
 * Three kinds of caller, and the routes say which:
 *  - a PERSON, signed in with their own phone and PIN (`consumer`): sets a business up, sees the ones they are in and
 *    invited to, accepts or declines, and opens a session for one;
 *  - somebody ACTING FOR A BUSINESS (`business`): reads it, its people, and — as an owner — changes them;
 *  - NETWORK STAFF (`operator`): the check, which takes two of them.
 *
 * The work itself (imports, papers, places, yards) is on the routes it always was, which now also answer a business.
 */
@Controller('sbg')
@UseGuards(BusinessMemberGuard)
export class BusinessController {
  constructor(
    private readonly businesses: BusinessService,
    private readonly clients: BusinessClientService,
  ) {}

  /* --------------------------------------------------- a person, as themselves -- */

  /** Set up a business. The person becomes its owner, and gets a session for it straight away. */
  @Roles('consumer')
  @Post('business')
  create(@Body() dto: CreateBusinessDto, @Actor() actor: IntrospectionResult): BusinessSession {
    const personDid = personOf(actor);
    const { entity } = this.businesses.create(personDid, dto);
    return this.businesses.session(personDid, entity.entityId);
  }

  /** The businesses this person is in, and the ones they are invited to. */
  @Roles('consumer')
  @Get('business/mine')
  mine(@Actor() actor: IntrospectionResult): BusinessMembershipList {
    return { items: this.businesses.mine(personOf(actor)) };
  }

  @Roles('consumer')
  @Post('business/invitations/:memberId/accept')
  accept(@Param('memberId') memberId: string, @Actor() actor: IntrospectionResult): BusinessMembershipView {
    return this.businesses.accept(personOf(actor), memberId);
  }

  @Roles('consumer')
  @Post('business/invitations/:memberId/decline')
  decline(@Param('memberId') memberId: string, @Actor() actor: IntrospectionResult): { declined: true } {
    return this.businesses.decline(personOf(actor), memberId);
  }

  /** Open one business: a session that acts as it, for a person who is in it. */
  @Roles('consumer')
  @Post('business/:entityId/session')
  session(@Param('entityId') entityId: string, @Actor() actor: IntrospectionResult): BusinessSession {
    return this.businesses.session(personOf(actor), entityId);
  }

  /* --------------------------------------------------------- acting for one -- */

  @Roles('business')
  @Get('business/me')
  me(@Actor() actor: IntrospectionResult): BusinessView {
    const acting = this.businesses.requireMember(actor);
    return this.businesses.view(acting.entity.entityId, acting.member.personDid!);
  }

  @Roles('business')
  @Patch('business/me')
  update(@Body() dto: UpdateBusinessDto, @Actor() actor: IntrospectionResult): BusinessView {
    const acting = this.businesses.requireMember(actor);
    this.businesses.update(acting, dto);
    return this.businesses.view(acting.entity.entityId, acting.member.personDid!);
  }

  @Roles('business')
  @Get('business/me/members')
  members(@Actor() actor: IntrospectionResult): { items: BusinessMemberView[] } {
    return { items: this.businesses.list(this.businesses.requireMember(actor)) };
  }

  @Roles('business')
  @Post('business/me/members')
  invite(@Body() dto: InviteMemberDto, @Actor() actor: IntrospectionResult): BusinessMemberView {
    return this.businesses.invite(this.businesses.requireMember(actor), dto);
  }

  @Roles('business')
  @Post('business/me/members/:memberId/role')
  setRole(@Param('memberId') memberId: string, @Body() dto: MemberRoleDto, @Actor() actor: IntrospectionResult): BusinessMemberView {
    return this.businesses.setRole(this.businesses.requireMember(actor), memberId, dto.role);
  }

  /** Take somebody out — or, on your own row, leave. A viewer may leave too: that is not changing the business. */
  @Roles('business')
  @AnyMember()
  @Delete('business/me/members/:memberId')
  remove(@Param('memberId') memberId: string, @Actor() actor: IntrospectionResult): BusinessMemberView {
    return this.businesses.remove(this.businesses.requireMember(actor), memberId);
  }

  /** Ask SeeBuyGet to check the business, once its papers are on record. */
  @Roles('business')
  @Post('business/me/check')
  askForCheck(@Actor() actor: IntrospectionResult): BusinessView {
    const acting = this.businesses.requireMember(actor);
    this.businesses.askForCheck(acting);
    return this.businesses.view(acting.entity.entityId, acting.member.personDid!);
  }

  /* ------------------------------------------------- B4: an expeditor's clients -- */

  /** The business's own book of clients — the ones it sends for, as their agent. Any member reads it. */
  @Roles('business')
  @Get('business/me/clients')
  listClients(@Actor() actor: IntrospectionResult, @Query('archived') archived?: string): { items: BusinessClient[] } {
    const acting = this.businesses.requireMember(actor);
    return { items: this.clients.list(acting.entity.entityId, { archived: archived === 'true' }) };
  }

  @Roles('business')
  @Post('business/me/clients')
  addClient(@Body() dto: BusinessClientDto, @Actor() actor: IntrospectionResult): BusinessClient {
    const acting = this.businesses.requireMember(actor);
    return this.clients.add(acting.entity.entityId, dto, acting.member.name);
  }

  @Roles('business')
  @Patch('business/me/clients/:clientId')
  updateClient(@Param('clientId') clientId: string, @Body() dto: UpdateBusinessClientDto, @Actor() actor: IntrospectionResult): BusinessClient {
    return this.clients.update(this.businesses.requireMember(actor).entity.entityId, clientId, dto);
  }

  /** Archive, or bring back. Never deleted: what was sent for them keeps naming them. */
  @Roles('business')
  @Post('business/me/clients/:clientId/archive')
  archiveClient(@Param('clientId') clientId: string, @Body() dto: ArchiveClientDto, @Actor() actor: IntrospectionResult): BusinessClient {
    const acting = this.businesses.requireMember(actor);
    return this.clients.setArchived(acting.entity.entityId, clientId, dto.archived, acting.member.name);
  }

  /* --------------------------------------------------------------- staff -- */

  @Roles('operator')
  @Get('businesses')
  staffList(): BusinessStaffList {
    return { items: this.businesses.staffList() };
  }

  @Roles('operator')
  @Get('businesses/:entityId')
  staffRow(@Param('entityId') entityId: string): BusinessStaffRow {
    return this.businesses.staffRow(entityId);
  }

  /** Approve — the first of two, or the second. Never twice by the same member of staff. */
  @Roles('operator')
  @Post('businesses/:entityId/approve')
  approve(@Param('entityId') entityId: string, @Body() dto: ApproveBusinessDto, @Actor() actor: IntrospectionResult): BusinessStaffRow {
    this.businesses.approve(entityId, staffOf(actor, dto.by));
    return this.businesses.staffRow(entityId);
  }

  @Roles('operator')
  @Post('businesses/:entityId/refuse')
  refuse(@Param('entityId') entityId: string, @Body() dto: RefuseBusinessDto, @Actor() actor: IntrospectionResult): BusinessStaffRow {
    this.businesses.refuse(entityId, staffOf(actor, dto.by), dto.reason);
    return this.businesses.staffRow(entityId);
  }
}

/** The person behind a sign-in. A consumer token's DID is the person. */
function personOf(actor: IntrospectionResult): string {
  const did = actor?.personDid ?? actor?.did;
  if (!did) throw new GlosError('FORBIDDEN', 'Sign in first');
  return did;
}

