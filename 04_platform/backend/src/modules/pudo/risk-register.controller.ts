import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { Actor } from '../../foundation/auth/actor.decorator';
import { auditActor } from '../../foundation/auth/acting';
import type { IntrospectionResult } from '../../foundation/auth/auth.types';
import { Roles } from '../../foundation/auth/scopes.decorator';
import { GlosError } from '../../foundation/http/glos-error';
import { CorridorService } from './corridor.service';
import { MdpService } from './mdp.service';
import { RISK_LEVELS, RISK_SUBJECTS, RISK_THREATS, RiskRegisterService, type RiskLevel, type RiskProposal, type RiskSubject, type RiskThreat } from './risk-register.service';

export class RateRiskDto {
  @ApiProperty({ enum: RISK_SUBJECTS }) @IsIn(RISK_SUBJECTS as unknown as string[]) subject!: RiskSubject;
  @ApiProperty() @IsString() @MaxLength(120) id!: string;
  @ApiProperty({ enum: RISK_THREATS }) @IsIn(RISK_THREATS as unknown as string[]) threat!: RiskThreat;
  @ApiProperty({ enum: RISK_LEVELS }) @IsIn(RISK_LEVELS as unknown as string[]) level!: RiskLevel;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) why?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) by?: string;
}

export class DecideRiskDto {
  @ApiProperty() @IsBoolean() accept!: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) reason?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) by?: string;
}

/** One threat's rating of one corridor or hub — or none yet. */
export class RiskCellView {
  @ApiProperty({ enum: RISK_THREATS }) threat!: RiskThreat;
  @ApiPropertyOptional({ enum: RISK_LEVELS }) level?: RiskLevel;
  @ApiPropertyOptional() why?: string;
  @ApiPropertyOptional() ratedBy?: string;
  @ApiPropertyOptional() ratedAt?: string;
  @ApiPropertyOptional() reviewBy?: string;
  /** Not looked at again within its quarter. */
  @ApiProperty() overdue!: boolean;
}

/** A corridor or a hub, and its four ratings. */
export class RiskRowView {
  @ApiProperty({ enum: RISK_SUBJECTS }) subject!: RiskSubject;
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: [RiskCellView] }) ratings!: RiskCellView[];
  /** Rated high for anything: it asks for seals, and no night running. */
  @ApiProperty() high!: boolean;
}

export class RiskProposalView {
  @ApiProperty() proposalId!: string;
  @ApiProperty({ enum: RISK_SUBJECTS }) subject!: RiskSubject;
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: RISK_THREATS }) threat!: RiskThreat;
  @ApiPropertyOptional({ enum: RISK_LEVELS }) from?: RiskLevel;
  @ApiProperty({ enum: RISK_LEVELS }) to!: RiskLevel;
  @ApiProperty() because!: string;
  @ApiPropertyOptional() ref?: string;
  @ApiProperty() at!: string;
}

export class RiskRegisterView {
  @ApiProperty({ type: [RiskRowView] }) rows!: RiskRowView[];
  @ApiProperty({ type: [RiskProposalView] }) proposals!: RiskProposalView[];
  /** Ratings past their quarter, waiting to be looked at again. */
  @ApiProperty() overdue!: number;
}

/**
 * Round 39 — THE RISK REGISTER (the user: "Staff rate, high asks seals"): every corridor and hub, its rating for each threat,
 * and what incidents have proposed. Staff rate, look again each quarter, and decide what was proposed; whoever works under
 * a rating — the hub, or the fleet running the corridor — is told when it changes.
 */
@Controller('sbg')
export class RiskRegisterController {
  constructor(
    private readonly risk: RiskRegisterService,
    private readonly corridors: CorridorService,
    private readonly mdps: MdpService,
  ) {}

  @Roles('operator')
  @Get('risk-register')
  register(): RiskRegisterView {
    const now = Date.now();
    const row = (subject: RiskSubject, id: string, name: string): RiskRowView => {
      const rated = this.risk.ratingsOf(subject, id);
      const ratings = RISK_THREATS.map((threat): RiskCellView => {
        const r = rated[threat];
        return r ? { threat, level: r.level, ...(r.why ? { why: r.why } : {}), ratedBy: r.ratedBy, ratedAt: r.ratedAt, reviewBy: r.reviewBy, overdue: Date.parse(r.reviewBy) <= now } : { threat, overdue: false };
      });
      return { subject, id, name, ratings, high: ratings.some((c) => c.level === 'high') };
    };
    const rows = [
      ...this.corridors.listCorridors().filter((c) => c.status === 'active').map((c) => row('corridor', c.corridorId, c.name)),
      ...this.mdps.approvedList().map((m) => row('hub', m.mdpId, m.name)),
    ];
    const names = new Map(rows.map((r) => [`${r.subject}:${r.id}`, r.name]));
    const proposals = this.risk.openProposals().map((p) => this.proposalView(p, names));
    return { rows, proposals, overdue: rows.reduce((n, r) => n + r.ratings.filter((c) => c.overdue).length, 0) };
  }

  /** Rated, or looked at again at the same level: by a named member of staff, with why. */
  @Roles('operator')
  @Post('risk-register/rate')
  rate(@Body() dto: RateRiskDto, @Actor() actor: IntrospectionResult) {
    this.nameOf(dto.subject, dto.id);
    return this.risk.rate(dto.subject, dto.id, dto.threat, dto.level, auditActor(actor, dto.by), dto.why, Date.now(), this.tellOf(dto.subject, dto.id));
  }

  /** What an incident proposed: raised, or kept as it is with the reason. */
  @Roles('operator')
  @Post('risk-register/proposals/:proposalId/decide')
  decide(@Param('proposalId') proposalId: string, @Body() dto: DecideRiskDto, @Actor() actor: IntrospectionResult) {
    const open = this.risk.openProposals().find((p) => p.proposalId === proposalId);
    return this.risk.decide(proposalId, dto.accept, auditActor(actor, dto.by), dto.reason, Date.now(), open ? this.tellOf(open.subject, open.id) : undefined);
  }

  private proposalView(p: RiskProposal, names: Map<string, string>): RiskProposalView {
    return { proposalId: p.proposalId, subject: p.subject, id: p.id, name: names.get(`${p.subject}:${p.id}`) ?? p.id, threat: p.threat, ...(p.from ? { from: p.from } : {}), to: p.to, because: p.because, ...(p.ref ? { ref: p.ref } : {}), at: p.at };
  }

  private nameOf(subject: RiskSubject, id: string): string {
    if (subject === 'hub') return this.mdps.require(id).name;
    const corridor = this.corridors.listCorridors().find((c) => c.corridorId === id);
    if (!corridor) throw new GlosError('NOT_FOUND', 'No such corridor');
    return corridor.name;
  }

  /** Who works under it: the hub itself, or the fleet that runs the corridor (the network's own corridors have none). */
  private tellOf(subject: RiskSubject, id: string): { did: string; name: string } | undefined {
    if (subject === 'hub') {
      const hub = this.mdps.require(id);
      return { did: hub.did, name: hub.name };
    }
    const corridor = this.corridors.listCorridors().find((c) => c.corridorId === id);
    return corridor?.owner ? { did: corridor.owner.managerDid, name: corridor.name } : undefined;
  }
}
