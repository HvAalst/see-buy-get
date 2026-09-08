import { describe, expect, it } from 'vitest';

import { t } from '../../shared/i18n'; // English is the base catalog, so the real `t` yields the English literals
import {
  blockerTone,
  boardDistanceLine,
  boardOriginPin,
  boardSummary,
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
  originReady,
  priceBreakdownLines,
  rateBand,
  roundPrice,
  secondsLeft,
  shiftSummary,
  unlocks,
  usedPercent,
} from './logic';
import type { Benchmark, BoardRow, PriceBreakdown } from './types';

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
    expect(capacitySubLine(600, 800, 1, t)).toBe('Free space out of 800 kg — 1 load claimed.');
    expect(capacitySubLine(600, 800, 3, t)).toBe('Free space out of 800 kg — 3 loads claimed.');
    expect(capacitySubLine(0, 800, 2, t)).toContain('Your van is full');
  });

  it('leads with BAG spaces when those run out first — the constraint kilos cannot express', () => {
    // A bus with 400 kg free and no room for another bag is full in the only way the driver can act on.
    expect(capacitySubLine(400, 800, 2, t, 0)).toContain('No bag space left');
    expect(capacitySubLine(400, 800, 2, t, 0)).toContain('nowhere to put a bag');
    expect(capacitySubLine(400, 800, 1, t, 3)).toBe('Free space out of 800 kg · room for 3 more bag(s) — 1 load claimed.');
    // Weight still wins when it is the one that has actually run out.
    expect(capacitySubLine(0, 800, 2, t, 5)).toContain('Your van is full');
  });
});

describe('rateBand — per-km price against the network median', () => {
  const b: Benchmark = { count: 12, median: 0.8, p25: 0.7, p75: 0.9, min: 0.5, max: 1.2 };

  it('renders nothing without a benchmark — a median of one vehicle is not a market', () => {
    expect(rateBand(0.9, null, t)).toBeNull();
    expect(rateBand(0.9, undefined, t)).toBeNull();
    expect(rateBand(0.9, { ...b, count: 0 }, t)).toBeNull();
  });

  it('computes the whole-percent delta and the legacy wording', () => {
    expect(rateBand(1.0, b, t)?.pct).toBe(25);
    expect(rateBand(1.0, b, t)?.word).toBe('25% above');
    expect(rateBand(0.6, b, t)?.pct).toBe(-25);
    expect(rateBand(0.6, b, t)?.word).toBe('25% below');
  });

  it('treats ±1% as a dead zone, for both the wording and the action', () => {
    const almost = rateBand(0.806, b, t); // +0.75% -> rounds to 1
    expect(almost?.pct).toBe(1);
    expect(almost?.word).toBe('at');
    expect(almost?.showMatch).toBe(false);

    const under = rateBand(0.794, b, t); // -0.75% -> rounds to -1
    expect(under?.word).toBe('at');
    expect(under?.showMatch).toBe(false);

    expect(rateBand(0.82, b, t)?.showMatch).toBe(true); // +2.5%
  });

  it('offers a match price rounded to 3 decimals, matching the display', () => {
    const band = rateBand(1.0, { ...b, median: 0.8266666 }, t);
    expect(band?.matchPrice).toBe(0.827);
    expect(band?.matchLabel).toBe('Match 0.827');
  });

  it('treats a zero median as no delta rather than dividing by zero', () => {
    expect(rateBand(1.0, { ...b, median: 0 }, t)?.pct).toBe(0);
  });

  it('defaults a missing price to zero rather than producing NaN', () => {
    expect(rateBand(null, b, t)?.pct).toBe(-100);
  });

  it('speaks plain language, not just numbers', () => {
    expect(rateBand(1.0, b, t)?.headline).toBe('You charge 25% more than most drivers.');
    expect(rateBand(0.6, b, t)?.headline).toBe('You charge 25% less than most drivers.');
    expect(rateBand(0.8, b, t)?.headline).toBe('You charge about the same as most drivers.');
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
    expect(driverStatusNotice('ACTIVE', t)).toBeNull();
    expect(driverStatusNotice('KYC_PENDING', t)).toContain('kyc pending');
    expect(driverStatusNotice('SUSPENDED', t)).toContain('suspended');
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
    expect(countdownLabel(240, t)).toBe('4 min left');
    expect(countdownLabel(45, t)).toBe('45 sec left');
    expect(countdownLabel(0, t)).toBe('Gone');
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
      t,
    );
    expect(nodes).toEqual([
      { id: 'm1', label: 'North (hub)', lat: 1, lng: 2 },
      { id: 'a1', label: 'Mama Shop', lat: 3, lng: 4 },
    ]);
  });

  it('survives both lists being absent', () => {
    expect(nodeOptions(null, null, t)).toEqual([]);
  });
});

describe('spoken summaries', () => {
  it('spells units out — a synthesiser reads "kg" as two letters', () => {
    expect(shiftSummary('CA 123-456', 640, 2, t)).toBe('On shift with CA 123-456. Remaining capacity 640 kilograms. 2 claimed loads.');
  });

  it('says why an offer list is empty', () => {
    expect(offersSummary(0, t)).toContain('No shipments');
    expect(offersSummary(1, t)).toContain('One shipment');
    expect(offersSummary(4, t)).toContain('4 shipments');
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
    const lines = priceBreakdownLines(price, t);
    expect(lines[0]).toBe('Base fee 10.00');
    expect(lines[1]).toBe('12 km at 0.575 per km');
    expect(lines[2]).toContain('Busy-time rate'); // multiplier > 1
    expect(lines[2]).toContain('15%');
  });

  it('names a quiet-time discount and omits any note at the neutral rate', () => {
    expect(priceBreakdownLines({ ...price, multiplier: 0.8 }, t).some((l) => l.includes('Quiet-time'))).toBe(true);
    expect(priceBreakdownLines({ ...price, multiplier: 1 }, t)).toHaveLength(2); // no surge/discount note
    expect(priceBreakdownLines(undefined, t)).toEqual([]);
  });

  it('FB0a: shows how much of the distance is run empty when the price carries the split', () => {
    const split = priceBreakdownLines({ ...price, deadheadKm: 9, loadedKm: 3 }, t);
    expect(split[2]).toBe('of which 9 km empty to the pickup, 3 km loaded');
    // The split is informational — it sits under the distance line and moves no money.
    expect(split[1]).toBe('12 km at 0.575 per km');
  });

  it('FB0a: says nothing about the split on an older price that has none — it never guesses one', () => {
    // `price` predates the split. Deriving "12 km loaded, 0 empty" would be the most misleading line on the
    // card: it is exactly the figure the driver is judging the job on.
    expect(priceBreakdownLines(price, t).some((l) => l.includes('empty'))).toBe(false);
    // Half a split is not a split.
    expect(priceBreakdownLines({ ...price, deadheadKm: 9 }, t).some((l) => l.includes('empty'))).toBe(false);
  });

  it('FB2: blocker tones group by KIND, so an unheard-of code still renders sensibly', () => {
    expect(blockerTone('legal')).toBe('danger');
    expect(blockerTone('physical')).toBe('danger');
    expect(blockerTone('resolvable')).toBe('warn');
    expect(blockerTone('preference')).toBe('info');
    // Not danger: 'unknown' is us admitting we could not check a bridge, and painting that red would train
    // an operator to ignore the one warning that could actually hurt them.
    expect(blockerTone('unknown')).toBe('idle');
  });

  it('speaks the earning for EITHER kind of load, and stays quiet when there is no figure', () => {
    // Reads `earn`, which a bag has too. It used to read the freight-only price, so a driver who listens
    // rather than reads heard every figure except the one on the bags they were being offered.
    const base = { message: 'Ready.', weightKg: 200, destLabel: 'Site', detourKm: 3 };
    expect(offerSpoken({ ...base, earn: price.total }, t)).toContain('You earn 16.90');
    expect(offerSpoken({ ...base, earn: 3.68 }, t)).toContain('You earn 3.68'); // a bag: handling + road
    expect(offerSpoken(base, t)).not.toContain('You earn'); // uncoupled — nothing to price against
  });

  it('speaks what is IN a bag, and says nothing about contents for a freight', () => {
    // The ear gets the same facts as the eye. How many parcels are in a bag is what the unloading at the
    // far end will actually be — and a freight has no such property to report.
    const base = { message: 'Ready.', weightKg: 200, destLabel: 'Site', detourKm: 3, earn: 3.68 };
    expect(offerSpoken({ ...base, parcels: 4 }, t)).toContain('The bag holds 4 parcels.');
    // …and it has to survive the singular, which "There are 1 parcel" would not.
    expect(offerSpoken({ ...base, parcels: 1 }, t)).toContain('The bag holds 1 parcel.');
    expect(offerSpoken(base, t)).not.toContain('The bag holds');
  });

  it('speaks the cost in MINUTES, split into collecting and carrying', () => {
    // A driver hears "nine extra minutes" and knows at once whether it fits the day; kilometres have to be
    // converted first, and cannot be justified to a vehicle full of passengers at all.
    const base = { message: 'Ready.', weightKg: 200, destLabel: 'Site', detourKm: 3, earn: 3.68 };
    const spoken = offerSpoken({ ...base, collectMin: 4, deliverMin: 11 }, t);
    expect(spoken).toContain('4 extra minutes to collect it, and 11 more to drop it');
    // A destination we could not place says less rather than guessing at the second figure.
    expect(offerSpoken({ ...base, collectMin: 4 }, t)).toContain('4 extra minutes to collect it.');
    expect(offerSpoken({ ...base, collectMin: 4 }, t)).not.toContain('more to drop');
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

describe('the open board (FB2)', () => {
  const row = (over: Partial<BoardRow> = {}): BoardRow => ({
    freightId: `f${Math.random()}`,
    code: 'FRT-001',
    description: 'Pallets',
    pickupLabel: 'Depot',
    destLabel: 'Site',
    weightKg: 400,
    commitMode: 'instant',
    deadheadKm: 5,
    loadedKm: 20,
    totalKm: 25,
    canTake: false,
    blockers: [],
    ...over,
  });
  const priced = (total: number) => ({ baseFee: 10, distanceKm: 25, deadheadKm: 5, loadedKm: 20, ratePerKm: 0.5, multiplier: 1, effectiveRate: 0.5, total });
  const equip = { kind: 'resolvable' as const, code: 'MISSING_EQUIPMENT', message: 'Needs a forklift' };
  const heavy = { kind: 'physical' as const, code: 'OVER_VEHICLE_CAPACITY', message: '12000 kg over' };
  const unchecked = { kind: 'unknown' as const, code: 'ROUTE_NOT_SURVEYED', message: 'Bridges not known' };

  it('counts what ONE change would open up, with what it would pay', () => {
    // The whole reason a load you cannot take is on the screen: "a forklift opens 2 more loads worth 130".
    const [u] = unlocks([
      row({ blockers: [equip], price: priced(80) }),
      row({ blockers: [equip], price: priced(50) }),
      row({ canTake: true, blockers: [] }),
    ]);
    expect(u.code).toBe('MISSING_EQUIPMENT');
    expect(u.loads).toBe(2);
    expect(u.earnings).toBe(130);
  });

  it('IGNORES a load with two obstacles — buying one of them would unlock nothing', () => {
    // The most expensive wrong number this screen could show: promising work an operator still cannot take.
    expect(unlocks([row({ blockers: [equip, heavy], price: priced(80) })])).toEqual([]);
  });

  it('still counts a load whose only other mark is an unchecked route', () => {
    // An unchecked bridge never blocked the load, so the forklift really is the one thing in the way.
    const [u] = unlocks([row({ blockers: [equip, unchecked], price: priced(80) })]);
    expect(u.code).toBe('MISSING_EQUIPMENT');
    expect(u.loads).toBe(1);
  });

  it('never lists a PREFERENCE as something to buy', () => {
    // "The shipper ruled out your body type" is somebody's choice. It belongs on the row, where it can be
    // argued with — not in a list of purchases that would win more work.
    const bs = [{ kind: 'preference' as const, code: 'BODY_EXCLUDED', message: 'Shipper ruled it out' }];
    expect(unlocks([row({ blockers: bs, price: priced(80) })])).toEqual([]);
  });

  it('ranks by what the work is worth, not by how many rows it touches', () => {
    const out = unlocks([
      row({ blockers: [equip], price: priced(10) }),
      row({ blockers: [equip], price: priced(10) }),
      row({ blockers: [heavy], price: priced(400) }),
    ]);
    expect(out[0].code).toBe('OVER_VEHICLE_CAPACITY'); // 400 beats 2 × 10
    expect(out[1].loads).toBe(2);
  });

  it('survives an unpriced board — no vehicle means no earnings, not NaN', () => {
    const [u] = unlocks([row({ blockers: [equip] }), row({ blockers: [equip] })]);
    expect(u.loads).toBe(2);
    expect(u.earnings).toBe(0);
  });

  it('names the EMPTY run first — it is the number the decision turns on', () => {
    const line = boardDistanceLine(row({ deadheadKm: 80, loadedKm: 12, totalKm: 92 }), t);
    expect(line).toBe('80 km empty to reach it, 12 km loaded · 92 km in all');
  });

  it('summarises the board as takeable versus not', () => {
    expect(boardSummary([], t)).toBe('Nothing is posted on the market right now.');
    expect(boardSummary([row({ canTake: true }), row()], t)).toBe('2 loads on the market. 1 you can take, 1 you cannot yet.');
  });
});

describe('where the board is read from (FB3a)', () => {
  const nairobi = { lat: -1.29, lng: 36.82 };
  const mombasa = { lat: -4.04, lng: 39.67 };

  it('prefers the place the operator chose over the device', () => {
    // The whole subject of the board is repositioning. An operator asking about Mombasa gets Mombasa, even
    // while the phone in their hand is certain it is in Nairobi.
    expect(boardOriginPin({ pin: mombasa }, nairobi)).toBe(mombasa);
  });

  it('falls back to the device when nothing was chosen', () => {
    expect(boardOriginPin(null, nairobi)).toBe(nairobi);
    // A chosen origin that never got a pin is not an origin — the device still answers.
    expect(boardOriginPin({ pin: null }, nairobi)).toBe(nairobi);
  });

  it('returns nothing rather than guessing when there is neither', () => {
    // Every distance, every price and the sort order are measured from this point. A default would misprice
    // the entire screen and say nothing about it.
    expect(boardOriginPin(null, null)).toBeNull();
    expect(boardOriginPin({ pin: null }, null)).toBeNull();
  });

  it('needs both a name and a pin before a place can become the origin', () => {
    expect(originReady({ label: 'Mombasa', pin: mombasa })).toBe(true);
    expect(originReady({ label: 'Mombasa', pin: null })).toBe(false); // a name nobody could place
    expect(originReady({ label: '   ', pin: mombasa })).toBe(false); // a pin nothing can call back
    expect(originReady({ label: '', pin: null })).toBe(false);
  });
});
