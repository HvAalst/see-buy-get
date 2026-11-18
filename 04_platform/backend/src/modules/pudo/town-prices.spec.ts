import { GlosError } from '../../foundation/http/glos-error';
import type { EntityService } from '../../foundation/entity/entity.service';
import type { NetworkPulseService } from './network-pulse.service';
import type { RoutingService } from './routing.service';
import { TOWNS_PRICED, TownPricesService } from './town-prices.service';

/*
 * 2026-11-18 — WHAT IT COSTS FROM A TOWN, ON ITS PAGE (the owner: example prices per country, "yes"). Priced as the Send app
 * prices — the cheapest leg's gross, rounded as a person pays it — from the town's most open shops to each other town's,
 * the lowest of them; within one country; only where a company of ours sells; never a shop to itself.
 */
describe('what it costs from a town', () => {
  const NOW = Date.parse('2026-11-18T10:00:00Z');
  const TOWNS = [
    { slug: 'nairobi', town: 'Nairobi', country: 'KE', ids: ['n1', 'n2', 'n3'] },
    { slug: 'mombasa', town: 'Mombasa', country: 'KE', ids: ['m1'] },
    { slug: 'kisumu', town: 'Kisumu', country: 'KE', ids: ['k1', 'k2'] },
    { slug: 'kampala', town: 'Kampala', country: 'UG', ids: ['u1', 'u2'] },
  ];
  const SIZE = { S: 1, M: 2, L: 3 } as const;
  // A price per pair: a different shop fee in n2, a route nobody runs to Kisumu's k2, a foreign money from k1 for S.
  const priceOf = (o: string, d: string, size: 'S' | 'M' | 'L'): { gross: number; currency: string } => {
    if (d === 'k2' || o === 'k2') throw new GlosError('NOT_FOUND', 'no route');
    const base = o[0] === d[0] ? 150 : 300;
    return { gross: (base + (o === 'n2' ? 20 : 0)) * SIZE[size], currency: o === 'k1' && size === 'S' ? 'USD' : 'KES' };
  };
  const setup = (towns = TOWNS, sells = ['KE']) => {
    const asked: Array<[string, string, string, unknown]> = [];
    const routing = {
      quoteShipment: (o: string, d: string, size: 'S' | 'M' | 'L', _m: unknown, carriers: unknown) => {
        asked.push([o, d, size, carriers]);
        const p = priceOf(o, d, size);
        return { currency: p.currency, locked: { gross: p.gross } };
      },
    } as unknown as RoutingService;
    const pulse = { townShopIds: () => towns } as unknown as NetworkPulseService;
    const entities = { forJurisdiction: (c: string) => (sells.includes(c) ? { entityId: `sbg-${c}` } : undefined) } as unknown as EntityService;
    return { asked, svc: new TownPricesService(pulse, routing, entities) };
  };

  it('prices from each town to itself and the country’s other towns, the lowest of its shops, as a person pays it', () => {
    const { svc, asked } = setup();
    const nairobi = svc.prices(NOW).find((p) => p.slug === 'nairobi')!;
    expect(nairobi).toMatchObject({ town: 'Nairobi', country: 'KE', currency: 'KES' });
    expect(nairobi.to).toEqual([
      // Within Nairobi: n1 to n2 (n1's price), never a shop to itself.
      { slug: 'nairobi', town: 'Nairobi', from: { S: 150, M: 300, L: 450 } },
      { slug: 'mombasa', town: 'Mombasa', from: { S: 300, M: 600, L: 900 } },
      // Kisumu's k2 is refused by the engine; k1 still prices it.
      { slug: 'kisumu', town: 'Kisumu', from: { S: 300, M: 600, L: 900 } },
    ]);
    expect(asked.every(([o, d]) => o !== d)).toBe(true);
    expect(asked.every(([, , , carriers]) => (carriers as { consumer?: boolean }).consumer === true)).toBe(true);
    // Only the two most open shops of a town are asked: n3 never is.
    expect(asked.some(([o, d]) => o === 'n3' || d === 'n3')).toBe(false);
  });

  it('never across a border, never where no company of ours sells, and one money per page', () => {
    const { svc } = setup();
    const all = svc.prices(NOW);
    expect(all.map((p) => p.slug)).toEqual(['nairobi', 'mombasa', 'kisumu']);
    expect(all.flatMap((p) => p.to.map((r) => r.slug))).not.toContain('kampala');
    // From Kisumu the first price came in USD: the page keeps that money, and the prices in another are left out.
    const kisumu = all.find((p) => p.slug === 'kisumu')!;
    expect(kisumu.currency).toBe('USD');
    expect(kisumu.to.every((r) => !('M' in r.from) && !('L' in r.from))).toBe(true);
  });

  it('a town with no price at all is left out; and the prices are kept for an hour', () => {
    const lonely = [{ slug: 'voi', town: 'Voi', country: 'KE', ids: ['v1'] }];
    expect(setup(lonely).svc.prices(NOW)).toEqual([]);
    const { svc, asked } = setup();
    svc.prices(NOW);
    const n = asked.length;
    svc.prices(NOW + 30 * 60_000);
    expect(asked.length).toBe(n);
    svc.prices(NOW + 61 * 60_000);
    expect(asked.length).toBe(2 * n);
  });

  it('prices to at most a dozen towns: itself and the country’s busiest', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ slug: `t${i}`, town: `Town ${i}`, country: 'KE', ids: [`x${i}a`, `x${i}b`] }));
    const first = setup(many).svc.prices(NOW)[0];
    expect(first.to).toHaveLength(TOWNS_PRICED);
    expect(first.to[0].slug).toBe('t0');
  });
});
