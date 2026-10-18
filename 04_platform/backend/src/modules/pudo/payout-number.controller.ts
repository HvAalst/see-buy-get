import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length, MaxLength } from 'class-validator';
import { Actor } from '../../foundation/auth/actor.decorator';
import { IntrospectionResult } from '../../foundation/auth/auth.types';
import { Roles } from '../../foundation/auth/scopes.decorator';
import { RateLimit, RateLimitGuard } from '../../foundation/http/rate-limit.guard';
import { PayoutNumberService } from './payout-number.service';
import { PayoutCodeSent, PayoutNumberSaved, PayoutNumberView } from './payout-number.types';

export class PayoutNumberCodeDto {
  @ApiProperty({ description: 'The M-Pesa number to be paid to, as the payee writes it: 07XX XXX XXX.' })
  @IsString()
  @MaxLength(40)
  phone: string;
}

export class PayoutNumberConfirmDto {
  @ApiProperty({ description: 'The code texted to that number.' })
  @IsString()
  @Length(4, 10)
  code: string;
}

/**
 * A PAYEE'S OWN PAYOUT NUMBER (payout-number.types.ts), from its own Settings: a courier, a fleet's office, a hub. Staff
 * pass every role check, so the service refuses them by name; they see the number masked on each payout.
 */
@Controller('sbg/payout-number')
export class PayoutNumberController {
  constructor(private readonly numbers: PayoutNumberService) {}

  @Roles('driver', 'fleet_manager', 'mdp', 'agent')
  @Get()
  mine(@Actor() actor: IntrospectionResult): PayoutNumberView {
    return this.numbers.view(actor);
  }

  @Roles('driver', 'fleet_manager', 'mdp')
  @UseGuards(RateLimitGuard)
  @RateLimit(20, 15 * 60)
  @Post('code')
  code(@Body() dto: PayoutNumberCodeDto, @Actor() actor: IntrospectionResult): Promise<PayoutCodeSent> {
    return this.numbers.requestCode(actor, dto.phone);
  }

  @Roles('driver', 'fleet_manager', 'mdp')
  @UseGuards(RateLimitGuard)
  @RateLimit(30, 15 * 60)
  @Post()
  confirm(@Body() dto: PayoutNumberConfirmDto, @Actor() actor: IntrospectionResult): Promise<PayoutNumberSaved> {
    return this.numbers.confirm(actor, dto.code);
  }
}
