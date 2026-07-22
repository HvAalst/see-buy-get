import { describe, expect, it } from 'vitest';
import {
  LADDER,
  journeyLine,
  ladderIndex,
  money,
  normalizeKey,
  pointLine,
  priceCards,
  quoteSummary,
  selectablePoints,
  statusPresentation,
  stepTime,
  trackSummary,
} from './logic';
import type { NetworkPoint, QuoteView, TrackView } from './types';

const point = (over: Partial<NetworkPoint> = {}): NetworkPoint => ({
  did: 'did:a',
  shopName: 'Mama Njeri',
  zone: 'Z-A',
  openState: 'open',
  pricePerParcel: 1.5,
  ...over,
});

const quote = (over: Partial<QuoteView> = {}): QuoteView => ({
  hops: [
    { type: 'pudo', id: 'a', label: 'Mama Njeri' },
    { type: 'mdp', id: 'm', label: 'Central hub' },
    { type: 'pudo', id: 'b', label: 'Riverside' },
  ],
  nodes: [],
  legs: [],
  totalKm: 12.4,
  nodeFees: 2,
  size: 'M',
  perKm: { min: 0.2, max: 0.5 },
  platformFeePct: 10,
  flexible: { transport: 4, base: 6, total: 6.6 },
  locked: { transport: 2, base: 4, total: 4.4 },
  ...over,
});

describe('selectablePoints', () => {
  it('excludes the origin, puts open shops first, then A→Z', () => {
    const pts = [
      point({ did: 'z', shopName: 'Zed', openState: 'closed' }),
      point({ did: 'b', shopName: 'Bees' }),
      point({ did: 'a', shopName: 'Apex' }),
      point({ did: 'x', shopName: 'Excluded' }),
    ];
    expect(selectablePoints(pts, 'x').map((p) => p.shopName)).toEqual(['Apex', 'Bees', 'Zed']);
    expect(selectablePoints(null)).toEqual([]);
  });

  it('pointLine folds zone, landmark, price and rating into one sentence', () => {
    expect(pointLine(point({ landmark: 'By the mosque', rating: { count: 12, average: 4.62 } }))).toBe(
      'Zone Z-A · By the mosque · 1.50 handling · rated 4.6',
    );
    expect(pointLine(point())).toBe('Zone Z-A · 1.50 handling');
  });
});

describe('quote presentation', () => {
  it('price cards run cheapest first — never anchored on the dear option', () => {
    const cards = priceCards(quote());
    expect(cards.map((c) => c.key)).toEqual(['locked', 'flexible']);
    expect(cards[0].total).toBeLessThan(cards[1].total);
  });

  it('journeyLine names every hop', () => {
    expect(journeyLine(quote())).toBe('Mama Njeri → Central hub → Riverside');
  });

  it('quoteSummary speaks distance, stops and both prices', () => {
    expect(quoteSummary(quote())).toBe('12 kilometres across 3 stops. Cheapest 4.40, fastest 6.60.');
  });
});

describe('track', () => {
  it('normalizeKey survives scanners and thumbs', () => {
    expect(normalizeKey('  t-9f3a ')).toBe('T-9F3A');
  });

  it('the ladder covers the happy path in order; the two failure states sit off it', () => {
    expect(LADDER).toEqual(['Created', 'At_PUDO', 'On_Bus', 'At_MDP', 'Ready_For_Pickup', 'Delivered']);
    expect(ladderIndex('On_Bus')).toBe(2);
    expect(ladderIndex('Disputed')).toBe(-1);
  });

  it('every status has plain words and a drawable icon', () => {
    for (const s of [...LADDER, 'Disputed', 'Voided'] as const) {
      const p = statusPresentation(s);
      expect(p.word.length).toBeGreaterThan(0);
      expect(p.icon.length).toBeGreaterThan(0);
    }
    expect(statusPresentation('Ready_For_Pickup')).toEqual({ word: 'Ready to collect', icon: 'box', tone: 'ok' });
  });

  it('trackSummary names the destination only once the parcel is there', () => {
    const t = (status: TrackView['status']): TrackView => ({
      ref: 'P-1',
      status,
      size: 'M',
      destination: 'Riverside',
      destZone: 'Z-B',
      steps: [],
    });
    expect(trackSummary(t('On_Bus'))).toBe('Parcel P-1: on the bus.');
    expect(trackSummary(t('Ready_For_Pickup'))).toBe('Parcel P-1: ready to collect at Riverside.');
  });

  it('stepTime falls back to the raw string on garbage', () => {
    expect(stepTime('not-a-date')).toBe('not-a-date');
    expect(money(4.4)).toBe('4.40');
  });
});
