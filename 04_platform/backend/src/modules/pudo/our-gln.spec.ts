import { glnOf, glnProblem, graiOf } from '../../foundation/gs1/gs1';
import { bagTagSvg, bagTagZpl } from './bag-tag';
import { ToteService } from './tote.service';
import { OurGlnBook, OurGlnSweeper } from './our-gln.service';
import type { AgentService } from './agent.service';
import type { MdpService } from './mdp.service';
import type { NotificationService } from './notification.service';

/**
 * 2026-11-09 — SEEBUYGET'S OWN GS1 PREFIX (the owner: "we should get our own GS1 prefix"): every approved hub and collection
 * point gets one GLN under it, the next each time, never given twice; a place that moves gets a new one and the old is
 * retired; a place gone keeps its number retired; without the prefix on the server nothing is numbered.
 */
describe('our places’ GLNs, under SeeBuyGet’s own prefix', () => {
  const PREFIX = '8712345';
  const env = { SBG_GS1_PREFIX: PREFIX } as NodeJS.ProcessEnv;
  const NOW = Date.parse('2026-11-09T12:00:00Z');

  type Shop = { did: string; shopName: string; status: string; location?: { lat: number; lng: number } };
  type Hub = { mdpId: string; did: string; name: string; location?: { lat: number; lng: number }; vetting?: { state: string } };

  function world(shops: Shop[], hubs: Hub[]) {
    const told: Array<{ did: string; kind: string; title: string; body: string }> = [];
    const agents = {
      list: () => shops,
      find: (did: string) => shops.find((s) => s.did === did),
      countryOf: () => 'KE',
    } as unknown as AgentService;
    const mdps = {
      list: () => hubs,
      isApproved: (m: Hub) => m.vetting?.state === 'approved',
      countryOf: () => 'KE',
    } as unknown as MdpService;
    const notifications = { notify: async (did: string, n: { kind: string; title: string; body: string }) => (told.push({ did, ...n }), {}) } as unknown as NotificationService;
    const book = new OurGlnBook();
    return { book, sweeper: new OurGlnSweeper(book, agents, mdps, notifications), told };
  }

  it('makes a GLN from the prefix and the location reference, with GS1’s check digit', () => {
    expect(glnOf('8712345', 1)).toBe('8712345000011');
    expect(glnProblem(glnOf('8712345', 99_999))).toBeUndefined();
    expect(() => glnOf('8712345', 100_000)).toThrow(/out of range/);
    expect(glnOf('871234567890', 0)).toHaveLength(13);
    expect(() => glnOf('871234567890', 1)).toThrow(/out of range/);
  });

  it('numbers nothing without SeeBuyGet’s prefix on the server, or with one GLNs cannot be made under', () => {
    const { book, sweeper } = world([{ did: 'shop-a', shopName: 'Mama Njeri', status: 'ACTIVE', location: { lat: -1.3, lng: 36.8 } }], []);
    expect(sweeper.sweep(NOW, {} as NodeJS.ProcessEnv)).toBe(0);
    expect(sweeper.sweep(NOW, { SBG_GS1_PREFIX: '1234' } as NodeJS.ProcessEnv)).toBe(0); // too short to be a prefix
    expect(sweeper.sweep(NOW, { SBG_GS1_PREFIX: '0251234' } as NodeJS.ProcessEnv)).toBe(0); // a range kept for use inside one company
    expect(book.of('shop', 'shop-a')).toBeUndefined();
    expect(book.status({} as NodeJS.ProcessEnv)).toEqual({ used: 0, capacity: 0, live: 0 });
  });

  it('gives every approved hub and collection point the next GLN — never a shop not yet approved — and tells it', () => {
    const { book, sweeper, told } = world(
      [
        { did: 'shop-a', shopName: 'Mama Njeri', status: 'ACTIVE', location: { lat: -1.3, lng: 36.8 } },
        { did: 'shop-b', shopName: 'Waiting Shop', status: 'KYC_PENDING', location: { lat: -1.31, lng: 36.81 } },
        { did: 'shop-c', shopName: 'New Shop', status: 'APPROVED_UNFUNDED', location: { lat: -1.32, lng: 36.82 } },
      ],
      [
        { mdpId: 'hub-1', did: 'did:hub-1', name: 'Nairobi Hub', location: { lat: -1.28, lng: 36.82 }, vetting: { state: 'approved' } },
        { mdpId: 'hub-2', did: 'did:hub-2', name: 'Draft Hub', location: { lat: -1.29, lng: 36.83 }, vetting: { state: 'draft' } },
      ],
    );
    expect(sweeper.sweep(NOW, env)).toBe(3);
    expect(book.of('shop', 'shop-a')).toBe(glnOf(PREFIX, 1)); // reference 0 is kept for SeeBuyGet itself
    expect(book.of('shop', 'shop-c')).toBe(glnOf(PREFIX, 2));
    expect(book.of('hub', 'hub-1')).toBe(glnOf(PREFIX, 3));
    expect(book.of('shop', 'shop-b')).toBeUndefined();
    expect(book.of('hub', 'hub-2')).toBeUndefined();
    expect(told.map((n) => [n.did, n.kind])).toEqual([['shop-a', 'place_gln'], ['shop-c', 'place_gln'], ['did:hub-1', 'place_gln']]);
    expect(told[0].title).toBe('Your collection point has its GS1 location number');
    expect(told[0].body).toContain(`GLN ${glnOf(PREFIX, 1)}`);
    expect(told[2].title).toBe('Your hub has its GS1 location number');
    // Asked again: nothing new, nobody told twice.
    expect(sweeper.sweep(NOW + 60_000, env)).toBe(0);
    expect(told).toHaveLength(3);
    expect(book.status(env)).toEqual({ prefix: PREFIX, used: 3, capacity: 99_998, live: 3 });
  });

  it('a pin corrected nearby keeps its number; a place that moved gets a new one, the old retired for good', () => {
    const shop: Shop = { did: 'shop-a', shopName: 'Mama Njeri', status: 'ACTIVE', location: { lat: -1.3, lng: 36.8 } };
    const { book, sweeper, told } = world([shop], []);
    sweeper.sweep(NOW, env);
    const first = book.of('shop', 'shop-a')!;
    shop.location = { lat: -1.3015, lng: 36.8 }; // about 170 m: the same place
    expect(sweeper.sweep(NOW + 1, env)).toBe(0);
    expect(book.of('shop', 'shop-a')).toBe(first);
    shop.location = { lat: -1.35, lng: 36.8 }; // about 5.5 km: a new place
    expect(sweeper.sweep(NOW + 2, env)).toBe(1);
    const second = book.of('shop', 'shop-a')!;
    expect(second).toBe(glnOf(PREFIX, 2));
    expect(book.find(first)).toMatchObject({ retiredWhy: 'moved', retiredAt: expect.any(String) });
    expect(told[1].body).toMatch(/moved, so it is a new place with a new number/);
    expect(told[1].body).toMatch(/never given to another place/);
  });

  it('a place gone from the network keeps its number retired, and no new place is ever given it', () => {
    const shops: Shop[] = [{ did: 'shop-a', shopName: 'Mama Njeri', status: 'ACTIVE', location: { lat: -1.3, lng: 36.8 } }];
    const { book, sweeper } = world(shops, []);
    sweeper.sweep(NOW, env);
    const gone = book.of('shop', 'shop-a')!;
    shops.length = 0;
    sweeper.sweep(NOW + 1, env);
    expect(book.find(gone)).toMatchObject({ retiredWhy: 'gone' });
    shops.push({ did: 'shop-z', shopName: 'Next Shop', status: 'ACTIVE', location: { lat: -1.3, lng: 36.8 } });
    sweeper.sweep(NOW + 2, env);
    expect(book.of('shop', 'shop-z')).toBe(glnOf(PREFIX, 2));
    expect(book.status(env)).toMatchObject({ used: 2, live: 1 });
  });

  it('never gives a number already given, even when the next reference it keeps is behind', () => {
    const { book } = world([], []);
    const place = { kind: 'shop' as const, id: 'a', name: 'A', location: { lat: 0, lng: 0 } };
    expect(book.give(PREFIX, place, NOW)!.gln).toBe(glnOf(PREFIX, 1));
    // The kept reference lost (a restore from an older copy): the book still finds the next free one.
    (book as unknown as { next: { set: (k: string, v: { next: number }) => void } }).next.set(PREFIX, { next: 1 });
    expect(book.give(PREFIX, { ...place, id: 'b', name: 'B' }, NOW)!.gln).toBe(glnOf(PREFIX, 2));
  });

  it('a shop back in draft keeps its number: it is still the same place on the record', () => {
    const shop: Shop = { did: 'shop-a', shopName: 'Mama Njeri', status: 'ACTIVE', location: { lat: -1.3, lng: 36.8 } };
    const { book, sweeper } = world([shop], []);
    sweeper.sweep(NOW, env);
    shop.status = 'DRAFT';
    sweeper.sweep(NOW + 1, env);
    expect(book.of('shop', 'shop-a')).toBe(glnOf(PREFIX, 1));
  });

  it('never gives a place the last number: it is the asset type of our bags', () => {
    const { book } = world([], []);
    const place = { kind: 'shop' as const, id: 'a', name: 'A', location: { lat: 0, lng: 0 } };
    const p = '87123456789'; // 11 digits: references 0–9, 0 kept for SeeBuyGet, 9 for the bags
    for (let i = 1; i <= 8; i += 1) expect(book.give(p, { ...place, id: `s${i}` }, NOW)!.gln).toBe(glnOf(p, i));
    expect(book.give(p, { ...place, id: 's9' }, NOW)).toBeUndefined();
    expect(book.graiForBag('BAG-001', { SBG_GS1_PREFIX: p } as NodeJS.ProcessEnv)).toBe(graiOf(p, 9, 'BAG-001'));
  });

  it('gives every bag its GRAI under the prefix — its code the serial — kept once given; a bag is found by it', () => {
    const totes = new ToteService();
    const a = totes.register('hub-1');
    const odd = totes.register('hub-1');
    (odd as { code: string }).code = 'bag 9'; // a code GS1 cannot take: no GRAI, and the sweep goes on
    const { book } = world([], []);
    const sweeper = new OurGlnSweeper(book, { list: () => [] } as unknown as AgentService, { list: () => [], isApproved: () => false } as unknown as MdpService, undefined, totes);
    sweeper.sweep(NOW, {} as NodeJS.ProcessEnv);
    expect(totes.requireById(a.toteId).grai).toBeUndefined();
    sweeper.sweep(NOW, env);
    const grai = graiOf(PREFIX, 99_999, a.code);
    expect(totes.requireById(a.toteId).grai).toBe(grai);
    expect(totes.requireById(odd.toteId).grai).toBeUndefined();
    // Found by its GRAI as a scanner hands it over.
    expect(totes.requireByCode(`(8003) ${grai}`).toteId).toBe(a.toteId);
    expect(totes.requireByCode(`]C18003${grai}`).toteId).toBe(a.toteId);
    // Another prefix later: the bag keeps the GRAI printed on its tag.
    sweeper.sweep(NOW, { SBG_GS1_PREFIX: '8799999' } as NodeJS.ProcessEnv);
    expect(totes.requireById(a.toteId).grai).toBe(grai);
    expect(totes.giveGrai(a.toteId, graiOf('8799999', 99_999, a.code)).grai).toBe(grai);
  });

  it('prints the bag’s tag: our QR and its code — and its GRAI in words and as a GS1-128 barcode once it has one', () => {
    const grai = graiOf(PREFIX, 99_999, 'BAG-007');
    const plain = bagTagSvg({ code: 'BAG-007' });
    expect(plain).toContain('>BAG-007<');
    expect(plain).not.toContain('GRAI');
    expect(plain).toContain('height="52mm"');
    const tagged = bagTagSvg({ code: 'BAG-007', grai });
    expect(tagged).toContain('RETURNABLE ASSET (GRAI)');
    expect(tagged).toContain(`>(8003) ${grai}<`);
    expect(tagged).toContain('height="80mm"');
    expect((tagged.match(/<rect x=/g) ?? []).length).toBeGreaterThan(40); // the barcode's bars
    const zpl = bagTagZpl({ code: 'BAG-007', grai });
    expect(zpl).toContain('^FDQA,sbg:tote:BAG-007^FS');
    expect(zpl).toContain(`>;>88003${grai.slice(0, 14)}>6BAG-007^FS`);
    expect(zpl).toContain(`^FD(8003) ${grai}^FS`);
    expect(bagTagZpl({ code: 'BAG-007' })).not.toContain('8003');
  });

  it('stops when the prefix holds no more, and says so', () => {
    const big = '871234567891'; // a 12-digit prefix holds one GLN: reference 0, kept for SeeBuyGet
    const { book, sweeper } = world([{ did: 'shop-a', shopName: 'Mama Njeri', status: 'ACTIVE', location: { lat: -1.3, lng: 36.8 } }], []);
    const env12 = { SBG_GS1_PREFIX: big } as NodeJS.ProcessEnv;
    expect(sweeper.sweep(NOW, env12)).toBe(0);
    expect(book.of('shop', 'shop-a')).toBeUndefined();
    expect(book.status(env12)).toEqual({ prefix: big, used: 0, capacity: 0, live: 0, full: true });
  });
});
