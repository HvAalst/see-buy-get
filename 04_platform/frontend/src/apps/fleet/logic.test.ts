import { describe, expect, it } from 'vitest';
import { t } from '../../shared/i18n'; // English is the base catalog, so the real `t` yields the English literals
import type { DepartureBookingRow, DepartureRow } from './types';
import { EMPTY_OWN_LOAD, EMPTY_RUN, ownLoadBlocker, runBlocker, runManifest, runMoney, runRemaining, runWaits, type OwnLoadForm, type RunForm } from './logic';
import { ageWords, signalState, shiftHours, overShiftLimit, fleetMap, hazardArea, hazardWords, HAZARD_MIN_KM, stopDetail, nextStopOf, vehicleDetail,
  EMPTY_DRIVER,
  EMPTY_VEHICLE,
  bodyPickerOptions,
  corridorState,
  dispatchDistanceLine,
  dispatchRowState,
  dispatchSummary,
  driverAction,
  driverMissing,
  freeDrivers,
  freeVehicles,
  isHeavySelection,
  paperDay,
  paperLine,
  paperLineClass,
  papersAloud,
  cardsFirst,
  cardsToRead,
  licenceSource,
  readingDiffers,
  papersToShow,
  paperTone,
  vehiclePins,
  shortDid,
  statusTone,
  subtypeLine,
  toggleClass,
  vehicleMissing,
} from './logic';
import type { AssignmentRow, DriverRow, PositionRow, VehicleRow } from './types';

const driver = (over: Partial<DriverRow> = {}): DriverRow => ({
  did: 'did:d1',
  displayName: 'Driver J.',
  registry: 'light',
  status: 'ACTIVE',
  ...over,
});

const vehicle = (over: Partial<VehicleRow> = {}): VehicleRow => ({
  vehicleId: 'v1',
  qr: 'VQR-1',
  plate: 'KAA 001',
  vehicleClass: 'van',
  capacityKg: 800,
  pricePerKm: 0.4,
  verified: true,
  status: 'ACTIVE',
  ...over,
});

const assignment = (over: Partial<AssignmentRow> = {}): AssignmentRow => ({
  assignmentId: 'a1',
  driverDid: 'did:d1',
  vehicleId: 'v1',
  startedAt: '2026-07-22T08:00:00Z',
  ...over,
});

describe('registry', () => {
  it('bike/motorcycle stay light; anything heavier is the heavy registry', () => {
    expect(isHeavySelection(['bike'])).toBe(false);
    expect(isHeavySelection(['bike', 'motorcycle'])).toBe(false);
    expect(isHeavySelection(['bike', 'van'])).toBe(true);
    expect(isHeavySelection([])).toBe(false);
  });
});

describe('forms', () => {
  it('vehicle form: plate → owner → truck body, in that order', () => {
    expect(vehicleMissing(EMPTY_VEHICLE, t)).toContain('plate');
    expect(vehicleMissing({ ...EMPTY_VEHICLE, plate: 'K 1' }, t)).toContain('owner');
    expect(vehicleMissing({ ...EMPTY_VEHICLE, plate: 'K 1', ownerName: 'A', vehicleClass: 'truck' }, t)).toContain('truck body');
    expect(vehicleMissing({ ...EMPTY_VEHICLE, plate: 'K 1', ownerName: 'A' }, t)).toBeNull();
  });

  it('vehicle form: the price-multiplier corridor is both-or-neither, and never inverted (S34)', () => {
    const ok = { ...EMPTY_VEHICLE, plate: 'K 1', ownerName: 'A' } as const;
    expect(vehicleMissing({ ...ok, minMultiplier: '1.5', maxMultiplier: '0.8' }, t)).toContain('cannot be above'); // inverted
    expect(vehicleMissing({ ...ok, minMultiplier: '0.8', maxMultiplier: '1.5' }, t)).toBeNull(); // floor ≤ ceiling
    expect(vehicleMissing({ ...ok, minMultiplier: '1.2' }, t)).toContain('both'); // a lone bound would be silently paired
    expect(vehicleMissing({ ...ok, maxMultiplier: '0.5' }, t)).toContain('both'); // a lone ceiling too
    expect(vehicleMissing({ ...ok, baseFee: '5' }, t)).toBeNull(); // base fee alone is always fine
  });

  it('driver form: heavy selection demands the licence number', () => {
    const filled = { ...EMPTY_DRIVER, displayName: 'D', fullName: 'D Full', nationalId: 'N1', mobile: '07' };
    expect(driverMissing(filled, t)).toBeNull();
    expect(driverMissing({ ...filled, classes: ['van'] }, t)).toContain('licence');
    expect(driverMissing({ ...filled, classes: ['van'], licenceNumber: 'L-9' }, t)).toBeNull();
    expect(driverMissing({ ...filled, classes: [] }, t)).toContain('at least one');
  });

  it('toggleClass flips membership without duplicating', () => {
    expect(toggleClass(['bike'], 'van')).toEqual(['bike', 'van']);
    expect(toggleClass(['bike', 'van'], 'van')).toEqual(['bike']);
  });
});

describe('pools', () => {
  it('free = ACTIVE and not already coupled', () => {
    const drivers = [driver(), driver({ did: 'did:d2' }), driver({ did: 'did:d3', status: 'KYC_PENDING' })];
    const vehicles = [vehicle(), vehicle({ vehicleId: 'v2' }), vehicle({ vehicleId: 'v3', status: 'RETIRED' })];
    const active = [assignment()];
    expect(freeDrivers(drivers, active).map((d) => d.did)).toEqual(['did:d2']);
    expect(freeVehicles(vehicles, active).map((v) => v.vehicleId)).toEqual(['v2']);
  });
});

/**
 * The live map's pins.
 *
 * The dashboard used to project positions onto an abstract 0–100 grid, which was right while the map was
 * a hand-drawn plot and wrong the moment it had tiles: the whole point of geography is that a dot sits on
 * the road it is actually on. Real coordinates now, straight through.
 */
describe('vehiclePins', () => {
  const at = (lat: number, lng: number): PositionRow => ({
    plate: 'KLM 002B',
    driverName: 'Amos K.',
    vehicleClass: 'bike',
    hoursOnDuty: 2,
    location: { lat, lng },
  });

  it('passes real coordinates through untouched', () => {
    const [p] = vehiclePins([at(-1.2942, 36.8331)]);
    expect(p.point).toEqual({ lat: -1.2942, lng: 36.8331 });
  });

  it('labels a pin the way a manager says it out loud', () => {
    // The plate is the handle — it is what gets said on the phone — and the driver rides along so a pin
    // can still answer "who is that".
    const [p] = vehiclePins([at(-1.2, 36.7)]);
    expect(p.id).toBe('KLM 002B');
    expect(p.label).toBe('KLM 002B · Amos K.');
  });

  it('renders no pins rather than failing when nobody is reporting', () => {
    // The map still draws — that is the point. An empty operating area beats an empty grid, and beats
    // no map at all for a manager opening the app before anyone has started a shift.
    expect(vehiclePins([])).toEqual([]);
  });
});

describe('views', () => {
  it('shortDid keeps short ids and elides long ones', () => {
    expect(shortDid('v1')).toBe('v1');
    expect(shortDid('did:glos:driver:abcdef123456')).toBe('did:glos…3456');
    expect(shortDid(undefined)).toBe('—');
  });

  it('statusTone and driverAction encode the manager scope', () => {
    expect(statusTone('ACTIVE')).toBe('ok');
    expect(statusTone('KYC_PENDING')).toBe('warn');
    expect(statusTone('SUSPENDED')).toBe('danger');
    expect(driverAction({ status: 'DRAFT', registry: 'heavy' })).toBe('submit-kyc');
    expect(driverAction({ status: 'DRAFT', registry: 'light' })).toBe('none');
    // The KYC decision is GLOS ops' — the app must offer no approve button.
    expect(driverAction({ status: 'KYC_PENDING', registry: 'heavy' })).toBe('awaiting-glos');
  });

  it('subtypeLine folds the capability flags into one sentence', () => {
    expect(subtypeLine({ id: 'refrigerated', label: 'Refrigerated box', capacityKg: 2500, coldChain: true }, t)).toBe(
      'Refrigerated box: about 2500 kg · cold-chain',
    );
    expect(subtypeLine(undefined, t)).toBeNull();
  });

  describe('the look-and-choose body picker', () => {
    it('takes the LABEL from the server and the sentence from the catalog', () => {
      // The server owns the body catalogue, so a body added there becomes choosable with no frontend
      // release. Only the description lives here.
      const [row] = bodyPickerOptions([{ id: 'curtain_side', label: 'Curtain-side (tautliner)', capacityKg: 12000 }], t);
      expect(row.key).toBe('curtain_side');
      expect(row.label).toBe('Curtain-side (tautliner)'); // the server's word, not ours
      expect(row.detail).toContain('curtains that slide back');
      expect(row.meta).toContain('12000 kg'); // the capability line the form already showed
    });

    it('falls back to a neutral sentence for a body it has no words for', () => {
      // t() returns the key itself when there is no entry. Rendering `fleet.body.hovercraftWhy` at a fleet
      // manager would make a NEW body look broken rather than merely unexplained — and the server is
      // allowed to grow the catalogue without us.
      const [row] = bodyPickerOptions([{ id: 'hovercraft', label: 'Hovercraft', capacityKg: 900 }], t);
      expect(row.detail).toBe(t('fleet.body.unknownWhy'));
      expect(row.detail).not.toContain('fleet.body');
    });
  });
});

describe('the corridor a shift is on', () => {
  const shift = (corridorId?: string) => ({ assignmentId: 'as_1', driverDid: 'did:1', vehicleId: 'veh_1', corridorId, startedAt: '2026-09-10T06:00:00Z' });
  const corridors = [
    { corridorId: 'cor_1', name: 'A → B', originZone: 'Z-A', destZone: 'Z-B', status: 'active' },
    { corridorId: 'cor_2', name: 'B → C', originZone: 'Z-B', destZone: 'Z-C', status: 'blocked' },
  ];

  it('names a live one', () => {
    expect(corridorState(shift('cor_1'), corridors)).toEqual({ kind: 'on', name: 'A → B' });
  });

  it('calls having none a LIMIT rather than a blank', () => {
    // The whole defect this fixes: "(optional)" is true when the shift starts and false at the shop
    // counter, where the handover refuses — on the shopkeeper's screen, about something only a manager
    // can fix. The screen has to distinguish "chose local work" from "forgot".
    expect(corridorState(shift(), corridors)).toEqual({ kind: 'none' });
    expect(corridorState(shift(''), corridors)).toEqual({ kind: 'none' });
  });

  it('says when the network has closed the corridor under a running shift', () => {
    expect(corridorState(shift('cor_2'), corridors)).toEqual({ kind: 'blocked', name: 'B → C' });
  });

  it('never reports a shift as having no corridor just because the list cannot name it', () => {
    // Saying "none" here would read as "local work only" about a driver who is on a line-haul run.
    expect(corridorState(shift('cor_gone'), corridors)).toEqual({ kind: 'gone', name: 'cor_gone' });
    expect(corridorState(shift('cor_1'), [])).toEqual({ kind: 'gone', name: 'cor_1' });
  });
});

describe('a vehicle that went dark', () => {
  const now = Date.parse('2026-09-14T14:35:00Z');
  it('is live inside ten minutes, dark after, and never when it has not reported', () => {
    expect(signalState('2026-09-14T14:33:00Z', now)).toEqual({ kind: 'live', minutes: 2 });
    expect(signalState('2026-09-14T14:20:00Z', now)).toEqual({ kind: 'dark', minutes: 15 });
    expect(signalState(undefined, now)).toEqual({ kind: 'never', minutes: 0 });
    expect([ageWords(12), ageWords(95), ageWords(1428), ageWords(3000)]).toEqual(['12 min', '2 h', '24 h', '2 d']);
  });

  it('says so on the pin, so the last place we heard from it is not read as where it is', () => {
    const rows = [
      { plate: 'KLM 001V', driverName: 'Grace', vehicleClass: 'van', hoursOnDuty: 2, location: { lat: -1.3, lng: 36.8 }, lastLocatedAt: '2026-09-14T14:34:00Z' },
      { plate: 'KLM 002B', driverName: 'Amos', vehicleClass: 'bike', hoursOnDuty: 3, location: { lat: -1.2, lng: 36.9 }, lastLocatedAt: '2026-09-14T14:00:00Z' },
    ];
    expect(vehiclePins(rows, now).map((p) => p.label)).toEqual(['KLM 001V · Grace', 'KLM 002B · Amos · no signal 35 min']);
  });
});

describe('FP4 — the papers that switch things off', () => {
  it('tones: a lapsed paper is a stop, a due one a warning, no date a gap, in date quiet', () => {
    expect(paperTone('lapsed')).toBe('danger');
    expect(paperTone('due')).toBe('warn');
    expect(paperTone('none')).toBe('idle');
    expect(paperTone('ok')).toBe('ok');
    expect(paperLineClass('lapsed')).toBe('row__s row__s--danger');
    expect(paperLineClass('due')).toBe('row__s row__s--warn');
    expect(paperLineClass('none')).toBe('row__s');
  });

  it('reads a date-only expiry as that calendar day, whatever the time zone', () => {
    expect(paperDay('2026-09-03')).toMatch(/3.*2026|2026.*3/);
    expect(paperDay('2026-09-03')).not.toMatch(/\b2\b/);
    expect(paperDay(undefined)).toBe('');
  });

  it('says in words what the date did', () => {
    expect(paperLine({ kind: 'insurance', state: 'lapsed', expiresAt: '2026-09-03' }, t)).toMatch(/^Insurance lapsed .*2026$/);
    expect(paperLine({ kind: 'inspection', state: 'due', expiresAt: '2026-10-10', daysLeft: 27 }, t)).toMatch(/^Inspection certificate runs out .*\(27 days\)$/);
    expect(paperLine({ kind: 'licence', state: 'due', daysLeft: 1 }, t)).toBe('Driving licence runs out today');
    expect(paperLine({ kind: 'licence', state: 'none' }, t)).toBe('Driving licence: no date recorded');
    expect(paperLine({ kind: 'licence', state: 'ok', expiresAt: '2027-01-01' }, t)).toMatch(/^Driving licence to .*2027$/);
  });

  it('pins only what is not simply in date, and reads aloud only what needs acting on', () => {
    expect(papersToShow([{ kind: 'insurance', state: 'ok' }, { kind: 'inspection', state: 'none' }]).map((p) => p.kind)).toEqual(['inspection']);
    expect(papersToShow(undefined)).toEqual([]);
    expect(papersAloud(null, t)).toBe('');
    expect(papersAloud({ lapsed: [], due: [], inDate: 4, unrecorded: 1 }, t)).toBe('');
    const row = { subject: 'vehicle' as const, id: 'v', label: 'P', kind: 'insurance' as const, expiresAt: '2026-09-01', onShift: false };
    expect(papersAloud({ lapsed: [{ ...row, state: 'lapsed' }], due: [{ ...row, state: 'due' }, { ...row, state: 'due' }], inDate: 0, unrecorded: 0 }, t)).toBe(' 1 off the road for lapsed papers. 2 papers running out within thirty days.');
  });
});

describe('FP5 — dispatch from the office', () => {
  it('a negotiate load is never "take", a blocked one is blocked, the rest can be put on the driver', () => {
    expect(dispatchRowState({ canTake: true, commitMode: 'instant' })).toBe('take');
    expect(dispatchRowState({ canTake: true, commitMode: 'negotiate' })).toBe('negotiate');
    expect(dispatchRowState({ canTake: false, commitMode: 'instant' })).toBe('blocked');
  });

  it('says the legs the way the money splits, and the market the way the office asks', () => {
    expect(dispatchDistanceLine({ deadheadKm: 3.25, loadedKm: 12 }, t)).toBe('3.3 km empty · 12.0 km loaded');
    expect(dispatchSummary(null, t)).toBe('Nobody is on a shift, so there is nobody to put a load on.');
    const row = (canTake: boolean) => ({ freightId: 'f', code: 'FRT-1', description: '', pickupLabel: '', destLabel: '', weightKg: 1, commitMode: 'instant' as const, deadheadKm: 0, loadedKm: 0, totalKm: 0, canTake, blockers: [] });
    expect(dispatchSummary({ drivers: [{ did: 'd', name: 'Amos K.', vehicleId: 'v', plate: 'P', vehicleClass: 'bike', remainingKg: 20 }], driver: 'd', from: { lat: 0, lng: 0, source: 'depot' }, rows: [row(true), row(false)], total: 2 }, t)).toBe('2 loads on the market for Amos K., 1 they could take.');
  });
});

describe('FP8 — the shift clock the office reads', () => {
  const started = '2026-09-15T06:00:00.000Z';
  it('counts hours from the start of the shift, to a tenth', () => {
    expect(shiftHours(started, Date.parse('2026-09-15T09:15:00.000Z'))).toBe(3.3);
    expect(shiftHours(started, Date.parse('2026-09-15T05:00:00.000Z'))).toBe(0); // a clock ahead of the server is not negative hours
    expect(shiftHours('not a date', Date.parse('2026-09-15T09:15:00.000Z'))).toBe(0);
  });
  it('marks over the limit the server gave, and 13 h when it has not', () => {
    expect(overShiftLimit(started, 13, Date.parse('2026-09-15T18:59:00.000Z'))).toBe(false);
    expect(overShiftLimit(started, 13, Date.parse('2026-09-15T19:30:00.000Z'))).toBe(true);
    expect(overShiftLimit(started, undefined, Date.parse('2026-09-15T19:30:00.000Z'))).toBe(true);
    expect(overShiftLimit(started, 10, Date.parse('2026-09-15T16:30:00.000Z'))).toBe(true);
  });
});

/**
 * F4 — the work the fleet already had.
 *
 * The claim worth testing is not that a field round-trips. It is that the fleet's own money NEVER lands in
 * the same figure as what was sold here — one is a price we quoted and stand behind, the other is a number
 * we were told and have no part in, and a screen that adds them is claiming a relationship that does not
 * exist.
 */
describe('F4 — a fleet’s own customers on its own run', () => {
  const booking = (over: Partial<DepartureBookingRow> & Pick<DepartureBookingRow, 'kind'>): DepartureBookingRow =>
    ({
      bookingId: 'b' + Math.random(),
      shipperDid: 'did:x',
      description: 'Load',
      weightKg: 100,
      binds: 'weight',
      price: 0,
      units: 1,
      at: '2026-09-25T06:00:00.000Z',
      status: 'booked',
      waiting: [],
      ...over,
    }) as DepartureBookingRow;

  // null, not undefined: passing undefined for an optional parameter TRIGGERS its default, so a run with
  // no measured hold would quietly get 40 m³ and the test that matters most would pass on the wrong run.
  const runWith = (bookings: DepartureBookingRow[], capacityKg = 6000, capacityM3: number | null = 40): DepartureRow =>
    ({
      departureId: 'dep1',
      corridorId: 'c1',
      lineName: 'Nairobi → Mombasa',
      originZone: 'Nairobi',
      destZone: 'Mombasa',
      leavesAt: '2026-10-01T06:00:00.000Z',
      capacityKg,
      ...(capacityM3 != null ? { capacityM3 } : {}),
      rate: { basis: 'per_trip', amount: 450, currency: 'KES' },
      status: 'open',
      bookings,
      createdAt: '2026-09-25T06:00:00.000Z',
    }) as DepartureRow;

  it('keeps the fleet’s own money out of what was sold here', () => {
    const run = runWith([
      booking({ kind: 'sold', price: 450 }),
      booking({ kind: 'own', customer: 'Kariuki Hardware', price: 380 }),
      booking({ kind: 'own', customer: 'Mwangi Feeds', price: 200 }),
    ]);
    expect(runMoney(run)).toMatchObject({ sold: 450, own: 580, currency: 'KES' });
  });

  it('counts an own load against the space, which is the whole point of recording it', () => {
    const run = runWith([booking({ kind: 'own', customer: 'Kariuki Hardware', weightKg: 2000, volumeM3: 6 })]);
    expect(runRemaining(run)).toEqual({ kg: 4000, m3: 34 });
  });

  it('ignores a cancelled own load in both, the same as any other', () => {
    const run = runWith([booking({ kind: 'own', customer: 'Kariuki Hardware', weightKg: 2000, price: 380, status: 'cancelled' })]);
    expect(runMoney(run).own).toBe(0);
    expect(runRemaining(run).kg).toBe(6000);
  });

  it('lists an own customer’s wait even though we put no price on it', () => {
    const run = runWith([
      booking({
        kind: 'own',
        customer: 'Kariuki Hardware',
        // Ninety minutes the fleet has to invoice, and an amount we deliberately did not set.
        waiting: [{ where: 'loading', arrivedAt: 'x', freeAt: 'y', waitedMin: 150, billableMin: 90, amount: 0, bearer: 'shipper' }],
      }),
    ]);
    expect(runWaits(run)).toHaveLength(1);
  });

  describe('what it refuses before the server has to', () => {
    const run = runWith([], 6000, 40);
    const form = (over: Partial<OwnLoadForm> = {}): OwnLoadForm => ({ ...EMPTY_OWN_LOAD, customer: 'Kariuki', description: 'Cement', weightKg: '100', ...over });

    it('asks for a name, because an unattributed load is a hole nobody can account for', () => {
      expect(ownLoadBlocker(form({ customer: '  ' }), run)).toBe('fleet.own.needCustomer');
      expect(ownLoadBlocker(form({ description: '' }), run)).toBe('fleet.own.needWhat');
      expect(ownLoadBlocker(form({ weightKg: '0' }), run)).toBe('fleet.own.needKg');
      expect(ownLoadBlocker(form(), run)).toBeNull();
    });

    it('names the axis that is full, not just "it does not fit"', () => {
      expect(ownLoadBlocker(form({ weightKg: '7000' }), run)).toBe('fleet.own.noRoomKg');
      // Light enough and far too big — the refusal a weight-only check would get wrong.
      expect(ownLoadBlocker(form({ weightKg: '40', volumeM3: '50' }), run)).toBe('fleet.own.noRoomM3');
    });

    it('measures the room against what is already aboard, own loads included', () => {
      const half = runWith([booking({ kind: 'own', customer: 'Kariuki', weightKg: 5500 })]);
      expect(ownLoadBlocker(form({ weightKg: '1000' }), half)).toBe('fleet.own.noRoomKg');
      expect(ownLoadBlocker(form({ weightKg: '400' }), half)).toBeNull();
    });

    it('says nothing about space on a run whose hold was never measured', () => {
      expect(ownLoadBlocker(form({ weightKg: '40', volumeM3: '999' }), runWith([], 6000, null))).toBeNull();
    });
  });
});

/**
 * The gaps found by reading F1–F4 back, on the fleet's side.
 *
 * Both of these were caught by driving rather than by anything failing: a delivered load VANISHED from
 * the run sheet the moment the driver said it had arrived, taking its money with it — at the one point
 * where the fleet has definitely earned it.
 */
describe('a run sheet that survives its own deliveries', () => {
  const b = (over: Partial<DepartureBookingRow> & Pick<DepartureBookingRow, 'kind'>): DepartureBookingRow =>
    ({ bookingId: 'b' + Math.random(), shipperDid: 'did:x', description: 'Load', weightKg: 100, binds: 'weight', price: 450, units: 1, at: 'x', status: 'booked', waiting: [], ...over }) as DepartureBookingRow;
  const runOf = (bookings: DepartureBookingRow[]): DepartureRow =>
    ({ departureId: 'd', corridorId: 'c', lineName: 'L', originZone: 'A', destZone: 'B', leavesAt: 'x', capacityKg: 6000, capacityM3: 40, rate: { basis: 'per_trip', amount: 450, currency: 'KES' }, status: 'open', bookings, createdAt: 'x' }) as DepartureRow;

  it('keeps a delivered load on the manifest and drops a cancelled one', () => {
    const run = runOf([b({ kind: 'sold' }), b({ kind: 'sold', status: 'delivered' }), b({ kind: 'sold', status: 'cancelled' })]);
    // A run sheet that erases each drop as it happens ends the day empty, which is the opposite of what
    // a fleet wants to read at the end of a day.
    expect(runManifest(run)).toHaveLength(2);
  });

  it('still counts a delivered load’s money', () => {
    const run = runOf([b({ kind: 'sold', status: 'delivered', price: 450 }), b({ kind: 'own', customer: 'Kariuki', status: 'delivered', price: 380 })]);
    expect(runMoney(run)).toMatchObject({ sold: 450, own: 380 });
  });

  it('does not count a booking somebody took back', () => {
    expect(runMoney(runOf([b({ kind: 'sold', status: 'cancelled', price: 450 })])).sold).toBe(0);
  });

  it('gives the space back on delivery, because the goods are off the truck', () => {
    // The manifest and the capacity answer different questions, and this is where they part company.
    const run = runOf([b({ kind: 'sold', status: 'delivered', weightKg: 2000 })]);
    expect(runRemaining(run).kg).toBe(6000);
    expect(runManifest(run)).toHaveLength(1);
  });
});

/**
 * The vehicle a run is sold on — gap 7a.
 *
 * capacityKg was a bare number somebody typed, so forty tonnes could be published on a van. The VEHICLE
 * is required and the DRIVER is not, and the asymmetry is the argument: who is driving on Tuesday is a
 * rostering detail, and which truck is going IS the offer.
 */
describe('declaring a run against a real vehicle', () => {
  const form = (over: Partial<RunForm> = {}): RunForm => ({
    ...EMPTY_RUN,
    corridorId: 'cor_1',
    vehicleId: 'veh_1',
    leavesAt: '2026-10-01T06:00',
    amount: '450',
    ...over,
  });
  const soon = Date.parse('2026-09-25T06:00:00.000Z');

  it('asks which truck before it asks anything about the load', () => {
    expect(runBlocker(form({ vehicleId: '' }), soon)).toBe('fleet.runs.needVehicle');
  });

  it('takes a blank capacity, because that means the whole truck', () => {
    // A required field whose right answer is already on the vehicle's own record is a field asking to
    // be got wrong.
    expect(runBlocker(form({ capacityKg: '' }), soon, 8000)).toBeNull();
  });

  it('refuses more than the vehicle holds, before the server has to', () => {
    expect(runBlocker(form({ capacityKg: '40000' }), soon, 1200)).toBe('fleet.runs.tooMuch');
    expect(runBlocker(form({ capacityKg: '800' }), soon, 1200)).toBeNull();
  });

  it('still refuses a typed nonsense capacity', () => {
    expect(runBlocker(form({ capacityKg: '0' }), soon, 8000)).toBe('fleet.runs.needCapacity');
  });

  it('says nothing about capacity when no vehicle has been chosen to measure against', () => {
    // The vehicle blocker fires first, so the ceiling is never consulted against a guess.
    expect(runBlocker(form({ vehicleId: '', capacityKg: '40000' }), soon)).toBe('fleet.runs.needVehicle');
  });
});

describe('a renewed licence one of the fleet’s drivers sent', () => {
  const card = { copyRef: 'med_card', expiresAt: '2031-03-31', sentAt: '2026-10-11T08:00:00.000Z' };
  const pool = [
    { did: 'a', displayName: 'Amos', licenceRenewal: undefined },
    { did: 'b', displayName: 'Baraka', licenceRenewal: card },
    { did: 'c', displayName: 'Chege', licenceRenewal: undefined },
    { did: 'd', displayName: 'Dalmas', licenceRenewal: card },
  ];

  it('counts the cards waiting on the office, and none when nobody has sent one', () => {
    expect(cardsToRead(pool)).toBe(2);
    expect(cardsToRead([pool[0], pool[2]])).toBe(0);
    expect(cardsToRead([])).toBe(0);
  });

  it('puts a waiting card first and leaves everybody else in the order they came', () => {
    expect(cardsFirst(pool).map((d) => d.did)).toEqual(['b', 'd', 'a', 'c']);
    expect(pool.map((d) => d.did)).toEqual(['a', 'b', 'c', 'd']); // the list it was given is not reordered
    expect(cardsFirst([pool[0], pool[2]]).map((d) => d.did)).toEqual(['a', 'c']);
  });

  it('points out a date that is not the one the driver read — and says nothing while there is no date, no card, or a date that cannot be saved', () => {
    expect(readingDiffers(card, '2031-03-30')).toBe(true);
    expect(readingDiffers(card, '2031-03-31')).toBe(false);
    expect(readingDiffers(card, '')).toBe(false);
    expect(readingDiffers(undefined, '2031-03-30')).toBe(false);
    expect(readingDiffers(card, '2020-01-01', true)).toBe(false);
  });

  it('says where the date on record came from: a card, somebody’s word, or before that was kept', () => {
    expect(licenceSource({ expiresAt: '2031-03-30', copyRef: 'med_card', recordedAt: '2026-10-11T09:00:00.000Z' })).toBe('card');
    expect(licenceSource({ expiresAt: '2031-03-30', recordedAt: '2026-10-11T09:00:00.000Z' })).toBe('word');
    expect(licenceSource({ expiresAt: '2031-03-30' })).toBeNull();
    expect(licenceSource({ expiresAt: '2031-03-30', copyRef: 'med_vetting' })).toBeNull(); // a copy with no recording is not a reading
    expect(licenceSource(undefined)).toBeNull();
  });

  it('asks the office for ITS reading, and tells the driver’s apart from it', () => {
    expect(t('fleet.card.readDate')).toBe('Expiry date, as you read it on the card');
    expect(t('fleet.card.read', { date: '11 Oct 2026', expires: '31 Mar 2031' })).toBe('Sent 11 Oct 2026. They read the expiry as 31 Mar 2031.');
    expect(t('fleet.card.differs', { expires: '31 Mar 2031' })).toBe('That is not the date they read (31 Mar 2031)');
    expect(t('fleet.card.waitingMany', { count: 2 })).toBe('2 renewed licences to read');
    expect(t('fleet.card.waitingOne')).toBe('A renewed licence to read');
  });
});

/**
 * THE OFFICE'S LIVE MAP: vehicles where their phones last reported, a straight line to each one's next stop, and what
 * drivers reported on the roads around them.
 */
describe('the fleet map', () => {
  const NOW = Date.parse('2026-10-15T10:00:00.000Z');
  const recent = '2026-10-15T09:58:00.000Z';
  const sessions = [
    { driverDid: 'did:a', driverName: 'Amos K.', plate: 'KLM 002B', vehicleClass: 'bike', hoursOnDuty: 3, location: { lat: -1.29, lng: 36.82 }, lastLocatedAt: recent },
    { driverDid: 'did:b', driverName: 'Grace M.', plate: 'KDA 100V', vehicleClass: 'van', hoursOnDuty: 12.5, location: { lat: -1.3, lng: 36.9 }, lastLocatedAt: '2026-10-15T08:00:00.000Z' },
    // On shift, and no position yet: on the list, never a pin at 0,0.
    { driverDid: 'did:c', driverName: 'Otieno', plate: 'KCB 777T', vehicleClass: 'truck', hoursOnDuty: 1 },
  ];
  const cargo = [
    { ref: 'BAG-1', kind: 'tote', weightKg: 8, destLabel: 'Central Sort', driver: 'Amos K.', driverDid: 'did:a', status: 'in_transit', nextStop: { what: 'drop' as const, label: 'Central Sort', location: { lat: -1.4, lng: 36.95 } } },
    { ref: 'FRT-9', kind: 'freight', weightKg: 20, destLabel: 'Kitengela', driver: 'Amos K.', driverDid: 'did:a', status: 'claimed', nextStop: { what: 'pickup' as const, label: 'Gikomba depot', location: { lat: -1.285, lng: 36.835 } } },
  ];
  const hazards = [{ constraintId: 'rc1', kind: 'LOW_BRIDGE', at: { lat: -1.31, lng: 36.85 }, value: 4.2, status: 'active', reportedAt: '2026-10-14T08:00:00.000Z', confirmations: 2, refutations: 0 }];

  it('pins each vehicle that reported a position, says so when it has gone dark, and pins hazards as warnings', () => {
    const { pins } = fleetMap(sessions, cargo, hazards, t, NOW);
    const [stop, amos, grace, hazard] = pins;
    expect(pins.map((p) => p.id)).toEqual(['s:-1.28500,36.83500', 'v:did:a', 'v:did:b', 'h:rc1']);
    expect(amos.label).toBe('KLM 002B · Amos K.');
    expect(grace.label).toMatch(/^KDA 100V · Grace M\. · no signal /);
    expect(hazard).toMatchObject({ tone: 'warn', point: { lat: -1.31, lng: 36.85 } });
    expect(hazard.label).toMatch(/^Low bridge/);
    expect(amos).not.toHaveProperty('tone');
    // The end of the line is marked, named for the place — and drawn first, under the vehicles.
    expect(stop).toEqual({ id: 's:-1.28500,36.83500', label: 'Gikomba depot', point: { lat: -1.285, lng: 36.835 }, tone: 'stop' });
  });

  it('marks only where a line ends, once for a place two vehicles share, and opens who is heading there', () => {
    // Grace's next stop is the same depot as Amos's, to within a metre: one ring, two vehicles in it.
    const both = [...cargo, { ref: 'FRT-12', kind: 'freight', weightKg: 300, destLabel: 'Athi River', driver: 'Grace M.', driverDid: 'did:b', status: 'claimed', nextStop: { what: 'pickup' as const, label: 'Gikomba depot', location: { lat: -1.285000001, lng: 36.835 } } }];
    const { pins, lines } = fleetMap(sessions, both, [], t, NOW);
    expect(pins.filter((p) => p.tone === 'stop').map((p) => p.id)).toEqual(['s:-1.28500,36.83500']);
    expect(lines).toHaveLength(2);
    // Amos's far drop is not his next stop: no line ends there, so no ring.
    expect(pins.some((p) => p.label === 'Central Sort')).toBe(false);
    const d = stopDetail('-1.28500,36.83500', sessions, both)!;
    expect(d.label).toBe('Gikomba depot');
    expect(d.vehicles.map((v) => v.session.plate)).toEqual(['KLM 002B', 'KDA 100V']);
    // Each with what it does THERE — not everything it carries.
    expect(d.vehicles[0].loads.map((l) => l.ref)).toEqual(['FRT-9']);
    expect(t('fleet.map.stopCollects', { ref: 'FRT-9', kg: 20 })).toBe('collects FRT-9 · 20 kg here');
    // The vehicle moved on and the map read itself again: the stop opens nothing rather than a stale list.
    expect(stopDetail('-1.40000,36.95000', sessions, both)).toBeNull();
    // A driver not on the road is nobody's line.
    expect(stopDetail('-1.28500,36.83500', [sessions[2]], both)).toBeNull();
  });

  it('draws one line per vehicle to its NEAREST stop, and says it is a straight line, not the road', () => {
    const { lines } = fleetMap(sessions, cargo, hazards, t, NOW);
    // Amos has a drop far off and a pickup round the corner: the pickup is next.
    expect(lines).toEqual([{ id: 'n:did:a', label: 'KLM 002B to collect at Gikomba depot — a straight line, not the road', from: { lat: -1.29, lng: 36.82 }, to: { lat: -1.285, lng: 36.835 } }]);
    expect(nextStopOf('did:b', { lat: -1.3, lng: 36.9 }, cargo)).toBeUndefined();
  });

  it('asks for hazards around the vehicles, wide enough to take them all in — and not at all with none on the road', () => {
    // One vehicle in town: the corridors around it, not the block it stands on.
    expect(hazardArea([sessions[0]])).toEqual({ at: { lat: -1.29, lng: 36.82 }, radiusKm: HAZARD_MIN_KM });
    // The stop a vehicle is heading for is in the area too, however far it is — up to the most that is asked.
    const far = [{ ...cargo[0], nextStop: { what: 'drop' as const, label: 'Nakuru', location: { lat: -0.3, lng: 36.07 } } }];
    expect(hazardArea([sessions[0]], far)!.radiusKm).toBeGreaterThan(HAZARD_MIN_KM);
    expect(hazardArea([sessions[0]], far)!.radiusKm).toBeLessThanOrEqual(150);
    // Another fleet's stop, or a driver not on the road, does not stretch it.
    expect(hazardArea([sessions[0]], [{ ...far[0], driverDid: 'did:someone-else' }])!.radiusKm).toBe(HAZARD_MIN_KM);
    // No vehicle on the road: nothing to ask about.
    expect(hazardArea([sessions[2]])).toBeNull();
  });

  it('opens a vehicle with its loads, where it goes next and the hours left of its shift', () => {
    const v = vehicleDetail('did:a', sessions, cargo, 13, NOW)!;
    expect(v).toMatchObject({ hoursLeft: 10, next: { what: 'pickup', label: 'Gikomba depot' } });
    expect(v.loads.map((l) => l.ref)).toEqual(['BAG-1', 'FRT-9']);
    expect(vehicleDetail('did:b', sessions, cargo, 13, NOW)).toMatchObject({ hoursLeft: 0.5, loads: [] });
    expect(vehicleDetail('did:nobody', sessions, cargo, 13, NOW)).toBeNull();
  });

  it('keeps a hazard’s label short — the dispute is said in its sheet — and never says a road with nothing reported is clear', () => {
    // A long label lay over a vehicle's dot in the walk and took the tap meant for the vehicle.
    expect(hazardWords({ ...hazards[0], status: 'disputed' }, t)).toBe(hazardWords(hazards[0], t));
    expect(hazardWords(hazards[0], t)).toMatch(/^Low bridge · /);
    expect(t('fleet.map.hazardDisputedDetail', { count: 1 })).toMatch(/1 driver says it is gone/);
    expect(t('fleet.map.keyNoHazards')).toMatch(/not the same as the roads being clear/);
  });
});
