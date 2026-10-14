import 'reflect-metadata';
import { Controller, ExecutionContext, Get, Post } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard, NOBODY_SAID } from './auth.guard';
import { AuthService } from './auth.service';
import { IntrospectionResult } from './auth.types';
import { Public } from './public.decorator';
import { Roles, SignedIn } from './scopes.decorator';
import { StaffOnlyOutsideSandbox } from './engine-surface';
import { isStaffAccount } from './setup-key';

/**
 * THE ENGINE UNDERNEATH IS NOT A DOOR. Its own routes were written before anybody was told apart: any valid token
 * opens most of them, and the wallet's — a credit, a cash-out — ask for no sign-in at all, "for the prototype". On a
 * laptop that is the demo. Anywhere else they are for a member of staff signed in to their own account.
 */
describe('the engine’s own routes, outside a sandbox', () => {
  const where = process.env.GLOS_ENV;
  afterEach(() => {
    if (where === undefined) delete process.env.GLOS_ENV;
    else process.env.GLOS_ENV = where;
  });

  @StaffOnlyOutsideSandbox()
  @Controller('engine')
  class Engine {
    // As the wallet is: no sign-in asked for.
    @Public()
    @Post('credit')
    credit() {}

    // As most of it is: no role written on it, so any valid token will do.
    @Get('shipments')
    shipments() {}

    @Roles('driver')
    @Post('position')
    position() {}
  }

  @Controller('product')
  class Product {
    @Public()
    @Post('track')
    track() {}

    // Nothing written on it: nobody said who it is for.
    @Get('rules')
    rules() {}

    // "Anybody signed in", said out loud.
    @SignedIn()
    @Get('rates')
    rates() {}
  }

  const staff = { active: true, role: 'operator', scopes: ['*'], actorName: 'Amina Otieno', revocationKey: 'operator:opr_amina' } as unknown as IntrospectionResult;
  const key = { active: true, role: 'operator', sub: 'glos-operator', scopes: ['*'] } as unknown as IntrospectionResult;
  const driver = { active: true, role: 'driver', did: 'did:glos:driver-1', scopes: [] } as unknown as IntrospectionResult;
  const nobody = { active: true, sub: 'a-script', scopes: [] } as unknown as IntrospectionResult;

  const at = <C extends object>(type: { prototype: C; new (): C }, auth: IntrospectionResult | undefined) => {
    const guard = new AuthGuard(new Reflector(), { introspect: () => auth } as unknown as AuthService);
    return (handler: keyof C) =>
      guard.canActivate({
        getHandler: () => type.prototype[handler],
        getClass: () => type,
        switchToHttp: () => ({ getRequest: () => ({ header: () => (auth ? 'Bearer a-token' : undefined), ip: '127.0.0.1' }) }),
      } as unknown as ExecutionContext);
  };
  const STAFF_ONLY = 'Outside a sandbox this part of the server is for network staff only.';

  it('knows a member of staff by their account, and nobody else as one', () => {
    expect(isStaffAccount(staff)).toBe(true);
    for (const not of [key, driver, nobody, undefined, { role: 'entity_admin', revocationKey: 'operator:looks-like-one' } as unknown as IntrospectionResult]) expect(isStaffAccount(not)).toBe(false);
  });

  it('on a laptop is as it was: no sign-in where none was asked, any valid token where no role was written', () => {
    expect(at(Engine, undefined)('credit')).toBe(true);
    expect(at(Engine, driver)('shipments')).toBe(true);
    expect(at(Engine, nobody)('shipments')).toBe(true);
    expect(at(Engine, driver)('position')).toBe(true);
    expect(at(Engine, key)('shipments')).toBe(true);
  });

  it('is refused to everybody but staff — the route that asks for no sign-in first of all', () => {
    process.env.GLOS_ENV = 'production';
    // Nobody signed in: it asks who they are now, though its own mark says it need not.
    expect(() => at(Engine, undefined)('credit')).toThrow('Missing Bearer token');
    for (const route of ['credit', 'shipments', 'position'] as const) {
      // Somebody signed in — as themselves, as nobody, even in the very role the route names — is not staff.
      expect(() => at(Engine, driver)(route)).toThrow(STAFF_ONLY);
      expect(() => at(Engine, nobody)(route)).toThrow(STAFF_ONLY);
      // Nor is the setup key, which is told its own reason.
      expect(() => at(Engine, key)(route)).toThrow('The setup key only sets network staff up');
      expect([route, at(Engine, staff)(route)]).toEqual([route, true]);
    }
  });

  it('touches nothing that is not marked: what the product marks open stays open, anywhere', () => {
    process.env.GLOS_ENV = 'production';
    expect(at(Product, undefined)('track')).toBe(true);
    expect(at(Product, driver)('rates')).toBe(true);
    expect(at(Product, staff)('rates')).toBe(true);
  });

  /**
   * THE DOOR, TURNED ROUND. A route with nothing written on it used to be let in with any valid sign-in. The engine's
   * still is, on a laptop — that is what its mark is for. Anything else that says nothing is for nobody, wherever it runs.
   */
  it.each([['on a laptop', undefined], ['anywhere else', 'production']])('a route that says nothing about who it is for is for nobody — %s', (_where, env) => {
    if (env) process.env.GLOS_ENV = env;
    else delete process.env.GLOS_ENV;
    // A driver, a token that is nobody at all, and a member of staff alike.
    for (const who of [driver, nobody, staff]) expect(() => at(Product, who)('rules')).toThrow(NOBODY_SAID);
    // It still asks who is there first: nobody signed in is told to sign in, not what the route failed to say.
    expect(() => at(Product, undefined)('rules')).toThrow('Missing Bearer token');
    // What a route SAYS is honoured: open to all, or to anybody signed in.
    expect(at(Product, undefined)('track')).toBe(true);
    for (const who of [driver, nobody, staff]) expect(at(Product, who)('rates')).toBe(true);
    expect(() => at(Product, undefined)('rates')).toThrow('Missing Bearer token');
  });

  it('…and the engine’s unwritten routes are the one exception, by its mark: open to a sign-in on a laptop, staff’s anywhere else', () => {
    delete process.env.GLOS_ENV;
    for (const who of [driver, nobody, staff]) expect(at(Engine, who)('shipments')).toBe(true);
    process.env.GLOS_ENV = 'production';
    expect(at(Engine, staff)('shipments')).toBe(true);
    for (const who of [driver, nobody]) expect(() => at(Engine, who)('shipments')).toThrow(STAFF_ONLY);
  });
});
