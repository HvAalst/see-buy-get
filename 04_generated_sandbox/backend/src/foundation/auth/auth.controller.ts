import { Body, Controller, Post } from '@nestjs/common';
import { AuthService, PUBLIC_MAX_TTL_SECONDS } from './auth.service';
import { Public } from './public.decorator';
import { AccessToken, ActorRole, GrantType, IntrospectionResult } from './auth.types';
import { Tier } from '../data-firewall/data-firewall.types';

interface TokenDto {
  sub: string;
  type: GrantType;
  ttlSeconds?: number;
  /** Required once GLOS_CLIENT_SECRET is configured. */
  clientSecret?: string;
  /**
   * Trusted-caller extensions (client-secret gated). Ask for an operator token (role 'operator'), or
   * impersonate a participant DID (role + did) — used by the seed and ops scripts, never the browser.
   */
  role?: ActorRole;
  did?: string;
  tenant?: string;
  tier?: Tier;
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
    // Trusted-caller paths (client-secret gated) — operator, or actor impersonation.
    if (body?.role === 'operator') return this.authService.mintOperatorToken(body?.clientSecret);
    if (body?.role && body?.did) {
      return this.authService.mintActorTokenFor(body.clientSecret, { role: body.role, did: body.did, tenant: body.tenant, tier: body.tier });
    }
    // Plain machine token (browser bootstrap / server-to-server), capped hard.
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
