import { describe, expect, it } from 'vitest';
import { createOperatorApi } from '../../lib/sbg/personas/operator';
import { createMdpApi } from '../../lib/sbg/personas/mdp';
import { t } from '../../shared/i18n';
import { sortSummary } from '../mdp/logic';

/*
 * 2026-11-09 — A NET OF HUBS (the owner: "We should aim for a net of hubs"; "Own zone + hub adds"): the console adds a hub
 * to a zone or takes it away, by name and with which; a hub reads the zones it serves and adds or drops one near it — each
 * to its own door.
 */
describe('a net of hubs, as the apps ask', () => {
  const capture = () => {
    const sent: Array<{ method: string; path: string; params?: unknown; body?: unknown }> = [];
    const answer = async () => ({ data: {}, error: undefined, response: new Response(null, { status: 200 }) });
    const client = {
      GET: async (path: string, init: { params?: unknown }) => (sent.push({ method: 'GET', path, params: init?.params }), answer()),
      POST: async (path: string, init: { params?: unknown; body?: unknown }) => (sent.push({ method: 'POST', path, params: init?.params, body: init?.body }), answer()),
    };
    const sbg = { request: (fn: (c: typeof client) => Promise<unknown>) => fn(client) } as never;
    return { sbg, sent };
  };

  it('the console adds a hub to a zone and takes one away — which hub, and which way', async () => {
    const { sbg, sent } = capture();
    const api = createOperatorApi(sbg);
    await api.assignCatchment('sbg-nl', 'Z0007', 'mdp_dhl1', true);
    await api.assignCatchment('sbg-nl', 'Z0007', 'mdp_dhl2', false);
    expect(sent).toEqual([
      { method: 'POST', path: '/v1/sbg/entities/{entityId}/catchments/{code}', params: { path: { entityId: 'sbg-nl', code: 'Z0007' } }, body: { mdpId: 'mdp_dhl1', serve: true } },
      { method: 'POST', path: '/v1/sbg/entities/{entityId}/catchments/{code}', params: { path: { entityId: 'sbg-nl', code: 'Z0007' } }, body: { mdpId: 'mdp_dhl2', serve: false } },
    ]);
  });

  it('a hub reads the zones it serves, and adds or drops one near it', async () => {
    const { sbg, sent } = capture();
    const api = createMdpApi(sbg);
    await api.zonesServed('mdp_dhl1');
    await api.serveZone('mdp_dhl1', 'Z0008', true);
    await api.serveZone('mdp_dhl1', 'Z0008', false);
    expect(sent).toEqual([
      { method: 'GET', path: '/v1/sbg/mdps/{id}/zones-served', params: { path: { id: 'mdp_dhl1' } } },
      { method: 'POST', path: '/v1/sbg/mdps/{id}/zones-served/{code}', params: { path: { id: 'mdp_dhl1', code: 'Z0008' } }, body: { serve: true } },
      { method: 'POST', path: '/v1/sbg/mdps/{id}/zones-served/{code}', params: { path: { id: 'mdp_dhl1', code: 'Z0008' } }, body: { serve: false } },
    ]);
  });

  it('a hub chooses what it does: sort only, or sort and hand out — the first time with its counter’s shelf and fee (2026-11-09)', async () => {
    const { sbg, sent } = capture();
    const api = createMdpApi(sbg);
    await api.counter('mdp_dhl1');
    await api.setCounter('mdp_dhl1', { mode: 'sort_and_hand_out', rows: 3, cols: 4, pricePerParcel: 40 });
    await api.setCounter('mdp_dhl1', { mode: 'sort' });
    expect(sent).toEqual([
      { method: 'GET', path: '/v1/sbg/mdps/{id}/counter', params: { path: { id: 'mdp_dhl1' } } },
      { method: 'POST', path: '/v1/sbg/mdps/{id}/counter', params: { path: { id: 'mdp_dhl1' } }, body: { mode: 'sort_and_hand_out', rows: 3, cols: 4, pricePerParcel: 40 } },
      { method: 'POST', path: '/v1/sbg/mdps/{id}/counter', params: { path: { id: 'mdp_dhl1' } }, body: { mode: 'sort' } },
    ]);
  });

  it('sorting for the hub’s own counter says the shelf slot, not a bag', () => {
    const next = { type: 'pudo' as const, id: 'did:c', label: 'Counter', zone: 'Z' };
    expect(sortSummary(2, { parcelId: 'P-1', nextDestination: next, toteCode: '', toteId: '', fillPct: 0, counterSlot: 'Green-2' }, t)).toBe('Put parcel P-1 on your counter’s shelf, slot Green-2. 2 left to sort.');
    expect(sortSummary(2, { parcelId: 'P-2', nextDestination: next, toteCode: 'BAG-004', toteId: 't', fillPct: 10 }, t)).toBe('Place parcel P-2 in bag BAG-004. 2 left to sort.');
  });
});
