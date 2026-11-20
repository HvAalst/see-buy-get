import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { auditActor } from '../../foundation/auth/acting';
import { Actor } from '../../foundation/auth/actor.decorator';
import type { IntrospectionResult } from '../../foundation/auth/auth.types';
import { Roles } from '../../foundation/auth/scopes.decorator';
import { GlosError } from '../../foundation/http/glos-error';
import { AgentService } from './agent.service';
import { DriverService } from './driver.service';
import { FleetManagerService } from './fleet-manager.service';
import { MdpService } from './mdp.service';
import { PartnerLedgerService, type PartnerPayeeKind } from './partner-ledger.service';
import { InvitePartnerMemberDto, PartnerMeView, PartnerMemberService, PartnerMemberView, PartnerMembershipList, PartnerMembershipView, PartnerOwedForPartner, PartnerSession } from './partner-member.service';

/**
 * 2026-11-20 — THE PARTNER APP'S DOORS (the payments plan, 3c; the owner: a separate Partner app). Our staff add and take out
 * a partner's own people; a person signed in as themselves sees the partners they are in or invited to, says yes or no, and
 * opens one; signed in for a partner, they read what it owes its hands — the same record our staff read, live.
 */
@Controller('sbg')
export class PartnerAppController {
  constructor(
    private readonly members: PartnerMemberService,
    private readonly ledger: PartnerLedgerService,
    private readonly agents: AgentService,
    private readonly mdps: MdpService,
    private readonly drivers: DriverService,
    private readonly fleets: FleetManagerService,
  ) {}

  /* ------------------------------------------------------------------ our staff -- */

  @Roles('operator')
  @Get('entities/:entityId/partner-members')
  membersOf(@Param('entityId') entityId: string): PartnerMemberView[] {
    return this.members.membersOf(entityId);
  }

  @Roles('operator')
  @Post('entities/:entityId/partner-members')
  invite(@Param('entityId') entityId: string, @Body() dto: InvitePartnerMemberDto, @Actor() actor: IntrospectionResult): PartnerMemberView {
    return this.members.invite(entityId, dto, auditActor(actor));
  }

  @Roles('operator')
  @Delete('entities/:entityId/partner-members/:memberId')
  remove(@Param('entityId') entityId: string, @Param('memberId') memberId: string, @Actor() actor: IntrospectionResult): PartnerMemberView {
    return this.members.remove(entityId, memberId, auditActor(actor));
  }

  /* ------------------------------------------------------- a person, as themselves -- */

  /** The partners this person is in, and the ones they are invited to. */
  @Roles('consumer')
  @Get('partner/mine')
  mine(@Actor() actor: IntrospectionResult): PartnerMembershipList {
    return { items: this.members.mine(personOf(actor)) };
  }

  @Roles('consumer')
  @Post('partner/invitations/:memberId/accept')
  accept(@Param('memberId') memberId: string, @Actor() actor: IntrospectionResult): PartnerMembershipView {
    return this.members.accept(personOf(actor), memberId);
  }

  @Roles('consumer')
  @Post('partner/invitations/:memberId/decline')
  decline(@Param('memberId') memberId: string, @Actor() actor: IntrospectionResult): { declined: true } {
    return this.members.decline(personOf(actor), memberId);
  }

  /** Open one partner: a session that reads for it, for a person who is in it. */
  @Roles('consumer')
  @Post('partner/:entityId/session')
  session(@Param('entityId') entityId: string, @Actor() actor: IntrospectionResult): PartnerSession {
    return this.members.session(personOf(actor), entityId);
  }

  /* ------------------------------------------------------- reading for the partner -- */

  @Roles('partner')
  @Get('partner/me')
  me(@Actor() actor: IntrospectionResult): PartnerMeView {
    return this.members.me(actor);
  }

  /** What the partner owes its hands: in all, per hand, every step — the record our staff read on its page. */
  @Roles('partner')
  @Get('partner/me/owed')
  owed(@Actor() actor: IntrospectionResult): PartnerOwedForPartner {
    const { entity } = this.members.requireMember(actor);
    const view = this.ledger.ledgerOf(entity.entityId);
    // Each hand by the name the partner knows it by — it contracts them — and never a phone number.
    const names: Record<string, string> = {};
    for (const h of [...view.byPayee, ...view.lines]) {
      if (names[h.payeeId]) continue;
      const name = this.nameOf(h.payeeKind, h.payeeId);
      if (name) names[h.payeeId] = name;
    }
    return { ...view, names };
  }

  private nameOf(kind: PartnerPayeeKind, id: string): string | undefined {
    try {
      if (kind === 'shop') return this.agents.get(id).shopName;
      if (kind === 'hub') return this.mdps.require(id).name;
      if (kind === 'driver') return this.drivers.get(id).displayName;
      const fleet = this.fleets.get(id);
      return fleet.tradingName ?? fleet.companyName;
    } catch {
      return undefined;
    }
  }
}

function personOf(actor: IntrospectionResult): string {
  const did = actor?.personDid ?? actor?.did;
  if (!did) throw new GlosError('FORBIDDEN', 'Sign in first');
  return did;
}
