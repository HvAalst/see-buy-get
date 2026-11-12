import { Test } from '@nestjs/testing';
import { EntityService } from '../../foundation/entity/entity.service';
import { DidService } from '../../foundation/did/did.service';
import { LedgerService } from '../../foundation/ledger/ledger.service';
import { LEDGER_ADAPTER } from '../../foundation/ledger/ledger.types';
import { InMemoryLedgerAdapter } from '../../foundation/ledger/in-memory-ledger.adapter';
import { EventBus } from '../../foundation/events/event-bus.service';
import { ZoneMapService } from './zone-map.service';
import { PriceCardService, type Doer } from './price-card.service';
import type { PriceCardTerms } from './price-card.types';
import { haversineKm } from './geo';
import type { OsrmRoadMatrix } from './road-matrix';
import { ROAD_CIRCUITY_FACTOR } from './pudo.config';

/** Five areas in a row, a tenth of a degree each (about 11 km), west to east: A B C D E. */
const ROW = JSON.stringify({
  type: 'FeatureCollection',
  features: ['A', 'B', 'C', 'D', 'E'].map((name, i) => ({
    type: 'Feature',
    properties: { shapeName: name },
    geometry: { type: 'Polygon', coordinates: [[[36 + i * 0.1, -1.1], [36.1 + i * 0.1, -1.1], [36.1 + i * 0.1, -1], [36 + i * 0.1, -1], [36 + i * 0.1, -1.1]]] },
  })),
});
const NJERI: Doer = { name: 'Njeri W.', id: 'admin-1' };
const OTIENO: Doer = { name: 'Otieno K.', id: 'admin-2' };
const DAY = 24 * 3_600_000;

describe('a country’s price card (zone pricing, step 2)', () => {
  let entities: EntityService;
  let zones: ZoneMapService;
  let cards: PriceCardService;
  const none = { list: () => [], countryOf: () => 'KE' };
  const code: Record<string, string> = {};

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [EntityService, DidService, LedgerService, EventBus, { provide: LEDGER_ADAPTER, useClass: InMemoryLedgerAdapter }],
    }).compile();
    entities = moduleRef.get(EntityService);
    entities.seed();
    zones = new ZoneMapService(entities, none as never, none as never);
    cards = new PriceCardService(entities, zones);
    // The zones card is pricing "by factors" (the owner's D3, 2026-11-12): a country starts on a fixed card.
    entities.setPricingMode('sbg-ke', 'factors', 'Njeri W.');
  });

  /** Kenya's zones published: A to E, E remote. */
  const publishRow = () => {
    const s = zones.importAreas('sbg-ke', { geojson: ROW, source: 'A test survey', licence: 'CC BY 4.0', attribution: 'Its contributors' }, 'N');
    for (const z of s.draft!.zones) code[z.name] = z.code;
    zones.changeZone('sbg-ke', code.E, { group: 'remote' }, 'N');
    zones.publish('sbg-ke', undefined, 'N');
  };

  /** A filled card: rising with weight and with distance. */
  const filled = (base: PriceCardTerms): PriceCardTerms => ({
    ...base,
    table: { local: [70, 80, 100, 140, 220, 300], near: [90, 105, 140, 210, 350, 490], regional: [120, 140, 200, 320, 560, 800], national: [150, 180, 260, 440, 800, 1160] },
    groupCharges: { urban: { perParcel: 0, perKg: 0 }, rural: { perParcel: 0, perKg: 0 }, remote: { perParcel: 400, perKg: 0 } },
    surcharges: { door: 150, oversize: 200, oversizeCm: 100, fragile: 50 },
  });
  const draftTerms = (): PriceCardTerms => cards.overview('sbg-ke').pending[0] as unknown as PriceCardTerms;

  it('a fixed card: one price for each size, near or far, made with no zone map — the country’s mode says which card prices (the owner’s D3, 2026-11-12)', () => {
    const now = Date.now();
    cards.setSettings('sbg-ke', { noticeDays: 0 }, NJERI);
    expect(entities.pricingModeFor('sbg-et')).toBe('fixed');
    entities.setPricingMode('sbg-ke', 'fixed', 'Njeri W.');
    expect(entities.changes('sbg-ke').find((c) => c.what === 'pricingMode')).toMatchObject({ from: 'by factors (zones and distance)', to: 'a fixed card' });
    expect(entities.get('sbg-ke').pricingMode).toBeUndefined();
    // No zone map published, and a fixed card starts anyway: one band, a weight for each size, no zones, all to fill in.
    const draft = cards.startDraft('sbg-ke', undefined, NJERI, now, 'fixed').pending[0];
    expect(draft).toMatchObject({ kind: 'fixed', status: 'draft', zoneMapVersion: 0, steps: [1, 5, 15, 30], groupCharges: {}, zoneCharges: {}, pairs: [] });
    expect(draft.bands).toEqual([{ key: 'all', name: 'Anywhere', maxZones: null, maxKm: null }]);
    expect(draft.problems).toContain('Anywhere has a weight with no price');
    // Whatever bands, ends or pairs are sent, a fixed card keeps one band and no zones.
    const terms = draftTerms();
    cards.saveDraft('sbg-ke', { ...terms, bands: [...terms.bands, { key: 'far', name: 'Far', maxZones: null, maxKm: null }], table: { all: [100, 150, 250, 400] }, perExtraKg: { all: 0 }, groupCharges: { remote: { perParcel: 400, perKg: 0 } }, pairs: [{ a: 'X', b: 'Y', band: 'far' }] }, NJERI, now);
    const kept = cards.overview('sbg-ke', now).pending[0];
    expect(kept).toMatchObject({ bands: [{ key: 'all' }], table: { all: [100, 150, 250, 400] }, groupCharges: {}, pairs: [], problems: [] });
    cards.ready('sbg-ke', NJERI, now);
    expect(cards.overview('sbg-ke', now).pending[0].distances).toBeUndefined();
    cards.approve('sbg-ke', kept.version, undefined, OTIENO, now);
    // In force, and pricing: the same near or far, whatever zones are named — none are asked.
    expect(cards.inForceFor('KE', now + 1000)?.card).toMatchObject({ version: kept.version, kind: 'fixed' });
    const live = cards.inForceFor('KE', now + 1000)!.card;
    const near = cards.priceOn('sbg-ke', live, { from: '', to: '', kg: 2 });
    expect(near).toMatchObject({ band: 'all', zonesCrossed: 0, km: 0, amount: 150, billableKg: 2 });
    expect(near.lines.map((l) => l.key)).toEqual(['table']);
    expect(cards.priceOn('sbg-ke', live, { from: 'KE-A', to: 'KE-Z', kg: 12, fragile: true }).amount).toBe(250);
    const v = cards.overview('sbg-ke', now + 1000);
    expect(v).toMatchObject({ mode: 'fixed', inForce: { version: kept.version, kind: 'fixed', status: 'in_force' } });
    expect(v.inForceOther).toBeUndefined();
    // By factors: the fixed card prices nothing — kept, said as the other card in force; no zones card yet.
    entities.setPricingMode('sbg-ke', 'factors', 'Njeri W.');
    expect(cards.inForceFor('KE', now + 1000)).toBeUndefined();
    expect(cards.overview('sbg-ke', now + 1000)).toMatchObject({ mode: 'factors', inForceOther: { version: kept.version, kind: 'fixed' } });
    expect(cards.overview('sbg-ke', now + 1000).inForce).toBeUndefined();
    expect(cards.cardsFrom('KE', now + 1000)?.cards).toEqual([]);
    entities.setPricingMode('sbg-ke', 'fixed', 'Njeri W.');
    expect(cards.cardsFrom('KE', now + 1000)?.cards.map((c) => c.version)).toEqual([kept.version]);
    // Its costs: a middling journey, beside each size.
    expect(cards.costs('sbg-ke', live).map((c) => c.band)).toEqual(['all', 'all', 'all', 'all']);
  });

  it('warns, never blocks, while no card of the kind the country prices by is approved (the owner’s weakness 2, 2026-11-12)', () => {
    const checks: Array<(e: never) => Array<{ key: string; met: boolean; label: string }>> = [];
    const warned = new PriceCardService(entities, zones, undefined, { alsoWarn: (c: never) => checks.push(c) } as never);
    const warning = (entityId: string) => checks.flatMap((c) => c(entities.get(entityId) as never)).find((w) => w.key === 'warn:price_card');
    const now = Date.now();
    entities.setPricingMode('sbg-ke', 'fixed', 'Njeri W.');
    expect(warning('sbg-ke')).toMatchObject({ met: false, label: expect.stringMatching(/^A fixed card approved on the Prices screen — the country prices by a fixed card: until one is, its parcels are priced by distance/) });
    warned.setSettings('sbg-ke', { noticeDays: 0 }, NJERI);
    warned.startDraft('sbg-ke', undefined, NJERI, now, 'fixed');
    warned.saveDraft('sbg-ke', { ...(warned.overview('sbg-ke').pending[0] as unknown as PriceCardTerms), table: { all: [100, 150, 250, 400] } }, NJERI, now);
    // Ready is not approved: still a warning.
    warned.ready('sbg-ke', NJERI, now);
    expect(warning('sbg-ke')?.met).toBe(false);
    warned.approve('sbg-ke', warned.overview('sbg-ke').pending[0].version, undefined, OTIENO, now);
    expect(warning('sbg-ke')?.met).toBe(true);
    // By factors, the fixed card does not count: a zones card is what it needs.
    entities.setPricingMode('sbg-ke', 'factors', 'Njeri W.');
    expect(warning('sbg-ke')).toMatchObject({ met: false, label: expect.stringMatching(/^A zones card approved/) });
    // A company that runs no country: nothing to say.
    expect(checks.flatMap((c) => c(entities.get('sbg') as never))).toEqual([]);
  });

  it('a zones card starts from the newest zones card, never from a fixed one; a fixed card from the newest fixed one', () => {
    publishRow();
    const now = Date.now();
    cards.startDraft('sbg-ke', undefined, NJERI, now, 'fixed');
    cards.saveDraft('sbg-ke', { ...draftTerms(), table: { all: [100, 150, 250, 400] } }, NJERI, now);
    cards.discardDraft('sbg-ke', NJERI, now);
    const zonesDraft = cards.startDraft('sbg-ke', undefined, NJERI, now).pending[0];
    expect(zonesDraft).toMatchObject({ kind: 'zones', zoneMapVersion: 1 });
    expect(zonesDraft.bands.map((b) => b.key)).toEqual(['local', 'near', 'regional', 'national']);
    // A zones card still has from 2 to 8 bands.
    expect(() => cards.saveDraft('sbg-ke', { ...draftTerms(), bands: [draftTerms().bands[3]] }, NJERI, now)).toThrow(/from 2 to 8 bands/);
    // Approved for a later date while the country prices by a fixed card: not on the counters' list; by factors, it is.
    cards.saveDraft('sbg-ke', filled(draftTerms()), NJERI, now);
    cards.ready('sbg-ke', NJERI, now);
    cards.approve('sbg-ke', zonesDraft.version, undefined, OTIENO, now);
    entities.setPricingMode('sbg-ke', 'fixed', 'Njeri W.');
    expect(cards.cardsFrom('KE', now)?.cards).toEqual([]);
    entities.setPricingMode('sbg-ke', 'factors', 'Njeri W.');
    expect(cards.cardsFrom('KE', now)?.cards.map((c) => c.version)).toEqual([zonesDraft.version]);
  });

  it('is made on a published zone map, from neutral words and no figures; what is still missing is said', () => {
    expect(() => cards.startDraft('sbg-ke', undefined, NJERI)).toThrow(/publish the zones first/);
    publishRow();
    const v = cards.startDraft('sbg-ke', undefined, NJERI);
    const draft = v.pending[0];
    expect(draft).toMatchObject({ status: 'draft', zoneMapVersion: 1, currency: 'KES' });
    expect(draft.bands.map((b) => b.name)).toEqual(['Local', 'Near', 'Regional', 'National']);
    expect(draft.steps).toEqual([1, 2, 5, 10, 20, 30]);
    expect(Object.keys(draft.groupCharges)).toEqual(['urban', 'rural', 'remote']);
    expect(draft.problems).toContain('Local has a weight with no price');
    expect(entities.changes('sbg-ke')[0]).toMatchObject({ what: 'prices', by: 'Njeri W.', to: 'price card 1: a draft on zone map 1' });
  });

  it('keeps to its shape: a card that breaks its own rules is refused, one only unfinished is kept with its problems', () => {
    publishRow();
    cards.startDraft('sbg-ke', undefined, NJERI);
    expect(() => cards.saveDraft('sbg-ke', { ...draftTerms(), steps: [5, 2] }, NJERI)).toThrow(/The weights go up/);
    expect(() => cards.saveDraft('sbg-ke', { ...draftTerms(), weight: { ...draftTerms().weight, divisorShop: 20 } }, NJERI)).toThrow(/divisor/);
    const v = cards.saveDraft('sbg-ke', { ...filled(draftTerms()), table: { ...filled(draftTerms()).table, near: [90, 80, 140, 210, 350, 490] } }, NJERI);
    expect(v.pending[0].problems).toEqual(['Near is cheaper for a heavier parcel']);
    expect(cards.saveDraft('sbg-ke', filled(draftTerms()), NJERI).pending[0].problems).toEqual([]);
  });

  it('prices the two ends: the band from the zones between them and the km, the higher counting; a pair named on the card wins', () => {
    publishRow();
    cards.startDraft('sbg-ke', undefined, NJERI);
    cards.saveDraft('sbg-ke', filled(draftTerms()), NJERI);
    const same = cards.price('sbg-ke', { from: code.A, to: code.A, kg: 0.8 });
    expect(same).toMatchObject({ band: 'local', zonesCrossed: 0, km: 0, billableKg: 1, amount: 70 });
    const nextDoor = cards.price('sbg-ke', { from: code.A, to: code.B, kg: 0.8 });
    expect(nextDoor).toMatchObject({ band: 'local', zonesCrossed: 0 });
    // A to D: two zones between (B, C) — Near; about 45 km by road — Near.
    expect(cards.price('sbg-ke', { from: code.A, to: code.D, kg: 1 })).toMatchObject({ band: 'near', zonesCrossed: 2 });
    // A to E: three zones between — Regional, though the km alone say Near: the higher counts. E is remote: its end charge.
    const far = cards.price('sbg-ke', { from: code.A, to: code.E, kg: 1 });
    expect(far).toMatchObject({ band: 'regional', zonesCrossed: 3, amount: 520 });
    expect(far.lines.map((l) => [l.key, l.amount])).toEqual([
      ['table', 120],
      ['end:to', 400],
    ]);
    // A parcel that stays in the remote zone pays its end once, not twice.
    const inside = cards.price('sbg-ke', { from: code.E, to: code.E, kg: 1 });
    expect(inside.lines.map((l) => [l.key, l.amount])).toEqual([
      ['table', 70],
      ['end:from', 400],
    ]);
    // The same pair named on the card: Near.
    cards.saveDraft('sbg-ke', { ...filled(draftTerms()), pairs: [{ a: code.E, b: code.A, band: 'near' }] }, NJERI);
    expect(cards.price('sbg-ke', { from: code.A, to: code.E, kg: 1 })).toMatchObject({ band: 'near', amount: 490 });
  });

  it('made ready while a routing server answers, it keeps the road km between its zones — not approved while they are measured; a server that cannot answer leaves it estimated, with why (step 4)', async () => {
    publishRow();
    // A routing server whose road from zone i to zone j is 100 + 7i + 3j km — not the same both ways; the shorter is kept.
    const answers: Array<{ km: Array<Array<number | null>> } | { why: string }> = [];
    const roads = { configured: () => true, allPairs: async (pts: unknown[]) => answers.shift() ?? { km: pts.map((_, i) => pts.map((_x, j) => (i === j ? 0 : 100 + 7 * i + 3 * j))) } } as unknown as OsrmRoadMatrix;
    const at = (c: string) => zones.publishedZones('sbg-ke', 1).zones.findIndex((z) => z.code === c);
    const road = (a: string, b: string) => 100 + 7 * Math.min(at(a), at(b)) + 3 * Math.max(at(a), at(b));
    const byRoad = new PriceCardService(entities, zones, roads);
    byRoad.setSettings('sbg-ke', { noticeDays: 0 }, NJERI);
    byRoad.startDraft('sbg-ke', undefined, NJERI);
    byRoad.saveDraft('sbg-ke', filled(byRoad.overview('sbg-ke').pending[0] as unknown as PriceCardTerms), NJERI);
    // Next door by the estimate: Local.
    expect(byRoad.price('sbg-ke', { from: code.A, to: code.B, kg: 1 })).toMatchObject({ band: 'local' });
    byRoad.ready('sbg-ke', NJERI);
    expect(byRoad.overview('sbg-ke').pending[0].distances).toBe('measuring');
    expect(() => byRoad.approve('sbg-ke', 1, undefined, OTIENO)).toThrow(/still being measured/);
    await byRoad.settled();
    expect(byRoad.overview('sbg-ke').pending[0].distances).toBe('roads');
    // Over 100 km by road: Regional, though no zone lies between them — each pair at its own distance, either way round.
    expect(byRoad.price('sbg-ke', { from: code.A, to: code.B, kg: 1 })).toMatchObject({ band: 'regional', km: road(code.A, code.B), zonesCrossed: 0 });
    expect(byRoad.price('sbg-ke', { from: code.E, to: code.C, kg: 1 }).km).toBe(road(code.C, code.E));
    expect(road(code.C, code.E)).not.toBe(road(code.A, code.B));
    byRoad.approve('sbg-ke', 1, undefined, OTIENO);
    expect(byRoad.inForceFor('KE')?.card.distances).toBe('roads');
    // The next card: the server cannot answer — estimated, with why, and approvable.
    answers.push({ why: 'the routing server could not be reached' });
    byRoad.startDraft('sbg-ke', undefined, NJERI);
    byRoad.ready('sbg-ke', NJERI);
    await byRoad.settled();
    const second = byRoad.overview('sbg-ke').pending.find((c) => c.version === 2)!;
    expect(second).toMatchObject({ distances: 'estimate', distancesWhy: 'the routing server could not be reached' });
    expect(byRoad.price('sbg-ke', { from: code.A, to: code.B, kg: 1 }, 2)).toMatchObject({ band: 'local' });
    // The card in force still prices by the roads it was approved with.
    expect(byRoad.price('sbg-ke', { from: code.A, to: code.B, kg: 1 }, 1)).toMatchObject({ band: 'regional' });
    // No routing server: estimated from the start.
    cards.startDraft('sbg-ke', undefined, NJERI);
    cards.saveDraft('sbg-ke', filled(draftTerms()), NJERI);
    cards.ready('sbg-ke', NJERI);
    expect(cards.overview('sbg-ke').pending.find((c) => c.status === 'ready')?.distances).toBe('estimate');
  });

  it('measures the km between two zones by the estimate — the straight line between their centres times the road factor — and nothing wired in beside it (step 4)', () => {
    publishRow();
    cards.startDraft('sbg-ke', undefined, NJERI);
    cards.saveDraft('sbg-ke', filled(draftTerms()), NJERI);
    const { zones: all } = zones.publishedZones('sbg-ke', 1);
    const a = all.find((z) => z.code === code.A)!;
    const d = all.find((z) => z.code === code.D)!;
    expect(cards.price('sbg-ke', { from: code.A, to: code.D, kg: 1 }).km).toBe(Math.round(haversineKm(a.centre, d.centre) * ROAD_CIRCUITY_FACTOR * 100) / 100);
  });

  it('counts the size by the service’s divisor, rounds up to the step, adds the surcharges, and keeps to the minimum and the most', () => {
    publishRow();
    cards.startDraft('sbg-ke', undefined, NJERI);
    cards.saveDraft('sbg-ke', { ...filled(draftTerms()), minimum: 100 }, NJERI);
    // 40 × 30 × 20 cm: 4 kg by size shop to shop (÷ 6,000), 4.8 kg to a door (÷ 5,000) — both up to the 5 kg step.
    const shop = cards.price('sbg-ke', { from: code.A, to: code.A, kg: 2.4, dims: { l: 40, w: 30, h: 20 } });
    expect(shop).toMatchObject({ billableKg: 4, by: 'size', amount: 100 });
    const door = cards.price('sbg-ke', { from: code.A, to: code.A, kg: 2.4, dims: { l: 40, w: 30, h: 20 }, door: true, fragile: true });
    expect(door.billableKg).toBe(5);
    expect(door.lines.map((l) => l.key)).toEqual(['table', 'door', 'fragile']);
    expect(door.amount).toBe(100 + 150 + 50);
    // A light parcel under the minimum is raised to it, and says so.
    const tiny = cards.price('sbg-ke', { from: code.A, to: code.A, kg: 0.3 });
    expect(tiny.lines.map((l) => [l.key, l.amount])).toEqual([
      ['table', 70],
      ['minimum', 30],
    ]);
    // Longer than the oversize limit.
    expect(cards.price('sbg-ke', { from: code.A, to: code.A, kg: 3, dims: { l: 120, w: 10, h: 10 } }).lines.some((l) => l.key === 'oversize')).toBe(true);
    // Light and bulky, where volume is not counted below 2 kg: charged what it weighs.
    cards.saveDraft('sbg-ke', { ...filled(draftTerms()), weight: { ...draftTerms().weight, volumeFromKg: 2 } }, NJERI);
    expect(cards.price('sbg-ke', { from: code.A, to: code.A, kg: 1, dims: { l: 60, w: 50, h: 40 } })).toMatchObject({ billableKg: 1, by: 'weight' });
    expect(() => cards.price('sbg-ke', { from: code.A, to: code.A, kg: 31 })).toThrow(/send it as freight/);
  });

  it('is approved by a second person — never the one who made it ready — from the country’s notice ahead; then it is in force', () => {
    publishRow();
    const now = Date.now();
    cards.startDraft('sbg-ke', undefined, NJERI, now);
    expect(() => cards.ready('sbg-ke', NJERI, now)).toThrow(/cannot be made ready yet/);
    cards.saveDraft('sbg-ke', filled(draftTerms()), NJERI, now);
    cards.ready('sbg-ke', NJERI, now);
    expect(() => cards.approve('sbg-ke', 1, undefined, NJERI, now)).toThrow(/A second person approves it/);
    expect(() => cards.approve('sbg-ke', 1, new Date(now + 2 * DAY).toISOString(), OTIENO, now)).toThrow(/30 days from now at the earliest/);
    const v = cards.approve('sbg-ke', 1, undefined, OTIENO, now);
    expect(v.pending[0]).toMatchObject({ status: 'scheduled', approvedBy: 'Otieno K.' });
    expect(cards.inForceFor('KE', now)).toBeUndefined();
    expect(cards.inForceFor('KE', now + 31 * DAY)?.card.version).toBe(1);
    // Kenya's card is Kenya's: Ethiopia has none.
    expect(cards.inForceFor('ET', now + 31 * DAY)).toBeUndefined();
    expect(cards.overview('sbg-et', now).pending).toEqual([]);
  });

  it('where the country says its regulator requires it, a card is filed and cleared before it can be approved', () => {
    publishRow();
    const now = Date.now();
    cards.setSettings('sbg-ke', { filingRequired: true, noticeDays: 0 }, NJERI);
    cards.startDraft('sbg-ke', undefined, NJERI, now);
    cards.saveDraft('sbg-ke', filled(draftTerms()), NJERI, now);
    cards.ready('sbg-ke', NJERI, now);
    expect(() => cards.approve('sbg-ke', 1, undefined, OTIENO, now)).toThrow(/once the regulator has cleared it/);
    expect(() => cards.cleared('sbg-ke', 1, 'CA/2026/1', NJERI, now)).toThrow(/Only a filed card is cleared/);
    cards.filed('sbg-ke', 1, 'CA/2026/114', NJERI, now);
    cards.cleared('sbg-ke', 1, 'CA/2026/114-A', NJERI, now);
    const v = cards.approve('sbg-ke', 1, undefined, OTIENO, now);
    expect(v.inForce).toMatchObject({ version: 1, filedRef: 'CA/2026/114', clearedRef: 'CA/2026/114-A' });
    expect(entities.changes('sbg-ke').map((c) => c.to)).toContain('price card 1: filed with the regulator (CA/2026/114)');
  });

  it('a card on its way can be withdrawn; one in force is replaced, never withdrawn', () => {
    publishRow();
    const now = Date.now();
    cards.setSettings('sbg-ke', { noticeDays: 0 }, NJERI);
    cards.startDraft('sbg-ke', undefined, NJERI, now);
    cards.saveDraft('sbg-ke', filled(draftTerms()), NJERI, now);
    cards.ready('sbg-ke', NJERI, now);
    cards.approve('sbg-ke', 1, undefined, OTIENO, now);
    expect(() => cards.withdraw('sbg-ke', 1, NJERI, now)).toThrow(/replaced by a new one/);
    cards.startDraft('sbg-ke', undefined, NJERI, now);
    cards.saveDraft('sbg-ke', filled(draftTerms()), NJERI, now);
    cards.ready('sbg-ke', NJERI, now);
    cards.approve('sbg-ke', 2, new Date(now + 5 * DAY).toISOString(), OTIENO, now);
    const v = cards.withdraw('sbg-ke', 2, NJERI, now);
    expect(v.history.map((c) => [c.version, c.status])).toEqual([[2, 'withdrawn']]);
    expect(cards.inForceFor('KE', now + 6 * DAY)?.card.version).toBe(1);
  });

  it('puts an estimated cost beside each price, at the country’s own starting figures', () => {
    publishRow();
    cards.startDraft('sbg-ke', undefined, NJERI);
    cards.saveDraft('sbg-ke', filled(draftTerms()), NJERI);
    const costs = cards.overview('sbg-ke').costs;
    expect(costs).toHaveLength(24);
    const nationalHeavy = costs.find((c) => c.band === 'national' && c.stepKg === 30)!;
    const localLight = costs.find((c) => c.band === 'local' && c.stepKg === 1)!;
    expect(nationalHeavy.cost).toBeGreaterThan(localLight.cost);
    expect(nationalHeavy.price).toBe(1160);
  });
});
