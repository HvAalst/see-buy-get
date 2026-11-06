import { describe, expect, it } from 'vitest';
import { parcelsApi } from './parcels';

/*
 * 2026-11-06 — A BUSINESS SAYS ITS ROOM FOR BAGS AGAIN (the owner: "go ahead"): both numbers, to the route that keeps its
 * place as it is — not collect-from, which would read the place's area afresh from the shop nearest to it.
 */
describe('a business’s room for bags at its own place, said again', () => {
  it('sends both numbers to collect-room, and nothing else', async () => {
    const sent: Array<{ path: string; body: unknown }> = [];
    const client = {
      POST: async (path: string, init: { body: unknown }) => {
        sent.push({ path, body: init.body });
        return { data: { open: true }, error: undefined, response: new Response(null, { status: 201 }) };
      },
    };
    const sbg = { request: (fn: (c: typeof client) => Promise<unknown>) => fn(client) } as never;
    await parcelsApi(sbg).collectRoom(3, 2);
    expect(sent).toEqual([{ path: '/v1/sbg/business/me/parcels/collect-room', body: { bays: 3, closedRoom: 2 } }]);
  });
});
