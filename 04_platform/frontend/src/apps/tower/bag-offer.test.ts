import { describe, expect, it } from 'vitest';
import { t } from '../../shared/i18n';
import { createOperatorApi } from '../../lib/sbg/personas/operator';

/*
 * 2026-11-06 — A BAG NOBODY HAS TAKEN, OFFERED BY STAFF TO A DRIVER THEY CHOOSE (the owner: "go ahead"): the case's bags,
 * the drivers an offer would reach, and the offer — each to its own door, the offer in the name of who made it.
 */
describe('offering a waiting bag from its case', () => {
  const capture = () => {
    const sent: Array<{ method: string; path: string; params?: unknown; body?: unknown }> = [];
    const answer = async () => ({ data: {}, error: undefined, response: new Response(null, { status: 200 }) });
    const client = {
      GET: async (path: string, init: { params?: unknown }) => (sent.push({ method: 'GET', path, params: init?.params }), answer()),
      POST: async (path: string, init: { params?: unknown; body?: unknown }) => (sent.push({ method: 'POST', path, params: init?.params, body: init?.body }), answer()),
    };
    const sbg = { request: (fn: (c: typeof client) => Promise<unknown>) => fn(client) } as never;
    return { api: createOperatorApi(sbg), sent };
  };

  it('reads the case’s bags and a bag’s drivers, and offers it in the name of who made the offer', async () => {
    const { api, sent } = capture();
    await api.caseBags('case_9');
    await api.bagDrivers('BAG-7');
    await api.offerBag('BAG-7', 'did:glos:kamau', 'Amina O');
    expect(sent).toEqual([
      { method: 'GET', path: '/v1/sbg/flag-cases/{caseId}/bags', params: { path: { caseId: 'case_9' } } },
      { method: 'GET', path: '/v1/sbg/totes/{code}/drivers', params: { path: { code: 'BAG-7' } } },
      { method: 'POST', path: '/v1/sbg/totes/{code}/offer', params: { path: { code: 'BAG-7' } }, body: { driverDid: 'did:glos:kamau', by: 'Amina O' } },
    ]);
  });

  it('says a bag, a driver and an offer made in words a member of staff reads at a glance', () => {
    expect(t('tower.bags.line', { code: 'BAG-7', destination: 'Kisumu', hours: 8 })).toBe('BAG-7 · to Kisumu · waited 8 h');
    expect(t('tower.bags.driver', { name: 'Kamau', km: 4.2 })).toBe('Kamau · 4.2 km');
    expect(t('tower.bags.offered', { name: 'Kamau' })).toBe('Offered to Kamau: told, and the notice opens their offer.');
  });
});
