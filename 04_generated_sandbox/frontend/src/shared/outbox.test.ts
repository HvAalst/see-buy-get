import { beforeEach, describe, expect, it, vi } from 'vitest';
import specRaw from '../../../backend/contracts/openapi.json?raw';
import { drain, enqueue, offlineFetch, outboxCount, outboxItems, queueableLabel, queueablePatterns, retry } from './outbox';

/**
 * The outbox — the handover that happens whether or not there is a signal.
 *
 * Everything in this network reduces to one event: did this parcel move from A's hands to B's. Until this
 * existed that event needed connectivity, which is not a thing a shopkeeper in a dead spot or a driver on
 * the road between two towns has. These tests pin the three properties that make a queued write honest
 * rather than merely optimistic: the attempt is named before it is first sent, only custody events queue,
 * and the queue stops at the first item that cannot go.
 */
/**
 * The suite runs in the node environment (see vitest.config.ts), so the browser's store is supplied here
 * rather than by pulling in a whole DOM for a string map. Faithful on the two behaviours the outbox
 * actually leans on: values are STRINGS, and a missing key is null.
 */
const store = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  },
});

describe('the outbox', () => {
  const ORIGIN = 'https://api.test';

  beforeEach(() => {
    localStorage.clear();
  });

  describe('what may be queued at all', () => {
    it('accepts the custody events — the ones a person can see with their own eyes', () => {
      expect(queueableLabel('POST', '/v1/sbg/parcels/PUD-1/intake')).toBe('Parcel taken in');
      expect(queueableLabel('POST', '/v1/sbg/parcels/handover')).toBe('Handed to the bus');
      expect(queueableLabel('POST', '/v1/sbg/parcels/PUD-1/shelve')).toBe('Parcel shelved');
    });

    it('refuses everything whose answer the person is WAITING to read', () => {
      // Queueing these would be a promise this file cannot keep: a sign-in has to be checked, a top-up
      // has to land, and a quote's whole value is the number that comes back.
      expect(queueableLabel('POST', '/v1/sbg/agents/login')).toBeNull();
      expect(queueableLabel('POST', '/v1/sbg/agents/did:glos:a1/top-up')).toBeNull();
      expect(queueableLabel('POST', '/v1/sbg/shipping/quotes')).toBeNull();
      // RELEASE, most importantly. It is a custody event AND an authorisation: the shop never learns the
      // code, so only the server can say whether the one offered is right. Queue it and a shop in a dead
      // spot gives somebody's parcel away on a code nobody checked.
      expect(queueableLabel('POST', '/v1/sbg/parcels/collect')).toBeNull();
      expect(queueableLabel('POST', '/v1/sbg/parcels/PUD-1/collect-confirm')).toBeNull();
      expect(queueableLabel('GET', '/v1/sbg/parcels/PUD-1/intake')).toBeNull(); // a read is not a write
    });
  });

  it('every pattern matches a REAL endpoint — the guard against the mistake this list already made', () => {
    // The first version of this allowlist shipped with half its paths wrong: /parcels/{id}/accept and
    // /agents/{did}/handover do not exist, so those writes would have silently never queued and the
    // feature would have looked built. A regex that matches nothing is indistinguishable from a feature
    // nobody uses, which is exactly why it needs a test rather than a careful reading.
    const spec = JSON.parse(specRaw) as { paths: Record<string, Record<string, unknown>> };
    const posts = Object.entries(spec.paths)
      .filter(([, ops]) => ops.post)
      // OpenAPI writes parameters as {id}; a live URL has a value there. Any non-empty segment will do.
      .map(([path]) => path.replace(/{[^}]+}/g, 'X'));
    const orphans = queueablePatterns().filter((re) => !posts.some((p) => re.test(p)));
    expect(orphans.map(String)).toEqual([]);
  });

  describe('the fetch wrapper', () => {
    const wrap = (base: typeof fetch) => offlineFetch(base, () => ORIGIN);

    it('NAMES THE ATTEMPT BEFORE IT IS FIRST SENT', async () => {
      // The failure most feared is not "it did not go through", it is "it went through and the answer
      // never came back". A key minted at enqueue time would not cover that: by then the server may
      // already have done the work, and the retry would arrive anonymous.
      const seen: Array<string | null> = [];
      const base = vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) => {
        seen.push(new Headers(init?.headers).get('idempotency-key'));
        return new Response('{}', { status: 200 });
      }) as unknown as typeof fetch;

      await wrap(base)(`${ORIGIN}/v1/sbg/parcels/PUD-1/intake`, { method: 'POST', body: '{}' });
      expect(seen[0]).toBeTruthy();
    });

    it('does not touch a request it may not queue', async () => {
      const seen: Array<string | null> = [];
      const base = vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) => {
        seen.push(new Headers(init?.headers).get('idempotency-key'));
        return new Response('{}', { status: 200 });
      }) as unknown as typeof fetch;

      await wrap(base)(`${ORIGIN}/v1/sbg/agents/login`, { method: 'POST', body: '{}' });
      expect(seen[0]).toBeNull();
    });

    it('queues on a dead network and answers 202 — the parcel HAS moved', async () => {
      // Telling somebody their scan failed, when the box is in their hands and they have already given
      // it to the driver, is the app arguing with something they can see.
      const base = (async () => {
        throw new TypeError('Failed to fetch');
      }) as unknown as typeof fetch;

      const res = await wrap(base)(`${ORIGIN}/v1/sbg/parcels/PUD-9/intake`, { method: 'POST', body: JSON.stringify({ agentDid: 'did:a' }) });
      expect(res.status).toBe(202); // accepted, NOT completed — a caller must be able to tell
      await expect(res.json()).resolves.toMatchObject({ queued: true, label: 'Parcel taken in' });

      const [item] = outboxItems();
      expect(item).toMatchObject({ method: 'POST', path: '/v1/sbg/parcels/PUD-9/intake', label: 'Parcel taken in', state: 'pending' });
      expect(item.body).toEqual({ agentDid: 'did:a' });
      expect(item.key).toBeTruthy();
    });

    it('does NOT queue a refusal that actually arrived', async () => {
      // An answer — even a bad one — must reach the caller rather than being quietly written to disk.
      const base = (async () => new Response(JSON.stringify({ detail: 'no' }), { status: 409 })) as unknown as typeof fetch;
      const res = await wrap(base)(`${ORIGIN}/v1/sbg/parcels/PUD-2/intake`, { method: 'POST', body: '{}' });
      expect(res.status).toBe(409);
      expect(outboxCount()).toBe(0);
    });
  });

  describe('draining', () => {
    const deps = (fetchImpl: typeof fetch) => ({ baseUrl: ORIGIN, token: async () => 'tok', fetch: fetchImpl });

    function queue(id: string, path: string, label = 'Parcel taken in') {
      enqueue({ id, key: `key-${id}`, method: 'POST', path, body: { n: id }, label, at: new Date().toISOString() });
    }

    it('sends oldest first and clears what lands', async () => {
      queue('a', '/v1/sbg/parcels/A/intake');
      queue('b', '/v1/sbg/parcels/B/intake');
      const order: string[] = [];
      const ok = (async (url: RequestInfo | URL) => {
        order.push(String(url));
        return new Response('{}', { status: 200 });
      }) as unknown as typeof fetch;

      expect(await drain(deps(ok))).toEqual({ sent: 2, blocked: 0 });
      expect(order).toEqual([`${ORIGIN}/v1/sbg/parcels/A/intake`, `${ORIGIN}/v1/sbg/parcels/B/intake`]);
      expect(outboxCount()).toBe(0);
    });

    it('replays under the SAME name it was first sent with', async () => {
      queue('a', '/v1/sbg/parcels/A/intake');
      let key: string | null = null;
      const ok = (async (_u: RequestInfo | URL, init?: RequestInit) => {
        key = new Headers(init?.headers).get('idempotency-key');
        return new Response('{}', { status: 200 });
      }) as unknown as typeof fetch;
      await drain(deps(ok));
      expect(key).toBe('key-a'); // …which is what makes a replay free rather than a second parcel
    });

    it('STOPS at the first item that cannot go — order is part of the meaning', async () => {
      // Shelving a parcel the server has not been told arrived would fail in a way nobody could read,
      // and the queue would look like it was working.
      queue('a', '/v1/sbg/parcels/A/intake');
      queue('b', '/v1/sbg/parcels/B/shelve', 'Parcel shelved');
      const seen: string[] = [];
      const flaky = (async (url: RequestInfo | URL) => {
        seen.push(String(url));
        return new Response(JSON.stringify({ detail: 'server having a moment' }), { status: 503 });
      }) as unknown as typeof fetch;

      await drain(deps(flaky));
      expect(seen).toHaveLength(1); // the second was never attempted
      expect(outboxItems()[0]).toMatchObject({ id: 'a', attempts: 1, state: 'pending' });
    });

    it('keeps trying a transient failure, and gives up on a refusal', async () => {
      queue('a', '/v1/sbg/parcels/A/intake');
      const refuse = (async () => new Response(JSON.stringify({ detail: 'That parcel was already collected' }), { status: 409 })) as unknown as typeof fetch;
      await drain(deps(refuse));
      // A 409 will be a 409 forever. It stops asking and waits for a person, with the server's own words.
      expect(outboxItems()[0]).toMatchObject({ state: 'blocked', error: 'That parcel was already collected' });
    });

    it('does not punish an item for a network that is still down', async () => {
      queue('a', '/v1/sbg/parcels/A/intake');
      const dead = (async () => {
        throw new TypeError('Failed to fetch');
      }) as unknown as typeof fetch;
      await drain(deps(dead));
      expect(outboxItems()[0]).toMatchObject({ attempts: 0, state: 'pending' });
    });

    it('steps over a blocked item to send the ones behind it, once a person has been told', async () => {
      queue('a', '/v1/sbg/parcels/A/intake');
      queue('b', '/v1/sbg/parcels/B/intake');
      const refuseFirst = (async (url: RequestInfo | URL) =>
        String(url).includes('/A/') ? new Response(JSON.stringify({ detail: 'gone' }), { status: 409 }) : new Response('{}', { status: 200 })) as unknown as typeof fetch;

      const result = await drain(deps(refuseFirst));
      // 'a' is stuck and stays visible; 'b' is not held hostage by a case that will never resolve itself.
      expect(result).toEqual({ sent: 1, blocked: 1 });
      expect(outboxItems().map((i) => i.id)).toEqual(['a']);
    });

    it('lets a person put a blocked item back in the queue', async () => {
      queue('a', '/v1/sbg/parcels/A/intake');
      const refuse = (async () => new Response('{}', { status: 409 })) as unknown as typeof fetch;
      await drain(deps(refuse));
      expect(outboxItems()[0].state).toBe('blocked');

      retry('a');
      expect(outboxItems()[0]).toMatchObject({ state: 'pending', attempts: 0 });
      // Asserted separately: the store round-trips through JSON, so a cleared field is ABSENT rather
      // than present-and-undefined, and toMatchObject tells those two apart.
      expect(outboxItems()[0].error).toBeUndefined();
    });

    it('never queues the same attempt twice', async () => {
      // A double tap, or a re-render mid-send. The second copy would replay a spent name and be refused.
      queue('a', '/v1/sbg/parcels/A/intake');
      queue('a', '/v1/sbg/parcels/A/intake');
      expect(outboxCount()).toBe(1);
    });

    it('waits rather than failing when there is no credential yet', async () => {
      queue('a', '/v1/sbg/parcels/A/intake');
      const never = (async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
      const result = await drain({ baseUrl: ORIGIN, fetch: never, token: async () => { throw new Error('signed out'); } });
      expect(result).toEqual({ sent: 0, blocked: 0 });
      expect(outboxItems()[0]).toMatchObject({ state: 'pending', attempts: 0 }); // not the item's fault
    });
  });
});
