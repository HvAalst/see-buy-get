import { beforeEach, describe, expect, it, vi } from 'vitest';
import specRaw from '../../../backend/contracts/openapi.json?raw';
import { drain, enqueue, offlineFetch, onOutboxSent, outboxCount, outboxItems, queueableLabel, queueablePatterns, retry, sendAsMine, setOutboxActor, waitingForOthers } from './outbox';

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
    setOutboxActor(null);
  });

  describe('what may be queued at all', () => {
    it('accepts the custody events — the ones a person can see with their own eyes', () => {
      expect(queueableLabel('POST', '/v1/sbg/parcels/PUD-1/intake')).toBe('Parcel taken in');
      expect(queueableLabel('POST', '/v1/sbg/parcels/handover')).toBe('Handed to the bus');
      expect(queueableLabel('POST', '/v1/sbg/parcels/PUD-1/shelve')).toBe('Parcel shelved');
    });

    it('accepts what a driver sees on the road: a breakdown, a road hazard, a word on one (2026-10-18)', () => {
      expect(queueableLabel('POST', '/v1/sbg/fleet/drivers/did:glos:d1/breakdown')).toBe('Breakdown reported');
      expect(queueableLabel('POST', '/v1/sbg/route-constraints')).toBe('Road hazard reported');
      expect(queueableLabel('POST', '/v1/sbg/route-constraints/rc_1/confirm')).toBe('Road hazard answered');
      expect(queueableLabel('POST', '/v1/sbg/route-constraints/rc_1/refute')).toBe('Road hazard answered');
      // Round 14 — at a border post, cleared it, at a hub: said where the signal is worst.
      expect(queueableLabel('POST', '/v1/sbg/dispatch/freight/frt_1/passages')).toBe('Border or hub said');
      // Held by the police or customs, and let go: said at a checkpoint.
      expect(queueableLabel('POST', '/v1/sbg/dispatch/freight/frt_1/held')).toBe('Held or let go said');
      expect(queueableLabel('POST', '/v1/sbg/dispatch/freight/frt_1/let-go')).toBe('Held or let go said');
      // Round 15 — a seal found broken on the road. Writing a seal is the shipper's, at its desk: it does not wait.
      expect(queueableLabel('POST', '/v1/sbg/dispatch/freight/frt_1/seals/seal_1/broken')).toBe('Broken seal reported');
      expect(queueableLabel('POST', '/v1/sbg/dispatch/freight/frt_1/seals')).toBeNull();
      // Round 37 — a driver reading the bag they carry; the bag received is the receiver's, and needs the server's answer.
      expect(queueableLabel('POST', '/v1/sbg/totes/BAG-001/take')).toBe('Bag’s seal read');
      expect(queueableLabel('POST', '/v1/sbg/agents/did:glos:a1/receive-bag')).toBeNull();
      // An operator clearing one is a decision, and the office's breakdown typed from a phone call is a desk's: neither waits.
      expect(queueableLabel('POST', '/v1/sbg/route-constraints/rc_1/clear')).toBeNull();
      expect(queueableLabel('POST', '/v1/sbg/vehicles/veh_1/breakdowns')).toBeNull();
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

    it('queues a write sent as a Request, whose body the failed fetch has already spent — as the app sends every write', async () => {
      // The generated client hands fetch a Request object. Calling fetch with it spends its body, signal or no signal,
      // so the body must be read BEFORE the attempt: read after it, the copy throws, and a take-in at a counter with no
      // signal was answered "you are offline" instead of being queued.
      const base = (async (input: RequestInfo | URL) => {
        if (input instanceof Request) await input.text(); // what fetch does to a Request before the network fails
        throw new TypeError('Failed to fetch');
      }) as unknown as typeof fetch;

      const req = new Request(`${ORIGIN}/v1/sbg/parcels/accept`, { method: 'POST', body: JSON.stringify({ parcelId: 'PUD-7' }), headers: { 'content-type': 'application/json' } });
      const res = await wrap(base)(req);
      expect(res.status).toBe(202);
      expect(outboxItems()[0]).toMatchObject({ path: '/v1/sbg/parcels/accept', body: { parcelId: 'PUD-7' } });
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

    it('runs once at a time: a second drain joins the first, so each item is sent — and told — once', async () => {
      queue('a', '/v1/sbg/parcels/A/intake');
      let sends = 0;
      const told: string[] = [];
      const stop = onOutboxSent((item) => told.push(item.id));
      const slow = (async () => {
        sends += 1;
        await new Promise((r) => setTimeout(r, 20));
        return new Response('{}', { status: 200 });
      }) as unknown as typeof fetch;
      const [one, two] = await Promise.all([drain(deps(slow)), drain(deps(slow))]);
      stop();
      expect([sends, told, one, two]).toEqual([1, ['a'], { sent: 1, blocked: 0 }, { sent: 1, blocked: 0 }]);
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

    /**
     * A SHOP'S COUNTER IS SEVERAL PEOPLE'S PHONE (the user, 2026-10-18: "who is at the counter"). What one of them did
     * without a signal goes under their own sign-in — never under whoever is signed in when the signal comes back.
     */
    describe('on a phone several people sign in on', () => {
      const WANJIRU = { key: 'staff:did:shop:ssm_1', name: 'Wanjiru' };
      const OWNER = { key: 'shop:did:shop', name: 'the shop’s own sign-in' };
      const ok = (sent: string[]) =>
        (async (url: RequestInfo | URL) => {
          sent.push(String(url).replace(ORIGIN, ''));
          return new Response('{}', { status: 200 });
        }) as unknown as typeof fetch;

      it('sends an act only under the sign-in that made it, and in order: the owner’s shelving waits behind her take-in', async () => {
        setOutboxActor(WANJIRU);
        queue('a', '/v1/sbg/parcels/A/intake');
        setOutboxActor(OWNER);
        queue('b', '/v1/sbg/parcels/A/shelve', 'Parcel shelved');
        expect(outboxItems().map((i) => i.by?.name)).toEqual(['Wanjiru', 'the shop’s own sign-in']);

        const sent: string[] = [];
        expect(await drain(deps(ok(sent)))).toEqual({ sent: 0, blocked: 0 });
        expect(sent).toEqual([]);
        // Whoever is signed in is told whose acts are waiting — and nothing is marked stuck.
        expect(waitingForOthers()).toEqual([{ by: WANJIRU, items: [expect.objectContaining({ id: 'a' })] }]);
        expect(outboxItems().every((i) => i.state === 'pending' && i.attempts === 0)).toBe(true);

        // She signs in again: hers goes, and the owner's behind it waits for the owner.
        setOutboxActor(WANJIRU);
        expect(await drain(deps(ok(sent)))).toEqual({ sent: 1, blocked: 0 });
        setOutboxActor(OWNER);
        expect(await drain(deps(ok(sent)))).toEqual({ sent: 1, blocked: 0 });
        expect(sent).toEqual(['/v1/sbg/parcels/A/intake', '/v1/sbg/parcels/A/shelve']);
      });

      it('sends nothing stamped while nobody is signed in, and sends what nobody stamped as it always did', async () => {
        setOutboxActor(WANJIRU);
        queue('a', '/v1/sbg/parcels/A/intake');
        setOutboxActor(null);
        const sent: string[] = [];
        await drain(deps(ok(sent)));
        expect(sent).toEqual([]);
        localStorage.clear();
        queue('b', '/v1/sbg/parcels/B/intake'); // one person to a phone: a driver's, a hub's
        await drain(deps(ok(sent)));
        expect(sent).toEqual(['/v1/sbg/parcels/B/intake']);
      });

      it('lets whoever is signed in send them as their own — recorded as theirs, by their choice', async () => {
        setOutboxActor(WANJIRU);
        queue('a', '/v1/sbg/parcels/A/intake');
        queue('b', '/v1/sbg/parcels/B/intake');
        setOutboxActor(OWNER);
        sendAsMine(WANJIRU.key);
        expect(outboxItems().map((i) => i.by?.key)).toEqual([OWNER.key, OWNER.key]);
        expect(waitingForOthers()).toEqual([]);
        const sent: string[] = [];
        expect(await drain(deps(ok(sent)))).toEqual({ sent: 2, blocked: 0 });
      });
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
