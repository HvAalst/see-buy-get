import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Actor } from '../../foundation/auth/actor.decorator';
import type { IntrospectionResult } from '../../foundation/auth/auth.types';
import { Roles } from '../../foundation/auth/scopes.decorator';
import type { Signer } from '../../foundation/entity/same-person';
import { BorderRouteService } from './border-route.service';
import { BorderAirportDto, BorderArrivalView, BorderByDto, BorderCarrierDto, BorderClearerDto, BorderDepartureDto, BorderFeeDto, BorderPricesDto, BorderRouteView, BorderRoutesView, BorderWarehouseDto } from './border-routes.types';
import { staffOf } from './staff-of';

/**
 * 2026-11-18 — PARCELS ACROSS A BORDER ON THE STAFF CONSOLE, STEP 1 (the plan "Parcels across a border", D1–D9 "As
 * recommended"). Every route and what it still needs; two people to switch one on, one to switch it off; and per arrival
 * country its airports (opened or blocked one by one), the customs warehouse agreed at each, who clears there and our fee
 * there. Administration's. A route joins two countries, so only network-wide staff change one; an arrival country's
 * setup is that country's.
 */
@Controller('sbg')
export class BorderRoutesController {
  constructor(private readonly borders: BorderRouteService) {}

  @Roles('operator')
  @Get('border-routes')
  view(@Actor() actor: IntrospectionResult): BorderRoutesView {
    return this.borders.view(reader(actor));
  }

  @Roles('operator')
  @Post('border-routes/:from/:to/propose')
  propose(@Param('from') from: string, @Param('to') to: string, @Body() dto: BorderByDto, @Actor() actor: IntrospectionResult): BorderRouteView {
    return this.borders.propose(from, to, staffOf(actor, dto.by));
  }

  @Roles('operator')
  @Post('border-routes/:from/:to/approve')
  approve(@Param('from') from: string, @Param('to') to: string, @Body() dto: BorderByDto, @Actor() actor: IntrospectionResult): BorderRouteView {
    return this.borders.approve(from, to, staffOf(actor, dto.by));
  }

  @Roles('operator')
  @Post('border-routes/:from/:to/decline')
  decline(@Param('from') from: string, @Param('to') to: string, @Body() dto: BorderByDto, @Actor() actor: IntrospectionResult): BorderRouteView {
    return this.borders.decline(from, to, staffOf(actor, dto.by));
  }

  @Roles('operator')
  @Post('border-routes/:from/:to/off')
  off(@Param('from') from: string, @Param('to') to: string, @Body() dto: BorderByDto, @Actor() actor: IntrospectionResult): BorderRouteView {
    return this.borders.switchOff(from, to, staffOf(actor, dto.by));
  }

  /** 2026-11-18 — step 2a: a route set up before it is proposed, and where it leaves, who carries it, what it costs. */
  @Roles('operator')
  @Post('border-routes/:from/:to')
  prepare(@Param('from') from: string, @Param('to') to: string): BorderRouteView {
    return this.borders.prepare(from, to);
  }

  @Roles('operator')
  @Post('border-routes/:from/:to/departure')
  departure(@Param('from') from: string, @Param('to') to: string, @Body() dto: BorderDepartureDto, @Actor() actor: IntrospectionResult): BorderRouteView {
    return this.borders.setDeparture(from, to, { airport: dto.airport, mdpId: dto.mdpId }, staffOf(actor, dto.by).name);
  }

  @Roles('operator')
  @Post('border-routes/:from/:to/carrier')
  carrier(@Param('from') from: string, @Param('to') to: string, @Body() dto: BorderCarrierDto, @Actor() actor: IntrospectionResult): BorderRouteView {
    return this.borders.setCarrier(from, to, dto.entityId, staffOf(actor, dto.by).name);
  }

  @Roles('operator')
  @Post('border-routes/:from/:to/prices')
  prices(@Param('from') from: string, @Param('to') to: string, @Body() dto: BorderPricesDto, @Actor() actor: IntrospectionResult): BorderRouteView {
    return this.borders.setPrices(from, to, { S: dto.S, M: dto.M, L: dto.L }, staffOf(actor, dto.by).name);
  }

  @Roles('operator')
  @Post('border-arrivals/:country/airports/:airport')
  airport(@Param('country') country: string, @Param('airport') airport: string, @Body() dto: BorderAirportDto, @Actor() actor: IntrospectionResult): BorderArrivalView {
    return this.borders.setAirport(country, airport, dto.open, staffOf(actor, dto.by).name);
  }

  @Roles('operator')
  @Post('border-arrivals/:country/airports/:airport/warehouse')
  warehouse(@Param('country') country: string, @Param('airport') airport: string, @Body() dto: BorderWarehouseDto, @Actor() actor: IntrospectionResult): BorderArrivalView {
    return this.borders.setWarehouse(country, airport, { mdpId: dto.mdpId, tstLicence: dto.tstLicence, agreement: dto.agreement, ...(dto.validUntil ? { validUntil: dto.validUntil } : {}) }, staffOf(actor, dto.by).name);
  }

  @Roles('operator')
  @Post('border-arrivals/:country/clearer')
  clearer(@Param('country') country: string, @Body() dto: BorderClearerDto, @Actor() actor: IntrospectionResult): BorderArrivalView {
    return this.borders.setClearer(country, { kind: dto.kind, ...(dto.entityId ? { entityId: dto.entityId } : {}), ...(dto.registration ? { registration: dto.registration } : {}) }, staffOf(actor, dto.by).name);
  }

  @Roles('operator')
  @Post('border-arrivals/:country/fee')
  fee(@Param('country') country: string, @Body() dto: BorderFeeDto, @Actor() actor: IntrospectionResult): BorderArrivalView {
    return this.borders.setFee(country, dto.amount, staffOf(actor, dto.by).name);
  }
}

/** Who is reading: their account where they have one, so "Approve" is offered by account, not by name. */
function reader(actor: IntrospectionResult | undefined): Signer {
  return { name: actor?.actorName ?? '', ...(actor?.actorName && actor.revocationKey ? { key: actor.revocationKey } : {}) };
}
