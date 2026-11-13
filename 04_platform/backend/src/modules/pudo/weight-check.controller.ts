import { Body, Controller, Param, Post } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsString, Max, MaxLength, Min } from 'class-validator';
import { Actor } from '../../foundation/auth/actor.decorator';
import { AtTheCounter } from '../../foundation/auth/at-the-counter';
import type { IntrospectionResult } from '../../foundation/auth/auth.types';
import { Roles, Scopes } from '../../foundation/auth/scopes.decorator';
import { GlosError } from '../../foundation/http/glos-error';
import { MdpService } from './mdp.service';
import { ParcelService } from './parcel.service';
import { PersonService } from './person.service';
import type { ParcelWeightFound } from './pudo.types';
import { VendorService } from './vendor.service';
import { WeightCheckService, type WeightCheckView } from './weight-check.service';

/** 2026-11-13 — a parcel weighed on a hub's floor: its weight in kg. */
export class WeighParcelDto {
  @ApiProperty() @IsNumber() @Min(0.01) @Max(1000) kg!: number;
}

/** 2026-11-13 — the sender's side, beside a weight found later. */
export class WeightAnswerDto {
  @ApiProperty() @IsString() @MaxLength(500) text!: string;
}

/**
 * 2026-11-13 — A WEIGHT FOUND LATER, AND THE SENDER'S ANSWER (the owner: "shop and hub tools", T2; weight-check.service.ts). The hub
 * weighs from its own sign-in — its floor's people under their own name; the person who sent it, or the store, answers once.
 */
@Controller('sbg')
export class WeightCheckController {
  constructor(
    private readonly checks: WeightCheckService,
    private readonly mdps: MdpService,
    private readonly parcels: ParcelService,
    private readonly persons: PersonService,
    private readonly vendors: VendorService,
  ) {}

  @Roles('mdp')
  @Post('mdps/:id/parcels/:parcelId/weight')
  @AtTheCounter()
  weighAtHub(@Param('id') id: string, @Param('parcelId') parcelId: string, @Body() dto: WeighParcelDto, @Actor() actor: IntrospectionResult): WeightCheckView {
    const hub = this.mdps.require(id); // 404 if unknown
    if (!actor?.did || actor.did !== hub.did) throw new GlosError('FORBIDDEN', 'Only the hub can do this, from its own sign-in');
    return this.checks.atHub(hub.mdpId, parcelId, dto.kg);
  }

  /** The person who sent it: their side, once. */
  @Roles('consumer')
  @Post('identity/parcels/:id/weight-answer')
  answerAsSender(@Param('id') id: string, @Body() dto: WeightAnswerDto, @Actor() actor: IntrospectionResult): ParcelWeightFound {
    const person = this.persons.requireByDid(actor.did!);
    if (!this.parcels.sentBy(id, person)) throw new GlosError('NOT_FOUND', 'No such parcel');
    return this.checks.answer(id, dto.text);
  }

  /** The store that sent it: its side, once. */
  @Scopes('vendor:manage:self')
  @Post('vendors/:id/orders/:parcelId/weight-answer')
  answerAsStore(@Param('id') id: string, @Param('parcelId') parcelId: string, @Body() dto: WeightAnswerDto, @Actor() actor: IntrospectionResult): ParcelWeightFound {
    const store = this.vendors.get(id); // 404 if unknown
    if (!actor?.did || actor.did !== store.did) throw new GlosError('FORBIDDEN', 'This store is not yours to answer for');
    if (this.parcels.get(parcelId).vendorId !== id) throw new GlosError('NOT_FOUND', 'Order does not belong to this store');
    return this.checks.answer(parcelId, dto.text);
  }
}
