import { describe, expect, it } from 'vitest';
import { t } from '../../shared/i18n'; // English is the base catalog, so the real `t` yields the English literals
import {
  SWATCH_COUNT,
  addToQueue,
  bagLine,
  dropFromQueue,
  fillPercent,
  fillingBags,
  findMyHub,
  floorOpen,
  freeBags,
  hubPapersStep,
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

  it('status filters: filling / free / loadable (at the hub, not gone, and non-empty — a closed bag too)', () => {
    const totes = [
      tote({ code: 'BAG-1' }),
      tote({ code: 'BAG-2', status: 'free', parcels: [] }),
      tote({ code: 'BAG-3', parcels: [] }),
      tote({ code: 'BAG-4', status: 'in_transit' }),
      tote({ code: 'BAG-5', status: 'available', closedWith: 'seal' }),
      tote({ code: 'BAG-6', status: 'claimed', closedWith: 'photo' }),
    ];
    expect(fillingBags(totes).map((t) => t.code)).toEqual(['BAG-1', 'BAG-3']);
    expect(freeBags(totes).map((t) => t.code)).toEqual(['BAG-2']);
    expect(loadableBags(totes).map((t) => t.code)).toEqual(['BAG-1', 'BAG-5', 'BAG-6']);
  });

  it('bagLine says destination and count in plain words', () => {
    expect(bagLine(tote({ destinationLabel: 'Mama Njeri', parcels: ['a', 'b'] }), t)).toBe('→ Mama Njeri · 2 parcels');
    expect(bagLine(tote({ destinationLabel: undefined, destinationNodeId: undefined }), t)).toBe('→ unassigned · 1 parcel');
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
    expect(placeLine(sort('pudo'), t)).toBe('→ Riverside (last mile)');
    expect(placeLine(sort('mdp'), t)).toBe('→ Riverside (onward hub)');
  });
});

describe('priceBand', () => {
  const bm: Benchmark = { count: 4, median: 0.5, p25: 0.4, p75: 0.6, min: 0.3, max: 0.8 };

  it('mirrors the agent band with hub wording', () => {
    expect(priceBand(0.75, bm, t, 'KES')?.headline).toContain('50% more than nearby hubs');
    expect(priceBand(0.5, bm, t, 'KES')?.showMatch).toBe(false);
    expect(priceBand(0.75, null, t, 'KES')).toBeNull();
  });

  it('is not shown at all without the money the hubs were compared in', () => {
    expect(priceBand(0.75, bm, t)).toBeNull();
  });

  it('says every fee in that money', () => {
    const b = priceBand(0.75, bm, t, 'ETB');
    for (const fee of ['ETB 0.75', 'ETB 0.50', 'ETB 0.30', 'ETB 0.80']) expect(b?.detail).toContain(fee);
    expect(b?.matchLabel).toContain('ETB 0.50');
  });
});

describe('speaking', () => {
  it('reads the floor state in plain words', () => {
    expect(homeSummary(1, 2, t)).toBe('1 parcel to sort. 2 outbound bags building.');
    expect(sortSummary(0, null, t)).toContain('queue is empty');
    expect(
      sortSummary(3, {
        parcelId: 'P-1',
        nextDestination: { type: 'pudo', id: 'x', label: 'L', zone: 'z' },
        toteCode: 'BAG-2',
        toteId: 't',
        fillPct: 10,
      }, t),
    ).toBe('Place parcel P-1 in bag BAG-2. 3 left to sort.');
    expect(money(0.5)).toBe('0.50');
    expect(money(0.5, 'KES')).toBe('KES 0.50');
  });
});

describe('a hub not yet approved: its papers, and whose move it is', () => {
  it('says send, with the reason when they came back; with staff while they are read; nothing once approved', () => {
    expect(hubPapersStep(hub())).toEqual({ kind: 'send' });
    expect(hubPapersStep(hub({ vetting: { state: 'draft' } }))).toEqual({ kind: 'send' });
    expect(hubPapersStep(hub({ vetting: { state: 'draft', refusal: { reason: 'The licence is out of date. ' } } }))).toEqual({ kind: 'send', refusedWhy: 'The licence is out of date' });
    expect(hubPapersStep(hub({ vetting: { state: 'draft', refusal: { reason: '   ' } } }))).toEqual({ kind: 'send' });
    expect(hubPapersStep(hub({ vetting: { state: 'pending' } }))).toEqual({ kind: 'with_staff' });
    expect(hubPapersStep(hub({ vetting: { state: 'approved' } }))).toBeNull();
    expect(hubPapersStep(null)).toBeNull(); // not read yet: nothing said about papers it has not seen
  });

  it('opens the floor only to an approved hub — not one that never said, and not one not read yet', () => {
    expect(floorOpen(hub({ vetting: { state: 'approved' } }))).toBe(true);
    expect([floorOpen(hub()), floorOpen(hub({ vetting: { state: 'pending' } })), floorOpen(hub({ vetting: { state: 'draft' } })), floorOpen(null)]).toEqual([false, false, false, false]);
  });
});
