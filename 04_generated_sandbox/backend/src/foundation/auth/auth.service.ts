import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { DidService } from '../did/did.service';
import { AccessToken, IntrospectionResult, IssueTokenInput, TokenClaims } from './auth.types';

/** Default lifetime when a caller does not ask for one. */
export const DEFAULT_TTL_SECONDS = 900; // 15 min
/**
 * Hard ceiling for ANY token, including ones minted internally. Participant sessions are
 * shift-length (S2) — deliberately long enough to survive a working day on a flaky network,
 * but never unbounded. Previously a caller could pass ttlSeconds: 999999999.
 */
export const MAX_TTL_SECONDS = 12 * 60 * 60; // 12h
/** Ceiling for the *public* grant, where the TTL is attacker-controlled. */
export const PUBLIC_MAX_TTL_SECONDS = 900; // 15 min

/**
 * AuthService — minimal OAuth 2.1 / OIDC-style token shim (T-006, APIG-011 subset).
 * Issues and verifies compact HMAC-signed tokens (header.payload.signature) using Node
 * crypto — no external JWT dependency. DID-bound tokens are introspected against the DID
 * registry (stand-in for M1), so a token for an unknown/false DID is inactive.
 *
 * The HMAC secret is a sandbox default; production injects a real signing key / HSM.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly secret = process.env.GLOS_AUTH_SECRET || 'glos-dev-secret-change-me';
  /**
   * Shared secret for the public client_credentials grant. When unset the grant stays open so the
   * existing sandbox pages keep working; a loud boot warning marks that as a deployment blocker.
   * The durable fix is S2 — participant login mints an actor-scoped token and no browser calls
   * /auth/token at all. A secret embedded in a public PWA is not a secret.
   */
  private readonly clientSecret = process.env.GLOS_CLIENT_SECRET;

  constructor(private readonly didService: DidService) {
    if (!this.clientSecret) {
      this.logger.warn(
        'GLOS_CLIENT_SECRET is not set — POST /v1/auth/token will mint a token for ANY subject. ' +
          'Set it before deploying anywhere reachable.',
      );
    }
  }

  /**
   * Gate the public token grant. Constant-time compare; a no-op while no secret is configured
   * (see the boot warning above).
   */
  assertClientCredentials(supplied?: string): void {
    if (!this.clientSecret) return;
    if (!supplied || !AuthService.safeEqual(supplied, this.clientSecret)) {
      throw new UnauthorizedException('Invalid client credentials');
    }
  }

  issueToken({ sub, type, ttlSeconds = DEFAULT_TTL_SECONDS }: IssueTokenInput): AccessToken {
    if (!sub || !type) throw new BadRequestException('sub and type are required');
    if (type !== 'client_credentials' && type !== 'did') {
      throw new BadRequestException('type must be "client_credentials" or "did"');
    }
    if (type === 'did' && !this.didService.exists(sub)) {
      throw new BadRequestException(`Unknown DID: ${sub}. Generate it first.`);
    }

    // Hard ceiling — an unbounded caller-supplied lifetime is a permanent credential.
    const ttl = Math.max(60, Math.min(Math.floor(ttlSeconds) || DEFAULT_TTL_SECONDS, MAX_TTL_SECONDS));
    const now = Math.floor(Date.now() / 1000);
    const claims: TokenClaims = { sub, type, iat: now, exp: now + ttl };
    return { access_token: this.sign(claims), token_type: 'Bearer', expires_in: ttl };
  }

  introspect(token: string): IntrospectionResult {
    const claims = this.verify(token);
    if (!claims) return { active: false, reason: 'invalid_signature_or_format' };
    if (claims.exp <= Math.floor(Date.now() / 1000)) return { active: false, reason: 'expired' };
    // DID-bound tokens are only active while the DID still resolves.
    if (claims.type === 'did' && !this.didService.exists(claims.sub)) {
      return { active: false, reason: 'did_not_found' };
    }
    return { active: true, sub: claims.sub, type: claims.type, exp: claims.exp };
  }

  // --- token codec (compact, HMAC-SHA256) ---

  private sign(claims: TokenClaims): string {
    const header = AuthService.b64url(JSON.stringify({ alg: 'HS256', typ: 'GLOS' }));
    const payload = AuthService.b64url(JSON.stringify(claims));
    const signature = this.hmac(`${header}.${payload}`);
    return `${header}.${payload}.${signature}`;
  }

  private verify(token: string): TokenClaims | null {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, payload, signature] = parts;
    const expected = this.hmac(`${header}.${payload}`);
    if (!AuthService.safeEqual(signature, expected)) return null;
    try {
      return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as TokenClaims;
    } catch {
      return null;
    }
  }

  private hmac(data: string): string {
    return createHmac('sha256', this.secret).update(data).digest('base64url');
  }

  private static b64url(value: string): string {
    return Buffer.from(value, 'utf8').toString('base64url');
  }

  private static safeEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
  }
}
