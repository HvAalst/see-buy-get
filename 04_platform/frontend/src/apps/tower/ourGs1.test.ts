import { describe, expect, it } from 'vitest';
import { t } from '../../shared/i18n';
import { ourGs1, ourGs1Line, type TowerClient } from './api';

/*
 * 2026-11-09 — SEEBUYGET'S OWN GS1 PREFIX in the console (the owner: "we should get our own GS1 prefix"): read from the
 * server, said above the shops — not set yet, how many location numbers are given of how many, or none left.
 */
describe('our own GS1 prefix, in the console', () => {
  it('reads it from its own door', async () => {
    const asked: string[] = [];
    const raw = { GET: async (path: string) => (asked.push(path), { data: { used: 0, capacity: 0, live: 0 }, error: undefined, response: new Response(null, { status: 200 }) }) };
    const client = { client: { sbg: { request: (fn: (c: typeof raw) => Promise<unknown>) => fn(raw) } } } as unknown as TowerClient;
    await ourGs1(client);
    expect(asked).toEqual(['/v1/sbg/gs1/ours']);
  });

  it('says it is not set, how many numbers are given of how many, and when none are left', () => {
    expect(ourGs1Line(null, t)).toBe('');
    expect(ourGs1Line({ used: 0, capacity: 0, live: 0 }, t)).toMatch(/^No GS1 company prefix of SeeBuyGet’s own on the server yet/);
    expect(ourGs1Line({ prefix: '8712345', used: 1, capacity: 99_999, live: 1 }, t)).toBe(
      'SeeBuyGet’s GS1 company prefix 8712345: 1 location number (GLN) given of 99999, 1 in use. Each approved hub and collection point has one; a place that moves gets a new one.',
    );
    expect(ourGs1Line({ prefix: '8712345', used: 14, capacity: 99_999, live: 12 }, t)).toMatch(/: 14 location numbers \(GLN\) given of 99999, 12 in use\./);
    expect(ourGs1Line({ prefix: '871234567891', used: 0, capacity: 0, live: 0, full: true }, t)).toMatch(/has no location numbers \(GLN\) left/);
  });
});
