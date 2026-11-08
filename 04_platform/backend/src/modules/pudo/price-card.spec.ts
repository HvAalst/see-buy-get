import { Test } from '@nestjs/testing';
import { EntityService } from '../../foundation/entity/entity.service';
import { DidService } from '../../foundation/did/did.service';
import { LedgerService } from '../../foundation/ledger/ledger.service';
import { LEDGER_ADAPTER } from '../../foundation/ledger/ledger.types';
import { InMemoryLedgerAdapter } from '../../foundation/ledger/in-memory-ledger.adapter';
import { EventBus } from '../../foundation/events/event-bus.service';
import { ZoneMapService } from './zone-map.service';
import { PriceCardService, type Doer } from './price-card.service';
import { HeuristicRouter } from './router';
import type { PriceCardTerms } from './price-card.types';

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
    cards = new PriceCardService(entities, zones, new HeuristicRouter());
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
