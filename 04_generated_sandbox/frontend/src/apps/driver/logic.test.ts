import { describe, expect, it } from 'vitest';

import { t } from '../../shared/i18n'; // English is the base catalog, so the real `t` yields the English literals
import {
  afterShiftLine,
  hoursWords,
  restSays,
  blockerTone,
  roadBlocks,
  roadMeasure,
  roadSummary,
  roadTone,
  roadValueLabel,
  boardDistanceLine,
  boardOriginPin,
  boardSummary,
  canLoadBag,
  canStartShift,
  capacitySubLine,
  claimControl,
  countdownLabel,
  driverStatusNotice,
  removalWords,
  removedLine,
  leftDetail,
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
    // NAMED AFTER WHAT THEY ACTUALLY RIDE. A caller who passes no word gets the plain noun rather than
    // "van", because a bicycle courier reading "your van is full" is being told the app is for somebody else.
    expect(capacitySubLine(0, 800, 2, t)).toContain('Your vehicle is full');
    expect(capacitySubLine(0, 800, 2, t, undefined, 'bike')).toContain('Your bike is full');
  });

  it('leads with BAG spaces when those run out first — the constraint kilos cannot express', () => {
    // A bus with 400 kg free and no room for another bag is full in the only way the driver can act on.
    expect(capacitySubLine(400, 800, 2, t, 0)).toContain('No bag space left');
    expect(capacitySubLine(400, 800, 2, t, 0)).toContain('nowhere to put a bag');
    expect(capacitySubLine(400, 800, 1, t, 3)).toBe('Free space out of 800 kg · room for 3 more bags — 1 load claimed.');
    // …and "1 more bag", never "1 more bag(s)" — the same rule the licence countdown follows. This sits
    // under the biggest number on the driver's screen, which is the worst place to leave a plural unfinished.
    expect(capacitySubLine(400, 800, 1, t, 1)).toBe('Free space out of 800 kg · room for 1 more bag — 1 load claimed.');
    // Weight still wins when it is the one that has actually run out.
    expect(capacitySubLine(0, 800, 2, t, 5, 'truck')).toContain('Your truck is full');
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

describe('the road, as drivers report it', () => {
  const at = { lat: -1, lng: 36 };
  const c = (over: Partial<{ kind: string; status: string; value: number }> = {}) => ({
    constraintId: 'rc_1',
    kind: 'LOW_BRIDGE',
    at,
    status: 'active',
    reportedAt: '2026-09-08T00:00:00Z',
    confirmations: 0,
    refutations: 0,
    ...over,
  });

  it('asks for the number only where there is one to give', () => {
    // A bridge with no height cannot be checked against any load, so the server refuses it. Asking in the
    // sheet is the difference between one tap and a rejected form at a junction.
    expect(roadMeasure('LOW_BRIDGE')).toBe('height_m');
    expect(roadMeasure('HEIGHT_BARRIER')).toBe('height_m');
    expect(roadMeasure('WEIGHT_LIMIT')).toBe('weight_kg');
    for (const kind of ['NO_HAZMAT', 'WASHOUT', 'FERRY', 'WEIGHBRIDGE', 'CHECKPOINT']) {
      expect(roadMeasure(kind)).toBeNull();
    }
  });

  it('keeps blockers and advisories apart', () => {
    // A board that weights "there is a weighbridge" the same as "this bridge will not take you" teaches a
    // driver to skim past both.
    for (const kind of ['LOW_BRIDGE', 'HEIGHT_BARRIER', 'WEIGHT_LIMIT', 'NO_HAZMAT', 'WASHOUT']) {
      expect(roadBlocks(kind)).toBe(true);
    }
    for (const kind of ['FERRY', 'WEIGHBRIDGE', 'CHECKPOINT']) {
      expect(roadBlocks(kind)).toBe(false);
    }
  });

  it('never softens a DISPUTED hazard — that is the state you must still treat as there', () => {
    // The single most important line on this screen. Somebody saying a low bridge is gone does not make it
    // gone, so dispute changes the sentence beside it and never the weight of the warning.
    expect(roadTone(c({ status: 'active' }))).toBe('danger');
    expect(roadTone(c({ status: 'disputed' }))).toBe('danger');
    expect(roadTone(c({ kind: 'FERRY', status: 'active' }))).toBe('info');
  });

  it('reads a limit back in the units on the sign', () => {
    expect(roadValueLabel(c({ kind: 'LOW_BRIDGE', value: 4.25 }), t)).toBe('4.3 m');
    // Tonnes, because no weight sign anywhere is posted in kilograms.
    expect(roadValueLabel(c({ kind: 'WEIGHT_LIMIT', value: 18_000 }), t)).toBe('18 t');
    expect(roadValueLabel(c({ kind: 'FERRY' }), t)).toBeNull();
    // A measurable kind with no number says nothing rather than inventing one.
    expect(roadValueLabel(c({ kind: 'LOW_BRIDGE' }), t)).toBeNull();
  });

  it('summarises what was REPORTED and never claims the rest of the road', () => {
    // "Nothing reported" has to survive being read quickly by somebody who wants it to mean "clear".
    expect(roadSummary([], t)).toBe('Nothing reported here yet — that is not the same as clear');
    expect(roadSummary([c({ kind: 'FERRY' }), c({ kind: 'WEIGHBRIDGE' })], t)).toBe('2 reported, none of them in your way');
    expect(roadSummary([c(), c({ kind: 'FERRY' })], t)).toBe('2 reported, 1 could stop you');
  });
});

describe('FP8 — the shift clock', () => {
  it('says the hours against the limit, and the plain word once over it', () => {
    expect(hoursWords(undefined, t)).toBeNull();
    expect(hoursWords({ onDuty: 3.2, limit: 13, over: false }, t)).toBe('On duty 3.2 h of 13 h');
    expect(hoursWords({ onDuty: 13.4, limit: 13, over: true }, t)).toBe('On duty 13.4 h — over the 13 h limit');
  });

  it('says the last hour as the last hour — when the server says it is, and never by its own arithmetic', () => {
    expect(hoursWords({ onDuty: 12.3, limit: 13, over: false, near: true }, t)).toBe('On duty 12.3 h of 13 h — less than an hour left');
    expect(hoursWords({ onDuty: 12.3, limit: 13, over: false }, t)).toBe('On duty 12.3 h of 13 h');
    // Past it, the limit is the news; "near" is not.
    expect(hoursWords({ onDuty: 13.1, limit: 13, over: true, near: true }, t)).toBe('On duty 13.1 h — over the 13 h limit');
  });

  it('ending a shift: promises "any time" only where no rest will be owed', () => {
    expect(afterShiftLine({ restHours: 9 }, t)).toBe('You can start a new shift any time');
    expect(afterShiftLine(undefined, t)).toBe('You can start a new shift any time');
    expect(afterShiftLine({ restHours: 9, restOwed: true }, t)).toBe('After a working day you rest: your next shift can start 9 hours from now');
  });

  it('off duty after a working day: says from when they can start, before they try — and whether they asked to be told', () => {
    const clock = (iso: string) => iso.slice(11, 16);
    expect(restSays(undefined, t, clock)).toBeNull();
    expect(restSays({ restHours: 9 }, t, clock)).toBeNull();
    expect(restSays({ restHours: 9, restUntil: '2026-10-10T05:10:00.000Z' }, t, clock)).toEqual({
      title: 'Resting: you can start again from 05:10',
      detail: 'After a working day the next shift waits for 9 hours of rest.',
      asked: false,
    });
    expect(restSays({ restHours: 9, restUntil: '2026-10-10T05:10:00.000Z', tellWhenRested: true }, t, clock)).toEqual({
      title: 'Resting: you can start again from 05:10',
      detail: 'After a working day the next shift waits for 9 hours of rest. We will tell you when you can start.',
      asked: true,
    });
  });
});

describe('removalWords — why a fleet took a driver off, as the driver reads it', () => {
  it('says the coded reason, and always what it means for them', () => {
    expect(removalWords({ reason: 'left' }, t)).toBe('They say you no longer work for them. Your trips, papers and rating stay yours. You cannot start a shift until a fleet offers you a place.');
    expect(removalWords({ reason: 'ended' }, t)).toContain('ended your contract');
  });

  it('quotes the fleet’s own words for "other" — and says nothing invented when it gave none', () => {
    expect(removalWords({ reason: 'other', note: 'Never came back after leave' }, t)).toContain('“Never came back after leave”');
    expect(removalWords({ reason: 'other' }, t)).toBe('Your trips, papers and rating stay yours. You cannot start a shift until a fleet offers you a place.');
  });
});

/**
 * A driver left their fleet by themselves. Nothing a fleet's office might have said is put in its mouth, and the
 * screen does not say a fleet "took them off" when nobody did.
 */
describe('a driver who left their fleet by themselves', () => {
  it('is told what it means, with no fleet’s words in front of it', () => {
    expect(removalWords({ reason: 'own' }, t)).toBe('Your trips, papers and rating stay yours. You cannot start a shift until a fleet offers you a place.');
    // Even if a note were somehow on the record, it is not a fleet's reason and is not shown as one.
    expect(removalWords({ reason: 'own', note: 'left over' }, t)).not.toMatch(/Their reason|They say/);
    // The fleet's three still read as the fleet's.
    expect(removalWords({ reason: 'ended' }, t)).toMatch(/^They say they ended your contract\./);
  });

  it('says what happened as it happened: "you left", or "they took you off"', () => {
    expect(removedLine({ reason: 'own', companyName: 'Kilima Logistics' }, '11 Oct', t)).toBe('You left Kilima Logistics on 11 Oct.');
    for (const reason of ['left', 'ended', 'other'] as const) {
      expect(removedLine({ reason, companyName: 'Kilima Logistics' }, '11 Oct', t)).toBe('Kilima Logistics took you off their fleet on 11 Oct.');
    }
  });

  it('is told what the office was told — and which runs now need somebody else', () => {
    expect(leftDetail([], t)).toBe('Their office has been told.');
    expect(leftDetail(['Nairobi – Nakuru'], t)).toBe('Their office has been told, and that the Nairobi – Nakuru run needs another driver.');
    expect(leftDetail(['Nairobi – Nakuru', 'Nairobi – Eldoret'], t)).toBe('Their office has been told, and that 2 of their runs need another driver.');
  });
});
