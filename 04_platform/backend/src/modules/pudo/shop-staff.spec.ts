import { INTERCEPTORS_METADATA } from '@nestjs/common/constants';
import { SbgController } from './pudo.controller';
import { CounterLogInterceptor } from './shop-staff.controller';
import { COUNTER_ACTS } from './shop-staff.service';
import { isShopStaff, STAFF_KEY_PREFIX } from './shop-staff.types';

/**
 * THE COUNTER LOG reads acts by the name of the route handler that does them. A handler renamed would stop being logged
 * without a word — so every name it keeps must be one the shop's controller has, on the controller it watches.
 */
describe('the counter’s own record of who did what', () => {
  it('names only handlers the shop’s controller has, and watches that controller', () => {
    const missing = Object.keys(COUNTER_ACTS).filter((name) => typeof (SbgController.prototype as unknown as Record<string, unknown>)[name] !== 'function');
    expect(missing).toEqual([]);
    expect(Reflect.getMetadata(INTERCEPTORS_METADATA, SbgController)).toContain(CounterLogInterceptor);
  });

  it('tells a member of staff from the shop’s own sign-in by the key their session is revoked by', () => {
    expect(isShopStaff({ role: 'agent', did: 'did:shop', revocationKey: `${STAFF_KEY_PREFIX}ssm_1` } as never)).toBe(true);
    expect(isShopStaff({ role: 'agent', did: 'did:shop' } as never)).toBe(false);
    expect(isShopStaff({ role: 'agent', did: 'did:shop', revocationKey: 'did:person' } as never)).toBe(false);
    expect(isShopStaff({ role: 'operator', revocationKey: `${STAFF_KEY_PREFIX}ssm_1` } as never)).toBe(false);
  });
});
