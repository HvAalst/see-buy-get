import { describe, expect, it, vi } from 'vitest';
import { createSbgClient } from './client';
import { createDriverApi } from './personas/driver';
import { Session } from './session';
import { makeConfig } from './config';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function setup(fetchImpl: typeof fetch) {
  const mint = vi.fn().mockResolvedValue({ access_token: 'tok', expires_in: 3600 });
  const session = new Session('sbg:test', mint);
  const sbg = createSbgClient({
    config: makeConfig('driver', '1.0.0', { baseUrl: 'http://api.test' }),
    session,
    traceId: () => 'trc_fixed',
    fetch: fetchImpl,
  });
  return { sbg, session, mint, driver: createDriverApi(sbg) };
}

describe('SbgClient envelope + resilience', () => {
  it('returns { data, error: null } for a 2xx', async () => {
    const { driver } = setup(async () => jsonResponse({ driverId: 'd1', did: 'did:x' }));
    const r = await driver.me('did:x');
    expect(r.error).toBeNull();
    expect(r.data).toMatchObject({ driverId: 'd1' });
    expect(r.status).toBe(200);
  });

  it('turns a business failure into a typed error, never an exception', async () => {
    const { driver } = setup(async () => jsonResponse({ code: 'NOT_FOUND', detail: 'Driver not found', retryable: false }, 404));
    const r = await driver.me('nope');
    expect(r.data).toBeNull();
    expect(r.error?.code).toBe('NOT_FOUND');
    expect(r.error?.retryable).toBe(false);
    expect(r.status).toBe(404);
  });

  it('surfaces a 426 as CLIENT_OUTDATED (the shell shows the update screen)', async () => {
    const { driver } = setup(async () => jsonResponse({}, 426));
    const r = await driver.me('did:x');
    expect(r.error?.code).toBe('CLIENT_OUTDATED');
    expect(r.error?.retryable).toBe(false);
  });

  it('maps a network failure to NETWORK and an abort to TIMEOUT', async () => {
    const net = setup(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect((await net.driver.me('x')).error?.code).toBe('NETWORK');

    const abort = setup(async () => {
      const e = new Error('aborted');
      e.name = 'AbortError';
      throw e;
    });
    expect((await abort.driver.me('x')).error?.code).toBe('TIMEOUT');
  });

  it('re-mints once on 401 and retries, transparently', async () => {
    let n = 0;
    const { driver, mint } = setup(async () => {
      n += 1;
      return n === 1 ? jsonResponse({ code: 'UNAUTHORIZED' }, 401) : jsonResponse({ did: 'x' });
    });
    const r = await driver.me('did:x');
    expect(r.error).toBeNull();
    expect(r.data).toMatchObject({ did: 'x' });
    expect(n).toBe(2);
    expect(mint).toHaveBeenCalledTimes(2); // initial mint + re-mint after clear
  });

  it('injects auth, client-version and trace headers on every request', async () => {
    let captured: Request | undefined;
    const { driver } = setup(async (input) => {
      captured = input as Request;
      return jsonResponse({ did: 'x' });
    });
    await driver.me('did:x');
    expect(captured?.headers.get('authorization')).toBe('Bearer tok');
    expect(captured?.headers.get('x-sbg-client')).toBe('driver/1.0.0');
    expect(captured?.headers.get('x-sbg-trace-id')).toBe('trc_fixed');
    expect(captured?.url).toBe('http://api.test/v1/sbg/fleet/drivers/did%3Ax');
  });
});
