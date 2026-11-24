import { LoadPostingService } from './load-posting.service';
import type { DispatchService } from './dispatch.service';
import type { PresenceService } from '../../foundation/presence/presence.service';
import type { BusinessClientService } from './business-client.service';
import type { RegisterFreightDto } from './pudo.dto';
import { runAsSystemsCall } from '../../foundation/http/api-rules';

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
    svc.post(load({ noGoodsWithOwnRules: true, fiscalCodes: { bg: { exempt: 'not-listed' }, indemnity: true } }), business);
    expect(made).toHaveLength(1);
    expect(made[0].withinUnion).toMatchObject({ union: 'EU', fromCountry: 'NL', toCountry: 'BG' });
    expect(Date.parse(String((made[0].withinUnion as { saidNoneAt: string }).saidNoneAt))).not.toBeNaN();
    expect(made[0]).not.toHaveProperty('noGoodsWithOwnRules');
  });

  // 2026-11-23 — the owner: "dedicated fields for both Romanian UIT and Bulgarian UTN codes" (fiscal-codes.ts).
  it('to Bulgaria or from Romania: refused without the UTN or UIT, or the word that none is needed, before anything is made', () => {
    expect(refusal(() => svc.post(load({ noGoodsWithOwnRules: true }), business))).toMatchObject({ code: 'FIELD_REQUIRED', params: expect.objectContaining({ field: 'fiscalCodes', countries: 'BG' }) });
    expect(refusal(() => svc.post(load({ pickupCountry: 'RO', noGoodsWithOwnRules: true, fiscalCodes: { bg: { exempt: 'not-listed' } } }), business))).toMatchObject({ params: expect.objectContaining({ countries: 'RO' }) });
    expect(made).toHaveLength(0);
  });

  it('with a code: kept on the load as a code with its last day, not as what was typed', () => {
    svc.post(load({ noGoodsWithOwnRules: true, fiscalCodes: { bg: { code: 'bg 1234-5678', from: '2099-01-10' }, indemnity: true } }), business);
    expect(made[0].fiscalCodes).toEqual([expect.objectContaining({ country: 'BG', kind: 'UTN', code: 'BG12345678', from: '2099-01-10', validThrough: '2099-01-23' })]);
    expect(made[0].fiscalIndemnity).toEqual(expect.objectContaining({ at: expect.any(String) }));
  });

  // 2026-11-24 — Romania's value threshold: a load worth over RON 10,000 is not "below the thresholds", whatever it weighs.
  it('refuses “below the thresholds” for a load from Romania worth over RON 10,000', () => {
    const light = { pickupCountry: 'RO', destCountry: 'NL', weightKg: 100, noGoodsWithOwnRules: true } as Partial<RegisterFreightDto>;
    expect(refusal(() => svc.post(load({ ...light, declaredValue: { amount: 12_000, currency: 'RON' }, fiscalCodes: { ro: { exempt: 'thresholds' }, indemnity: true } } as never), business)).message).toMatch(/worth about RON 12,000: over RON 10,000/);
    svc.post(load({ ...light, declaredValue: { amount: 9_000, currency: 'RON' }, fiscalCodes: { ro: { exempt: 'thresholds' }, indemnity: true } } as never), business);
    expect(made).toHaveLength(1);
  });

  // 2026-11-24 — the owner: "a required tick" by which the sender certifies them (CMR art. 7 and 11).
  it('refuses the codes without the sender’s certification; a company’s system is warned of it first', () => {
    expect(refusal(() => svc.post(load({ noGoodsWithOwnRules: true, fiscalCodes: { bg: { exempt: 'not-listed' } } }), business))).toMatchObject({ code: 'FIELD_REQUIRED', params: expect.objectContaining({ field: 'fiscalCodes.indemnity' }) });
    expect(made).toHaveLength(0);
    const store = { warned: [] as Array<{ id: string }> };
    runAsSystemsCall(store as never, () => svc.post(load({ noGoodsWithOwnRules: true, fiscalCodes: { bg: { exempt: 'not-listed' } } }), business));
    expect(made).toHaveLength(1);
    expect(made[0].fiscalIndemnity).toBeUndefined();
    expect(store.warned.map((r) => r.id)).toEqual(['ro-bg-fiscal-indemnity']);
  });

  it('a company’s system is warned, not refused, until the rule’s day; a code it gives is still checked', () => {
    const store = { warned: [] as Array<{ id: string }> };
    runAsSystemsCall(store as never, () => svc.post(load({ noGoodsWithOwnRules: true }), business));
    expect(made).toHaveLength(1);
    expect(made[0].fiscalCodes).toBeUndefined();
    expect(store.warned.map((r) => r.id)).toEqual(['ro-bg-fiscal-codes']);
    expect(refusal(() => runAsSystemsCall({ warned: [] }, () => svc.post(load({ noGoodsWithOwnRules: true, fiscalCodes: { bg: { code: '12' } } }), business))).message).toMatch(/6 to 40 letters and digits/);
  });

  it('asks nothing of a load inside one country, or across a customs border, where the declaration lists what is inside', () => {
    svc.post(load({ destCountry: 'NL', destLocation: { lat: 51.92, lng: 4.48 } }), business);
    svc.post(load({ pickupCountry: 'KE', destCountry: 'UG' }), business);
    expect(made).toHaveLength(2);
    expect(made.every((m) => m.withinUnion === undefined)).toBe(true);
  });
});
