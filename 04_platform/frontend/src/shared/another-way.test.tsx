import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { AnotherWaySheet } from './AnotherWaySheet';
import { createVendorApi } from '../lib/sbg/personas/vendor';
import { parcelsApi } from '../apps/business/parcels';

/*
 * 2026-11-06 — SENT ANOTHER WAY FROM ITS OWN PLACE (the owner: "I follow point 1 to 6 at your recommendation"): a store's or a
 * business's waiting parcels sent through another hub than their plans' — the hub chosen from those near, then why — as a
 * shop can for its own.
 */
describe('sending parcels another way from a store’s or a business’s own place', () => {
  const ways = [
    { id: 'mdp_now', label: 'Their Sort', km: 2 },
    { id: 'mdp_a', label: 'North Sort', km: 4.5 },
    { id: 'mdp_b', label: 'East Sort', km: 9 },
  ];
  const sheet = (over: { ways?: typeof ways } = {}) => renderToString(<AnotherWaySheet open count={3} ways={over.ways ?? ways} exclude="mdp_now" onSend={() => undefined} onClose={() => undefined} />);

  it('offers the hubs near, nearest first — never the one they go through now', () => {
    const html = sheet();
    expect(html).toContain('Send 3 parcels another way');
    expect(html).toContain('North Sort');
    expect(html).toContain('4.5 km from here');
    expect(html).toContain('East Sort');
    expect(html).not.toContain('Their Sort');
    expect(html.indexOf('North Sort')).toBeLessThan(html.indexOf('East Sort'));
  });

  it('says so where no other hub can take them', () => {
    expect(sheet({ ways: [ways[0]] })).toContain('No other hub can take them now.');
  });

  const capture = () => {
    const sent: Array<{ path: string; params?: unknown; body: unknown }> = [];
    const client = {
      POST: async (path: string, init: { params?: unknown; body: unknown }) => {
        sent.push({ path, ...(init.params ? { params: init.params } : {}), body: init.body });
        return { data: {}, error: undefined, response: new Response(null, { status: 201 }) };
      },
    };
    return { sbg: { request: (fn: (c: typeof client) => Promise<unknown>) => fn(client) } as never, sent };
  };

  it('a store sends the parcels, the hub and the reason to its own place’s route', async () => {
    const { sbg, sent } = capture();
    await createVendorApi(sbg).dockAnotherWay('vnd_1', ['P-1', 'P-2'], 'mdp_a', 'no_transport');
    await createVendorApi(sbg).dockAnotherWay('vnd_1', ['P-3'], 'mdp_b', 'other', 'the road is closed');
    expect(sent).toEqual([
      { path: '/v1/sbg/vendors/{id}/dock/another-way', params: { path: { id: 'vnd_1' } }, body: { parcelIds: ['P-1', 'P-2'], toHubId: 'mdp_a', offPlanReason: 'no_transport' } },
      { path: '/v1/sbg/vendors/{id}/dock/another-way', params: { path: { id: 'vnd_1' } }, body: { parcelIds: ['P-3'], toHubId: 'mdp_b', offPlanReason: 'other', offPlanNote: 'the road is closed' } },
    ]);
  });

  it('a business sends the same to its own route', async () => {
    const { sbg, sent } = capture();
    await parcelsApi(sbg).anotherWay(['P-1'], 'mdp_a', 'hub_full');
    expect(sent).toEqual([{ path: '/v1/sbg/business/me/parcels/dock/another-way', body: { parcelIds: ['P-1'], toHubId: 'mdp_a', offPlanReason: 'hub_full' } }]);
  });
});
