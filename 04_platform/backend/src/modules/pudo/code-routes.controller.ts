import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Actor } from '../../foundation/auth/actor.decorator';
import type { IntrospectionResult } from '../../foundation/auth/auth.types';
import { Roles } from '../../foundation/auth/scopes.decorator';
import { CodeRouteService } from '../../foundation/sms/code-route.service';
import { CodeRouteId, CodeRoutesView, CountryCodeRoutes } from '../../foundation/sms/code-routes.types';
import { CodeRouteOnDto, CodeRouteOrderDto } from './code-routes.dto';
import { staffOf } from './staff-of';

/**
 * 2026-11-16 — SIGN-IN CODES ON THE STAFF CONSOLE (the owner: "Can we build it in a way that it becomes visual and
 * controlable from the staff console? If so, we implement."). Every route a code may go by, whether it is set up, and per
 * country the order they are tried in, which are switched off, the one codes go by now and the last seven days' counts;
 * staff set the order and switch a route off or on, named, and each change is kept with who made it. Administration's.
 */
@Controller('sbg/code-routes')
export class CodeRoutesController {
  constructor(private readonly routes: CodeRouteService) {}

  @Roles('operator')
  @Get()
  view(): CodeRoutesView {
    return this.routes.view();
  }

  @Roles('operator')
  @Post(':country/order')
  order(@Param('country') country: string, @Body() dto: CodeRouteOrderDto, @Actor() actor: IntrospectionResult): CountryCodeRoutes {
    return this.routes.setOrder(country, dto.order, staffOf(actor, dto.by).name);
  }

  @Roles('operator')
  @Post(':country/routes/:route')
  onOff(@Param('country') country: string, @Param('route') route: string, @Body() dto: CodeRouteOnDto, @Actor() actor: IntrospectionResult): CountryCodeRoutes {
    return this.routes.setOn(country, route as CodeRouteId, dto.on, staffOf(actor, dto.by).name);
  }
}
