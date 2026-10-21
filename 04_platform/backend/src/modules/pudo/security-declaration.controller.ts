import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { Actor } from '../../foundation/auth/actor.decorator';
import { actingTenant } from '../../foundation/auth/acting';
import type { IntrospectionResult } from '../../foundation/auth/auth.types';
import { Roles } from '../../foundation/auth/scopes.decorator';
import { GlosError } from '../../foundation/http/glos-error';
import { AgentService } from './agent.service';
import { DriverService } from './driver.service';
import { FleetManagerService } from './fleet-manager.service';
import { MdpService } from './mdp.service';
import { DECLARATION_KINDS, SecurityDeclarationService, type DeclarationKind, type DeclarationStanding } from './security-declaration.service';

/** The partner signs the wording they were shown: its version, and — where the sign-in does not say it — their name. */
export class SignDeclarationDto {
  @ApiProperty() @IsInt() @Min(1) version!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) by?: string;
}

/** Where a partner stands under the security declaration, or — a fleet's driver — whose declaration covers them. */
export class DeclarationView {
  /** False for a fleet's driver: the fleet signs, and answers for them. */
  @ApiProperty() required!: boolean;
  @ApiPropertyOptional({ enum: DECLARATION_KINDS }) kind?: DeclarationKind;
  @ApiPropertyOptional() version?: number;
  @ApiPropertyOptional() title?: string;
  @ApiPropertyOptional({ type: [String] }) lines?: string[];
  @ApiPropertyOptional({ enum: ['signed', 'due', 'missing', 'lapsed', 'outdated'] }) state?: DeclarationStanding['state'];
  @ApiPropertyOptional() signedAt?: string;
  @ApiPropertyOptional() signedBy?: string;
  @ApiPropertyOptional() until?: string;
  @ApiPropertyOptional() daysLeft?: number;
  /** A fleet's driver: the fleet whose declaration covers them. */
  @ApiPropertyOptional() coveredBy?: string;
}

/** One partner on staff's list: who, which declaration, and where they stand. */
export class DeclarationRow {
  @ApiProperty({ enum: DECLARATION_KINDS }) kind!: DeclarationKind;
  @ApiProperty() did!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: ['signed', 'due', 'missing', 'lapsed', 'outdated'] }) state!: DeclarationStanding['state'];
  @ApiPropertyOptional() until?: string;
  @ApiPropertyOptional() signedBy?: string;
}

/**
 * Round 39 — THE SECURITY DECLARATION (the user: "At joining and yearly (Recommended)"): a shop, a hub, a fleet's office and
 * a rider in no fleet read theirs and sign it, from their own sign-in; staff read who stands where. Nobody signs for
 * anybody else — not staff, and not the people at a shop's counter (the guard keeps them to the doors marked for them).
 */
@Controller('sbg')
export class SecurityDeclarationController {
  constructor(
    private readonly declarations: SecurityDeclarationService,
    private readonly agents: AgentService,
    private readonly mdps: MdpService,
    private readonly drivers: DriverService,
    private readonly managers: FleetManagerService,
  ) {}

  /** The caller's own declaration — or, for a fleet's driver, whose covers them. */
  @Roles('agent', 'mdp', 'fleet_manager', 'driver')
  @Get('declarations/mine')
  mine(@Actor() actor: IntrospectionResult): DeclarationView {
    const who = this.declarer(actor);
    if ('coveredBy' in who) return { required: false, coveredBy: who.coveredBy };
    return { required: true, ...this.declarations.standing(who.kind, who.did) };
  }

  /** Signed — the wording in force, which must be the one they were shown — for a year from now. */
  @Roles('agent', 'mdp', 'fleet_manager', 'driver')
  @Post('declarations/mine/sign')
  sign(@Body() dto: SignDeclarationDto, @Actor() actor: IntrospectionResult): DeclarationView {
    const who = this.declarer(actor);
    if ('coveredBy' in who) throw new GlosError('INVALID_STATE', `${who.coveredBy} signs the security declaration for its drivers: you sign nothing of your own`);
    const by = actor?.actorName?.trim() || dto.by?.trim() || who.name;
    return { required: true, ...this.declarations.sign(who.kind, who.did, dto.version, by) };
  }

  /** Every partner and where they stand, for staff: the shops, the hubs, the fleets and the riders in no fleet. */
  @Roles('operator')
  @Get('declarations')
  report(): { items: DeclarationRow[] } {
    const now = Date.now();
    const row = (kind: DeclarationKind, did: string, name: string): DeclarationRow => {
      const s = this.declarations.standing(kind, did, now);
      return { kind, did, name, state: s.state, ...(s.until ? { until: s.until } : {}), ...(s.signedBy ? { signedBy: s.signedBy } : {}) };
    };
    const items = [
      ...this.agents.list().filter((a) => a.status === 'ACTIVE').map((a) => row('shop', a.did, a.shopName)),
      ...this.mdps.approvedList().map((m) => row('hub', m.did, m.name)),
      ...this.managers.list().filter((m) => m.status === 'ACTIVE').map((m) => row('fleet', m.did, m.companyName)),
      ...this.drivers.list().filter((d) => !d.managerDid && d.status === 'ACTIVE').map((d) => row('driver', d.did, d.displayName)),
    ];
    // What needs somebody first: none, lapsed, a new wording unsigned, then due, then in force.
    const order: Record<DeclarationStanding['state'], number> = { missing: 0, lapsed: 1, outdated: 2, due: 3, signed: 4 };
    return { items: items.sort((a, b) => order[a.state] - order[b.state] || a.name.localeCompare(b.name)) };
  }

  /** Who the caller declares as: their shop, their hub, their fleet, or themselves as a rider in no fleet. */
  private declarer(actor: IntrospectionResult): { kind: DeclarationKind; did: string; name: string } | { coveredBy: string } {
    const did = actor?.did;
    if (!did) throw new GlosError('FORBIDDEN', 'A security declaration is signed from the partner’s own sign-in');
    if (actor.role === 'agent') return { kind: 'shop', did, name: this.agents.get(did).shopName };
    if (actor.role === 'mdp') {
      const hub = this.mdps.list().find((m) => m.did === did);
      if (!hub) throw new GlosError('NOT_FOUND', 'No such hub');
      return { kind: 'hub', did, name: hub.name };
    }
    if (actor.role === 'fleet_manager') {
      const office = actingTenant(actor) ?? did;
      return { kind: 'fleet', did: office, name: this.managers.get(office).companyName };
    }
    if (actor.role === 'driver') {
      const driver = this.drivers.get(did);
      if (driver.managerDid) return { coveredBy: this.managers.get(driver.managerDid).companyName };
      return { kind: 'driver', did, name: driver.displayName };
    }
    throw new GlosError('FORBIDDEN', 'Only a shop, a hub, a fleet or a rider signs a security declaration');
  }
}
