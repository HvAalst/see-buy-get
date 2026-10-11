import 'reflect-metadata';
import { Controller, ExecutionContext, Get, Post } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { IntrospectionResult } from './auth.types';
import { Public } from './public.decorator';
import { Roles } from './scopes.decorator';
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

    @Get('rules')
    rules() {}
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

  it('touches nothing that is not marked: the product’s own open routes stay open, anywhere', () => {
    process.env.GLOS_ENV = 'production';
    expect(at(Product, undefined)('track')).toBe(true);
    expect(at(Product, driver)('rules')).toBe(true);
    expect(at(Product, staff)('rules')).toBe(true);
  });
});
