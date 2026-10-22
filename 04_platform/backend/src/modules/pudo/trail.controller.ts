import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Roles } from '../../foundation/auth/scopes.decorator';
import { Actor } from '../../foundation/auth/actor.decorator';
import { auditActor } from '../../foundation/auth/acting';
import type { IntrospectionResult } from '../../foundation/auth/auth.types';
import { staffIdOf } from '../../foundation/entity/operator-account.service';
import { GlosError } from '../../foundation/http/glos-error';
import { TrailService } from './trail.service';
import { TrailView } from './trail.types';
import { TrailAnchorService, type AnchorsView, type CopyCheck, type StaffWho } from './trail-anchor.service';
import { AnchorAuditorDecisionDto, AnchorAuditorDto, AnchorCopyCheckDto } from './pudo.dto';

/** THE TRAIL (trail.types.ts): a load's or a bag's anchored steps, checked, for staff. */
@Controller('sbg')
export class TrailController {
  constructor(
    private readonly trail: TrailService,
    private readonly anchors: TrailAnchorService,
  ) {}

  @Roles('operator')
  @Get('ops/trail/:ref')
  of(@Param('ref') ref: string): TrailView {
    return this.trail.of(ref);
  }

  /**
   * Round 40 — THE TRAIL ANCHORED OUTSIDE OUR DATABASE (the user: "Daily to an auditor"): who receives the daily head, a change
   * waiting for a second member of staff, and the days kept — each checked against the chain as it stands now.
   */
  @Roles('operator')
  @Get('ops/anchors')
  view(@Actor() actor: IntrospectionResult): AnchorsView {
    return this.anchors.view(this.namedOrNone(actor));
  }

  /** Round 40 — one member of staff asks for the auditor's address to change. It counts once ANOTHER approves. */
  @Roles('operator')
  @Post('ops/anchors/auditor')
  propose(@Body() dto: AnchorAuditorDto, @Actor() actor: IntrospectionResult): AnchorsView {
    return this.anchors.propose(dto.address, this.named(actor));
  }

  /** Round 40 — a second member of staff approves the change, or declines it with the reason the one who asked reads. */
  @Roles('operator')
  @Post('ops/anchors/auditor/decide')
  decide(@Body() dto: AnchorAuditorDecisionDto, @Actor() actor: IntrospectionResult): Promise<AnchorsView> {
    return this.anchors.decide(dto.approve, this.named(actor), dto.reason);
  }

  /** Round 40 — an auditor's copy read out: is it still what the chain gives at that height? */
  @Roles('operator')
  @Post('ops/anchors/check')
  check(@Body() dto: AnchorCopyCheckDto): CopyCheck {
    return this.anchors.check(dto.height, dto.txId);
  }

  /** Two people are two staff accounts: the shared setup key cannot tell them apart, so it asks for nothing here. */
  private named(actor: IntrospectionResult | undefined): StaffWho {
    const who = this.namedOrNone(actor);
    if (!who) throw new GlosError('FORBIDDEN', 'Sign in with your own staff account — the setup key cannot tell two people apart');
    return who;
  }

  private namedOrNone(actor: IntrospectionResult | undefined): StaffWho | undefined {
    const operatorId = staffIdOf(actor?.revocationKey);
    return operatorId ? { operatorId, name: auditActor(actor) } : undefined;
  }
}
