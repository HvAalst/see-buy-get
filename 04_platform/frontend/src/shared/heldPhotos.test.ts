import { beforeEach, describe, expect, it } from 'vitest';
import { heldCount, heldPhoto, heldRefsIn, holdPhoto, isHeld, mayHold, withRefs } from './heldPhotos';
import { drain, enqueue, onOutboxSent, outboxItems, type OutboxItem } from './outbox';

/**
 * A TAKE-IN WITHOUT A SIGNAL, its photo held on the phone until there is one. The photo goes first when the outbox
 * sends, the real one takes the held one's place, and the server only ever sees a real photo.
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

const ORIGIN = 'https://api.test';
const deps = (fetchImpl: typeof fetch) => ({ baseUrl: ORIGIN, token: async () => 'tok', fetch: fetchImpl });
const takeIn = (photoRef: string) =>
  enqueue({ id: 'ob_1', key: 'key-1', method: 'POST', path: '/v1/sbg/parcels/accept', body: { parcelId: 'PUD-1', senderMobile: '+254700000001', dropoffPhotoRef: photoRef }, label: 'Parcel taken in at the counter', at: new Date().toISOString() });

describe('a take-in photo held for a signal', () => {
  beforeEach(() => localStorage.clear());

  it('is held only for the acts the outbox carries, under a reference the server would never accept as a photo', () => {
    expect(mayHold('dropoff')).toBe(true);
    // …and the photographs of the reports a driver makes with no signal: the breakdown's, the road hazard's.
    expect(mayHold('defect')).toBe(true);
    expect(mayHold('hazard')).toBe(true);
    // …and a load's (round 15): the securement photo at pickup, the proof at delivery, a seal's on the road.
    expect(mayHold('securement')).toBe(true);
    expect(mayHold('pod')).toBe(true);
    expect(mayHold('seal')).toBe(true);
    expect(mayHold('avatar')).toBe(false);
    const ref = holdPhoto('dropoff', 'data:image/jpeg;base64,AAAA', 'data:image/jpeg;base64,BB')!;
    expect(isHeld(ref)).toBe(true);
    expect(heldPhoto(ref)).toMatchObject({ kind: 'dropoff', dataUrl: 'data:image/jpeg;base64,AAAA' });
    expect(heldRefsIn({ a: 1, photo: ref, list: [ref, 'med_x'] })).toEqual([ref]);
    expect(withRefs({ photo: ref, n: 2 }, { [ref]: 'med_real' })).toEqual({ photo: 'med_real', n: 2 });
  });

  it('goes first when the outbox sends, and the take-in carries the real photo in its place', async () => {
    const ref = holdPhoto('dropoff', 'data:image/jpeg;base64,AAAA')!;
    takeIn(ref);
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const server = (async (url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      calls.push({ url: String(url), body });
      if (String(url).endsWith('/v1/sbg/media')) return new Response(JSON.stringify({ mediaId: 'med_real' }), { status: 201 });
      return new Response(JSON.stringify({ parcelId: 'PUD-1', otp: '4821' }), { status: 201 });
    }) as unknown as typeof fetch;
    const told: Array<{ item: OutboxItem; answer: unknown }> = [];
    const stop = onOutboxSent((item, answer) => told.push({ item, answer }));

    expect(await drain(deps(server))).toEqual({ sent: 1, blocked: 0 });
    stop();
    expect(calls.map((c) => c.url)).toEqual([`${ORIGIN}/v1/sbg/media`, `${ORIGIN}/v1/sbg/parcels/accept`]);
    expect(calls[0].body).toMatchObject({ kind: 'dropoff', dataUrl: 'data:image/jpeg;base64,AAAA' });
    expect(calls[1].body.dropoffPhotoRef).toBe('med_real');
    expect(heldCount()).toBe(0); // nothing is left on the phone once the server has it
    // The take-in's answer — its label and release code — reaches the app, which shows them once.
    expect(told).toEqual([{ item: expect.objectContaining({ path: '/v1/sbg/parcels/accept' }), answer: { parcelId: 'PUD-1', otp: '4821' } }]);
  });

  it('waits, photo and all, while there is still no signal', async () => {
    const ref = holdPhoto('dropoff', 'data:image/jpeg;base64,AAAA')!;
    takeIn(ref);
    const dead = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    expect(await drain(deps(dead))).toEqual({ sent: 0, blocked: 0 });
    expect(outboxItems()[0]).toMatchObject({ state: 'pending', attempts: 0, body: { dropoffPhotoRef: ref } });
    expect(heldCount()).toBe(1);
  });

  it('never uploads the same photo twice: an answer lost after the upload leaves the real photo on the take-in', async () => {
    const ref = holdPhoto('dropoff', 'data:image/jpeg;base64,AAAA')!;
    takeIn(ref);
    let uploads = 0;
    let signal = true;
    const patchy = (async (url: RequestInfo | URL) => {
      if (String(url).endsWith('/v1/sbg/media')) {
        uploads += 1;
        return new Response(JSON.stringify({ mediaId: 'med_real' }), { status: 201 });
      }
      if (signal) {
        signal = false;
        throw new TypeError('Failed to fetch'); // the signal drops between the photo and the take-in
      }
      return new Response('{}', { status: 201 });
    }) as unknown as typeof fetch;
    await drain(deps(patchy));
    expect(outboxItems()[0].body).toMatchObject({ dropoffPhotoRef: 'med_real' });
    await drain(deps(patchy));
    expect(uploads).toBe(1);
    expect(outboxItems()).toHaveLength(0);
  });

  it('stops for a person when the photo is gone from the phone, or the server refuses it', async () => {
    takeIn('local:vanished');
    const server = (async () => new Response('{}', { status: 201 })) as unknown as typeof fetch;
    await drain(deps(server));
    expect(outboxItems()[0]).toMatchObject({ state: 'blocked', error: expect.stringMatching(/^The photo kept on this phone for it is gone/) });

    localStorage.clear();
    takeIn(holdPhoto('dropoff', 'data:image/gif;base64,AAAA')!);
    const refuses = (async () => new Response(JSON.stringify({ detail: 'Only JPEG, PNG or WebP photos' }), { status: 400 })) as unknown as typeof fetch;
    await drain(deps(refuses));
    expect(outboxItems()[0]).toMatchObject({ state: 'blocked', error: 'Only JPEG, PNG or WebP photos' });
  });
});
