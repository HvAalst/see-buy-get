import { IsNumber, IsObject, IsOptional, IsPositive, IsString } from 'class-validator';

export class CashOutDto {
  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  destination?: string;
}

export class CreditDto {
  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsOptional()
  @IsString()
  currency?: string;
}

export class SettlementTriggerDto {
  @IsObject()
  trigger!: Record<string, unknown>;
}

export class BankLinkVerifyDto {
  @IsString()
  challengeId!: string;

  @IsNumber()
  amount1!: number;

  @IsNumber()
  amount2!: number;
}

export class WithdrawalDto {
  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  destination?: string;

  @IsOptional()
  @IsString()
  requestedBy?: string;
}

export class ApproveDto {
  @IsString()
  adminId!: string;
}
