import { describe, expect, it } from 'vitest';
import { t } from '../../shared/i18n'; // English is the base catalog, so the real `t` yields the English literals
import { ageWords, signalState,
  EMPTY_DRIVER,
  EMPTY_VEHICLE,
  bodyPickerOptions,
  corridorState,
  driverAction,
  driverMissing,
  freeDrivers,
  freeVehicles,
  isHeavySelection,
  paperDay,
  paperLine,
  paperLineClass,
  papersAloud,
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
