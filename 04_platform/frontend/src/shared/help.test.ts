import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearHelpCache, fetchHelpTopic, helpImageSrc } from './help';
import type { SbgConfig } from '../lib/sbg';

const config: SbgConfig = { baseUrl: 'https://api.example', clientId: 'test/1', timeoutMs: 1000 };

const ok = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));

describe('help illustrations client', () => {
  beforeEach(() => {
    clearHelpCache();
    vi.restoreAllMocks();
  });

  it('fetches a topic once and serves every later open from memory', async () => {
    // The pictures change when an admin edits them, which is approximately never, and every booking opens
    // the same sheet. Re-fetching per open would spend a phone's data on an answer that did not change.
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => ok({ topic: 'packaging', options: [{ key: 'bagged' }] }));
    await fetchHelpTopic(config, 'packaging');
    await fetchHelpTopic(config, 'packaging');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('shares ONE request between two pickers opening at once', async () => {
    // The promise is cached, not the result — two sheets opening together must not race into two fetches.
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => ok({ topic: 'body', options: [] }));
    await Promise.all([fetchHelpTopic(config, 'body'), fetchHelpTopic(config, 'body')]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('resolves to null on a dead network, and does NOT cache that as "no pictures"', async () => {
    // Help is help: a clerk with no signal still has to book the freight, so the sheet falls back to its
    // words rather than the picker refusing to open. But a failure must not become a permanent answer —
    // caching it would leave the app picture-less until a reload.
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('offline')).mockImplementation(() => ok({ topic: 'nature', options: [{ key: 'FOD' }] }));
    expect(await fetchHelpTopic(config, 'nature')).toBeNull();
    expect((await fetchHelpTopic(config, 'nature'))?.options).toEqual([{ key: 'FOD' }]);
    expect(fetchSpy).toHaveBeenCalledTimes(2); // it tried again rather than serving the failure
  });

  it('builds an absolute image URL, keeping the server’s cache-busting version', () => {
    // The `?v=` is the blob id and rotates whenever an admin replaces the picture — it is what lets the
    // bytes be cached hard without a corrected illustration being overruled by every phone that saw the old.
    expect(helpImageSrc(config, '/v1/sbg/help/packaging/bagged/image?v=help_abc')).toBe('https://api.example/v1/sbg/help/packaging/bagged/image?v=help_abc');
  });
});
