import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsNumber, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { Actor } from '../../foundation/auth/actor.decorator';
import { AtTheCounter } from '../../foundation/auth/at-the-counter';
import type { IntrospectionResult } from '../../foundation/auth/auth.types';
import { Roles } from '../../foundation/auth/scopes.decorator';
import { catalogueEntry } from '../../foundation/countries/catalogue';
import { GlosError } from '../../foundation/http/glos-error';
import { MdpService } from './mdp.service';
import { RoutingService } from './routing.service';
import { BorderRouteService } from './border-route.service';
import { EntityService } from '../../foundation/entity/entity.service';
import { ParcelService } from './parcel.service';
import { inCustoms, type Parcel, type ParcelBorder } from './pudo.types';

/*
 * 2026-11-18 — PARCELS ACROSS A BORDER, STEP 2c: AT THE HUBS (the plan "Parcels across a border"). At the hub a route leaves
 * from, its people hand parcels abroad to the route's carrier, under the carrier's reference, never into a bag for one of our
 * drivers. At the arrival airport's customs warehouse, they receive them from the carrier and record what customs decided:
 * released, or held with what it asks to be paid and its reference. Until then the parcel leaves by no path. The hub's own
 * sign-in, its floor's people under their own name, as for a parcel weighed there.
 */

export const ABROAD_STEPS = ['to_hand', 'coming', 'customs', 'held'] as const;
export type AbroadStep = (typeof ABROAD_STEPS)[number];

export class AbroadClearanceView {
  @ApiProperty() amount: number;
  @ApiProperty() currency: string;
  @ApiProperty() reference: string;
  /** 2026-11-19 — who the receiver pays it to (D17), and by when; not paid by then, the sender is asked what to do. */
  @ApiPropertyOptional() payee?: string;
  @ApiPropertyOptional() payBy?: string;
  @ApiPropertyOptional() lapsed?: boolean;
}

/** A parcel abroad as a hub's floor acts on it. */
export class AbroadParcelRow {
  @ApiProperty() parcelId: string;
  /** What the hub has to do with it: hand it to the carrier, receive it from them, record customs' decision, or keep it held. */
  @ApiProperty({ enum: ABROAD_STEPS }) step: AbroadStep;
  @ApiProperty() from: string;
  @ApiProperty() to: string;
  @ApiProperty() toName: string;
  @ApiProperty() carrier: string;
  @ApiProperty() departure: string;
  @ApiProperty() arrival: string;
  @ApiProperty() seal: string;
  @ApiProperty() contents: string;
  @ApiProperty() itemCount: number;
  @ApiProperty() value: number;
  @ApiProperty() valueCurrency: string;
  /** The carrier's reference it went under, once handed. */
  @ApiPropertyOptional() reference?: string;
  /** Held: what customs asks, and its reference. */
  @ApiPropertyOptional({ type: AbroadClearanceView }) held?: AbroadClearanceView;
}

export class AbroadAtHubView {
  @ApiProperty({ type: [AbroadParcelRow] }) rows: AbroadParcelRow[];
}

export class HandToCarrierDto {
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @IsString({ each: true }) parcelIds!: string[];
  /** The carrier's reference for them: the number on its air waybill or consignment note. */
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(60) reference!: string;
}

export class CustomsOutcomeDto {
  @ApiProperty({ enum: ['released', 'held'] }) @IsIn(['released', 'held']) outcome!: 'released' | 'held';
  /** Held: what customs asks to be paid, in the arrival country's money. */
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0.01) amount?: number;
  /** Customs' reference, as on their notice — needed when held. */
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) reference?: string;
}

/** A parcel abroad, as the hub reads it. */
export function abroadRow(p: Parcel): AbroadParcelRow {
  const b = p.border!;
  const c = b.clearance;
  const step: AbroadStep = !b.handed ? 'to_hand' : !b.arrived ? 'coming' : c?.outcome === 'held' ? 'held' : 'customs';
  return {
    parcelId: p.parcelId,
    step,
    from: b.from,
    to: b.to,
    toName: catalogueEntry(b.to)?.name ?? b.to,
    carrier: b.carrier.name,
    departure: b.departure.airport,
    arrival: b.arrival.airport,
    seal: b.seal,
    contents: p.customs?.contents ?? '',
    itemCount: p.customs?.itemCount ?? 0,
    value: p.customs?.declaredValue ?? 0,
    valueCurrency: p.customs?.currency ?? '',
    ...(b.handed ? { reference: b.handed.reference } : {}),
    ...(c?.outcome === 'held' && inCustoms(p) ? { held: { amount: c.amount ?? 0, currency: c.currency ?? '', reference: c.reference ?? '', ...(c.payee ? { payee: c.payee } : {}), ...(c.payBy ? { payBy: c.payBy } : {}), ...(c.lapsedAt ? { lapsed: true } : {}) } } : {}),
  };
}

@Controller('sbg')
export class BorderParcelsController {
  constructor(
    private readonly mdps: MdpService,
    private readonly parcels: ParcelService,
    // 2026-11-19 — step 3: what the receiver owes us, priced by the arrival company; who duty is paid to.
    private readonly routing: RoutingService,
    private readonly borders: BorderRouteService,
    private readonly entities: EntityService,
  ) {}

  /** The parcels abroad this hub has to act on. */
  @Roles('mdp')
  @Get('mdps/:id/abroad')
  @AtTheCounter()
  abroad(@Param('id') id: string, @Actor() actor: IntrospectionResult): AbroadAtHubView {
    const hub = this.hubOf(id, actor);
    return { rows: this.parcels.abroadAt(hub.mdpId).map(abroadRow) };
  }

  /** Handed to the route's carrier, under its reference: one consignment, one carrier. */
  @Roles('mdp')
  @Post('mdps/:id/abroad/hand')
  @AtTheCounter()
  hand(@Param('id') id: string, @Body() dto: HandToCarrierDto, @Actor() actor: IntrospectionResult): AbroadAtHubView {
    const hub = this.hubOf(id, actor);
    return { rows: this.parcels.handToRouteCarrier(dto.parcelIds, hub, dto.reference).map(abroadRow) };
  }

  /** Received from the route's carrier at the arrival airport's customs warehouse: under customs control from now. */
  @Roles('mdp')
  @Post('mdps/:id/abroad/:parcelId/receive')
  @AtTheCounter()
  receive(@Param('id') id: string, @Param('parcelId') parcelId: string, @Actor() actor: IntrospectionResult): AbroadParcelRow {
    const hub = this.hubOf(id, actor);
    return abroadRow(this.parcels.receiveFromRouteCarrier(parcelId, hub));
  }

  /** What customs decided: released, or held with what it asks and its reference. */
  @Roles('mdp')
  @Post('mdps/:id/abroad/:parcelId/customs')
  @AtTheCounter()
  customs(@Param('id') id: string, @Param('parcelId') parcelId: string, @Body() dto: CustomsOutcomeDto, @Actor() actor: IntrospectionResult): AbroadParcelRow {
    const hub = this.hubOf(id, actor);
    const p = this.parcels.get(String(parcelId).trim().toUpperCase());
    const payee = dto.outcome === 'held' && p.border ? this.borders.payeeIn(p.border.to) : undefined;
    return abroadRow(this.parcels.recordClearance(parcelId, hub, dto, Date.now(), { ...(p.border ? { due: this.dueFor(p) } : {}), ...(payee ? { payee } : {}) }));
  }

  /** 2026-11-19 — a held parcel's duty paid to the clearing agent, and customs released it (D17): it goes on. */
  @Roles('mdp')
  @Post('mdps/:id/abroad/:parcelId/paid')
  @AtTheCounter()
  paid(@Param('id') id: string, @Param('parcelId') parcelId: string, @Actor() actor: IntrospectionResult): AbroadParcelRow {
    const hub = this.hubOf(id, actor);
    return abroadRow(this.parcels.confirmDutyPaid(parcelId, hub));
  }

  /**
   * 2026-11-19 — WHAT THE RECEIVER OWES US (step 3; D12, D18): our clearance fee in the arrival country, and the last leg from the
   * warehouse to their shop as that country's company prices it — fixed when customs decides, paid at collection.
   */
  private dueFor(p: Parcel): NonNullable<ParcelBorder['due']> {
    const b = p.border!;
    const seller = this.entities.forJurisdiction(b.to);
    if (!seller) throw new GlosError('INVALID_STATE', `No company of ours stands in ${b.to} to price the last leg`);
    const q = this.routing.quoteShipmentFrom(this.routing.hubEnd(b.arrival.mdpId), p.destAgentDid!, p.size, seller.entityId, undefined, { consumer: true, kg: p.weightKg });
    const fee = this.borders.feeIn(b.to);
    if (fee && fee.currency !== q.currency) throw new GlosError('INVALID_STATE', `The clearance fee is in ${fee.currency} and the last leg in ${q.currency}`);
    const amount = fee?.amount ?? 0;
    return { fee: amount, lastLeg: q.locked.gross, total: Math.round((amount + q.locked.gross) * 100) / 100, tax: q.locked.tax, provision: q.locked.provision, currency: q.currency, sellerEntityId: seller.entityId, at: new Date().toISOString() };
  }

  private hubOf(id: string, actor: IntrospectionResult) {
    const hub = this.mdps.require(id); // 404 if unknown
    if (!actor?.did || actor.did !== hub.did) throw new GlosError('FORBIDDEN', 'Only the hub can do this, from its own sign-in');
    return hub;
  }
}
