import { describe, expect, it } from 'vitest';
import { t } from '../../shared/i18n';
import { createOperatorApi } from '../../lib/sbg/personas/operator';
import { chainWords, stepWords } from './screens/BagsWaitingPanel';

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

  /*
   * 2026-11-06 — NOBODY ABLE TO TAKE IT NOW, OFFERED AGAIN EVERY HOUR (the owner: "check every hour after 24 hour checks and
   * notify the buyer that they will be notified when their parcel is on the road again").
   */
  it('says the try it is on — not every driver ever asked — when it is offered again, and who has been told', () => {
    const now = Date.parse('2026-11-06T12:00:00Z');
    const asked = (name: string, round: number, outcome: 'not_now' | 'no_answer') => ({ name, km: 4, at: '2026-11-06T10:00:00Z', until: '2026-11-06T10:20:00Z', outcome, round });
    const nextTryAt = '2026-11-06T13:00:00Z';
    const time = new Date(nextTryAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const waiting = { state: 'waiting' as const, round: 2, tries: 2, nextTryAt, steps: [asked('Kamau', 0, 'not_now'), asked('Wanjiru', 1, 'no_answer'), asked('Otieno', 2, 'not_now')] };
    expect(chainWords(waiting, t as never, now)).toBe(`Otieno · said not now — nobody can take it now: offered again every hour, next at ${time} — offered again 2 times so far`);
    expect(chainWords({ ...waiting, tries: 1 }, t as never, now)).toContain('offered again once so far');
    // A day on, its people told it is held up; then, aboard, that it is on the road.
    expect(chainWords({ ...waiting, heldUpToldAt: '2026-11-06T11:00:00Z' }, t as never, now)).toMatch(/— the people of its parcels are told it is held up, and told again when it is on the road$/);
    expect(chainWords({ ...waiting, state: 'gone', heldUpToldAt: '2026-11-06T11:00:00Z', onRoadToldAt: '2026-11-06T11:30:00Z' }, t as never, now)).toMatch(/— on the road: the people of its parcels are told$/);
    // A chain from before the hourly tries reads as it did.
    expect(chainWords({ state: 'nobody', steps: [{ name: 'Kamau', km: 4, at: '2026-11-06T10:00:00Z', until: '2026-11-06T10:20:00Z', outcome: 'not_now' }] }, t as never, now)).toBe('Kamau · said not now — Nobody else can be reached now: choose a driver again later, or call one.');
  });
});
