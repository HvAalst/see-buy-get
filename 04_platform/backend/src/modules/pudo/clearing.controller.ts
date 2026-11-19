import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Actor } from '../../foundation/auth/actor.decorator';
import type { IntrospectionResult } from '../../foundation/auth/auth.types';
import { Roles } from '../../foundation/auth/scopes.decorator';
import { EntityService } from '../../foundation/entity/entity.service';
import { GlosError } from '../../foundation/http/glos-error';
import { AbroadParcelRow, CustomsOutcomeDto, abroadRow, dueOf } from './border-parcels.controller';
import { BorderRouteService } from './border-route.service';
import { BusinessMemberGuard } from './business-member.guard';
import { BusinessService, type ActingMember } from './business.service';
import { ParcelService } from './parcel.service';
import { RoutingService } from './routing.service';

/*
 * 2026-11-19 — PARCELS ACROSS A BORDER, STEP 4: THE CLEARING AGENT'S SIDE (the plan "Parcels across a border": "accepting a route,
 * recording release or hold"). Staff name a clearing agent for an arrival country; its owner accepts here, from the Business
 * app. From then its people see the parcels coming into that country and those under customs control, and record what customs
 * decided — released, or held with what it asks and its reference — and when a held one's duty is paid and customs released it,
 * the same acts as the warehouse, so what the receiver owes us and what they are told come out the same. The parcel stays in the
 * warehouse's hands throughout: released, the warehouse sorts it on to our driver for the last leg.
 */

export class ClearingCountryView {
  @ApiProperty() country: string;
  @ApiProperty() name: string;
  @ApiProperty() accepted: boolean;
  @ApiPropertyOptional() acceptedAt?: string;
}

export class ClearingView {
  /** The arrival countries this business is named to clear in, accepted or not yet. */
  @ApiProperty({ type: [ClearingCountryView] }) countries: ClearingCountryView[];
  /** The parcels into the countries it has accepted: coming from abroad, waiting for customs, or held. */
  @ApiProperty({ type: [AbroadParcelRow] }) rows: AbroadParcelRow[];
}

@Controller('sbg')
@UseGuards(BusinessMemberGuard)
export class ClearingController {
  constructor(
    private readonly businesses: BusinessService,
    readonly borders: BorderRouteService,
    private readonly parcels: ParcelService,
    readonly routing: RoutingService,
    readonly entities: EntityService,
  ) {}

  @Roles('business')
  @Get('business/me/clearing')
  view(@Actor() actor: IntrospectionResult): ClearingView {
    return this.viewOf(this.own(actor).entity.entityId);
  }

  /** Its owner accepts clearing in a country it was named for: from then the routes into it count it as their clearer. */
  @Roles('business')
  @Post('business/me/clearing/:country/accept')
  accept(@Param('country') country: string, @Actor() actor: IntrospectionResult): ClearingView {
    const acting = this.own(actor);
    this.businesses.requireOwner(acting);
    this.borders.acceptAsClearer(country, acting.entity.entityId);
    return this.viewOf(acting.entity.entityId);
  }

  /** What customs decided on a parcel into a country it clears in. */
  @Roles('business')
  @Post('business/me/clearing/parcels/:parcelId/customs')
  customs(@Param('parcelId') parcelId: string, @Body() dto: CustomsOutcomeDto, @Actor() actor: IntrospectionResult): AbroadParcelRow {
    const { acting, p } = this.clearing(actor, parcelId);
    const b = p.border!;
    const payee = dto.outcome === 'held' ? this.borders.payeeIn(b.to) : undefined;
    return abroadRow(this.parcels.recordClearance(p.parcelId, { country: b.to, name: byName(acting) }, dto, Date.now(), { due: dueOf(p, this), ...(payee ? { payee } : {}) }));
  }

  /** A held parcel's duty paid, and customs released it. */
  @Roles('business')
  @Post('business/me/clearing/parcels/:parcelId/paid')
  paid(@Param('parcelId') parcelId: string, @Actor() actor: IntrospectionResult): AbroadParcelRow {
    const { acting, p } = this.clearing(actor, parcelId);
    return abroadRow(this.parcels.confirmDutyPaid(p.parcelId, { country: p.border!.to, name: byName(acting) }));
  }

  private viewOf(entityId: string): ClearingView {
    const countries = this.borders.clearsFor(entityId);
    const accepted = countries.filter((c) => c.acceptedAt).map((c) => c.country);
    return {
      countries: countries.map((c) => ({ country: c.country, name: c.name, accepted: Boolean(c.acceptedAt), ...(c.acceptedAt ? { acceptedAt: c.acceptedAt } : {}) })),
      rows: this.parcels.abroadInto(accepted).map(abroadRow),
    };
  }

  /** One of its people who may act, on a parcel into a country it has accepted to clear in — refused by name otherwise. */
  private clearing(actor: IntrospectionResult, parcelId: string): { acting: ActingMember; p: ReturnType<ParcelService['get']> } {
    const acting = this.own(actor);
    if (!this.businesses.mayAct(acting)) throw new GlosError('FORBIDDEN', 'A viewer reads this; one of its other people records what customs decided');
    const p = this.parcels.get(String(parcelId).trim().toUpperCase());
    if (!p.border || !this.borders.clearsIn(acting.entity.entityId, p.border.to)) throw new GlosError('FORBIDDEN', `${acting.entity.name} does not clear customs for ${p.parcelId}`);
    return { acting, p };
  }

  private own(actor: IntrospectionResult): ActingMember {
    if (actor?.role !== 'business') throw new GlosError('FORBIDDEN', 'This is a clearing agent’s own page: staff read parcels abroad on the console');
    return this.businesses.requireMember(actor);
  }
}

/** Who recorded it: the clearing agent, and which of its people. */
function byName(acting: ActingMember): string {
  return `${acting.entity.name} (${acting.member.name})`;
}
