import { describe, expect, it } from 'vitest';
import { t } from '../../shared/i18n';
import { createOperatorApi } from '../../lib/sbg/personas/operator';
import { stepWords } from './screens/BagsWaitingPanel';

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

  it('says each driver asked and how it went — still asked, the minutes left to answer', () => {
    const now = Date.parse('2026-11-06T12:00:00Z');
    const step = (outcome?: 'taken' | 'not_now' | 'no_answer' | 'passed_over') => ({ name: 'Kamau', km: 4, at: '2026-11-06T11:50:00Z', until: '2026-11-06T12:10:00Z', ...(outcome ? { outcome } : {}) });
    expect(stepWords(step('not_now'), t as never, now)).toBe('Kamau · said not now');
    expect(stepWords(step('no_answer'), t as never, now)).toBe('Kamau · no answer in time');
    expect(stepWords(step('taken'), t as never, now)).toBe('Kamau · took it');
    expect(stepWords(step(), t as never, now)).toBe('Kamau · asked, 10 min left to answer');
  });
});
