import { LoadPostingService } from './load-posting.service';
import type { DispatchService } from './dispatch.service';
import type { PresenceService } from '../../foundation/presence/presence.service';
import type { BusinessClientService } from './business-client.service';
import type { RegisterFreightDto } from './pudo.dto';

/**
 * 2026-11-22 — A LOAD TO ANOTHER EU COUNTRY (the owner's BG-2): no customs list what is inside, so the poster says it holds no
 * alcohol, tobacco, medicines or weapons, or it is not posted; medicines by their kind of goods are refused whatever is said.
 * The load keeps the word. Anywhere else nothing is asked.
 */
describe('a load posted to another EU country', () => {
  const made: Array<Record<string, unknown>> = [];
  const dispatch = { registerFreight: (input: Record<string, unknown>) => (made.push(input), { freightId: `frt_${made.length}`, ...input }) } as unknown as DispatchService;
  const svc = new LoadPostingService(dispatch, {} as PresenceService, {} as BusinessClientService);
  const business = { role: 'business', did: 'did:glos:biz-1', tenant: 'biz-1' } as never;
  const load = (over: Partial<RegisterFreightDto> = {}) =>
    ({ description: 'Pallets of tiles', pickupLocation: { lat: 52.37, lng: 4.9 }, pickupLabel: 'Amsterdam yard', destLocation: { lat: 42.7, lng: 23.32 }, destLabel: 'Sofia depot', weightKg: 800, pickupCountry: 'NL', destCountry: 'BG', ...over }) as RegisterFreightDto;
  const refusal = (fn: () => unknown) => {
    try {
      fn();
    } catch (e) {
      return e as { code: string; params?: Record<string, unknown>; message: string };
    }
    throw new Error('it was posted');
  };

  beforeEach(() => (made.length = 0));

  it('is refused without the poster’s word, and with a false one — before anything is made', () => {
    const r = refusal(() => svc.post(load(), business));
    expect(r).toMatchObject({ code: 'GOODS_WITH_OWN_RULES', params: expect.objectContaining({ field: 'noGoodsWithOwnRules', fromCountry: 'NL', toCountry: 'BG' }) });
    expect(refusal(() => svc.post(load({ noGoodsWithOwnRules: false }), business)).code).toBe('GOODS_WITH_OWN_RULES');
    expect(made).toHaveLength(0);
  });

  it('refuses medicines whatever is said', () => {
    expect(refusal(() => svc.post(load({ noGoodsWithOwnRules: true, natureCode: 'HUM' }), business))).toMatchObject({ code: 'GOODS_WITH_OWN_RULES', params: expect.objectContaining({ field: 'natureCode' }) });
    expect(made).toHaveLength(0);
  });

  it('with the word: posted, keeping it, and the word itself is not passed on as part of the load', () => {
    svc.post(load({ noGoodsWithOwnRules: true }), business);
    expect(made).toHaveLength(1);
    expect(made[0].withinUnion).toMatchObject({ union: 'EU', fromCountry: 'NL', toCountry: 'BG' });
    expect(Date.parse(String((made[0].withinUnion as { saidNoneAt: string }).saidNoneAt))).not.toBeNaN();
    expect(made[0]).not.toHaveProperty('noGoodsWithOwnRules');
  });

  it('asks nothing of a load inside one country, or across a customs border, where the declaration lists what is inside', () => {
    svc.post(load({ destCountry: 'NL', destLocation: { lat: 51.92, lng: 4.48 } }), business);
    svc.post(load({ pickupCountry: 'KE', destCountry: 'UG' }), business);
    expect(made).toHaveLength(2);
    expect(made.every((m) => m.withinUnion === undefined)).toBe(true);
  });
});
