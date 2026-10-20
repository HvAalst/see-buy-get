import { Body, Controller, Delete, Get, Optional, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { BusinessHookService } from './business-hooks.service';
import { BusinessClientService } from './business-client.service';
import { BusinessClient } from './business-client.types';
import { ShipperCodesService, clientCoder } from './shipper-codes.service';
import { Roles } from '../../foundation/auth/scopes.decorator';
import { Actor } from '../../foundation/auth/actor.decorator';
import { staffOf } from './staff-of';
import { IntrospectionResult } from '../../foundation/auth/auth.types';
import { GlosError } from '../../foundation/http/glos-error';
import { BusinessService } from './business.service';
import { AnyMember, BusinessMemberGuard } from './business-member.guard';
import { ApproveBusinessDto, ArchiveClientDto, BusinessClientDto, BusinessGs1Dto, UpdateBusinessClientDto, CreateBusinessDto, InviteMemberDto, MemberRoleDto, RefuseBusinessDto, UpdateBusinessDto } from './business.dto';
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
    @Optional() private readonly hooks?: BusinessHookService,
    @Optional() private readonly codes?: ShipperCodesService,
  ) {}

  /** Round 20 — a client as the forwarder reads it: with the GS1 prefix entered for it, and how many codes are left. */
  private withGs1(c: BusinessClient): BusinessClient {
    const g = this.codes?.of(clientCoder(c.entityId, c.clientId));
    return g ? { ...c, gs1: { companyPrefix: g.companyPrefix, extensionDigit: g.extensionDigit, left: this.codes!.left(clientCoder(c.entityId, c.clientId)) ?? 0, setAt: g.setAt, setBy: g.setBy } } : c;
  }

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

  /**
   * The business's GS1 company prefix: from then on, each package of a load it posts gets an SSCC under it, printed
   * beside our own code. Owner only; a business sign-in only, so staff never change it.
   */
  @Roles('business')
  @Post('business/me/gs1')
  setGs1(@Body() dto: BusinessGs1Dto, @Actor() actor: IntrospectionResult): BusinessView {
    const acting = this.businesses.requireMember(actor);
    this.businesses.setGs1(acting, { companyPrefix: dto.companyPrefix, extensionDigit: dto.extensionDigit });
    return this.businesses.view(acting.entity.entityId, acting.member.personDid!);
  }

  /** Stop giving packages GS1 codes. The codes loads already have stay with them. */
  @Roles('business')
  @Delete('business/me/gs1')
  clearGs1(@Actor() actor: IntrospectionResult): BusinessView {
    const acting = this.businesses.requireMember(actor);
    this.businesses.setGs1(acting, null);
    return this.businesses.view(acting.entity.entityId, acting.member.personDid!);
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
    return { items: this.clients.list(acting.entity.entityId, { archived: archived === 'true' }).map((c) => this.withGs1(c)) };
  }

  @Roles('business')
  @Post('business/me/clients')
  addClient(@Body() dto: BusinessClientDto, @Actor() actor: IntrospectionResult): BusinessClient {
    const acting = this.businesses.requireMember(actor);
    return this.withGs1(this.clients.add(acting.entity.entityId, dto, acting.member.name));
  }

  @Roles('business')
  @Patch('business/me/clients/:clientId')
  updateClient(@Param('clientId') clientId: string, @Body() dto: UpdateBusinessClientDto, @Actor() actor: IntrospectionResult): BusinessClient {
    return this.withGs1(this.clients.update(this.businesses.requireMember(actor).entity.entityId, clientId, dto));
  }

  /** Archive, or bring back. Never deleted: what was sent for them keeps naming them. */
  @Roles('business')
  @Post('business/me/clients/:clientId/archive')
  archiveClient(@Param('clientId') clientId: string, @Body() dto: ArchiveClientDto, @Actor() actor: IntrospectionResult): BusinessClient {
    const acting = this.businesses.requireMember(actor);
    return this.withGs1(this.clients.setArchived(acting.entity.entityId, clientId, dto.archived, acting.member.name));
  }

  /**
   * Round 20 — the client's own GS1 prefix and the extension digit it set aside for this forwarder: its loads' packages are
   * coded under it. An owner sets it, as for the business's own; the same refusals hold. Staff: refused by name.
   */
  @Roles('business')
  @Post('business/me/clients/:clientId/gs1')
  setClientGs1(@Param('clientId') clientId: string, @Body() dto: BusinessGs1Dto, @Actor() actor: IntrospectionResult): BusinessClient {
    return this.clientGs1(clientId, actor, { companyPrefix: dto.companyPrefix, extensionDigit: dto.extensionDigit });
  }

  /** Stop coding the client's packages. The codes its loads already have stay with them. */
  @Roles('business')
  @Delete('business/me/clients/:clientId/gs1')
  clearClientGs1(@Param('clientId') clientId: string, @Actor() actor: IntrospectionResult): BusinessClient {
    return this.clientGs1(clientId, actor, null);
  }

  private clientGs1(clientId: string, actor: IntrospectionResult, input: { companyPrefix: string; extensionDigit: number } | null): BusinessClient {
    if (actor?.role === 'operator') throw new GlosError('FORBIDDEN', 'Staff read a client’s GS1 prefix and change none of it: the business that keeps the client sets it');
    const acting = this.businesses.requireMember(actor);
    this.businesses.requireOwner(acting);
    const c = this.clients.require(acting.entity.entityId, clientId);
    if (!this.codes) throw new GlosError('INVALID_STATE', 'GS1 codes are not available here');
    this.codes.set(clientCoder(c.entityId, c.clientId), input, acting.member.name);
    return this.withGs1(c);
  }

  /* --------------------------------------------------------------- staff -- */

  @Roles('operator')
  @Get('businesses')
  staffList(): BusinessStaffList {
    // With how the messages to each one's own system stand — counts only (round 10).
    return { items: this.businesses.staffList().map((row) => (this.hooks ? { ...row, system: this.hooks.counts(row.entityId) } : row)) };
  }

  @Roles('operator')
  @Get('businesses/:entityId')
  staffRow(@Param('entityId') entityId: string): BusinessStaffRow {
    const row = this.businesses.staffRow(entityId);
    // How the messages to its own system stand — counts only (round 10).
    return this.hooks ? { ...row, system: this.hooks.counts(entityId) } : row;
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

