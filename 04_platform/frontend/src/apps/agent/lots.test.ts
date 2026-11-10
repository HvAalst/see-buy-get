import { describe, expect, it } from 'vitest';
import { createAgentApi } from '../../lib/sbg/personas/agent';

/*
 * 2026-11-09 — A COOPERATIVE'S LOT, A LOAD LIKE ANY (the owner: "the cooperative lots"): the Shop app names who receives it
 * there when the lot is opened, and sends it as a load when the cooperative chooses — each to its own door.
 */
describe('a cooperative’s lot, as the Shop app asks', () => {
  it('opens a lot with its receiver, and sends it now', async () => {
    const sent: Array<{ path: string; params?: unknown; body?: unknown }> = [];
    const answer = async () => ({ data: {}, error: undefined, response: new Response(null, { status: 200 }) });
    const client = { POST: async (path: string, init: { params?: unknown; body?: unknown }) => (sent.push({ path, params: init?.params, body: init?.body }), answer()) };
    const api = createAgentApi({ request: (fn: (c: typeof client) => Promise<unknown>) => fn(client) } as never);
    await api.openConsignment({ destLabel: 'Merkato', targetKg: 10000, consigneeName: 'Merkato Grain Traders', consigneeAddress: 'Gate 3' });
    await api.sendConsignment('LOT-007');
    expect(sent).toEqual([
      { path: '/v1/sbg/consignments', params: undefined, body: { destLabel: 'Merkato', targetKg: 10000, consigneeName: 'Merkato Grain Traders', consigneeAddress: 'Gate 3' } },
      { path: '/v1/sbg/consignments/{code}/send', params: { path: { code: 'LOT-007' } }, body: undefined },
    ]);
  });
});
