import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Actor } from '../../foundation/auth/actor.decorator';
import type { IntrospectionResult } from '../../foundation/auth/auth.types';
import { Roles } from '../../foundation/auth/scopes.decorator';
import { RateLimit, RateLimitGuard } from '../../foundation/http/rate-limit.guard';
import { DirectPayService } from './direct-pay.service';
import { DirectPayView } from './direct-pay.types';

/**
 * 2026-11-19 — A LOAD'S PRICE, PAID AT THE HANDOVER BY MOLLIE (the payments plan, part 2b). The driver the load is on — or the
 * office of the fleet that is paid for it — sees whether it can be paid that way now, and asks for it: a payment on the
 * carrier's own Mollie account, its page as a QR code for the payer. Looking again asks Mollie about one still open.
 */
@Controller('sbg/dispatch/freight')
export class DirectPayController {
  constructor(private readonly direct: DirectPayService) {}

  @Roles('driver', 'fleet_manager')
  @Get(':id/mollie')
  look(@Param('id') id: string, @Actor() actor: IntrospectionResult): Promise<DirectPayView> {
    return this.direct.look(id, actor);
  }

  @Roles('driver', 'fleet_manager')
  @UseGuards(RateLimitGuard)
  @RateLimit(30, 15 * 60)
  @Post(':id/mollie')
  ask(@Param('id') id: string, @Actor() actor: IntrospectionResult): Promise<DirectPayView> {
    return this.direct.ask(id, actor);
  }
}
