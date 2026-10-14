import { Body, Controller, ForbiddenException, Post, Req } from '@nestjs/common';
import { staffNetworkAllows } from './staff-network';
import { AuthService } from './auth.service';
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
   * Trusted-caller extensions (client-secret gated). Ask for the setup key's operator token (role 'operator') —
   * which outside a sandbox only sets network staff up — or, ON A LAPTOP ONLY, a token as a participant
   * (role + did): what the seeder and the tests use. Outside a sandbox the second is refused whatever is presented.
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
   * Issue a token to whoever holds the client secret. OUTSIDE A SANDBOX that is one token only: the setup key's,
   * which sets network staff up and does nothing else. On a laptop it is also a plain machine token, and a token as
   * any participant — what the seeder and the tests run on.
   */
  @Public()
  @Post('token')
  token(@Body() body: TokenDto, @Req() req: { ip?: string }): AccessToken {
    // Trusted-caller paths (client-secret gated): the setup key; and, in a sandbox only, a token as a participant.
    if (body?.role === 'operator') {
      if (!staffNetworkAllows(req?.ip)) throw new ForbiddenException('Staff access is open only from the networks SeeBuyGet staff work on');
      return this.authService.mintOperatorToken(body?.clientSecret);
    }
    if (body?.role && body?.did) {
      return this.authService.mintActorTokenFor(body.clientSecret, { role: body.role, did: body.did, tenant: body.tenant, tier: body.tier });
    }
    // A plain machine token — nobody in particular. On a laptop only: outside a sandbox the secret gets the setup key
    // and no other token.
    return this.authService.mintMachineToken(body?.clientSecret, { sub: body?.sub, type: body?.type, ttlSeconds: body?.ttlSeconds });
  }

  /** Introspect a token (public — RFC 7662 style). */
  @Public()
  @Post('introspect')
  introspect(@Body() body: IntrospectDto): IntrospectionResult {
    return this.authService.introspect(body?.token);
  }
}
