import { describe, expect, it } from 'vitest';
import { t } from '../../shared/i18n'; // English is the base catalog, so the real `t` yields the English literals
import {
  BODY_HINTS,
  EMPTY_ACCEPT,
  EXCLUDABLE_BODIES,
  VOID_WINDOW_MS,
  acceptMissing,
  bodyHintValue,
  bookFreightMissing,
  canAccept,
  chooseBodyHint,
  consignmentProgress,
  destinationZones,
  DRIVER_ISSUE_LABELS,
  DURABLE_NATURES,
  excludedBodiesValue,
  gateNotice,
  PACKAGING_OPTIONS,
  packagingValue,
  gridDims,
  parseBudget,
  plannedPickupIso,
  handoverSummary,
  homeSummary,
  isVoidable,
  money,
  otpValid,
  parseDims,
  pointDistance,
  priceBand,
  releaseStage,
  roundMoney,
  selectablePoints,
  sizeMeta,
  statusNotice,
  toggleExcludedBody,
  voidCountdownLabel,
  voidRemainingMs,
  voidableParcels,
  type AcceptForm,
} from './logic';
import type { AgentView, Benchmark, CorridorRow, GateView, NetworkPoint, ParcelView } from './types';

const agent = (over: Partial<AgentView> = {}): AgentView => ({
  agentId: 'ag_1',
  did: 'did:glos:agent:1',
  shopName: 'Mama Njeri',
  zone: 'Z-A',
  openState: 'open',
  pricePerParcel: 1.5,
  status: 'ACTIVE',
  balance: 20,
  ...over,
});

const gate = (over: Partial<GateView> = {}): GateView => ({ ok: true, balance: 20, ...over });

describe('gateNotice', () => {
  it('is silent while the gate is open', () => {
    expect(gateNotice(agent(), gate(), t)).toBeNull();
  });

  it('a locked account outranks a thin wallet', () => {
    const n = gateNotice(agent({ status: 'LOCKED' }), gate({ ok: false, code: 'AGENT_LOCKED', balance: -3 }), t);
    expect(n?.tone).toBe('danger');
    expect(n?.title).toBe('Account locked');
  });

  it('a thin wallet names the exact top-up needed', () => {
    const n = gateNotice(agent(), gate({ ok: false, code: 'WALLET_INSUFFICIENT', balance: 0.4, shortfall: 4.6 }), t);
    expect(n?.tone).toBe('warn');
    expect(n?.detail).toContain('4.60');
  });

  it('canAccept follows the gate alone', () => {
    expect(canAccept(gate())).toBe(true);
    expect(canAccept(gate({ ok: false }))).toBe(false);
    expect(canAccept(null)).toBe(false);
  });
});

describe('statusNotice', () => {
  it('active and locked shops get no onboarding notice', () => {
    expect(statusNotice('ACTIVE', t)).toBeNull();
    expect(statusNotice('LOCKED', t)).toBeNull(); // locked is the gate's story, not onboarding's
  });
  it('a draft shop is told the office must activate it', () => {
    expect(statusNotice('KYC_PENDING', t)).toContain('kyc pending');
  });
});

describe('destinationZones', () => {
  const corridors: CorridorRow[] = [
    { corridorId: 'c1', name: 'A→B', originZone: 'Z-A', destZone: 'Z-B', status: 'active' },
    { corridorId: 'c2', name: 'A→C', originZone: 'Z-A', destZone: 'Z-C', status: 'active' },
    { corridorId: 'c3', name: 'B→A', originZone: 'Z-B', destZone: 'Z-A', status: 'active' },
    { corridorId: 'c4', name: 'A→D', originZone: 'Z-A', destZone: 'Z-D', status: 'paused' },
    { corridorId: 'c5', name: 'A→B dup', originZone: 'Z-A', destZone: 'Z-B', status: 'active' },
  ];

  it('keeps only active corridors leaving my zone, deduplicated', () => {
    expect(destinationZones(corridors, 'Z-A')).toEqual(['Z-B', 'Z-C']);
  });

  it('is empty without corridors or a zone', () => {
    expect(destinationZones(null, 'Z-A')).toEqual([]);
    expect(destinationZones(corridors, undefined)).toEqual([]);
  });
});

describe('acceptMissing', () => {
  const dims = { l: '30', w: '20', h: '10', kg: '1.6' };
  it('walks the redesigned counter flow in order: sticker → measure → destination → photo', () => {
    expect(acceptMissing(EMPTY_ACCEPT, t)).toContain('sticker');
    expect(acceptMissing({ ...EMPTY_ACCEPT, parcelId: 'P-1' }, t)).toContain('Measure');
    expect(acceptMissing({ ...EMPTY_ACCEPT, parcelId: 'P-1', dims }, t)).toContain('going');
    expect(acceptMissing({ ...EMPTY_ACCEPT, parcelId: 'P-1', dims, destPudoDid: 'did:agent:b', destZone: 'Z-B' }, t)).toContain('photo');
    expect(acceptMissing({ ...EMPTY_ACCEPT, parcelId: 'P-1', dims, destPudoDid: 'did:agent:b', destZone: 'Z-B', photoRef: 'p.jpg' }, t)).toBeNull();
  });

  it('an incomplete or sub-1mm measurement still blocks', () => {
    expect(acceptMissing({ ...EMPTY_ACCEPT, parcelId: 'P-1', dims: { l: '30', w: '20', h: '', kg: '1' }, destPudoDid: 'x', photoRef: 'p.jpg' }, t)).toContain('Measure');
    expect(acceptMissing({ ...EMPTY_ACCEPT, parcelId: 'P-1', dims: { l: '30', w: '20', h: '0.05', kg: '1' }, destPudoDid: 'x', photoRef: 'p.jpg' }, t)).toContain('Measure');
  });
});

describe('intake measure + destination helpers', () => {
  it('parseDims accepts a thin item + a decimal comma, down to the 1 mm floor', () => {
    expect(parseDims({ l: '30', w: '20', h: '10', kg: '1.6' })).toEqual({ l: 30, w: 20, h: 10, kg: 1.6 });
    expect(parseDims({ l: '21', w: '10', h: '0,5', kg: '0,02' })).toEqual({ l: 21, w: 10, h: 0.5, kg: 0.02 }); // comma + thin
    expect(parseDims({ l: '-30', w: '20', h: '10', kg: '1' })).toBeNull(); // a truthy negative must NOT slip through
    expect(parseDims({ l: '30', w: '20', h: '0.05', kg: '1' })).toBeNull(); // below the floor
  });

  it('sizeMeta gives a derived tier its plain words', () => {
    expect(sizeMeta('M', t).label).toBe('Medium');
    expect(sizeMeta('HEAVY', t).hint).toBe('Over 20 kg');
  });

  const pt = (over: Partial<NetworkPoint>): NetworkPoint => ({ did: 'd', shopName: 'Shop', zone: 'Z-A', openState: 'open', pricePerParcel: 1, ...over });

  it('selectablePoints excludes the accepting shop, puts open first, then nearest (with a ref) else A→Z', () => {
    const near = { lat: -1.3, lng: 36.84 };
    const pts = [
      pt({ did: 'far', shopName: 'Far', location: { lat: -1.2, lng: 36.7 } }),
      pt({ did: 'closed', shopName: 'AClosed', openState: 'closed', location: { lat: -1.301, lng: 36.841 } }),
      pt({ did: 'close', shopName: 'Close', location: { lat: -1.301, lng: 36.841 } }),
      pt({ did: 'self', shopName: 'MyOwnShop', location: { lat: -1.3, lng: 36.84 } }),
    ];
    // 'self' is the accepting shop → excluded even though it is the nearest of all.
    expect(selectablePoints(pts, 'self', near).map((p) => p.did)).toEqual(['close', 'far', 'closed']);
    expect(selectablePoints(pts, 'self').map((p) => p.shopName)).toEqual(['Close', 'Far', 'AClosed']); // no ref → open A→Z, then closed
    expect(pointDistance(pts[2], near)).toContain('away');
    expect(pointDistance(pt({ location: undefined }), near)).toBeNull();
  });
});

describe('book freight (F2)', () => {
  const dims = { l: '120', w: '100', h: '100', kg: '200' };
  const now = Date.parse('2026-08-10T12:00:00Z');

  it('parseBudget takes a positive amount (comma ok) and rejects zero / negative / blank', () => {
    expect(parseBudget('40')).toBe(40);
    expect(parseBudget('12,5')).toBe(12.5); // decimal comma
    expect(parseBudget('0')).toBeNull();
    expect(parseBudget('-5')).toBeNull();
    expect(parseBudget('')).toBeNull();
    expect(parseBudget('abc')).toBeNull();
  });

  it('plannedPickupIso converts a datetime-local to an ISO instant with an offset, only when planned', () => {
    expect(plannedPickupIso({ freightWhen: 'now', freightDate: '2026-08-11T09:00' })).toBeUndefined();
    expect(plannedPickupIso({ freightWhen: 'planned', freightDate: '' })).toBeUndefined();
    expect(plannedPickupIso({ freightWhen: 'planned', freightDate: 'not-a-date' })).toBeUndefined();
    const iso = plannedPickupIso({ freightWhen: 'planned', freightDate: '2026-08-11T09:00' });
    expect(iso).toMatch(/Z$/); // canonical UTC (an offset the server's @Matches guard accepts)
    expect(Number.isNaN(Date.parse(iso!))).toBe(false);
  });

  it('bookFreightMissing gates dims, destination, a positive cash cap, packaging, and a future planned date', () => {
    const base = { ...EMPTY_ACCEPT, dims, destPudoDid: 'did:agent:b', budgetCap: '40', packaging: 'bagged' as const };
    expect(bookFreightMissing({ ...EMPTY_ACCEPT }, now, t)).toContain('Measure');
    expect(bookFreightMissing({ ...EMPTY_ACCEPT, dims }, now, t)).toContain('going');
    expect(bookFreightMissing({ ...EMPTY_ACCEPT, dims, destPudoDid: 'did:agent:b' }, now, t)).toContain('cash budget');
    expect(bookFreightMissing({ ...base, budgetCap: '0' }, now, t)).toContain('cash budget'); // a zero cap is no cap
    // FB5 — packaging is REQUIRED, unlike the body hint. Unanswered, the server would fall back to the
    // deployment default and stamp a body from it, turning a question nobody asked into a recorded fact.
    expect(bookFreightMissing({ ...base, packaging: '' }, now, t)).toContain('packed');
    // A ship-now booking with all fields is complete (no sticker, no photo — freight isn't shelved).
    expect(bookFreightMissing({ ...base, freightWhen: 'now' }, now, t)).toBeNull();
    // Planned needs a real, FUTURE date.
    expect(bookFreightMissing({ ...base, freightWhen: 'planned', freightDate: '' }, now, t)).toContain('planned pickup date');
    expect(bookFreightMissing({ ...base, freightWhen: 'planned', freightDate: '2026-08-09T09:00' }, now, t)).toContain('future'); // a past date
    expect(bookFreightMissing({ ...base, freightWhen: 'planned', freightDate: '2026-08-20T09:00' }, now, t)).toBeNull();
  });
});

describe('how the load is packed (FB5)', () => {
  it('treats "Choose…" as an ABSENT answer, not an empty one', () => {
    // Same rule as the body hint: sending '' would post a packaging nobody named. The difference is that
    // this form refuses to submit until it IS named, because the fallback here is not "no opinion recorded"
    // — it is the deployment default silently deciding the body and the handling kit.
    expect(packagingValue('')).toBeUndefined();
    expect(packagingValue('bagged')).toBe('bagged');
    expect(packagingValue('loose')).toBe('loose');
  });

  it('starts a fresh booking with nothing assumed', () => {
    expect(EMPTY_ACCEPT.packaging).toBe('');
  });

  it('offers every packaging the API accepts, headed by the unanswered one', () => {
    // Unlike the body picker this list is NOT trimmed: each of these lifts and secures differently, and a
    // clerk can tell them apart by sight — there is no expertise here for a short list to protect them from.
    expect(PACKAGING_OPTIONS[0].value).toBe('');
    expect(PACKAGING_OPTIONS.slice(1).map((p) => p.value)).toEqual(['bagged', 'palletised', 'loose', 'drummed', 'baled', 'ibc', 'piece']);
  });
});

describe('consolidation lots (F3)', () => {
  it('DURABLE_NATURES excludes perishables (fresh/frozen) but keeps dry goods', () => {
    expect(DURABLE_NATURES).not.toContain('FOP'); // perishable → books freight directly, never consolidates
    expect(DURABLE_NATURES).toContain('FOD'); // dry food is durable
  });

  it('consignmentProgress reports accumulated vs target, clamped to 0–100%', () => {
    expect(consignmentProgress({ weightKg: 900, targetKg: 1000 })).toEqual({ pct: 90, label: '900 / 1000 kg' });
    expect(consignmentProgress({ weightKg: 1200, targetKg: 1000 }).pct).toBe(100); // an over-full lot clamps at 100
    expect(consignmentProgress({ weightKg: 0, targetKg: 0 }).pct).toBe(0); // no divide-by-zero
  });

});

describe('driver ratings (REP2)', () => {
  it('DRIVER_ISSUE_LABELS covers the movement-leg failings with plain words', () => {
    const keys = DRIVER_ISSUE_LABELS.map((i) => i.key);
    expect(keys).toEqual(expect.arrayContaining(['LATE_PICKUP', 'KEPT_OVERNIGHT', 'AFTER_HOURS', 'EQUIPMENT_FAILURE']));
    expect(DRIVER_ISSUE_LABELS.every((i) => t(i.labelKey).length > 0)).toBe(true);
  });
});

describe('releaseStage', () => {
  it('maps parcel status to the release step', () => {
    expect(releaseStage('On_Bus')).toBe('arrive');
    expect(releaseStage('Ready_For_Pickup')).toBe('otp');
    expect(releaseStage('Delivered')).toBe('rate');
    expect(releaseStage('At_MDP')).toBe('blocked');
    expect(releaseStage('Voided')).toBe('blocked');
  });
});

describe('otpValid', () => {
  it('accepts exactly four digits', () => {
    expect(otpValid('0042')).toBe(true);
    expect(otpValid(' 1234 ')).toBe(true);
    expect(otpValid('123')).toBe(false);
    expect(otpValid('12345')).toBe(false);
    expect(otpValid('12a4')).toBe(false);
  });
});

describe('priceBand', () => {
  const bm: Benchmark = { count: 8, median: 2, p25: 1.5, p75: 2.5, min: 1, max: 3 };

  it('needs a usable benchmark', () => {
    expect(priceBand(1.5, null, t)).toBeNull();
    expect(priceBand(1.5, { ...bm, count: 0 }, t)).toBeNull();
  });

  it('reads above / below / at with a ±1% dead zone', () => {
    expect(priceBand(2.5, bm, t)?.headline).toContain('25% more');
    expect(priceBand(1.5, bm, t)?.headline).toContain('25% less');
    expect(priceBand(2.01, bm, t)?.showMatch).toBe(false);
  });

  it('the match price is money-rounded exactly as it will be PATCHed', () => {
    const b = priceBand(3, { ...bm, median: 1.999 }, t);
    expect(b?.matchPrice).toBe(2);
    expect(roundMoney(1.006)).toBe(1.01);
    expect(roundMoney(2.994)).toBe(2.99);
  });
});

describe('speaking', () => {
  it('money always carries two decimals', () => {
    expect(money(5)).toBe('5.00');
    expect(money(undefined)).toBe('0.00');
  });

  it('home summary reads the gate and the closed state', () => {
    expect(homeSummary(agent({ balance: 12.5, openState: 'closed' }), gate({ ok: false }), t)).toBe(
      'Wallet balance 12.50. Top up to accept parcels. Your shop is marked closed.',
    );
  });

  it('handover summary counts the waiting and the chosen', () => {
    expect(handoverSummary(0, 0, 0, t)).toContain('No parcels');
    expect(handoverSummary(3, 2, 0, t)).toContain('3 parcels');
  });

  it('handover summary speaks the parcels still owed to the bus after the gate refuses (S25)', () => {
    const said = handoverSummary(3, 1, 2, t);
    expect(said).toContain('2 for this bus are still waiting');
    expect(said).toContain('leave them behind');
    // No missed → the plain "finish the handover" prompt, never the short-ship wording.
    expect(handoverSummary(3, 3, 0, t)).toContain('finish the handover');
    expect(handoverSummary(3, 3, 0, t)).not.toContain('still waiting');
  });
});

describe('void / reverse logistics', () => {
  const NOW = Date.parse('2026-07-23T10:00:00Z');
  const parcel = (over: Partial<ParcelView> = {}): ParcelView => ({
    parcelId: 'P-1',
    size: 'M',
    status: 'At_PUDO',
    destZone: 'Z-B',
    acceptedAt: new Date(NOW - 60_000).toISOString(), // accepted 1 min ago
    ...over,
  });

  it('remaining time counts down inside the window and clamps at zero', () => {
    expect(voidRemainingMs(new Date(NOW).toISOString(), NOW)).toBe(VOID_WINDOW_MS);
    expect(voidRemainingMs(new Date(NOW - 60_000).toISOString(), NOW)).toBe(VOID_WINDOW_MS - 60_000);
    expect(voidRemainingMs(new Date(NOW - 6 * 60_000).toISOString(), NOW)).toBe(0);
    expect(voidRemainingMs(undefined, NOW)).toBe(0);
    expect(voidRemainingMs('not-a-date', NOW)).toBe(0);
  });

  it('only an At_PUDO parcel still inside the window is voidable', () => {
    expect(isVoidable(parcel(), NOW)).toBe(true);
    expect(isVoidable(parcel({ acceptedAt: new Date(NOW - 6 * 60_000).toISOString() }), NOW)).toBe(false);
    expect(isVoidable(parcel({ status: 'On_Bus' }), NOW)).toBe(false);
    expect(isVoidable(parcel({ status: 'Delivered' }), NOW)).toBe(false);
  });

  it('voidableParcels keeps only the eligible, soonest-to-expire first', () => {
    const rows = [
      parcel({ parcelId: 'fresh', acceptedAt: new Date(NOW - 30_000).toISOString() }),
      parcel({ parcelId: 'expiring', acceptedAt: new Date(NOW - 4 * 60_000).toISOString() }),
      parcel({ parcelId: 'gone', acceptedAt: new Date(NOW - 10 * 60_000).toISOString() }),
      parcel({ parcelId: 'onbus', status: 'On_Bus' }),
    ];
    expect(voidableParcels(rows, NOW).map((p) => p.parcelId)).toEqual(['expiring', 'fresh']);
    expect(voidableParcels(null, NOW)).toEqual([]);
  });

  it('the countdown speaks plainly and never shows a bare number', () => {
    expect(voidCountdownLabel(VOID_WINDOW_MS, t)).toBe('5 min left to undo');
    expect(voidCountdownLabel(45_000, t)).toBe('45 sec left to undo');
    expect(voidCountdownLabel(0, t)).toBe('Window closed');
  });
});

describe('shelf', () => {
  it('reads the grid dimensions back from its slots (max row/col), null when empty', () => {
    const slots = [
      { row: 1, col: 1 },
      { row: 3, col: 2 },
      { row: 2, col: 5 },
    ];
    expect(gridDims(slots)).toEqual({ rows: 3, cols: 5 });
    expect(gridDims([])).toBeNull();
    expect(gridDims(undefined)).toBeNull();
  });
});

describe('the counter’s freight facts (FB2c)', () => {
  it('treats "I don’t know" as an ABSENT hint, not an empty one', () => {
    // Sending '' would record a body nobody named, and it would then be counted in the market series as if a
    // clerk had asserted it. The whole value of the hint is that it is only there when someone meant it.
    expect(bodyHintValue('')).toBeUndefined();
    expect(bodyHintValue('flatbed')).toBe('flatbed');
    expect(bodyHintValue('lowboy')).toBe('lowboy');
  });

  it('offers a SHORT list of bodies a shop clerk would recognise', () => {
    // Not the full 25-body catalogue: a picker with twenty-five options invites a confident wrong answer
    // where "I don't know" was the honest one, and a wrong hint is worse than none.
    expect(BODY_HINTS.length).toBeLessThanOrEqual(9);
    expect(BODY_HINTS[0].value).toBe(''); // the honest default comes first
    // Every offered value must be one the API's enum accepts, or the form would post a body it rejects.
    for (const b of BODY_HINTS) expect(['', 'flatbed', 'box', 'curtain_side', 'refrigerated', 'tipper', 'lowboy', 'skeletal']).toContain(b.value);
  });

  it('starts a fresh booking with no opinion and nothing declared indivisible', () => {
    // Both default to the absence of an answer. A form that opened with "cannot be split" ticked would put
    // loads on low-loaders because nobody looked at the checkbox.
    expect(EMPTY_ACCEPT.indivisible).toBe(false);
    expect(EMPTY_ACCEPT.bodyHint).toBe('');
  });
});

describe('the customer’s excluded bodies (FB2d)', () => {
  const form = (over: Partial<AcceptForm> = {}): AcceptForm => ({ ...EMPTY_ACCEPT, ...over });

  it('starts a fresh booking with nothing ruled out, and sends nothing when nothing is', () => {
    // The ordinary walk-up has no exclusions at all. An empty array would post a shipper preference the
    // shipper never expressed — and this one REFUSES claims, so inventing it costs a driver a load.
    expect(EMPTY_ACCEPT.excludedBodies).toEqual([]);
    expect(excludedBodiesValue([])).toBeUndefined();
    expect(excludedBodiesValue(['flatbed'])).toEqual(['flatbed']);
  });

  it('cannot rule out "I don’t know", and offers exactly the bodies the hint picker does', () => {
    expect(EXCLUDABLE_BODIES.map((b) => b.value)).toEqual(BODY_HINTS.slice(1).map((b) => b.value));
    for (const b of EXCLUDABLE_BODIES) expect(b.value).not.toBe('');
  });

  it('toggles one body on and off again', () => {
    const on = toggleExcludedBody(form(), 'flatbed');
    expect(on.excludedBodies).toEqual(['flatbed']);
    expect(toggleExcludedBody(form(on), 'flatbed').excludedBodies).toEqual([]);
  });

  it('posts exclusions in the picker’s order, not the order they were tapped', () => {
    // Two clerks recording the same three refusals must produce the same freight, or the market series
    // counts them as different shapes of demand.
    let f = form();
    for (const b of ['tipper', 'flatbed', 'box'] as const) f = form(toggleExcludedBody(f, b));
    expect(f.excludedBodies).toEqual(['flatbed', 'box', 'tipper']);
  });

  it('lets the NEWEST answer win when the hint and an exclusion collide', () => {
    // A load cannot both be the kind that needs a flatbed and one the customer refuses to put on a flatbed.
    // The person is standing there revising what they said; silently keeping the older word argues with them.
    const excludedAfterHint = toggleExcludedBody(form({ bodyHint: 'flatbed' }), 'flatbed');
    expect(excludedAfterHint).toEqual({ excludedBodies: ['flatbed'], bodyHint: '' });

    const hintAfterExcluded = chooseBodyHint(form({ excludedBodies: ['flatbed', 'box'] }), 'flatbed');
    expect(hintAfterExcluded).toEqual({ excludedBodies: ['box'], bodyHint: 'flatbed' });
  });

  it('leaves an unrelated hint alone when a different body is ruled out', () => {
    expect(toggleExcludedBody(form({ bodyHint: 'lowboy' }), 'flatbed')).toEqual({ excludedBodies: ['flatbed'], bodyHint: 'lowboy' });
    // And clearing the hint back to "I don't know" never disturbs the exclusions.
    expect(chooseBodyHint(form({ excludedBodies: ['flatbed'], bodyHint: 'lowboy' }), '')).toEqual({ excludedBodies: ['flatbed'], bodyHint: '' });
  });
});
