import { Body, Controller, Post } from '@nestjs/common';
import { AuthService, PUBLIC_MAX_TTL_SECONDS } from './auth.service';
import { Public } from './public.decorator';
import { AccessToken, GrantType, IntrospectionResult } from './auth.types';

interface TokenDto {
  sub: string;
  type: GrantType;
  ttlSeconds?: number;
  /** Required once GLOS_CLIENT_SECRET is configured. */
  clientSecret?: string;
}

interface IntrospectDto {
  token: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * Issue an access token (public — this is how machine callers obtain credentials).
   * The caller-supplied TTL is capped hard here: on this grant the lifetime is attacker-controlled.
   */
  @Public()
  @Post('token')
  token(@Body() body: TokenDto): AccessToken {
    this.authService.assertClientCredentials(body?.clientSecret);
    return this.authService.issueToken({
      sub: body?.sub,
      type: body?.type,
      ttlSeconds: Math.min(body?.ttlSeconds ?? PUBLIC_MAX_TTL_SECONDS, PUBLIC_MAX_TTL_SECONDS),
    });
  }

  /** Introspect a token (public — RFC 7662 style). */
  @Public()
  @Post('introspect')
  introspect(@Body() body: IntrospectDto): IntrospectionResult {
    return this.authService.introspect(body?.token);
  }
}
