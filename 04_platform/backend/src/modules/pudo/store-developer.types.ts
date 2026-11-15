import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

/** 2026-11-15 — a store's developer, as its owner reads them (the Connect page): never their sign-in links. */
export class StoreDeveloperView {
  devId: string;
  name: string;
  email: string;
  invitedAt: string;
  @ApiPropertyOptional() lastSignInAt?: string;
  @ApiPropertyOptional() removedAt?: string;
}

export class StoreDevelopersResponse {
  @ApiProperty({ type: [StoreDeveloperView] }) items: StoreDeveloperView[];
}

export class InviteStoreDeveloperDto {
  @IsString() @MinLength(2) @MaxLength(60) name!: string;
  @IsEmail() @MaxLength(120) email!: string;
}

/** A developer asks for a fresh sign-in link: the same answer whether or not the address is known. */
export class StoreDeveloperLinkDto {
  @IsEmail() @MaxLength(120) email!: string;
}

export class StoreDeveloperLinkSent {
  sent: boolean;
}

/** The one-time code from a sign-in link, exchanged for a developer's session. */
export class StoreDeveloperSessionDto {
  @IsString() @MinLength(16) @MaxLength(120) code!: string;
}

export class StoreDeveloperSession {
  vendorId: string;
  storeName: string;
  name: string;
  developer: boolean;
  @ApiProperty() token: { access_token: string; expires_in?: number };
}
