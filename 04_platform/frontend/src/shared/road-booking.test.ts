import { describe, expect, it } from 'vitest';
import { t } from './i18n';
import { EMPTY_ABROAD, EMPTY_ACCEPT, abroadBlock, abroadExtras } from '../apps/agent/logic';
import type { AbroadRoute } from '../apps/agent/types';
import { goodsWordBody, goodsWordMissing } from '../apps/genesis/logic';
import { EMPTY_PARCEL, sendBody, shopChoices } from '../apps/business/parcels';

/*
 * 2026-11-23 — BOOKING ON A ROAD ROUTE (the Netherlands–Bulgaria plan, step 3b; P3-3 "only on a route that is on"). Between two
 * EU countries nothing is declared: each way of sending asks the sender's word that it holds no alcohol, tobacco, medicines or
 * weapons, sends it there and only there, and never asks a customs declaration.
 */
const BG_ROAD: AbroadRoute = { to: 'BG', name: 'Bulgaria', by: 'road' };
const ET_AIR: AbroadRoute = { to: 'ET', name: 'Ethiopia', by: 'air', departure: 'NBO', arrival: 'ADD' };

describe('booking on a road route', () => {
  it('at a counter: a road route asks the word, never a declaration — an air route still its declaration', () => {
    const blank = { ...EMPTY_ACCEPT };
    expect(abroadBlock(BG_ROAD, blank, t)).toBe(t('agent.accept.roadWord'));
    expect(abroadBlock(BG_ROAD, { ...blank, noGoodsWithOwnRules: true }, t)).toBeNull();
    expect(abroadExtras(BG_ROAD, { ...blank, noGoodsWithOwnRules: true })).toEqual({ noGoodsWithOwnRules: true });
    // An air route as it was: its declaration, and no word.
    expect(abroadBlock(ET_AIR, { ...blank, noGoodsWithOwnRules: true }, t)).toBe(t('agent.logic.acceptAbroadContents'));
    expect(abroadExtras(ET_AIR, { ...blank, abroad: { ...EMPTY_ABROAD } })).toHaveProperty('abroad');
    expect(abroadExtras(ET_AIR, blank)).not.toHaveProperty('noGoodsWithOwnRules');
    // At home: nothing.
    expect(abroadBlock(null, blank, t)).toBeNull();
    expect(abroadExtras(null, blank)).toEqual({});
  });

  it('in the Send app: the label waits for the word where the quote goes to another EU country, and sends it only there', () => {
    const eu = { withinUnion: { union: 'EU', fromCountry: 'NL', toCountry: 'BG' } };
    expect(goodsWordMissing(eu, false)).toBe(true);
    expect(goodsWordMissing(eu, true)).toBe(false);
    expect(goodsWordMissing({}, false)).toBe(false);
    expect(goodsWordBody(eu, true)).toEqual({ noGoodsWithOwnRules: true });
    expect(goodsWordBody({}, true)).toEqual({});
  });

  it('in the Business app: collected at a shop in another EU country, handed in at home; the word sent only on a road route', () => {
    const shops = [
      { did: 'a', shopName: 'Amsterdam', zone: 'A', country: 'NL' },
      { did: 's', shopName: 'Sofia', zone: 'S', country: 'BG' },
      { did: 'n', shopName: 'Nairobi', zone: 'N', country: 'KE' },
    ] as never[];
    expect(shopChoices(shops, 'NL').map((s: { did: string }) => s.did)).toEqual(['a']);
    expect(shopChoices(shops, 'NL', true).map((s: { did: string }) => s.did)).toEqual(['a', 's']);
    const form = { ...EMPTY_PARCEL, originDid: 'a', destDid: 's', receiver: '+359888123456', l: '30', w: '20', h: '15', kg: '2', photoRef: 'med_1', noGoodsWithOwnRules: true };
    expect(sendBody(form, 30, true)).toMatchObject({ destPudoDid: 's', noGoodsWithOwnRules: true });
    expect(sendBody(form, 30)).not.toHaveProperty('noGoodsWithOwnRules');
  });
});
