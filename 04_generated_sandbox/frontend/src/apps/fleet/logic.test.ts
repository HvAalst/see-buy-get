import { describe, expect, it } from 'vitest';
import { t } from '../../shared/i18n'; // English is the base catalog, so the real `t` yields the English literals
import {
  EMPTY_DRIVER,
  EMPTY_VEHICLE,
  bodyPickerOptions,
  driverAction,
  driverMissing,
  freeDrivers,
  freeVehicles,
  isHeavySelection,
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
