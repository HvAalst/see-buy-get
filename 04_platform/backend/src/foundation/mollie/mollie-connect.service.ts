import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { FieldEncryption } from '../data-firewall/field-encryption.service';
import { GlosError } from '../http/glos-error';
import { refused } from '../../modules/pudo/notice-words/refuse';
import { said } from '../../modules/pudo/notice-words/say';
import { isSandbox } from '../runtime/sandbox';
import { PersistentMap } from '../store/persistent-map';
import { customsUnionOf } from '../countries/customs-union';
import { MollieClient, MollieError, type FetchLike } from './mollie-client';
import { directPayWayOf, type MollieConfig, type MollieConnectedView, type MollieConnection, type MollieConnectionView, type MollieConnectStarted, type MolliePayee, type MollieReturn, type MollieVia, MOLLIE_PARTNER_SCOPES, MolliePartnerView, type MollieBackTo, type MolliePartnerChange } from './mollie.types';

export const MOLLIE_CONFIG = 'MOLLIE_CONFIG';
export const MOLLIE_FETCH = 'MOLLIE_FETCH';

/** How long a sign-in at Mollie may take: Mollie's own code lasts thirty seconds once given; the person may take longer. */
export const MOLLIE_STATE_TTL_MS = 10 * 60_000;
/** An access token lasts an hour; it is renewed this long before, so a payment never goes out on one about to lapse. */
const RENEW_BEFORE_MS = 5 * 60_000;
/** What Mollie says of an account's readiness is asked again when it is older than this. */
const CHECK_EVERY_MS = 60 * 60_000;

/**
 * THE SERVER'S SETTINGS FOR MOLLIE (the owner puts them in the server's .env; never in a chat). A live key is never taken as
 * the test key, and a stand-in host never outside a sandbox: either would send real money somewhere it was not meant to go.
 */
export function mollieConfigFromEnv(env: NodeJS.ProcessEnv, logger?: Logger): MollieConfig {
  const text = (v?: string) => (v && v.trim() ? v.trim() : undefined);
  const testKey = text(env.GLOS_MOLLIE_TEST_KEY);
  if (testKey && !testKey.startsWith('test_')) logger?.error('GLOS_MOLLIE_TEST_KEY is not a test key (test_…): it is not used');
  const ownKey = text(env.GLOS_MOLLIE_API_KEY);
  const ownOk = Boolean(ownKey && (ownKey.startsWith('test_') || (ownKey.startsWith('live_') && !isSandbox())));
  if (ownKey && !ownOk) logger?.error(ownKey.startsWith('live_') ? 'GLOS_MOLLIE_API_KEY is a live key: it is not used in a sandbox' : 'GLOS_MOLLIE_API_KEY is not a Mollie API key (live_… or test_…): it is not used');
  const host = text(env.GLOS_MOLLIE_HOST);
  if (host && !isSandbox()) logger?.error('GLOS_MOLLIE_HOST is a stand-in for Mollie: it is not used outside a sandbox');
  return {
    clientId: text(env.GLOS_MOLLIE_CLIENT_ID),
    clientSecret: text(env.GLOS_MOLLIE_CLIENT_SECRET),
    ...(testKey?.startsWith('test_') ? { testKey } : {}),
    ...(ownOk ? { ownKey } : {}),
    testmode: (env.GLOS_MOLLIE_LIVE ?? '').trim().toLowerCase() !== 'true',
    publicBase: text(env.SBG_PUBLIC_URL)?.replace(/\/+$/, ''),
    ...(host && isSandbox() ? { host: host.replace(/\/+$/, '') } : {}),
    ...(['on', 'true', '1'].includes((env.GLOS_MOLLIE_ROUTING ?? '').trim().toLowerCase()) ? { routing: true } : {}),
  };
}

/**
 * A CARRIER'S OWN MOLLIE ACCOUNT, CONNECTED (the payments plan, part 2). Through the Connect app, the carrier signs in at
 * Mollie and gives SeeBuyGet leave to make payments into its account; its tokens are kept sealed, renewed before they lapse,
 * and given back when it disconnects. Before the Connect app exists, our own test key stands in, for test money only.
 *
 * Whose account it is, and in which country, is the caller's to say (MolliePayee): this keeps the connection, not the rule
 * of who is paid for a load.
 */
@Injectable()
export class MollieConnectService {
  private readonly logger = new Logger('Mollie');
  readonly cfg: MollieConfig;
  private readonly client: MollieClient;
  private readonly connections = new PersistentMap<string, MollieConnection>('mollie-connections');
  private readonly states = new PersistentMap<string, { payeeId: string; by: string; back: MollieBackTo; at: string }>('mollie-oauth-states');
  /** 2026-11-26 — whoever is told when a partner's Mollie account is connected or disconnected (its members; our staff's checks). */
  private readonly partnerListeners: Array<(c: MolliePartnerChange) => void> = [];

  constructor(
    @Optional() private readonly crypt?: FieldEncryption,
    @Optional() @Inject(MOLLIE_CONFIG) cfg?: MollieConfig,
    @Optional() @Inject(MOLLIE_FETCH) fetchImpl?: FetchLike,
  ) {
    this.cfg = cfg ?? mollieConfigFromEnv(process.env, this.logger);
    this.client = new MollieClient(this.cfg, fetchImpl);
  }

  /** How a carrier is connected on this server: the Connect app where it is set up with the site's address, else the test key. */
  via(): MollieVia | undefined {
    if (this.cfg.clientId && this.cfg.clientSecret && this.cfg.publicBase) return 'oauth';
    if (this.cfg.testKey) return 'test_key';
    return undefined;
  }

  /**
   * 2026-11-21 — OUR OWN COMPANY'S ACCOUNT (the payments plan, 5a): its API key, or the test key standing in for test money;
   * null where neither is set. A payment made with a key is test or live by the key itself.
   */
  ownToken(): { bearer: string; testmode: boolean } | null {
    if (this.cfg.ownKey) return { bearer: this.cfg.ownKey, testmode: this.cfg.ownKey.startsWith('test_') };
    if (this.cfg.testKey) return { bearer: this.cfg.testKey, testmode: true };
    return null;
  }

  /** The client, for whoever makes and reads payments on a connection. */
  api(): MollieClient {
    return this.client;
  }

  view(payee: MolliePayee, now: number = Date.now()): MollieConnectionView {
    if (directPayWayOf(payee.country) !== 'mollie') return { available: false, why: 'country' };
    if ('notPayee' in payee) return { available: false, why: 'fleet' };
    const via = this.via();
    if (!via) return { available: false, why: 'off' };
    const c = this.connections.get(payee.payeeId);
    if (c?.via === 'oauth' && !c.lostAt && (!c.checkedAt || now - Date.parse(c.checkedAt) > CHECK_EVERY_MS)) void this.check(payee.payeeId, now);
    return { available: true, via, ...(c ? { connected: viewOf(c) } : {}), ...(this.cfg.routing && via === 'oauth' ? { paysLoads: true } : {}) };
  }

  connection(payeeId: string): MollieConnection | undefined {
    return this.connections.get(payeeId);
  }

  /** Through the Connect app: Mollie's sign-in, with a state only we know. With our test key: connected at once. */
  connect(payee: MolliePayee, now: number = Date.now()): MollieConnectStarted {
    const p = this.requirePayee(payee);
    const via = this.via();
    if (!via) throw refused('INVALID_STATE', said('refuse.mollie.notSetUp'));
    if (via === 'test_key') {
      const c: MollieConnection = { payeeId: p.payeeId, via, testmode: true, connectedAt: new Date(now).toISOString(), connectedBy: p.by };
      this.connections.set(p.payeeId, c);
      return { connected: viewOf(c) };
    }
    this.prune(now);
    const state = randomBytes(24).toString('base64url');
    this.states.set(state, { payeeId: p.payeeId, by: p.by, back: p.back, at: new Date(now).toISOString() });
    return { url: this.client.authorizeUrl(state) };
  }

  /* ------------------------------------------------------------ a partner's own account -- */

  /**
   * 2026-11-26 — A PARTNER'S OWN MOLLIE ACCOUNT, FOR THE MONEY ITS COUNTERS TAKE (the weakness after route plan part 4b, fixed as
   * recommended): in a country of the European Union, a sender pays at a partner's shop by a Mollie page opened from a QR code, into
   * the partner's own account. Connected by the partner's own people, in the Partner app, through the same Connect app — asked for
   * refunds too, so a parcel voided after it was paid goes back to the card it was paid from. Kept under the partner company's id.
   */
  partnerView(entityId: string, country: string | undefined, now: number = Date.now()): MolliePartnerView {
    if (customsUnionOf(country) !== 'EU') return { available: false, why: 'country' };
    const via = this.via();
    if (!via) return { available: false, why: 'off' };
    const c = this.connections.get(entityId);
    if (c?.via === 'oauth' && !c.lostAt && (!c.checkedAt || now - Date.parse(c.checkedAt) > CHECK_EVERY_MS)) void this.check(entityId, now);
    return { available: true, via, ...(c ? { connected: viewOf(c) } : {}) };
  }

  /** 2026-11-26 — be told when a partner's Mollie account is connected or disconnected. */
  onPartnerChange(listener: (c: MolliePartnerChange) => void): void {
    this.partnerListeners.push(listener);
  }

  private toldPartner(c: MolliePartnerChange): void {
    for (const l of this.partnerListeners) {
      try {
        l(c);
      } catch (err) {
        this.logger.warn(`a partner's Mollie change could not be told: ${(err as Error).message}`);
      }
    }
  }

  /** Mollie's sign-in for the partner, back to the Partner app; with our test key, connected at once (test money). */
  connectPartner(entityId: string, country: string | undefined, by: string, now: number = Date.now()): MollieConnectStarted {
    if (customsUnionOf(country) !== 'EU') throw refused('FORBIDDEN', said('refuse.mollie.euOnly'));
    if (!by?.trim()) throw refused('FIELD_REQUIRED', said('refuse.mollie.whoConnects'));
    const via = this.via();
    if (!via) throw refused('INVALID_STATE', said('refuse.mollie.notSetUp'));
    if (via === 'test_key') {
      const c: MollieConnection = { payeeId: entityId, via, testmode: true, connectedAt: new Date(now).toISOString(), connectedBy: by.trim() };
      this.connections.set(entityId, c);
      this.toldPartner({ entityId, change: 'connected', by: c.connectedBy, at: c.connectedAt });
      return { connected: viewOf(c) };
    }
    this.prune(now);
    const state = randomBytes(24).toString('base64url');
    this.states.set(state, { payeeId: entityId, by: by.trim(), back: 'partner', at: new Date(now).toISOString() });
    return { url: this.client.authorizeUrl(state, MOLLIE_PARTNER_SCOPES) };
  }

  /** Disconnected by the partner: the leave given back to Mollie, the connection forgotten. Its counters take test money again. */
  async disconnectPartner(entityId: string, country: string | undefined, by: string, now: number = Date.now()): Promise<MolliePartnerView> {
    const c = this.connections.get(entityId);
    if (c?.via === 'oauth' && c.refreshToken) await this.client.revoke(this.open(c.refreshToken), 'refresh_token').catch(() => undefined);
    this.connections.delete(entityId);
    if (c) this.toldPartner({ entityId, change: 'disconnected', by, ...(c.organization ? { organization: c.organization } : {}), at: new Date(now).toISOString() });
    return this.partnerView(entityId, country);
  }

  /**
   * BACK FROM MOLLIE'S SIGN-IN: the code exchanged for tokens, the account's profile chosen (a verified one before one that
   * can only take test payments), its company and readiness read, and all of it kept. A state is good once, for ten minutes.
   */
  async finish(q: { code?: string; state?: string; error?: string }, now: number = Date.now()): Promise<MollieReturn> {
    const s = q.state ? this.states.get(q.state) : undefined;
    if (q.state) this.states.delete(q.state);
    if (!s || now - Date.parse(s.at) > MOLLIE_STATE_TTL_MS) return { back: s?.back ?? 'driver', outcome: 'failed', why: 'expired' };
    if (q.error || !q.code) return { back: s.back, outcome: 'failed', why: q.error === 'access_denied' ? 'denied' : 'failed' };
    try {
      const tokens = await this.client.exchangeCode(q.code);
      const profiles = await this.client.profiles(tokens.accessToken);
      const profile = profiles.find((p) => p.status === 'verified') ?? profiles.find((p) => p.status !== 'blocked');
      if (!profile) {
        await this.client.revoke(tokens.refreshToken ?? tokens.accessToken, tokens.refreshToken ? 'refresh_token' : 'access_token').catch(() => undefined);
        return { back: s.back, outcome: 'failed', why: 'no_profile' };
      }
      const organization = await this.client.organization(tokens.accessToken).catch(() => undefined);
      const ready = await this.client.onboarding(tokens.accessToken).catch(() => undefined);
      this.connections.set(s.payeeId, {
        payeeId: s.payeeId,
        via: 'oauth',
        ...(organization?.id ? { organization } : {}),
        profileId: profile.id,
        profileName: profile.name,
        accessToken: this.seal(tokens.accessToken),
        ...(tokens.refreshToken ? { refreshToken: this.seal(tokens.refreshToken) } : {}),
        accessExpiresAt: new Date(now + tokens.expiresIn * 1000).toISOString(),
        ...(tokens.scope ? { scope: tokens.scope } : {}),
        testmode: this.cfg.testmode,
        connectedAt: new Date(now).toISOString(),
        connectedBy: s.by,
        ...(ready?.canReceivePayments !== undefined ? { canReceivePayments: ready.canReceivePayments } : {}),
        ...(ready?.status ? { onboarding: ready.status } : {}),
        ...(ready?.dashboardUrl ? { dashboardUrl: ready.dashboardUrl } : {}),
        checkedAt: new Date(now).toISOString(),
      });
      if (s.back === 'partner') this.toldPartner({ entityId: s.payeeId, change: 'connected', by: s.by, ...(organization?.id ? { organization } : {}), at: new Date(now).toISOString() });
      return { back: s.back, outcome: 'connected' };
    } catch (err) {
      this.logger.warn(`a Mollie sign-in could not be finished: ${(err as Error).message}`);
      return { back: s.back, outcome: 'failed', why: 'failed' };
    }
  }

  /** Where the carrier's app takes it back to, with how it ended — a code the app says in words, never Mollie's own text. */
  backTo(r: MollieReturn): string {
    const base = this.cfg.publicBase ?? '';
    return `${base}/${r.back}/?mollie=${r.outcome}${r.outcome === 'failed' ? `&why=${r.why}` : ''}`;
  }

  /** Disconnected: the leave given back to Mollie (as far as it answers), and the connection forgotten here. */
  async disconnect(payee: MolliePayee): Promise<MollieConnectionView> {
    const p = this.requirePayee(payee);
    const c = this.connections.get(p.payeeId);
    if (c?.via === 'oauth' && c.refreshToken) await this.client.revoke(this.open(c.refreshToken), 'refresh_token').catch(() => undefined);
    this.connections.delete(p.payeeId);
    return this.view(payee);
  }

  /**
   * THE TOKEN A PAYMENT GOES OUT ON — renewed before it lapses. A refused renewal means the carrier took the app's access away
   * on Mollie's side: the connection is marked lost, and it is connected again from Settings.
   */
  async tokenFor(payeeId: string, now: number = Date.now()): Promise<{ bearer: string; via: MollieVia; testmode: boolean; profileId?: string }> {
    const c = this.connections.get(payeeId);
    if (!c) throw refused('INVALID_STATE', said('refuse.mollie.noneConnected'));
    if (c.via === 'test_key') {
      if (!this.cfg.testKey) throw refused('INVALID_STATE', said('refuse.mollie.testKeyGone'));
      return { bearer: this.cfg.testKey, via: 'test_key', testmode: true };
    }
    if (c.lostAt) throw refused('INVALID_STATE', said('refuse.mollie.tookBackAccess'));
    if (c.accessToken && c.accessExpiresAt && Date.parse(c.accessExpiresAt) - now > RENEW_BEFORE_MS) {
      return { bearer: this.open(c.accessToken), via: 'oauth', testmode: c.testmode, profileId: c.profileId };
    }
    if (!c.refreshToken) throw refused('INVALID_STATE', said('refuse.mollie.connectAgain'));
    try {
      const t = await this.client.refresh(this.open(c.refreshToken));
      const next: MollieConnection = { ...c, accessToken: this.seal(t.accessToken), ...(t.refreshToken ? { refreshToken: this.seal(t.refreshToken) } : {}), accessExpiresAt: new Date(now + t.expiresIn * 1000).toISOString() };
      this.connections.set(payeeId, next);
      return { bearer: t.accessToken, via: 'oauth', testmode: c.testmode, profileId: c.profileId };
    } catch (err) {
      if (err instanceof MollieError && (err.code === 'invalid_grant' || err.status === 401)) {
        this.connections.set(payeeId, { ...c, lostAt: new Date(now).toISOString() });
        throw refused('INVALID_STATE', said('refuse.mollie.tookBackAccess'));
      }
      throw err instanceof GlosError ? err : refused('PROVIDER_UNAVAILABLE', said('refuse.mollie.didNotAnswer'));
    }
  }

  /** What Mollie says of the account's readiness, asked again now and then: whether it can take payments yet. */
  private async check(payeeId: string, now: number): Promise<void> {
    const c = this.connections.get(payeeId);
    if (!c) return;
    this.connections.set(payeeId, { ...c, checkedAt: new Date(now).toISOString() });
    try {
      const { bearer } = await this.tokenFor(payeeId, now);
      const ready = await this.client.onboarding(bearer);
      const latest = this.connections.get(payeeId);
      if (!latest) return;
      this.connections.set(payeeId, {
        ...latest,
        ...(ready.canReceivePayments !== undefined ? { canReceivePayments: ready.canReceivePayments } : {}),
        ...(ready.status ? { onboarding: ready.status } : {}),
        ...(ready.dashboardUrl ? { dashboardUrl: ready.dashboardUrl } : {}),
      });
    } catch {
      /* asked again at the next look; a lost connection is already marked by tokenFor */
    }
  }

  private requirePayee(payee: MolliePayee): { payeeId: string; country: string; by: string; back: 'driver' | 'fleet' } {
    if ('notPayee' in payee) throw new GlosError('FORBIDDEN', payee.notPayee);
    if (directPayWayOf(payee.country) !== 'mollie') throw refused('FORBIDDEN', said('refuse.mollie.netherlandsOnly'));
    return payee;
  }

  private prune(now: number): void {
    for (const [state, s] of this.states) if (now - Date.parse(s.at) > MOLLIE_STATE_TTL_MS) this.states.delete(state);
  }

  private seal(secret: string): string {
    return this.crypt ? `enc:${this.crypt.encrypt(secret)}` : secret;
  }

  private open(sealed: string): string {
    return sealed.startsWith('enc:') && this.crypt ? this.crypt.decrypt(sealed.slice(4)) : sealed;
  }
}

export function viewOf(c: MollieConnection): MollieConnectedView {
  return {
    via: c.via,
    ...(c.organization?.name ? { organizationName: c.organization.name } : {}),
    ...(c.profileName ? { profileName: c.profileName } : {}),
    testmode: c.testmode,
    connectedAt: c.connectedAt,
    ...(c.lostAt ? { lostAt: c.lostAt } : {}),
    ...(c.canReceivePayments !== undefined ? { canReceivePayments: c.canReceivePayments } : {}),
    ...(c.onboarding ? { onboarding: c.onboarding } : {}),
    ...(c.dashboardUrl ? { dashboardUrl: c.dashboardUrl } : {}),
  };
}
