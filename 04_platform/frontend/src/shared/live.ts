/**
 * ONE LIVE VIEW, the screen's half (backend modules/pudo/live.service.ts; the user, 2026-10-25: "Console and fleet
 * offices"). An open stream from the server that says, by name only, that something this screen shows may have
 * changed; the screen then reads it again through its usual doors. Nothing in the stream is a record of anybody's.
 *
 * Read with fetch rather than EventSource, so the sign-in goes in a header as on every other call — never in an
 * address, where proxies and logs keep it. A dropped connection is tried again by itself, two seconds after the first
 * failure and doubling to a minute; once it is back the screen reads once, since it may have missed something. A
 * refusal (signed out, or not a console or a fleet office) is not tried again. A stream quiet for longer than two of
 * the server's beats is taken for dead and opened again.
 */

/** `connecting`: trying again after a drop. `live`: open. `off`: closed, or refused. */
export type LiveState = 'connecting' | 'live' | 'off';

export interface LiveFrame {
  event: string;
  data: string;
}

/** The server beats every 25 s while nothing happens: no byte for this long and the connection is gone. */
export const LIVE_SILENCE_MS = 70_000;

/** The least time between two reads the live view asks a screen for: a busy network costs it one read in this long. */
export const LIVE_READ_GAP_MS = 5_000;

/** Whole frames from what has arrived, and what is left over until the rest of it arrives. A frame ends at a blank line. */
export function framesOf(text: string): { frames: LiveFrame[]; rest: string } {
  const parts = text.replace(/\r\n?/g, '\n').split('\n\n');
  const rest = parts.pop() ?? '';
  const frames: LiveFrame[] = [];
  for (const block of parts) {
    let event = 'message';
    const data: string[] = [];
    for (const line of block.split('\n')) {
      if (!line || line.startsWith(':')) continue; // a comment, or nothing
      const at = line.indexOf(':');
      const field = at < 0 ? line : line.slice(0, at);
      const value = at < 0 ? '' : line.slice(at + 1).replace(/^ /, '');
      if (field === 'event') event = value;
      else if (field === 'data') data.push(value);
    }
    if (data.length || event !== 'message') frames.push({ event, data: data.join('\n') });
  }
  return { frames, rest };
}

/** The names a `changed` frame carries; none for any other frame, or one that does not read. */
export function topicsOf(frame: LiveFrame): string[] {
  if (frame.event !== 'changed') return [];
  try {
    const topics = (JSON.parse(frame.data) as { topics?: unknown }).topics;
    return Array.isArray(topics) ? topics.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

/** How long to wait before trying again after the n-th failure in a row: 2 s, doubling, never more than a minute. */
export function retryAfterMs(failures: number): number {
  return Math.min(60_000, 2_000 * 2 ** Math.max(0, failures - 1));
}

export interface LiveOptions {
  /** The stream's whole address: `<server>/v1/sbg/live`. */
  url: string;
  /** The current sign-in; null, or a failure, when there is none — then nothing is opened. */
  token: () => Promise<string | null>;
  /** Sent as X-SBG-Client, as on every other call. */
  clientId?: string;
  /** Something with these names may have changed. */
  onTopics: (topics: string[]) => void;
  onState?: (state: LiveState) => void;
  fetch?: typeof fetch;
  silenceMs?: number;
  /** How long to wait after the n-th failure in a row (retryAfterMs; a test makes it short). */
  retryAfter?: (failures: number) => number;
}

/**
 * Read again when told, but never more often than once every `gapMs`, and never two reads at once: what is told while
 * a read runs, or inside the gap, is one more read at its end. So a busy network costs a screen one read every few
 * seconds, and the last change is never left unread.
 */
export function throttleReads(read: () => Promise<void>, gapMs: number): { tell: () => void; stop: () => void } {
  let running = false;
  let again = false;
  let stopped = false;
  let lastAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const go = async (): Promise<void> => {
    timer = undefined;
    if (stopped) return;
    running = true;
    again = false;
    try {
      await read();
    } catch {
      // A read that failed says so on its own screen; the next one is tried as usual.
    } finally {
      running = false;
      lastAt = Date.now();
      if (again) tell();
    }
  };
  const tell = (): void => {
    if (stopped) return;
    if (running || timer) {
      again = running || again;
      return;
    }
    const wait = lastAt ? lastAt + gapMs - Date.now() : 0;
    if (wait > 0) timer = setTimeout(() => void go(), wait);
    else void go();
  };
  return {
    tell,
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}

/** Open the stream, and keep it open until closed. */
export function openLive(opts: LiveOptions): { close: () => void } {
  const doFetch = opts.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const silenceMs = opts.silenceMs ?? LIVE_SILENCE_MS;
  let closed = false;
  let failures = 0;
  let everOpen = false;
  let ctrl: AbortController | null = null;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  const say = (s: LiveState) => {
    if (!closed) opts.onState?.(s);
  };

  const connect = async (): Promise<void> => {
    if (closed) return;
    let token: string | null;
    try {
      token = await opts.token();
    } catch {
      token = null;
    }
    if (closed) return;
    if (!token) {
      say('off'); // nobody signed in: nothing to listen with
      return;
    }
    ctrl = new AbortController();
    const mine = ctrl;
    try {
      const res = await doFetch(opts.url, {
        headers: { accept: 'text/event-stream', authorization: `Bearer ${token}`, ...(opts.clientId ? { 'X-SBG-Client': opts.clientId } : {}) },
        signal: mine.signal,
        cache: 'no-store',
      });
      if (res.status === 401 || res.status === 403) {
        say('off'); // not ours to listen to: never asked again
        void res.body?.cancel().catch(() => undefined);
        return;
      }
      if (!res.ok || !res.body) throw new Error(`live: ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let carry = '';
      const fed = () => {
        if (watchdog) clearTimeout(watchdog);
        watchdog = setTimeout(() => mine.abort(), silenceMs);
      };
      fed();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        fed();
        const { frames, rest } = framesOf(carry + decoder.decode(value, { stream: true }));
        carry = rest;
        for (const frame of frames) {
          if (frame.event === 'live') {
            const wasDown = failures > 0 || everOpen;
            everOpen = true;
            failures = 0;
            say('live');
            // Back after a drop: whatever changed while it was down was said to nobody. Read once.
            if (wasDown) opts.onTopics(['changed']);
            continue;
          }
          const topics = topicsOf(frame);
          if (topics.length) opts.onTopics(topics);
        }
      }
    } catch {
      // Dropped, the network said no, or quiet for too long: tried again below.
    } finally {
      if (watchdog) clearTimeout(watchdog);
      watchdog = undefined;
    }
    if (closed) return;
    failures += 1;
    // Only a connection that was open, or a screen that has been waiting a while, says it is trying again: the first
    // attempt at opening says nothing, so a console does not flash "reconnecting" as it starts.
    if (everOpen || failures > 1) say('connecting');
    retry = setTimeout(() => void connect(), (opts.retryAfter ?? retryAfterMs)(failures));
  };

  void connect();
  return {
    close: () => {
      if (closed) return;
      opts.onState?.('off');
      closed = true;
      if (retry) clearTimeout(retry);
      if (watchdog) clearTimeout(watchdog);
      ctrl?.abort();
    },
  };
}
