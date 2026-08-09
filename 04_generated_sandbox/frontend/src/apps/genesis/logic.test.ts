import { describe, expect, it } from 'vitest';
import {
  LADDER,
  cleanPhone,
  codeReady,
  dimsBlocker,
  isOffLadder,
  journeyLine,
  ladderIndex,
  lockedPrice,
  mapsHref,
  mintChecklist,
  money,
  normalizeKey,
  parcelRowLine,
  parseDims,
  phoneBlocker,
  phoneReady,
  pinBlocker,
  pointDistance,
  pointLine,
  quoteSummary,
  sizeMeta,
  relationWord,
  roleMeta,
  selectablePoints,
  showCollectCard,
  sortForPerson,
  statusPresentation,
  stepTime,
  trackSummary,
} from './logic';
import type { ConsumerParcelView, NetworkPoint, QuoteView, TrackView } from './types';

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

  it('with a reference point (typed place words), open shops sort nearest-first with a distance label', () => {
    const near = { lat: -1.3, lng: 36.84 };
    const pts = [
      point({ did: 'far', shopName: 'Far', location: { lat: -1.2, lng: 36.7 } }),
      point({ did: 'close', shopName: 'Close', location: { lat: -1.301, lng: 36.841 } }),
      point({ did: 'nowhere', shopName: 'NoPin' }),
    ];
    expect(selectablePoints(pts, undefined, near).map((p) => p.did)).toEqual(['close', 'far', 'nowhere']);
    expect(pointDistance(pts[1], near)).toContain('m away');
    expect(pointDistance(pts[2], near)).toBeNull();
  });

  it('pointLine folds zone, landmark, price and rating into one sentence', () => {
    expect(pointLine(point({ landmark: 'By the mosque', rating: { count: 12, average: 4.62 } }))).toBe(
      'Zone Z-A · By the mosque · 1.50 handling · rated 4.6',
    );
    expect(pointLine(point())).toBe('Zone Z-A · 1.50 handling');
  });
});

describe('quote presentation', () => {
  it('the ONE price shown is the locked (cheapest) leg — what a booked send actually costs', () => {
    expect(lockedPrice(quote()).total).toBe(4.4);
  });

  it('journeyLine names every hop', () => {
    expect(journeyLine(quote())).toBe('Mama Njeri → Central hub → Riverside');
  });

  it('quoteSummary speaks distance, stops and the price', () => {
    expect(quoteSummary(quote())).toBe('12 kilometres across 3 stops. The price is 4.40.');
  });
});

describe('dims (PG3)', () => {
  it('parses only a complete, positive set of measurements', () => {
    expect(parseDims({ l: '30', w: '20', h: '10', kg: '1.6' })).toEqual({ l: 30, w: 20, h: 10, kg: 1.6 });
    expect(parseDims({ l: '30', w: '20', h: '', kg: '1.6' })).toBeNull(); // missing
    expect(parseDims({ l: '-30', w: '20', h: '10', kg: '1.6' })).toBeNull(); // a truthy negative must NOT slip through
    expect(parseDims({ l: '30', w: '20', h: '10', kg: '0' })).toBeNull(); // weightless
  });

  it('accepts a thin item (a letter at 0.5 cm) and a decimal comma, down to the 1 mm floor', () => {
    expect(parseDims({ l: '21', w: '10', h: '0.5', kg: '0.02' })).toEqual({ l: 21, w: 10, h: 0.5, kg: 0.02 }); // a letter
    expect(parseDims({ l: '21', w: '10', h: '0,5', kg: '0,02' })).toEqual({ l: 21, w: 10, h: 0.5, kg: 0.02 }); // European comma
    expect(parseDims({ l: '30', w: '20', h: '0.1', kg: '1' })).toEqual({ l: 30, w: 20, h: 0.1, kg: 1 }); // exactly the floor
    expect(parseDims({ l: '30', w: '20', h: '0.05', kg: '1' })).toBeNull(); // below the 1 mm floor
  });

  it('dimsBlocker gates the Continue in plain words', () => {
    expect(dimsBlocker({ l: '', w: '', h: '', kg: '' })).toContain('Measure the parcel');
    expect(dimsBlocker({ l: '30', w: '20', h: '10', kg: '1.6' })).toBe('');
  });

  it('sizeMeta gives the derived tier its plain words', () => {
    expect(sizeMeta('M').label).toBe('Medium');
    expect(sizeMeta('HEAVY').hint).toBe('Over 20 kg');
  });

  it('mintChecklist tells the sender the three things that matter', () => {
    const items = mintChecklist('Mama Njeri', 4.4);
    expect(items[0]).toContain('Mama Njeri');
    expect(items[1]).toContain('4.40');
    expect(items).toHaveLength(3);
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

  it('the collect card shows only when a receiver can act, and the way link needs a pin', () => {
    expect(showCollectCard('Ready_For_Pickup')).toBe(true);
    expect(showCollectCard('Delivered')).toBe(true);
    expect(showCollectCard('On_Bus')).toBe(false);
    expect(mapsHref({ destination: 'Riverside', destinationLocation: { lat: -1.3, lng: 36.84 } })).toBe(
      'https://www.google.com/maps?q=-1.3%2C36.84',
    );
    expect(mapsHref({ destination: 'Riverside' })).toBeNull();
  });
});

describe('Send app — identity + my-parcels logic (S21)', () => {
  it('cleans a typed phone to digits + a single leading plus', () => {
    expect(cleanPhone('  0712 345 678 ')).toBe('0712345678');
    expect(cleanPhone('+254 (712) 345-678')).toBe('+254712345678');
    expect(cleanPhone('++12ab34')).toBe('+1234');
  });

  it('gates the phone and PIN CTAs on readiness', () => {
    expect(phoneReady('0712345678')).toBe(true);
    expect(phoneReady('12345')).toBe(false);
    expect(phoneBlocker('0712345678')).toBe('');
    expect(phoneBlocker('123')).toMatch(/phone/i);
    expect(codeReady('1234', 4)).toBe(true);
    expect(codeReady('123', 4)).toBe(false);
    expect(codeReady('123456', 6)).toBe(true);
    expect(codeReady('12a4', 4)).toBe(false);
    expect(pinBlocker('1234')).toBe('');
    expect(pinBlocker('12')).toMatch(/PIN/);
  });

  it('gives every role a plain label + a real icon name', () => {
    expect(roleMeta('consumer').label).toBe('You');
    expect(roleMeta('driver').icon).toBe('truck');
    expect(roleMeta('fleet_manager').label).toBe('Fleet');
  });

  it('describes a parcel from the person\'s side', () => {
    expect(relationWord('received')).toMatch(/you/i);
    expect(relationWord('sent')).toMatch(/sending/i);
    const recv = mkParcel({ relation: 'received', originZone: 'NorthTown', vendorOrder: true });
    expect(parcelRowLine(recv)).toBe('From NorthTown · Store order');
    const sent = mkParcel({ relation: 'sent', destZone: 'EastTown', vendorOrder: false });
    expect(parcelRowLine(sent)).toBe('To EastTown · Personal send');
  });

  it('sorts a person\'s parcels: act-now first, then in-flight, then done — newest within each', () => {
    const list = [
      mkParcel({ parcelId: 'DONE', status: 'Delivered', updatedAt: '2026-07-20T10:00:00Z' }),
      mkParcel({ parcelId: 'FLYING', status: 'On_Bus', updatedAt: '2026-07-21T10:00:00Z' }),
      mkParcel({ parcelId: 'READY', status: 'Ready_For_Pickup', updatedAt: '2026-07-19T10:00:00Z' }),
      mkParcel({ parcelId: 'FLYING2', status: 'At_MDP', updatedAt: '2026-07-22T10:00:00Z' }),
    ];
    expect(sortForPerson(list).map((p) => p.parcelId)).toEqual(['READY', 'FLYING2', 'FLYING', 'DONE']);
  });

  it('marks cancelled/disputed parcels as off the ladder', () => {
    expect(isOffLadder('Voided')).toBe(true);
    expect(isOffLadder('Disputed')).toBe(true);
    expect(isOffLadder('On_Bus')).toBe(false);
  });
});

function mkParcel(over: Partial<ConsumerParcelView>): ConsumerParcelView {
  return {
    parcelId: 'P-1',
    relation: 'sent',
    direction: 'outbound',
    status: 'At_PUDO',
    originZone: 'A',
    destZone: 'B',
    size: 'M',
    vendorOrder: false,
    createdAt: '2026-07-20T09:00:00Z',
    updatedAt: '2026-07-20T09:00:00Z',
    timeline: [],
    ...over,
  };
}
