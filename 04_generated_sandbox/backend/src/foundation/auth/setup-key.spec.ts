import 'reflect-metadata';
import { Controller, ExecutionContext, Get, Post } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { actingDid, actingTenant } from './acting';
import { IntrospectionResult } from './auth.types';
import { Public } from './public.decorator';
import { Roles } from './scopes.decorator';
import { SetupKeyMay, assertMayStandIn, isSetupKey, setupKeyOutsideSandbox } from './setup-key';
import { DidService } from '../did/did.service';
import { OperationalStore } from '../data-firewall/operational-store.service';
import { LedgerService } from '../ledger/ledger.service';
import { InMemoryLedgerAdapter } from '../ledger/in-memory-ledger.adapter';
import { LEDGER_ADAPTER } from '../ledger/ledger.types';
import { EventBus } from '../events/event-bus.service';

/**
 * OUTSIDE A SANDBOX THE CLIENT SECRET ACTS FOR NOBODY (the user, 2026-10-11: "client secret should not act as
 * participant outside sandbox").
 *
 * It used to be every shop, driver, fleet and company at once: it could ask for a token as any of them, and its own
 * operator token could stand in for any of them. On a laptop that is the seeder. Anywhere else it is one stolen
 * string with nobody's name on what it does.
 */
describe('the setup key, outside a sandbox', () => {
  const where = process.env.GLOS_ENV;
  const secret = process.env.GLOS_CLIENT_SECRET;
  afterEach(() => {
    if (where === undefined) delete process.env.GLOS_ENV;
    else process.env.GLOS_ENV = where;
    if (secret === undefined) delete process.env.GLOS_CLIENT_SECRET;
    else process.env.GLOS_CLIENT_SECRET = secret;
  });
  const production = () => {
    process.env.GLOS_ENV = 'production';
  };

  const key = { active: true, role: 'operator', sub: 'glos-operator', scopes: ['*'] } as IntrospectionResult;
  const staff = { active: true, role: 'operator', sub: 'operator:opr_amina', scopes: ['*'], actorName: 'Amina Otieno', revocationKey: 'operator:opr_amina' } as IntrospectionResult;
  const driver = { active: true, role: 'driver', did: 'did:glos:driver-1', scopes: ['pudo.driver'], revocationKey: 'did:glos:person-1' } as unknown as IntrospectionResult;
  const admin = { active: true, role: 'entity_admin', did: 'did:glos:entity-1', scopes: [], actorName: 'Wanjiru', revocationKey: 'entity-admin:adm_1' } as unknown as IntrospectionResult;

  it('is told from a member of staff by what stands behind the token: an account, or nothing', () => {
    expect(isSetupKey(key)).toBe(true);
    expect(isSetupKey(staff)).toBe(false);
    // Nobody else is the setup key, whatever their sign-out key looks like.
    expect(isSetupKey(driver)).toBe(false);
    expect(isSetupKey(admin)).toBe(false);
    expect(isSetupKey(undefined)).toBe(false);
    // The all-scopes mark is the operator's, with or without the role written down.
    expect(isSetupKey({ scopes: ['*'] } as IntrospectionResult)).toBe(true);
    // A sign-out key that merely CONTAINS the staff prefix is not a staff account.
    expect(isSetupKey({ ...key, revocationKey: 'not-operator:opr_x' } as IntrospectionResult)).toBe(true);

    expect(setupKeyOutsideSandbox(key)).toBe(false);
    production();
    expect(setupKeyOutsideSandbox(key)).toBe(true);
    expect(setupKeyOutsideSandbox(staff)).toBe(false);
  });

  it('stands in for nobody: not for a participant, not for a tenant, not for all of them', () => {
    // On a laptop the seeder does, with the same token.
    expect(actingDid(key, 'did:glos:shop-1')).toBe('did:glos:shop-1');
    expect(actingTenant(key, 'did:glos:fleet-1')).toBe('did:glos:fleet-1');
    expect(actingTenant(key)).toBeUndefined();

    production();
    expect(() => actingDid(key, 'did:glos:shop-1')).toThrow('The setup key acts for nobody. Sign in with a staff account of your own.');
    expect(() => actingTenant(key, 'did:glos:fleet-1')).toThrow('The setup key acts for nobody');
    expect(() => actingTenant(key)).toThrow('The setup key acts for nobody');
    expect(() => assertMayStandIn(key)).toThrow('The setup key acts for nobody');
    // A member of staff still stands in, by name; and everybody else is still only themselves.
    expect(actingDid(staff, 'did:glos:shop-1')).toBe('did:glos:shop-1');
    expect(actingTenant(staff, 'did:glos:fleet-1')).toBe('did:glos:fleet-1');
    expect(actingTenant(staff)).toBeUndefined();
    expect(actingDid(driver, 'did:glos:shop-1')).toBe('did:glos:driver-1');
  });

  describe('at the one guard every request passes', () => {
    @Controller('walk')
    class Walk {
      @Roles('operator')
      @SetupKeyMay()
      @Get('staff')
      staffSetUp() {}

      @Roles('operator')
      @Post('decide')
      decide() {}

      @Roles('driver', 'operator')
      @Get('runs')
      runs() {}

      @Get('unlabelled')
      unlabelled() {}

      @Public()
      @Get('open')
      open() {}
    }
    const guardAs = (auth: IntrospectionResult | undefined) => {
      const guard = new AuthGuard(new Reflector(), { introspect: () => auth } as unknown as AuthService);
      return (handler: keyof Walk) =>
        guard.canActivate({
          getHandler: () => Walk.prototype[handler],
          getClass: () => Walk,
          switchToHttp: () => ({ getRequest: () => ({ header: () => (auth ? 'Bearer a-token' : undefined), ip: '127.0.0.1' }) }),
        } as unknown as ExecutionContext);
    };
    const REFUSED = 'The setup key only sets network staff up. Sign in with a staff account of your own for everything else.';

    it('lets the setup key through only where a route is marked for it — and an unlabelled route is not', () => {
      production();
      const as = guardAs(key);
      expect(as('staffSetUp')).toBe(true);
      // Its operator role would open every one of these: it is refused before any role is read.
      expect(() => as('decide')).toThrow(REFUSED);
      expect(() => as('runs')).toThrow(REFUSED);
      expect(() => as('unlabelled')).toThrow(REFUSED);
      // What needs no sign-in needs none from it either.
      expect(as('open')).toBe(true);
    });

    it('changes nothing for a member of staff, for anybody else, or on a laptop', () => {
      production();
      for (const route of ['staffSetUp', 'decide', 'runs', 'unlabelled', 'open'] as const) expect([route, guardAs(staff)(route)]).toEqual([route, true]);
      expect(guardAs(driver)('runs')).toBe(true);
      expect(() => guardAs(driver)('decide')).toThrow('Requires role: operator');
      expect(() => guardAs(driver)('staffSetUp')).toThrow('Requires role: operator');

      delete process.env.GLOS_ENV;
      for (const route of ['staffSetUp', 'decide', 'runs', 'unlabelled', 'open'] as const) expect([route, guardAs(key)(route)]).toEqual([route, true]);
    });
  });

  describe('asking for a token as a participant', () => {
    const SECRET = 'a-client-secret-made-by-a-generator-0123456789';
    const withSecret = async () => {
      process.env.GLOS_CLIENT_SECRET = SECRET;
      const moduleRef = await Test.createTestingModule({
        providers: [AuthService, DidService, OperationalStore, LedgerService, EventBus, { provide: LEDGER_ADAPTER, useClass: InMemoryLedgerAdapter }],
      }).compile();
      return { auth: moduleRef.get(AuthService), did: moduleRef.get(DidService) };
    };

    it('is refused outside a sandbox whatever is presented — and the setup key’s own token is still given', async () => {
      const { auth, did } = await withSecret();
      const shop = did.generate('pudo-agent:+254700990077');
      // On a laptop: the right secret gets it, the wrong one does not.
      expect(auth.introspect(auth.mintActorTokenFor(SECRET, { role: 'agent', did: shop.id }).access_token)).toMatchObject({ active: true, role: 'agent', did: shop.id });
      expect(() => auth.mintActorTokenFor('not-the-secret', { role: 'agent', did: shop.id })).toThrow('Invalid client credentials');
      // …and a plain machine token, whose lifetime is capped whatever is asked for.
      const plain = auth.mintMachineToken(SECRET, { sub: 'a-script', type: 'client_credentials', ttlSeconds: 10 * 365 * 24 * 60 * 60 });
      expect(auth.introspect(plain.access_token)).toMatchObject({ active: true, sub: 'a-script' });
      expect(plain.expires_in).toBeLessThanOrEqual(60 * 60);
      expect(() => auth.mintMachineToken('not-the-secret', { sub: 'a-script', type: 'client_credentials' })).toThrow('Invalid client credentials');

      production();
      const REFUSED = 'Nobody is signed in as somebody else here: a participant’s token comes only from that participant signing in';
      expect(() => auth.mintActorTokenFor(SECRET, { role: 'agent', did: shop.id })).toThrow(REFUSED);
      // The same answer for a wrong secret and for none: it does not say whether the secret was right.
      expect(() => auth.mintActorTokenFor('not-the-secret', { role: 'agent', did: shop.id })).toThrow(REFUSED);
      expect(() => auth.mintActorTokenFor(undefined, { role: 'agent', did: shop.id })).toThrow(REFUSED);
      // Nor a plain machine token — nobody at all, but "a valid token", which is all many routes ask for.
      const PLAIN = 'Outside a sandbox the client secret gets the setup key’s token and no other';
      for (const presented of [SECRET, 'not-the-secret', undefined]) expect(() => auth.mintMachineToken(presented, { sub: 'a-script', type: 'client_credentials' })).toThrow(PLAIN);
      // The setup key itself is still handed out for the secret — and is nobody: no name, no account behind it.
      const setupKey = auth.introspect(auth.mintOperatorToken(SECRET).access_token);
      expect(setupKey).toMatchObject({ active: true, role: 'operator' });
      expect(isSetupKey(setupKey)).toBe(true);
      expect(() => auth.mintOperatorToken('not-the-secret')).toThrow('Invalid client credentials');
    });
  });
});
