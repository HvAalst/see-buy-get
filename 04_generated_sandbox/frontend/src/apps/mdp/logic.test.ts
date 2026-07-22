import { describe, expect, it } from 'vitest';
import {
  SWATCH_COUNT,
  addToQueue,
  bagLine,
  dropFromQueue,
  fillPercent,
  fillingBags,
  findMyHub,
  freeBags,
  homeSummary,
  loadableBags,
  money,
  placeLine,
  priceBand,
  sortSummary,
  sortedWaitingAt,
  swatchIndex,
  unsortedAt,
} from './logic';
import type { Benchmark, MdpView, ParcelRow, SortView, ToteView } from './types';

const hub = (over: Partial<MdpView> = {}): MdpView => ({
  mdpId: 'mdp_1',
  did: 'did:glos:mdp:1',
  name: 'Central Sort',
  zones: ['Z-A', 'Z-B'],
  pricePerParcel: 0.5,
  ...over,
});

const tote = (over: Partial<ToteView> = {}): ToteView => ({
  toteId: 'tote_1',
  code: 'BAG-001',
  status: 'filling',
  locationId: 'mdp_1',
  parcels: ['P-1'],
  unitsUsed: 3,
  weightKg: 4,
  ...over,
});

const row = (over: Partial<ParcelRow> = {}): ParcelRow => ({
  parcelId: 'P-1',
  size: 'M',
  status: 'At_MDP',
  destZone: 'Z-B',
  atMdpId: 'mdp_1',
  ...over,
});

describe('findMyHub', () => {
  it('resolves the hub whose DID the token is bound to', () => {
    const mine = hub();
    expect(findMyHub([hub({ did: 'did:x', mdpId: 'other' }), mine], 'did:glos:mdp:1')).toBe(mine);
    expect(findMyHub([mine], 'did:unknown')).toBeNull();
    expect(findMyHub(null, 'did:glos:mdp:1')).toBeNull();
  });
});

describe('queue', () => {
  it('unsorted = physically here and still loose; sorted-waiting = already in a bag', () => {
    const rows = [
      row({ parcelId: 'A' }),
      row({ parcelId: 'B', toteId: 'tote_9' }),
      row({ parcelId: 'C', atMdpId: 'elsewhere' }),
    ];
    expect(unsortedAt(rows, 'mdp_1').map((p) => p.parcelId)).toEqual(['A']);
    expect(sortedWaitingAt(rows, 'mdp_1').map((p) => p.parcelId)).toEqual(['B']);
  });

  it('addToQueue dedupes while keeping the pile order; dropFromQueue removes one', () => {
    expect(addToQueue(['A', 'B'], ['B', 'C'])).toEqual(['A', 'B', 'C']);
    expect(dropFromQueue(['A', 'B', 'C'], 'B')).toEqual(['A', 'C']);
  });
});

describe('swatchIndex', () => {
  it('is stable, in range, and matches the legacy 31-hash', () => {
    // legacy: for 'did:pudo:x' → h*31+code over the string, mod 8
    let h = 0;
    for (const c of 'did:pudo:x') h = (h * 31 + c.charCodeAt(0)) >>> 0;
    expect(swatchIndex('did:pudo:x')).toBe(h % SWATCH_COUNT);
    expect(swatchIndex('did:pudo:x')).toBe(swatchIndex('did:pudo:x'));
    expect(swatchIndex(undefined)).toBe(0);
    for (const id of ['a', 'zz', 'mdp_123', 'did:glos:agent:9']) {
      expect(swatchIndex(id)).toBeGreaterThanOrEqual(0);
      expect(swatchIndex(id)).toBeLessThan(SWATCH_COUNT);
    }
  });
});

describe('bags', () => {
  it('fillPercent uses the 10-unit bag and clamps at 100', () => {
    expect(fillPercent(0)).toBe(0);
    expect(fillPercent(3)).toBe(30);
    expect(fillPercent(14)).toBe(100);
  });

  it('status filters: filling / free / loadable (filling AND non-empty)', () => {
    const totes = [
      tote({ code: 'BAG-1' }),
      tote({ code: 'BAG-2', status: 'free', parcels: [] }),
      tote({ code: 'BAG-3', parcels: [] }),
      tote({ code: 'BAG-4', status: 'in_transit' }),
    ];
    expect(fillingBags(totes).map((t) => t.code)).toEqual(['BAG-1', 'BAG-3']);
    expect(freeBags(totes).map((t) => t.code)).toEqual(['BAG-2']);
    expect(loadableBags(totes).map((t) => t.code)).toEqual(['BAG-1']);
  });

  it('bagLine says destination and count in plain words', () => {
    expect(bagLine(tote({ destinationLabel: 'Mama Njeri', parcels: ['a', 'b'] }))).toBe('→ Mama Njeri · 2 parcels');
    expect(bagLine(tote({ destinationLabel: undefined, destinationNodeId: undefined }))).toBe('→ unassigned · 1 parcel');
  });
});

describe('placeLine', () => {
  const sort = (type: 'pudo' | 'mdp'): SortView => ({
    parcelId: 'P-9',
    nextDestination: { type, id: 'x', label: 'Riverside', zone: 'Z-B' },
    toteCode: 'BAG-007',
    toteId: 't',
    fillPct: 40,
  });

  it('names the hop kind a worker understands', () => {
    expect(placeLine(sort('pudo'))).toBe('→ Riverside (last mile)');
    expect(placeLine(sort('mdp'))).toBe('→ Riverside (onward hub)');
  });
});

describe('priceBand', () => {
  const bm: Benchmark = { count: 4, median: 0.5, p25: 0.4, p75: 0.6, min: 0.3, max: 0.8 };

  it('mirrors the agent band with hub wording', () => {
    expect(priceBand(0.75, bm)?.headline).toContain('50% more than nearby hubs');
    expect(priceBand(0.5, bm)?.showMatch).toBe(false);
    expect(priceBand(0.75, null)).toBeNull();
  });
});

describe('speaking', () => {
  it('reads the floor state in plain words', () => {
    expect(homeSummary(1, 2)).toBe('1 parcel to sort. 2 outbound bags building.');
    expect(sortSummary(0, null)).toContain('queue is empty');
    expect(
      sortSummary(3, {
        parcelId: 'P-1',
        nextDestination: { type: 'pudo', id: 'x', label: 'L', zone: 'z' },
        toteCode: 'BAG-2',
        toteId: 't',
        fillPct: 10,
      }),
    ).toBe('Place parcel P-1 in bag BAG-2. 3 left to sort.');
    expect(money(0.5)).toBe('0.50');
  });
});
