import { describe, expect, it } from 'vitest';
import {
  canLoadBag,
  canStartShift,
  capacitySubLine,
  claimControl,
  countdownLabel,
  driverStatusNotice,
  isFull,
  lastReadingBreached,
  minEarnFilter,
  money,
  nodeOptions,
  offerSpoken,
  offersSummary,
  priceBreakdownLines,
  rateBand,
  roundPrice,
  secondsLeft,
  shiftSummary,
  usedPercent,
} from './logic';
import type { Benchmark, PriceBreakdown } from './types';

describe('usedPercent — the capacity bar', () => {
  it('reports the used share of capacity', () => {
    expect(usedPercent(800, 600)).toBe(25);
    expect(usedPercent(800, 800)).toBe(0);
    expect(usedPercent(800, 0)).toBe(100);
  });

  it('rounds to a whole percent', () => {
    expect(usedPercent(3, 2)).toBe(33);
    expect(usedPercent(1000, 333)).toBe(67);
  });

  it('guards divide-by-zero — a 0 kg vehicle reads 0%, never NaN', () => {
    expect(usedPercent(0, 0)).toBe(0);
    expect(usedPercent(null, 40)).toBe(0);
    expect(usedPercent(undefined, 40)).toBe(0);
  });

  it('clamps a negative remaining to 100% (capacity can be cut mid-shift)', () => {
    // 800 kg van, office drops it to 500 after 540 kg is already claimed => remaining -40.
    expect(usedPercent(500, -40)).toBe(100);
    expect(isFull(-40)).toBe(true);
  });

  it('clamps a remaining larger than capacity to 0%', () => {
    expect(usedPercent(500, 900)).toBe(0);
  });

  it('says how much room is left in plain language', () => {
    expect(capacitySubLine(600, 800, 1)).toBe('Free space out of 800 kg — 1 load claimed.');
    expect(capacitySubLine(600, 800, 3)).toBe('Free space out of 800 kg — 3 loads claimed.');
    expect(capacitySubLine(0, 800, 2)).toContain('Your van is full');
  });
});

describe('rateBand — per-km price against the network median', () => {
  const b: Benchmark = { count: 12, median: 0.8, p25: 0.7, p75: 0.9, min: 0.5, max: 1.2 };

  it('renders nothing without a benchmark — a median of one vehicle is not a market', () => {
    expect(rateBand(0.9, null)).toBeNull();
    expect(rateBand(0.9, undefined)).toBeNull();
    expect(rateBand(0.9, { ...b, count: 0 })).toBeNull();
  });

  it('computes the whole-percent delta and the legacy wording', () => {
    expect(rateBand(1.0, b)?.pct).toBe(25);
    expect(rateBand(1.0, b)?.word).toBe('25% above');
    expect(rateBand(0.6, b)?.pct).toBe(-25);
    expect(rateBand(0.6, b)?.word).toBe('25% below');
  });

  it('treats ±1% as a dead zone, for both the wording and the action', () => {
    const almost = rateBand(0.806, b); // +0.75% -> rounds to 1
    expect(almost?.pct).toBe(1);
    expect(almost?.word).toBe('at');
    expect(almost?.showMatch).toBe(false);

    const under = rateBand(0.794, b); // -0.75% -> rounds to -1
    expect(under?.word).toBe('at');
    expect(under?.showMatch).toBe(false);

    expect(rateBand(0.82, b)?.showMatch).toBe(true); // +2.5%
  });

  it('offers a match price rounded to 3 decimals, matching the display', () => {
    const band = rateBand(1.0, { ...b, median: 0.8266666 });
    expect(band?.matchPrice).toBe(0.827);
    expect(band?.matchLabel).toBe('Match 0.827');
  });

  it('treats a zero median as no delta rather than dividing by zero', () => {
    expect(rateBand(1.0, { ...b, median: 0 })?.pct).toBe(0);
  });

  it('defaults a missing price to zero rather than producing NaN', () => {
    expect(rateBand(null, b)?.pct).toBe(-100);
  });

  it('speaks plain language, not just numbers', () => {
    expect(rateBand(1.0, b)?.headline).toBe('You charge 25% more than most drivers.');
    expect(rateBand(0.6, b)?.headline).toBe('You charge 25% less than most drivers.');
    expect(rateBand(0.8, b)?.headline).toBe('You charge about the same as most drivers.');
  });

  it('rounds a price to 3 decimals', () => {
    expect(roundPrice(0.8266666)).toBe(0.827);
    expect(roundPrice(1)).toBe(1);
  });
});

describe('driver status gate', () => {
  it('blocks a shift until the office activates the driver', () => {
    expect(canStartShift('ACTIVE')).toBe(true);
    expect(canStartShift('KYC_PENDING')).toBe(false);
    expect(canStartShift(undefined)).toBe(false);
  });

  it('explains the block without underscores or shouting', () => {
    expect(driverStatusNotice('ACTIVE')).toBeNull();
    expect(driverStatusNotice('KYC_PENDING')).toContain('kyc pending');
    expect(driverStatusNotice('SUSPENDED')).toContain('suspended');
  });
});

describe('offer countdown', () => {
  const now = Date.parse('2026-07-21T10:00:00.000Z');

  it('counts down to the expiry instant', () => {
    expect(secondsLeft('2026-07-21T10:04:00.000Z', now)).toBe(240);
    expect(secondsLeft('2026-07-21T09:59:00.000Z', now)).toBe(0);
    expect(secondsLeft('not-a-date', now)).toBe(0);
  });

  it('labels the remaining time in words', () => {
    expect(countdownLabel(240)).toBe('4 min left');
    expect(countdownLabel(45)).toBe('45 sec left');
    expect(countdownLabel(0)).toBe('Gone');
  });
});

describe('claim rows', () => {
  const tote = { kind: 'tote' as const, ref: 'T1', pickupLabel: 'Mama Shop', destLabel: 'Hub', weightKg: 12 };

  it('offers a scan for a tote still waiting at a shop', () => {
    expect(claimControl(tote)).toBe('load');
  });

  it('shows nothing to do once it is on board', () => {
    expect(claimControl({ ...tote, pickupLabel: 'on board' })).toBe('onboard');
  });

  it('drives claimed freight through pickup then deliver (S32b)', () => {
    expect(claimControl({ ...tote, kind: 'freight', status: 'claimed' })).toBe('pickup');
    expect(claimControl({ ...tote, kind: 'freight', status: 'in_transit' })).toBe('deliver');
    expect(claimControl({ ...tote, kind: 'freight' })).toBe('none'); // no status → nothing actionable
  });

  it('requires a badge before a bag can be loaded (no badge, no payout)', () => {
    expect(canLoadBag('BADGE-1')).toBe(true);
    expect(canLoadBag(undefined)).toBe(false);
    expect(canLoadBag('')).toBe(false);
  });
});

describe('route node list', () => {
  it('merges hubs and shops, and drops shops with no location', () => {
    const nodes = nodeOptions(
      [{ mdpId: 'm1', name: 'North', location: { lat: 1, lng: 2 } }],
      [
        { did: 'a1', shopName: 'Mama Shop', location: { lat: 3, lng: 4 } },
        { did: 'a2', shopName: 'Nowhere Shop' },
      ],
    );
    expect(nodes).toEqual([
      { id: 'm1', label: 'North (hub)', lat: 1, lng: 2 },
      { id: 'a1', label: 'Mama Shop', lat: 3, lng: 4 },
    ]);
  });

  it('survives both lists being absent', () => {
    expect(nodeOptions(null, null)).toEqual([]);
  });
});

describe('spoken summaries', () => {
  it('spells units out — a synthesiser reads "kg" as two letters', () => {
    expect(shiftSummary('CA 123-456', 640, 2)).toBe('On shift with CA 123-456. Remaining capacity 640 kilograms. 2 claimed loads.');
  });

  it('says why an offer list is empty', () => {
    expect(offersSummary(0)).toContain('No shipments');
    expect(offersSummary(1)).toContain('One shipment');
    expect(offersSummary(4)).toContain('4 shipments');
  });
});

describe('freight pricing (S34)', () => {
  const price: PriceBreakdown = { baseFee: 10, distanceKm: 12, ratePerKm: 0.5, multiplier: 1.15, effectiveRate: 0.575, total: 16.9 };

  it('money is two decimals, no symbol, safe on nullish', () => {
    expect(money(16.9)).toBe('16.90');
    expect(money(undefined)).toBe('0.00');
    expect(money(null)).toBe('0.00');
  });

  it('breaks a price into plain lines a driver can trust', () => {
    const lines = priceBreakdownLines(price);
    expect(lines[0]).toBe('Base fee 10.00');
    expect(lines[1]).toBe('12 km at 0.575 per km');
    expect(lines[2]).toContain('Busy-time rate'); // multiplier > 1
    expect(lines[2]).toContain('15%');
  });

  it('names a quiet-time discount and omits any note at the neutral rate', () => {
    expect(priceBreakdownLines({ ...price, multiplier: 0.8 }).some((l) => l.includes('Quiet-time'))).toBe(true);
    expect(priceBreakdownLines({ ...price, multiplier: 1 })).toHaveLength(2); // no surge/discount note
    expect(priceBreakdownLines(undefined)).toEqual([]);
  });

  it('adds the earning to the spoken offer only when the load is priced', () => {
    const base = { message: 'Ready.', weightKg: 200, destLabel: 'Site', detourKm: 3 };
    expect(offerSpoken({ ...base, price })).toContain('You earn 16.90');
    expect(offerSpoken(base)).not.toContain('You earn');
  });

  it('minEarnFilter keeps only a finite POSITIVE floor — everything else means "show all"', () => {
    expect(minEarnFilter('20')).toBe(20);
    expect(minEarnFilter('12.5')).toBe(12.5);
    expect(minEarnFilter('')).toBeUndefined(); // blank
    expect(minEarnFilter('0')).toBeUndefined(); // zero = no floor
    expect(minEarnFilter('-5')).toBeUndefined(); // a negative must NOT reach the backend's @Min(0)
    expect(minEarnFilter('abc')).toBeUndefined(); // junk
    expect(minEarnFilter(undefined)).toBeUndefined();
  });

  it('lastReadingBreached reflects THIS reading, not the sticky freight flag (S33b)', () => {
    expect(lastReadingBreached([{ breach: false }])).toBe(false);
    expect(lastReadingBreached([{ breach: true }])).toBe(true);
    // A recovery after a breach: the last reading is in-band → NOT a fresh alert, even though the freight
    // stayed flagged. This is the exact case the sticky flag would have mis-warned.
    expect(lastReadingBreached([{ breach: true }, { breach: false }])).toBe(false);
    expect(lastReadingBreached([])).toBe(false);
    expect(lastReadingBreached(undefined)).toBe(false);
  });
});
