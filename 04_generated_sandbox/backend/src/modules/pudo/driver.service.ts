import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { createHash, randomBytes } from 'crypto';
import { DidService } from '../../foundation/did/did.service';
import { IdentityVault } from '../../foundation/data-firewall/identity-vault.service';
import { OperationalStore } from '../../foundation/data-firewall/operational-store.service';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { VEHICLE_SPEC, VehicleClass } from './fleet.config';
import { DriverKyc, DriverRegistry, FleetDriver } from './fleet.types';
import { FleetManagerService } from './fleet-manager.service';

interface RegisterDriverInput {
  displayName: string; // shop-floor label (non-PII)
  fullName: string;
  nationalId: string;
  mobile: string;
  licenceClasses: VehicleClass[]; // vehicle classes the driver is cleared to operate
  licenceNumber?: string; // required for heavy registry
  licenceExpiresAt?: string; // required for heavy registry
  criminalRecordClear?: boolean;
  homeZone?: string;
  managerDid?: string; // the fleet manager that employs this driver (must be ACTIVE)
}

const fp = (value: string): string => createHash('sha256').update(value.trim().toLowerCase()).digest('hex');

/**
 * DriverService — driver identity + onboarding (Compendium Ch 19), staged by the vehicle classes the
 * driver is cleared for. A bike/motorcycle courier takes the LIGHT path (register → ACTIVE, badge
 * issued) so micro-businesses can join the MDP→PUDO feeder with minimal friction. Anyone cleared for
 * a heavier class (tuktuk/car/van/bus/truck) takes the HEAVY path — a real licence with an expiry,
 * KYC docs, a clean-record check, and operator vetting before a badge is issued. Reuses the GLOS
 * backbone: a DID per driver, the Golden Record in the vault, a tier-2 entry in the operational core.
 */
@Injectable()
export class DriverService {
  // Durable: onboarded drivers + their badge index (badgeId → DID). If drivers reload but the badge
  // index does not, handover badge resolution breaks after a restart — so both persist.
  private readonly drivers = new PersistentMap<string, FleetDriver>('pudo-drivers'); // keyed by DID
  private readonly badges = new PersistentMap<string, string>('pudo-driver-badges'); // badgeId → DID
  private readonly fingerprints = new Set<string>();

  constructor(
    private readonly dids: DidService,
    private readonly vault: IdentityVault,
    private readonly core: OperationalStore,
    private readonly events: EventBus,
    private readonly managers: FleetManagerService,
  ) {}

  /** The highest registry tier across the driver's cleared classes decides the onboarding path. */
  registryFor(licenceClasses: VehicleClass[]): DriverRegistry {
    return licenceClasses.some((c) => VEHICLE_SPEC[c]?.registry === 'heavy') ? 'heavy' : 'light';
  }

  register(input: RegisterDriverInput): FleetDriver {
    if (!input.licenceClasses?.length) throw new BadRequestException('Select at least one vehicle class the driver can operate');
    for (const c of input.licenceClasses) if (!VEHICLE_SPEC[c]) throw new BadRequestException(`Unknown vehicle class: ${c}`);
    if (input.managerDid) this.managers.requireActive(input.managerDid);
    const registry = this.registryFor(input.licenceClasses);

    // Heavy registry requires a real licence (number + expiry, not already expired).
    if (registry === 'heavy') {
      if (!input.licenceNumber?.trim()) throw new BadRequestException('A driving licence number is required for this vehicle class');
      if (!input.licenceExpiresAt) throw new BadRequestException('A licence expiry date is required for this vehicle class');
      if (this.isExpired(input.licenceExpiresAt)) throw new BadRequestException('The driving licence has expired');
    }

    // Dedup — one national ID, one mobile, one licence number across the network.
    const prints = { id: fp(input.nationalId), mobile: fp(input.mobile), ...(input.licenceNumber ? { lic: fp(input.licenceNumber) } : {}) };
    if (this.fingerprints.has(prints.id)) throw new ConflictException('A driver with this national ID already exists');
    if (this.fingerprints.has(prints.mobile)) throw new ConflictException('A driver with this mobile already exists');
    if (prints.lic && this.fingerprints.has(prints.lic)) throw new ConflictException('A driver with this licence number already exists');

    const did = this.dids.generate(`pudo-driver:${input.mobile}`, { role: 'pudo-driver' }).id;
    const { vaultRef } = this.vault.store({ fullName: input.fullName, governmentId: input.nationalId, phone: input.mobile }, { region: 'local' });
    this.core.upsert({ did, vaultRef, tier: 2, status: 'pending', capabilities: ['pudo-driver'], metadata: { registry, homeZone: input.homeZone } });
    for (const p of Object.values(prints)) this.fingerprints.add(p);

    const now = new Date().toISOString();
    const driver: FleetDriver = {
      driverId: `drv_${randomBytes(8).toString('hex')}`,
      did,
      managerDid: input.managerDid,
      vaultRef,
      displayName: input.displayName,
      registry,
      licence: { number: input.licenceNumber ?? 'n/a', classes: input.licenceClasses, expiresAt: input.licenceExpiresAt },
      criminalRecordClear: input.criminalRecordClear ?? false,
      homeZone: input.homeZone,
      status: 'DRAFT',
      createdAt: now,
      lastSeenAt: now,
    };
    this.drivers.set(did, driver);

    // Light registry (bike/motorcycle): no KYC gate — activate immediately and issue a badge.
    if (registry === 'light') this.activate(driver, 'light registry');
    return driver;
  }

  /** Heavy registry: upload ID + licence copy → KYC_PENDING. */
  submitKyc(did: string, documents: { idCopyRef: string; licenceCopyRef: string }): FleetDriver {
    const driver = this.require(did);
    if (driver.registry !== 'heavy') throw new BadRequestException('Light-registry drivers (bike/motorcycle) do not need KYC');
    if (driver.status !== 'DRAFT') throw new BadRequestException(`Driver is ${driver.status}, expected DRAFT`);
    if (!documents.idCopyRef || !documents.licenceCopyRef) throw new BadRequestException('KYC requires an ID copy and a licence copy');
    driver.kyc = { idCopyRef: documents.idCopyRef, licenceCopyRef: documents.licenceCopyRef, submittedAt: new Date().toISOString() } as DriverKyc;
    driver.status = 'KYC_PENDING';
    return driver;
  }

  /** Operator vetting (heavy): approve → ACTIVE (+ badge); reject → DRAFT. Re-checks licence + record. */
  decideKyc(did: string, approve: boolean, by?: string): FleetDriver {
    const driver = this.require(did);
    if (driver.status !== 'KYC_PENDING') throw new BadRequestException(`Driver is ${driver.status}, expected KYC_PENDING`);
    if (!approve) { driver.status = 'DRAFT'; return driver; }
    if (!driver.kyc) throw new BadRequestException('Cannot approve: KYC documents missing');
    if (!driver.criminalRecordClear) throw new BadRequestException('Cannot approve: criminal-record check not cleared');
    if (this.isExpired(driver.licence.expiresAt)) throw new BadRequestException('Cannot approve: the driving licence has expired');
    this.core.upsert({ did, vaultRef: driver.vaultRef, tier: 2, status: 'active', capabilities: ['pudo-driver'], metadata: { by } });
    this.activate(driver, by ?? 'vetting');
    return driver;
  }

  suspend(did: string, reason?: string): FleetDriver {
    const driver = this.require(did);
    driver.status = 'SUSPENDED';
    void this.events.publish(GlosEvent.Pudo.DriverSuspended, { did, driverId: driver.driverId, reason }, { source: 'pudo' }).catch(() => undefined);
    return driver;
  }

  /** A driver may operate only if ACTIVE and (heavy) the licence has not expired. */
  canOperate(did: string): boolean {
    const driver = this.drivers.get(did);
    if (!driver || driver.status !== 'ACTIVE') return false;
    if (driver.registry === 'heavy' && this.isExpired(driver.licence.expiresAt)) return false;
    return true;
  }

  /** Whether the driver's licence clears them for a given vehicle class. */
  clearedFor(did: string, vehicleClass: VehicleClass): boolean {
    return this.require(did).licence.classes.includes(vehicleClass);
  }

  setAssignedVehicle(did: string, vehicleId?: string): void {
    this.require(did).assignedVehicleId = vehicleId;
  }

  ping(did: string): FleetDriver {
    const driver = this.require(did);
    driver.lastSeenAt = new Date().toISOString();
    return driver;
  }

  kycQueue(): FleetDriver[] {
    return [...this.drivers.values()].filter((d) => d.status === 'KYC_PENDING');
  }

  byBadge(badgeId: string): FleetDriver | undefined {
    const did = this.badges.get(badgeId);
    return did ? this.drivers.get(did) : undefined;
  }

  get(did: string): FleetDriver {
    return this.require(did);
  }

  list(filter: { managerDid?: string } = {}): FleetDriver[] {
    return [...this.drivers.values()].filter((d) => !filter.managerDid || d.managerDid === filter.managerDid);
  }

  // --- internals ---

  private activate(driver: FleetDriver, by: string): void {
    if (!driver.badgeId) {
      driver.badgeId = `DRV-${randomBytes(4).toString('hex').toUpperCase()}`;
      this.badges.set(driver.badgeId, driver.did);
    }
    driver.status = 'ACTIVE';
    void this.events.publish(GlosEvent.Pudo.DriverActivated, { did: driver.did, driverId: driver.driverId, badgeId: driver.badgeId, registry: driver.registry, by }, { source: 'pudo' }).catch(() => undefined);
  }

  private isExpired(iso?: string): boolean {
    if (!iso) return false;
    return new Date(iso).getTime() < Date.now();
  }

  private require(did: string): FleetDriver {
    const driver = this.drivers.get(did);
    if (!driver) throw new NotFoundException(`Driver not found: ${did}`);
    return driver;
  }
}
