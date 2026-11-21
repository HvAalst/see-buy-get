import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Roles } from '../../foundation/auth/scopes.decorator';
import { Actor } from '../../foundation/auth/actor.decorator';
import { IntrospectionResult } from '../../foundation/auth/auth.types';
import { actingTenant, auditActor } from '../../foundation/auth/acting';
import { GlosError } from '../../foundation/http/glos-error';
import { DriverService } from './driver.service';
import { FleetManagerService } from './fleet-manager.service';
import { PlateClaimService } from './plate-claim.service';
import { PlateClaimAnswerDto, PlateClaimAskDto, PlateClaimDecisionDto } from './plate-claim.dto';
import { LapsedPlateClaimView, PlateClaimParty, PlateClaimView, PlateClaimsView } from './plate-claim.types';

/**
 * 2026-11-21 — A PLATE CLAIMED BY WHOEVER BOUGHT THE VEHICLE, over the wire (PlateClaimService). Asked and answered by a driver or
 * a fleet's office from its own sign-in — staff ask and answer nothing in anybody's name; staff decide only what nobody answered,
 * at the vehicle's own address (so its country is the vehicle's), with a reason.
 */
@Controller('sbg')
export class PlateClaimController {
  constructor(
    private readonly claims: PlateClaimService,
    private readonly drivers: DriverService,
    private readonly managers: FleetManagerService,
  ) {}

  /** "I bought it": the owner of the vehicle that carries this plate is asked whether they sold it. */
  @Roles('driver', 'fleet_manager')
  @Post('plate-claims')
  ask(@Body() dto: PlateClaimAskDto, @Actor() actor: IntrospectionResult): PlateClaimView {
    const c = this.claims.ask(dto.plate, this.partyOf(actor));
    return { claimId: c.claimId, plate: c.plate, vehicleClass: c.vehicleClass, state: c.state, askedAt: c.askedAt };
  }

  /** What is asked of this driver or fleet about its vehicles, and what it asked. */
  @Roles('driver', 'fleet_manager')
  @Get('plate-claims')
  mine(@Actor() actor: IntrospectionResult): PlateClaimsView {
    return this.claims.viewFor(this.partyOf(actor));
  }

  /** The owner's answer: sold — it comes off their vehicles now — or still theirs. */
  @Roles('driver', 'fleet_manager')
  @Post('plate-claims/:id/answer')
  answer(@Param('id') id: string, @Body() dto: PlateClaimAnswerDto, @Actor() actor: IntrospectionResult): PlateClaimView {
    const c = this.claims.answer(id, this.partyOf(actor), dto.sold);
    return { claimId: c.claimId, plate: c.plate, vehicleClass: c.vehicleClass, state: c.state, askedAt: c.askedAt, ...(c.closedAt ? { closedAt: c.closedAt } : {}) };
  }

  /** For staff: the claims nobody answered in fourteen days, or with nobody to ask. */
  @Roles('operator')
  @Get('plate-claims/lapsed')
  lapsed(): LapsedPlateClaimView[] {
    return this.claims.lapsed();
  }

  /** Staff decide one, at the vehicle's address: take it off its owner's list, or leave it — with a reason both are told. */
  @Roles('operator')
  @Post('vehicles/:id/plate-claim-decision')
  decide(@Param('id') id: string, @Body() dto: PlateClaimDecisionDto, @Actor() actor: IntrospectionResult): PlateClaimView {
    if (actor?.role !== 'operator') throw new GlosError('FORBIDDEN', 'Network staff decide a plate nobody answered about');
    const c = this.claims.decide(id, { claimId: dto.claimId, release: dto.release, reason: dto.reason, by: auditActor(actor, dto.by) });
    return { claimId: c.claimId, plate: c.plate, vehicleClass: c.vehicleClass, state: c.state, askedAt: c.askedAt, ...(c.closedAt ? { closedAt: c.closedAt } : {}), ...(c.reason ? { reason: c.reason } : {}) };
  }

  /** Who is asking or answering: a driver, by their own sign-in, or a fleet's office. Staff stand in for nobody here. */
  private partyOf(actor: IntrospectionResult | undefined): PlateClaimParty {
    if (actor?.role === 'driver' && actor.did) {
      const d = this.drivers.get(actor.did);
      return { kind: 'driver', did: d.did, name: d.displayName };
    }
    const fleet = actor?.role === 'fleet_manager' ? actingTenant(actor) : undefined;
    if (fleet) return { kind: 'fleet', did: fleet, name: this.managers.get(fleet).companyName };
    throw new GlosError('FORBIDDEN', 'A plate is asked about, and answered, by a driver or a fleet’s office from its own sign-in');
  }
}
