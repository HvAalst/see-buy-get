import { PersistentMap } from '../store/persistent-map';
import { isSandbox } from '../runtime/sandbox';
import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { DidService } from '../did/did.service';
import { OperationalStore } from '../data-firewall/operational-store.service';
import { scopesForRole } from './actor-scopes';
import { AccessToken, ActorRole, IntrospectionResult, IssueTokenInput, TokenClaims } from './auth.types';
import { Tier } from '../data-firewall/data-firewall.types';

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
/** Actor sessions are shift-length: long enough to survive a working day on a flaky network. */
export const SHIFT_TTL_SECONDS = 10 * 60 * 60; // 10h

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
  /**
   * Sign-out counters that do not depend on an operational profile. Only some DIDs have a profile (shops, hubs,
   * fleets, drivers, stores); a PERSON and a COMPANY do not, so bumping "their" profile did nothing and a PIN change
   * could not sign anybody out. Durable: a restart must not quietly bring a signed-out session back.
   */
  private readonly revocations = new PersistentMap<string, number>('auth-revocations');

  constructor(
    private readonly didService: DidService,
    private readonly profiles: OperationalStore,
  ) {
    if (!isSandbox()) {
      // Codes are no longer handed back outside a sandbox, and nothing sends them yet: without an SMS/email sender
      // a person can neither verify a phone nor reset a password. Said at boot, not discovered by a locked-out user.
      this.logger.warn('GLOS_ENV=production: phone codes and password-reset tokens are not returned to callers, and no SMS or email sender is configured — they cannot reach anyone until one is added.');
    }
    if (!this.clientSecret) {
      this.logger.warn(
        isSandbox()
          ? 'GLOS_CLIENT_SECRET is not set — in this sandbox POST /v1/auth/token will mint a token for ANY subject.'
          : 'GLOS_CLIENT_SECRET is not set — POST /v1/auth/token is closed to everyone until it is.',
      );
    }
  }

  /**
   * Gate the public token grant. Constant-time compare; a no-op while no secret is configured
   * (see the boot warning above).
   */
  assertClientCredentials(supplied?: string): void {
    if (!this.clientSecret) {
      // Open on a laptop, so seeds and tests can act as anyone. Anywhere else, no secret means NOBODY may: an open
      // grant would let any browser mint a token for any driver, shop or fleet by naming its DID.
      if (isSandbox()) return;
      throw new UnauthorizedException('The trusted-caller grant is closed: no client secret is configured');
    }
    if (!supplied || !AuthService.safeEqual(supplied, this.clientSecret)) {
      throw new UnauthorizedException('Invalid client credentials');
    }
  }

  issueToken(input: IssueTokenInput): AccessToken {
    const { sub, type, ttlSeconds = DEFAULT_TTL_SECONDS } = input;
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
    const claims: TokenClaims = {
      sub,
      type,
      iat: now,
      exp: now + ttl,
      ver: 1,
      // Actor claims — undefined on a plain machine token, populated by mintActorToken().
      role: input.role,
      did: input.did,
      scopes: input.scopes,
      tenant: input.tenant,
      actorName: input.actorName,
      tier: input.tier,
      personDid: input.personDid,
      tokenVersion: input.tokenVersion,
      revocationKey: input.revocationKey,
      revocationVersion: input.revocationVersion,
    };
    return { access_token: this.sign(claims), token_type: 'Bearer', expires_in: ttl };
  }

  /**
   * Mint an OPERATOR token (role 'operator', the `*` scope). Trusted-caller only: the caller must
   * present the client secret. This is the "ops via script/curl" path the plan defers a UI for — the
   * client secret is the operator trust boundary until a real ops console exists.
   */
  mintOperatorToken(clientSecret?: string): AccessToken {
    this.assertClientCredentials(clientSecret);
    return this.issueToken({ sub: 'glos-operator', type: 'client_credentials', role: 'operator', scopes: ['*'], ttlSeconds: SHIFT_TTL_SECONDS });
  }

  /**
   * An operator token for ONE PERSON — a staff account signed in. Same rights as the shared key's token, plus the
   * two things that token can never have: the name the account was created with, and a key that signs out this
   * person's sessions alone.
   */
  mintOperatorSession(input: { name: string; revocationKey: string }): AccessToken {
    return this.issueToken({
      sub: input.revocationKey,
      type: 'client_credentials',
      role: 'operator',
      scopes: ['*'],
      actorName: input.name,
      revocationKey: input.revocationKey,
      revocationVersion: this.revocations.get(input.revocationKey) ?? 0,
      ttlSeconds: SHIFT_TTL_SECONDS,
    });
  }

  /**
   * Impersonate a participant — mint an actor token for an arbitrary registered DID. Trusted-caller
   * only (client secret). Used by the seed and ops tooling to act AS an entity they provisioned
   * without a password. In dev (no secret configured) this is open, like every grant.
   */
  mintActorTokenFor(clientSecret: string | undefined, input: { role: ActorRole; did: string; tenant?: string; tier?: Tier }): AccessToken {
    this.assertClientCredentials(clientSecret);
    return this.mintActorToken(input);
  }

  /**
   * Mint a shift-length actor token at login. Scopes come from the role vocabulary; tier and the
   * revocation counter come from the actor's OperationalProfile (if any). This is the durable
   * replacement for the ?agent=<did> URL-param "session" — the token now carries who you are and
   * what you may do, verifiably. The DID must already be registered (issueToken enforces it).
   */
  mintActorToken(input: { role: ActorRole; did: string; tenant?: string; tier?: Tier; actorName?: string; revocationKey?: string; personDid?: string }): AccessToken {
    const profile = this.profiles.get(input.did);
    return this.issueToken({
      sub: input.did,
      type: 'did',
      role: input.role,
      did: input.did,
      scopes: scopesForRole(input.role),
      tenant: input.tenant,
      actorName: input.actorName,
      tier: input.tier ?? profile?.tier,
      personDid: input.personDid,
      tokenVersion: this.versionOf(input.did),
      ...(input.revocationKey ? { revocationKey: input.revocationKey, revocationVersion: this.revocations.get(input.revocationKey) ?? 0 } : {}),
      ttlSeconds: SHIFT_TTL_SECONDS,
    });
  }

  /**
   * End every live session of one actor — after a password, PIN or secret changes, the devices still holding the
   * old sign-in must stop working. A token minted AFTER this carries the new version, so the device that made the
   * change can be handed a fresh one and stay in.
   */
  revokeAll(key: string): void {
    this.revocations.set(key, (this.revocations.get(key) ?? 0) + 1);
  }

  /** A DID's sign-out counter: its profile's (shops, fleets, stores…) plus the one kept here (anything at all). */
  private versionOf(did: string): number {
    return (this.profiles.get(did)?.tokenVersion ?? 0) + (this.revocations.get(did) ?? 0);
  }

  introspect(token: string): IntrospectionResult {
    const claims = this.verify(token);
    if (!claims) return { active: false, reason: 'invalid_signature_or_format' };
    if (claims.exp <= Math.floor(Date.now() / 1000)) return { active: false, reason: 'expired' };
    // DID-bound tokens are only active while the DID still resolves.
    if (claims.type === 'did' && !this.didService.exists(claims.sub)) {
      return { active: false, reason: 'did_not_found' };
    }
    // Revocation: if the actor's profile tokenVersion has moved past the token's, it was signed out.
    if (claims.tokenVersion != null && claims.did && this.versionOf(claims.did) > claims.tokenVersion) {
      return { active: false, reason: 'revoked' };
    }
    // …or its own key has: one administrator, or everything a person's PIN opened.
    if (claims.revocationKey && (this.revocations.get(claims.revocationKey) ?? 0) > (claims.revocationVersion ?? 0)) {
      return { active: false, reason: 'revoked' };
    }
    // WHITELIST PROJECTION — every actor field must be copied here or the guard never sees it.
    return {
      active: true,
      sub: claims.sub,
      type: claims.type,
      exp: claims.exp,
      role: claims.role,
      did: claims.did,
      scopes: claims.scopes,
      tenant: claims.tenant,
      actorName: claims.actorName,
      tier: claims.tier,
      personDid: claims.personDid,
    };
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
