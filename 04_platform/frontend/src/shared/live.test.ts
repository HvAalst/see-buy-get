import { describe, expect, it, vi } from 'vitest';
import { framesOf, openLive, retryAfterMs, throttleReads, topicsOf, type LiveState } from './live';

/*
 * ONE LIVE VIEW, the screen's half: what the stream says is read frame by frame, a drop is tried again and followed by
 * one read, a refusal is never asked again, and a closed screen stops listening.
 */

describe('reading the stream', () => {
  it('splits what arrived into whole frames, keeping a half-arrived one for later', () => {
    const { frames, rest } = framesOf('event: live\ndata: {"topics":[]}\n\nevent: changed\r\ndata: {"topics":["orders","map"]}\r\n\r\n: a comment\n\nevent: chan');
    expect(frames).toEqual([
      { event: 'live', data: '{"topics":[]}' },
      { event: 'changed', data: '{"topics":["orders","map"]}' },
    ]);
    expect(rest).toBe('event: chan');
    expect(framesOf(`${rest}ged\ndata: {"topics":["bell"]}\n\n`).frames).toEqual([{ event: 'changed', data: '{"topics":["bell"]}' }]);
    expect(framesOf('data: one\ndata: two\n\n').frames).toEqual([{ event: 'message', data: 'one\ntwo' }]);
  });

  it('takes names from a "changed" frame only, and nothing from one that does not read', () => {
    expect(topicsOf({ event: 'changed', data: '{"topics":["orders","bell",3]}' })).toEqual(['orders', 'bell']);
    expect(topicsOf({ event: 'beat', data: '{}' })).toEqual([]);
    expect(topicsOf({ event: 'live', data: '{"topics":["orders"]}' })).toEqual([]);
    expect(topicsOf({ event: 'changed', data: 'not json' })).toEqual([]);
  });

  it('tries again after 2 s, doubling, never waiting more than a minute', () => {
    expect([1, 2, 3, 4, 5, 6, 10].map(retryAfterMs)).toEqual([2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000]);
  });
});

describe('reading again when told', () => {
  it('reads at once, then at most once a gap, never two at a time, and never leaves the last change unread', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_000_000);
      let reads = 0;
      let finish: (() => void) | undefined;
      const reader = throttleReads(
        () =>
          new Promise<void>((resolve) => {
            reads += 1;
            finish = resolve;
          }),
        5_000,
      );
      reader.tell();
      expect(reads).toBe(1); // at once
      reader.tell();
      reader.tell();
      expect(reads).toBe(1); // one is running: these wait for it
      finish!();
      await vi.advanceTimersByTimeAsync(0);
      expect(reads).toBe(1); // inside the gap now
      await vi.advanceTimersByTimeAsync(4_999);
      expect(reads).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(reads).toBe(2); // the change told while the first ran is read, once
      finish!();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(reads).toBe(2); // nothing more was told
      reader.tell();
      expect(reads).toBe(3); // after a quiet while: at once again
      finish!();
      reader.tell();
      reader.stop();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(reads).toBe(3); // stopped: nothing more
    } finally {
      vi.useRealTimers();
    }
  });
});

/** A stream the test writes to, as the server would. */
function aStream() {
  let ctl!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      ctl = c;
    },
  });
  const enc = new TextEncoder();
  return {
    body,
    say: (s: string) => ctl.enqueue(enc.encode(s)),
    drop: () => {
      try {
        ctl.error(new Error('dropped'));
      } catch {
        /* already gone */
      }
    },
  };
}

async function until(pred: () => boolean): Promise<void> {
  for (let i = 0; i < 300 && !pred(); i += 1) await new Promise((r) => setTimeout(r, 5));
  expect(pred()).toBe(true);
}

function harness(answers: Array<number | ReturnType<typeof aStream>>, token: string | null = 'tok') {
  const states: LiveState[] = [];
  const topics: string[][] = [];
  const asked: Array<{ url: string; auth?: string }> = [];
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    asked.push({ url: String(url), auth: (init?.headers as Record<string, string>)?.authorization });
    const next = answers.shift();
    if (next === undefined) throw new Error('no more answers');
    if (typeof next === 'number') return new Response(null, { status: next });
    init?.signal?.addEventListener('abort', () => next.drop());
    return new Response(next.body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  });
  const live = openLive({
    url: 'https://seebuyget.test/v1/sbg/live',
    token: async () => token,
    onTopics: (t) => topics.push(t),
    onState: (s) => states.push(s),
    fetch: fetch as unknown as typeof globalThis.fetch,
    retryAfter: () => 5,
  });
  return { states, topics, asked, fetch, live };
}

describe('keeping the stream open', () => {
  it('opens with the sign-in in a header, says it is live, and passes on what changed — not the opening itself', async () => {
    const s = aStream();
    const h = harness([s]);
    s.say('event: live\ndata: {"topics":[]}\n\n');
    await until(() => h.states.includes('live'));
    expect(h.asked[0]).toEqual({ url: 'https://seebuyget.test/v1/sbg/live', auth: 'Bearer tok' });
    expect(h.topics).toEqual([]);
    s.say('event: beat\ndata: {}\n\nevent: changed\ndata: {"topics":["orders"]}\n\n');
    await until(() => h.topics.length === 1);
    expect(h.topics).toEqual([['orders']]);
    h.live.close();
    expect(h.states[h.states.length - 1]).toBe('off');
  });

  it('after a drop, says it is trying again, opens again by itself, and reads once', async () => {
    const first = aStream();
    const second = aStream();
    const h = harness([first, 503, second]);
    first.say('event: live\ndata: {}\n\n');
    await until(() => h.states.includes('live'));
    first.drop();
    await until(() => h.fetch.mock.calls.length === 3); // the 503 is tried again too
    second.say('event: live\ndata: {}\n\n');
    await until(() => h.topics.length === 1);
    expect(h.topics).toEqual([['changed']]); // the one read after coming back
    expect(h.states).toEqual(['live', 'connecting', 'connecting', 'live']);
    h.live.close();
  });

  it('is never asked again once refused, and opens nothing for nobody signed in', async () => {
    const refused = harness([403]);
    await until(() => refused.states.includes('off'));
    await new Promise((r) => setTimeout(r, 30));
    expect(refused.fetch).toHaveBeenCalledTimes(1);

    const nobody = harness([], null);
    await until(() => nobody.states.includes('off'));
    expect(nobody.fetch).not.toHaveBeenCalled();
  });

  it('takes a stream quiet for too long for a dead one, and opens another', async () => {
    const quiet = aStream();
    const next = aStream();
    const states: LiveState[] = [];
    const answers = [quiet, next];
    const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const s = answers.shift()!;
      init?.signal?.addEventListener('abort', () => s.drop());
      return new Response(s.body, { status: 200 });
    });
    const live = openLive({ url: 'u', token: async () => 't', onTopics: () => undefined, onState: (s) => states.push(s), fetch: fetch as unknown as typeof globalThis.fetch, silenceMs: 40, retryAfter: () => 5 });
    quiet.say('event: live\ndata: {}\n\n');
    await until(() => fetch.mock.calls.length === 2);
    live.close();
  });

  it('once closed, opens nothing more', async () => {
    const s = aStream();
    const h = harness([s, aStream()]);
    s.say('event: live\ndata: {}\n\n');
    await until(() => h.states.includes('live'));
    h.live.close();
    await new Promise((r) => setTimeout(r, 30));
    expect(h.fetch).toHaveBeenCalledTimes(1);
  });
});
