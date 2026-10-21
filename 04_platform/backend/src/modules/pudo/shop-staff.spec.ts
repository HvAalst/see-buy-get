import { INTERCEPTORS_METADATA } from '@nestjs/common/constants';
import { BagClosureController } from './bag-closure.controller';
import { SbgController } from './pudo.controller';
import { CounterLogInterceptor } from './shop-staff.controller';
import { COUNTER_ACTS } from './shop-staff.service';
import { TamperController } from './tamper.controller';
import { isShopStaff, STAFF_KEY_PREFIX } from './shop-staff.types';

/**
 * THE COUNTER LOG reads acts by the name of the route handler that does them. A handler renamed would stop being logged
 * without a word — so every name it keeps must be one a watched controller has: the shop's and the hub's own, a bag closed,
 * a parcel or a bag reported tampered. And each of those controllers must be watched.
 */
describe('the counter’s own record of who did what', () => {
  it('names only handlers the watched controllers have, and watches each of them', () => {
    const watched = [SbgController, BagClosureController, TamperController];
    const has = (name: string) => watched.some((c) => typeof (c.prototype as unknown as Record<string, unknown>)[name] === 'function');
    expect(Object.keys(COUNTER_ACTS).filter((name) => !has(name))).toEqual([]);
    for (const c of watched) expect(Reflect.getMetadata(INTERCEPTORS_METADATA, c)).toContain(CounterLogInterceptor);
  });

  it('tells a member of staff from the shop’s own sign-in by the key their session is revoked by', () => {
    expect(isShopStaff({ role: 'agent', did: 'did:shop', revocationKey: `${STAFF_KEY_PREFIX}ssm_1` } as never)).toBe(true);
    expect(isShopStaff({ role: 'agent', did: 'did:shop' } as never)).toBe(false);
    expect(isShopStaff({ role: 'agent', did: 'did:shop', revocationKey: 'did:person' } as never)).toBe(false);
    expect(isShopStaff({ role: 'operator', revocationKey: `${STAFF_KEY_PREFIX}ssm_1` } as never)).toBe(false);
    // A hub's people are told apart the same way: the hub's own sign-in has no such key.
    expect(isShopStaff({ role: 'mdp', did: 'did:hub', revocationKey: `${STAFF_KEY_PREFIX}ssm_2` } as never)).toBe(true);
    expect(isShopStaff({ role: 'mdp', did: 'did:hub' } as never)).toBe(false);
  });
});
