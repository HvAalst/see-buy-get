import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNumber, IsOptional, IsPositive, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * A member of staff confirming a payment they can see on a bank statement.
 *
 * `providerRef` is REQUIRED and is the point of the whole form: it is the statement line, the M-Pesa code,
 * the transfer reference — the thing somebody can go and look at afterwards. Without it this route would
 * be the shop's own word wearing a staff badge, which is the exact arrangement this work replaced.
 */
export class ConfirmFundingDto {
  @ApiProperty({ description: "The payment's own reference on the statement or provider receipt — the thing an auditor can look up." })
  @IsString()
  @MinLength(3)
  @MaxLength(80)
  providerRef: string;

  @ApiProperty({ description: 'What actually arrived. The rail is the authority on this, never what was asked for.' })
  @IsNumber()
  @IsPositive()
  amount: number;

  @ApiPropertyOptional({ description: 'Which rail carried it, if it was not a plain bank transfer.' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  provider?: string;

  @ApiPropertyOptional({ description: 'What the provider took to move it. Our expense — never netted off the payer’s credit.' })
  @IsOptional()
  @IsNumber()
  fee?: number;
}

/**
 * The sandbox standing in for the provider — and the one extra thing it can do.
 *
 * `reference` overrides what the payer is pretended to have quoted, so a demo can produce the case that
 * actually happens at a counter: somebody types the reference wrong, or leaves it blank, and real money
 * arrives that we cannot attribute to anybody. That is the state the operator console's unmatched list
 * exists for, and a sandbox with no way to reach it is a screen nobody has ever seen working.
 *
 * Deliberately NOT on ConfirmFundingDto: letting a member of staff confirm one request against another's
 * reference is the beginning of crediting the wrong shop.
 */
export class SimulateFundingDto extends ConfirmFundingDto {
  @ApiPropertyOptional({ description: 'Pretend the payer quoted this instead — an empty string means they quoted none. SANDBOX ONLY.' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  reference?: string;
}

/**
 * Whose the unattributed payment was.
 *
 * Both fields required, and no defaulting to "agent": a shop's float and a store's prepaid balance are
 * different liabilities of ours, and guessing which one a bare id belongs to is how a payment ends up on
 * the wrong book.
 */
export class ApplyFundingDto {
  @ApiProperty({ enum: ['agent', 'vendor'], description: 'A shop (agent) or a store (vendor).' })
  @IsIn(['agent', 'vendor'])
  payerKind: 'agent' | 'vendor';

  @ApiProperty({ description: 'The shop’s DID or the store’s id — chosen from a list, never typed.' })
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  payerDid: string;

  @ApiPropertyOptional({ description: 'The person deciding. Recorded on the payment, because this is a judgement.' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  by?: string;
}

/** Why a funding request failed, expired or was reversed. Always in words somebody can act on. */
export class FundingFailureDto {
  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  reason: string;
}

/** What a shop or a store is asking to pay in. The amount is a request, not a movement. */
export class OpenFundingDto {
  @ApiProperty({ description: 'How much they intend to pay in.' })
  @IsNumber()
  @IsPositive()
  amount: number;
}
