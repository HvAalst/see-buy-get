import { MIN_SAMPLE, NetworkPulseService, townSlug } from './network-pulse.service';
import type { AgentService } from './agent.service';
import type { ParcelService } from './parcel.service';
import type { RatingService } from './rating.service';

/**
 * The front page's proof is the network's own record — counted, withheld below ten cases, and never naming a person.
 */
describe('the network, measured for the front page', () => {
  const NOW = Date.UTC(2026, 9, 3, 12, 0, 0);
  const H = 3_600_000;
  const iso = (t: number) => new Date(t).toISOString();

  const shop = (did: string, zone: string, extra: Record<string, unknown> = {}) => ({ did, shopName: `Shop ${did}`, zone, landmark: 'Main road', status: 'ACTIVE', openState: 'open', country: 'KE', ...extra });
  /** A parcel handed in at `from`, ready at `to` after `hours`, collected an hour after that. */
  const parcel = (n: number, from: string, to: string, handedIn: number, hours: number, collected = true) => ({
    parcelId: `P${n}`,
    originAgentDid: from,
    destAgentDid: to,
    status: collected ? 'Delivered' : 'Ready_For_Pickup',
    acceptedAt: iso(handedIn),
    senderMobile: '+254700000001',
    receiverMobile: '+254700000002',
    scans: [
      { at: iso(handedIn), status: 'At_PUDO', by: from },
      { at: iso(handedIn + hours * H), status: 'Ready_For_Pickup', by: to },
      ...(collected ? [{ at: iso(handedIn + (hours + 1) * H), status: 'Delivered', by: to }] : []),
    ],
  });

  const make = (shops: unknown[], parcels: unknown[], ratings: Record<string, { average: number; count: number }> = {}) =>
    new NetworkPulseService(
      { list: () => shops, countryOf: (a: { country: string }) => a.country } as unknown as AgentService,
      { list: () => parcels } as unknown as ParcelService,
      { agentRating: (did: string) => ({ agentDid: did, average: ratings[did]?.average ?? 0, count: ratings[did]?.count ?? 0, isNew: false }) } as unknown as RatingService,
    );

  it('counts trading shops, open ones, towns and countries — a shop still being checked is not trading', () => {
    const pulse = make(
      [shop('a', 'Nairobi'), shop('b', 'nairobi ', { openState: 'closed' }), shop('c', 'Kisumu', { country: 'UG' }), shop('d', 'Mombasa', { status: 'KYC_PENDING' })],
      [],
    ).measure(NOW);
    expect(pulse).toMatchObject({ shops: 3, shopsOpen: 2, towns: 2, countries: ['KE', 'UG'], collected30d: 0 });
    // The list is of the same trading shops as the count: no town for the shop still being checked.
    expect(pulse.townList).toEqual([{ town: 'Nairobi', slug: 'nairobi', shops: 2 }, { town: 'Kisumu', slug: 'kisumu', shops: 1 }]);
  });

  it('withholds the median and the rating until there are enough cases, then publishes them', () => {
    const shops = [shop('a', 'Nairobi'), shop('b', 'Kisumu')];
    const few = Array.from({ length: MIN_SAMPLE - 1 }, (_, i) => parcel(i, 'a', 'b', NOW - (i + 2) * 24 * H, 6));
    const thin = make(shops, few, { a: { average: 4.8, count: MIN_SAMPLE - 1 } }).measure(NOW);
    expect(thin.collected30d).toBe(MIN_SAMPLE - 1); // a count is a count
    expect(thin.medianHoursToReady).toBeUndefined();
    expect(thin.shopRating).toBeUndefined();

    const hours = [2, 3, 4, 5, 6, 7, 8, 9, 10, 30];
    const enough = hours.map((h, i) => parcel(i, 'a', 'b', NOW - (i + 2) * 24 * H, h));
    const full = make(shops, enough, { a: { average: 4.8, count: 6 }, b: { average: 4.3, count: 6 } }).measure(NOW);
    expect(full.medianHoursToReady).toBe(6.5); // the median, so one slow parcel does not speak for the rest
    expect(full.shopRating).toEqual({ average: 4.6, count: 12 }); // weighted by how many ratings each shop has
  });

  it('counts only the last 30 days', () => {
    const shops = [shop('a', 'Nairobi'), shop('b', 'Kisumu')];
    const pulse = make(shops, [parcel(1, 'a', 'b', NOW - 5 * 24 * H, 4), parcel(2, 'a', 'b', NOW - 45 * 24 * H, 4)]).measure(NOW);
    expect(pulse.collected30d).toBe(1);
  });

  it('tells the latest real journey between two shops, with shop names and times and nobody in it', () => {
    const shops = [shop('a', 'Nairobi'), shop('b', 'Kisumu'), shop('c', 'Eldoret')];
    const older = parcel(1, 'a', 'b', NOW - 4 * 24 * H, 20);
    const latest = parcel(2, 'c', 'a', NOW - 2 * 24 * H, 9);
    const fromNowhere = { ...parcel(3, 'x', 'a', NOW - 1 * 24 * H, 3), originAgentDid: undefined }; // a store's own dock
    const journey = make(shops, [older, latest, fromNowhere]).measure(NOW).journey!;
    expect(journey).toMatchObject({ fromShop: 'Shop c', fromTown: 'Eldoret', toShop: 'Shop a', toTown: 'Nairobi', toReadyMinutes: 540, toCollectedMinutes: 60 });
    expect(JSON.stringify(journey)).not.toMatch(/\+254|P2|parcelId/);
  });

  it('gives each town a page of its trading shops, open ones first, at an address that is the same everywhere', () => {
    const towns = make(
      [shop('b', 'Dar es Salaam', { landmark: 'By the market', openState: 'closed' }), shop('a', 'Dar es Salaam', { landmark: 'Opposite the mosque' }), shop('c', 'Arusha'), shop('d', 'Arusha', { status: 'DRAFT' })],
      [],
      { a: { average: 4.7, count: 12 }, b: { average: 5, count: 1 } },
    ).towns(NOW);
    expect(towns.map((p) => [p.slug, p.shops.length])).toEqual([['dar-es-salaam', 2], ['arusha', 1]]);
    expect(towns[0].shops.map((s) => s.shopName)).toEqual(['Shop a', 'Shop b']);
    expect(towns[0].shops[0].rating).toEqual({ average: 4.7, count: 12 });
    expect(towns[0].shops[1].rating).toBeUndefined(); // one rating is an anecdote
    expect(JSON.stringify(towns)).not.toMatch(/did|\+254|vault|imei/i);
    expect(townSlug('Région Ébène  2')).toBe('region-ebene-2');
  });

  it('serves the same figures for five minutes, then counts again', () => {
    const parcels: unknown[] = [];
    const svc = make([shop('a', 'Nairobi')], parcels);
    expect(svc.pulse(NOW).collected30d).toBe(0);
    parcels.push(parcel(1, 'a', 'a', NOW - 3 * H, 1));
    expect(svc.pulse(NOW + 60_000).collected30d).toBe(0);
    expect(svc.pulse(NOW + 6 * 60_000).collected30d).toBe(1);
  });
});
