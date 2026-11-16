import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { CODE_ROUTES, CodeRouteId } from '../../foundation/sms/code-routes.types';

/** 2026-11-16 — the order a country's routes are tried in: every route, once each. */
export class CodeRouteOrderDto {
  @ApiProperty({ enum: CODE_ROUTES, isArray: true })
  @IsArray() @ArrayMaxSize(10) @IsIn(CODE_ROUTES, { each: true }) order!: CodeRouteId[];
  /** Who is at the keyboard, where the sign-in cannot say (a sandbox's shared key). */
  @IsOptional() @IsString() @MaxLength(80) by?: string;
}

/** 2026-11-16 — a route switched on or off in one country. */
export class CodeRouteOnDto {
  @IsBoolean() on!: boolean;
  @IsOptional() @IsString() @MaxLength(80) by?: string;
}
