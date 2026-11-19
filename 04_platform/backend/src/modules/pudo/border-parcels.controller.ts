import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsNumber, IsOptional, IsString, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import { PersonService } from './person.service';
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

export const ABROAD_STEPS = ['to_hand', 'coming', 'customs', 'held', 'given_up'] as const;
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
  /** 2026-11-19 — not paid in time, its sender named someone else there to take it (D19). */
  @ApiPropertyOptional() someoneElse?: boolean;
}

export class AbroadAtHubView {
  @ApiProperty({ type: [AbroadParcelRow] }) rows: AbroadParcelRow[];
}

export class HandToCarrierDto {
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @IsString({ each: true }) parcelIds!: string[];
  /** The carrier's reference for them: the number on its air waybill or consignment note. */
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(60) reference!: string;
}

/** 2026-11-19 — what a held parcel's sender chooses once its day to pay has passed (D19). */
export class AbroadChoiceDto {
  @ApiProperty({ enum: ['someone_else', 'give_up'] }) @IsIn(['someone_else', 'give_up']) choice!: 'someone_else' | 'give_up';
  /** Someone else: the new receiver's phone number, in the destination country. */
  @ApiPropertyOptional() @ValidateIf((o: AbroadChoiceDto) => o.choice === 'someone_else') @IsString() @MinLength(6) @MaxLength(20) receiverMobile?: string;
}

export class CustomsOutcomeDto {
  @ApiProperty({ enum: ['released', 'held'] }) @IsIn(['released', 'held']) outcome!: 'released' | 'held';
  /** Held: what customs asks to be paid, in the arrival country's money. */
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0.01) amount?: number;
  /** Customs' reference, as on their notice — needed when held. */
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) reference?: string;
}

/**
 * 2026-11-19 — WHAT THE RECEIVER OWES US (step 3; D12, D18): our clearance fee in the arrival country, and the last leg from the
 * warehouse to their shop as that country's company prices it — fixed when customs decides, paid at collection. Whoever records
 * customs' decision — the warehouse, or the clearing agent (step 4) — fixes it the same way.
 */
export function dueOf(p: Parcel, deps: { routing: RoutingService; borders: BorderRouteService; entities: EntityService }): NonNullable<ParcelBorder['due']> {
  const b = p.border!;
  const seller = deps.entities.forJurisdiction(b.to);
  if (!seller) throw new GlosError('INVALID_STATE', `No company of ours stands in ${b.to} to price the last leg`);
  const q = deps.routing.quoteShipmentFrom(deps.routing.hubEnd(b.arrival.mdpId), p.destAgentDid!, p.size, seller.entityId, undefined, { consumer: true, kg: p.weightKg });
  const fee = deps.borders.feeIn(b.to);
  if (fee && fee.currency !== q.currency) throw new GlosError('INVALID_STATE', `The clearance fee is in ${fee.currency} and the last leg in ${q.currency}`);
  const amount = fee?.amount ?? 0;
  return { fee: amount, lastLeg: q.locked.gross, total: Math.round((amount + q.locked.gross) * 100) / 100, tax: q.locked.tax, provision: q.locked.provision, currency: q.currency, sellerEntityId: seller.entityId, at: new Date().toISOString() };
}

/** A parcel abroad, as the hub reads it. */
export function abroadRow(p: Parcel): AbroadParcelRow {
  const b = p.border!;
  const c = b.clearance;
  const step: AbroadStep = c?.decision?.choice === 'give_up' ? 'given_up' : !b.handed ? 'to_hand' : !b.arrived ? 'coming' : c?.outcome === 'held' ? 'held' : 'customs';
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
    ...(c?.decision?.choice === 'someone_else' ? { someoneElse: true } : {}),
    ...(c?.outcome === 'held' && inCustoms(p) ? { held: { amount: c.amount ?? 0, currency: c.currency ?? '', reference: c.reference ?? '', ...(c.payee ? { payee: c.payee } : {}), ...(c.payBy ? { payBy: c.payBy } : {}), ...(c.lapsedAt ? { lapsed: true } : {}) } } : {}),
  };
}

@Controller('sbg')
export class BorderParcelsController {
  constructor(
    private readonly mdps: MdpService,
    private readonly parcels: ParcelService,
    // 2026-11-19 — step 3: what the receiver owes us, priced by the arrival company; who duty is paid to.
    readonly routing: RoutingService,
    readonly borders: BorderRouteService,
    readonly entities: EntityService,
    // 2026-11-19 — the sender of a held parcel not paid in time chooses from the Send app (D19).
    private readonly persons: PersonService,
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

  /** 2026-11-19 — a parcel its sender gave up, handed to customs to dispose of (D19): no longer ours. */
  @Roles('mdp')
  @Post('mdps/:id/abroad/:parcelId/dispose')
  @AtTheCounter()
  dispose(@Param('id') id: string, @Param('parcelId') parcelId: string, @Actor() actor: IntrospectionResult): AbroadParcelRow {
    const hub = this.hubOf(id, actor);
    return abroadRow(this.parcels.handToCustomsForDisposal(parcelId, hub));
  }

  /**
   * 2026-11-19 — THE SENDER'S CHOICE FOR A HELD PARCEL NOT PAID IN TIME (D19, D20): someone else in the destination country takes
   * it — who pays, besides our fee and the last leg, the warehouse days and the extra handling as the arrival company set them —
   * or it is given up. From the Send app, its sender only.
   */
  @Roles('consumer')
  @Post('identity/parcels/:id/abroad-choice')
  choose(@Param('id') id: string, @Body() dto: AbroadChoiceDto, @Actor() actor: IntrospectionResult) {
    const person = this.persons.requireByDid(actor.did!);
    const p = this.parcels.get(String(id).trim().toUpperCase());
    if (dto.choice === 'give_up') {
      this.parcels.decideLapsed(p.parcelId, person, { choice: 'give_up' });
    } else {
      const b = p.border;
      const fees = b ? this.borders.readdressIn(b.to) : undefined;
      if (fees && b?.due && fees.currency !== b.due.currency) throw new GlosError('INVALID_STATE', `The warehouse fees are in ${fees.currency} and what is owed in ${b.due.currency}`);
      const days = b?.arrived ? Math.max(1, Math.ceil((Date.now() - Date.parse(b.arrived.at)) / 86_400_000)) : 0;
      this.parcels.decideLapsed(p.parcelId, person, { choice: 'someone_else', receiverMobile: dto.receiverMobile ?? '' }, { storage: days * (fees?.storagePerDay ?? 0), handling: fees?.handlingFee ?? 0 });
    }
    return this.parcels.consumerParcel(p.parcelId, person);
  }

  /** 2026-11-19 — a held parcel's duty paid to the clearing agent, and customs released it (D17): it goes on. */
  @Roles('mdp')
  @Post('mdps/:id/abroad/:parcelId/paid')
  @AtTheCounter()
  paid(@Param('id') id: string, @Param('parcelId') parcelId: string, @Actor() actor: IntrospectionResult): AbroadParcelRow {
    const hub = this.hubOf(id, actor);
    return abroadRow(this.parcels.confirmDutyPaid(parcelId, hub));
  }

  private dueFor(p: Parcel): NonNullable<ParcelBorder['due']> {
    return dueOf(p, this);
  }

  private hubOf(id: string, actor: IntrospectionResult) {
    const hub = this.mdps.require(id); // 404 if unknown
    if (!actor?.did || actor.did !== hub.did) throw new GlosError('FORBIDDEN', 'Only the hub can do this, from its own sign-in');
    return hub;
  }
}
