import { describe, expect, it } from 'vitest';
import { t } from '../../shared/i18n';
import { createDriverApi } from '../../lib/sbg/personas/driver';
import { createConsumerApi } from '../../lib/sbg/personas/consumer';
import { shopChoiceLine } from './screens/ShopClosedSheet';
import { renderToString } from 'preact-render-to-string';
import { h } from 'preact';
import { LooseParcels } from './screens/LooseParcels';

/*
 * 2026-11-06 — A BAG FOR A SHOP THAT IS CLOSED (the owner, point 6: "let a driver be able to search for a pudos near to the
 * closed shop so the buyer can select from his pick"): the driver finds the open shops near it and picks; each buyer chooses
 * from the pick, in the Send app; the bag goes whole to the shop most chose.
 */
describe('a bag for a closed shop: the driver’s pick, the buyers’ choice', () => {
  const capture = () => {
    const sent: Array<{ method: string; path: string; params?: unknown; body?: unknown }> = [];
    const answer = async () => ({ data: {}, error: undefined, response: new Response(null, { status: 200 }) });
    const client = {
      GET: async (path: string, init: { params?: unknown }) => (sent.push({ method: 'GET', path, params: init?.params }), answer()),
      POST: async (path: string, init: { params?: unknown; body?: unknown }) => (sent.push({ method: 'POST', path, params: init?.params, body: init?.body }), answer()),
    };
    return { sbg: { request: (fn: (c: typeof client) => Promise<unknown>) => fn(client) } as never, sent };
  };

  it('the driver asks for the shops near, then sends the pick — and says when the door was found shut', async () => {
    const { sbg, sent } = capture();
    const api = createDriverApi(sbg);
    await api.bagShopsNear('did:drv:amos', 'BAG-7');
    await api.bagShopChoice('did:drv:amos', 'BAG-7', ['did:shop:y', 'did:shop:z']);
    await api.bagShopChoice('did:drv:amos', 'BAG-8', ['did:shop:y'], true);
    expect(sent).toEqual([
      { method: 'GET', path: '/v1/sbg/fleet/drivers/{did}/bags/{code}/shops-near', params: { path: { did: 'did:drv:amos', code: 'BAG-7' } } },
      { method: 'POST', path: '/v1/sbg/fleet/drivers/{did}/bags/{code}/shop-choice', params: { path: { did: 'did:drv:amos', code: 'BAG-7' } }, body: { shopDids: ['did:shop:y', 'did:shop:z'] } },
      { method: 'POST', path: '/v1/sbg/fleet/drivers/{did}/bags/{code}/shop-choice', params: { path: { did: 'did:drv:amos', code: 'BAG-8' } }, body: { shopDids: ['did:shop:y'], shut: true } },
    ]);
  });

  it('a buyer sends the shop they chose for their parcel', async () => {
    const { sbg, sent } = capture();
    await createConsumerApi(sbg).choosePickupShop('PUD-1', 'did:shop:z');
    expect(sent).toEqual([{ method: 'POST', path: '/v1/sbg/identity/parcels/{id}/pickup-shop', params: { path: { id: 'PUD-1' } }, body: { shopDid: 'did:shop:z' } }]);
  });

  it('says on the bag how many buyers answered, and the shop to take it to', () => {
    const line = shopChoiceLine({ picks: [], leading: { did: 'did:shop:z', name: 'Mama Zawadi', chose: 2 }, answered: 3, of: 4 }, t as never);
    expect(line).toBe('3 of 4 buyers answered · take it to Mama Zawadi');
  });

  it('a parcel handed over loose: the driver asks for the shops near its shop, and sends the pick', async () => {
    const { sbg, sent } = capture();
    const api = createDriverApi(sbg);
    await api.parcelShopsNear('did:drv:amos', 'PUD-9');
    await api.parcelShopChoice('did:drv:amos', 'PUD-9', ['did:shop:y'], true);
    expect(sent).toEqual([
      { method: 'GET', path: '/v1/sbg/fleet/drivers/{did}/parcels/{parcelId}/shops-near', params: { path: { did: 'did:drv:amos', parcelId: 'PUD-9' } } },
      { method: 'POST', path: '/v1/sbg/fleet/drivers/{did}/parcels/{parcelId}/shop-choice', params: { path: { did: 'did:drv:amos', parcelId: 'PUD-9' } }, body: { shopDids: ['did:shop:y'], shut: true } },
    ]);
  });

  it('lists the parcels handed to the driver loose — a closed shop’s with “Find another shop”, an open one’s with “Shop shut”, an asked one with its line', () => {
    const html = renderToString(
      h(LooseParcels, {
        loose: [
          { parcelId: 'PUD-1', destShop: { did: 'did:shop:x', name: 'Mama Sarah', closed: true } },
          { parcelId: 'PUD-2', destShop: { did: 'did:shop:o', name: 'Open Duka', closed: false } },
          { parcelId: 'PUD-3', destShop: { did: 'did:shop:x', name: 'Mama Sarah', closed: true }, shopChoice: { picks: [], leading: { did: 'did:shop:z', name: 'Mama Zawadi', chose: 1 }, answered: 1, of: 1 } },
        ],
        onFind: () => undefined,
      }),
    );
    expect(html).toContain('3 parcels handed to you');
    expect(html).toContain('Mama Sarah is closed');
    expect(html).toContain('Find another shop');
    expect(html).toContain('Shop shut when you came?');
    expect(html).toContain('1 of 1 buyer answered · take it to Mama Zawadi');
    expect(renderToString(h(LooseParcels, { loose: [], onFind: () => undefined }))).toBe('');
  });
});
