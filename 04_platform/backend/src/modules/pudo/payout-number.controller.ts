import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { CODE_WAYS, CodeWay } from '../../foundation/sms/code-routes.types';
import { Actor } from '../../foundation/auth/actor.decorator';
import { IntrospectionResult } from '../../foundation/auth/auth.types';
import { Roles } from '../../foundation/auth/scopes.decorator';
import { RateLimit, RateLimitGuard } from '../../foundation/http/rate-limit.guard';
import { PayoutNumberService } from './payout-number.service';
import { PayoutBankDto, PayoutCodeSent, PayoutNumberSaved, PayoutNumberView } from './payout-number.types';

export class PayoutNumberCodeDto {
  @ApiProperty({ description: 'The M-Pesa number to be paid to, as the payee writes it: 07XX XXX XXX.' })
  @IsString()
  @MaxLength(40)
  phone: string;

  /** 2026-11-16 — the way the payee chose for the code: by text, or an app offered for that number. */
  @ApiPropertyOptional({ enum: CODE_WAYS })
  @IsOptional()
  @IsIn(CODE_WAYS)
  via?: CodeWay;
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

  @Roles('driver', 'fleet_manager', 'mdp', 'agent')
  @UseGuards(RateLimitGuard)
  @RateLimit(20, 15 * 60)
  @Post('code')
  code(@Body() dto: PayoutNumberCodeDto, @Actor() actor: IntrospectionResult): Promise<PayoutCodeSent> {
    return this.numbers.requestCode(actor, dto.phone, Date.now(), dto.via);
  }

  @Roles('driver', 'fleet_manager', 'mdp', 'agent')
  @UseGuards(RateLimitGuard)
  @RateLimit(30, 15 * 60)
  @Post()
  confirm(@Body() dto: PayoutNumberConfirmDto, @Actor() actor: IntrospectionResult): Promise<PayoutNumberSaved> {
    return this.numbers.confirm(actor, dto.code);
  }

  /**
   * Route plan part 4 — the payee's own bank account, where its partner pays to bank accounts (the European Union). No code: the
   * payee is signed in as itself, and a change pauses payouts for a day.
   */
  @Roles('driver', 'fleet_manager', 'mdp', 'agent')
  @UseGuards(RateLimitGuard)
  @RateLimit(10, 15 * 60)
  @Post('bank')
  bank(@Body() dto: PayoutBankDto, @Actor() actor: IntrospectionResult): PayoutNumberSaved {
    return this.numbers.setBank(actor, dto);
  }
}
