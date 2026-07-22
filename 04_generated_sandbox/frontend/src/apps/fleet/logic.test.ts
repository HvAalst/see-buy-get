import { describe, expect, it } from 'vitest';
import {
  EMPTY_DRIVER,
  EMPTY_VEHICLE,
  driverAction,
  driverMissing,
  freeDrivers,
  freeVehicles,
  isHeavySelection,
  projectPositions,
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
    expect(vehicleMissing(EMPTY_VEHICLE)).toContain('plate');
    expect(vehicleMissing({ ...EMPTY_VEHICLE, plate: 'K 1' })).toContain('owner');
    expect(vehicleMissing({ ...EMPTY_VEHICLE, plate: 'K 1', ownerName: 'A', vehicleClass: 'truck' })).toContain('truck body');
    expect(vehicleMissing({ ...EMPTY_VEHICLE, plate: 'K 1', ownerName: 'A' })).toBeNull();
  });

  it('driver form: heavy selection demands the licence number', () => {
    const filled = { ...EMPTY_DRIVER, displayName: 'D', fullName: 'D Full', nationalId: 'N1', mobile: '07' };
    expect(driverMissing(filled)).toBeNull();
    expect(driverMissing({ ...filled, classes: ['van'] })).toContain('licence');
    expect(driverMissing({ ...filled, classes: ['van'], licenceNumber: 'L-9' })).toBeNull();
    expect(driverMissing({ ...filled, classes: [] })).toContain('at least one');
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

describe('projectPositions', () => {
  const at = (lat: number, lng: number): PositionRow => ({
    plate: 'P',
    driverName: 'D',
    vehicleClass: 'van',
    hoursOnDuty: 2,
    location: { lat, lng },
  });

  it('spreads points inside the clamped 4–96 / 6–94 frame', () => {
    const [a, b] = projectPositions([at(-1.2, 36.7), at(-1.3, 36.9)]);
    for (const p of [a, b]) {
      expect(p.x).toBeGreaterThanOrEqual(4);
      expect(p.x).toBeLessThanOrEqual(96);
      expect(p.y).toBeGreaterThanOrEqual(6);
      expect(p.y).toBeLessThanOrEqual(94);
    }
    expect(a.x).not.toBeCloseTo(b.x);
    expect(a.y).toBeLessThan(b.y); // higher latitude renders higher (smaller y)
  });

  it('one vehicle centres instead of dividing by zero', () => {
    const [p] = projectPositions([at(-1.2, 36.7)]);
    expect(Number.isFinite(p.x)).toBe(true);
    expect(Number.isFinite(p.y)).toBe(true);
  });

  it('empty input renders nothing', () => {
    expect(projectPositions([])).toEqual([]);
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
    expect(subtypeLine({ id: 'refrigerated', label: 'Refrigerated box', capacityKg: 2500, coldChain: true })).toBe(
      'Refrigerated box: about 2500 kg · cold-chain',
    );
    expect(subtypeLine(undefined)).toBeNull();
  });
});
