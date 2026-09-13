import { Injectable } from '@nestjs/common';
import { GlosError } from '../../foundation/http/glos-error';
import { MAX_NUDGE_MIN_EARN } from './pudo.config';
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
import { EntityService } from '../../foundation/entity/entity.service';
import { NETWORK_JURISDICTION } from './pudo.config';

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
  /** ISO-3166-alpha-2 legal residence — for an INDEPENDENT courier only; ignored when a fleet employs
   *  them, because the network pays the fleet. Defaults to the network's own jurisdiction. */
  jurisdiction?: string;
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
    private readonly entities: EntityService,
  ) {}

  /**
   * Who the network actually pays for this driver's work, and therefore which sister owes it.
   *
   * A fleet-attached driver resolves to their FLEET: the sister contracts the fleet as a supplier, pays
   * it one invoice in one currency, and what the fleet then pays its own drivers — in which countries,
   * under whose employment law, with what withholding — is the fleet's business and never ours. An
   * independent courier resolves to themselves, settled by the sister where they legally reside.
   */
  settlingEntityIdOf(driver: FleetDriver): string {
    if (driver.managerDid) return this.managers.entityIdOf(this.managers.get(driver.managerDid));
    return driver.entityId ?? this.entities.requireForJurisdiction(driver.jurisdiction ?? NETWORK_JURISDICTION).entityId;
  }

  /**
   * Who actually gets paid for this driver's work, and which sister owes it.
   *
   * The network contracts a FLEET or an independent courier — never a person who happens to be at a
   * wheel — so a fleet driver's money is owed to their fleet. See the scope boundary: we move parcels, we
   * do not do payroll, and the payable is keyed to who we CONTRACT with rather than who does the work.
   *
   * Note what this does NOT change: the driver's own earnings register stays keyed to the DRIVER. "What
   * did I earn today" and "who does the network owe" are different questions with legitimately different
   * answers, and collapsing them would either hide a fleet driver's own record from them or quietly turn
   * their earnings into their employer's ledger row.
   */
  /**
   * The sister that settles this driver's work, or nothing — where the driver's fleet stands in a country we only
   * match. For paths that must answer rather than refuse: a delivery must not fail because nobody of ours pays.
   */
  payeeOrNone(did: string): { entityId?: string; payeeDid: string } {
    const driver = this.require(did);
    const entityId = driver.managerDid
      ? this.managers.entityIdOrNone(this.managers.get(driver.managerDid))
      : driver.entityId ?? this.entities.forJurisdiction(driver.jurisdiction ?? NETWORK_JURISDICTION)?.entityId;
    return { ...(entityId ? { entityId } : {}), payeeDid: driver.managerDid ?? driver.did };
  }

  payeeOf(did: string): { entityId: string; payeeDid: string } {
    const driver = this.require(did);
    return { entityId: this.settlingEntityIdOf(driver), payeeDid: driver.managerDid ?? driver.did };
  }

  /**
   * What this driver's work has actually turned into money for, and for WHOM.
   *
   * The jobs register has always carried a `paid` flag, and it has never meant paid: `driverPaid` is set
   * the moment a load is delivered, when the network ACCRUES what it owes. While nothing ever left the
   * building that was a harmless shorthand. It stopped being harmless the day settlement shipped — a
   * screen that says "paid" about money still sitting in the sister's account is a false statement on the
   * one screen somebody opens to find out whether they have been paid.
   *
   * So the two facts are reported apart. `settled` is money a rail confirmed leaving; `inFlight` is a
   * payment on its way. And `payeeDid` names who it goes to, which for a fleet driver is not them — that
   * is the scope boundary made visible rather than left for somebody to discover on payday.
   */
  settlementFor(did: string, payouts: { forPayee(payeeDid: string): { settled: number; inFlight: number; currency?: string } }): {
    payeeDid: string;
    paidToMe: boolean;
    settled: number;
    inFlight: number;
    currency?: string;
  } {
    const driver = this.require(did);
    // WHO is paid is a fact about the contract, not about money — so it is read without asking which sister
    // pays, which would refuse for a driver whose fleet stands where no sister does (a read must answer).
    const payeeDid = driver.managerDid ?? driver.did;
    return { payeeDid, paidToMe: payeeDid === driver.did, ...payouts.forPayee(payeeDid) };
  }

  /** Whether the network contracts this driver directly (an independent courier) or through a fleet. */
  isIndependent(driver: FleetDriver): boolean {
    return !driver.managerDid;
  }

  /** The highest registry tier across the driver's cleared classes decides the onboarding path. */
  registryFor(licenceClasses: VehicleClass[]): DriverRegistry {
    return licenceClasses.some((c) => VEHICLE_SPEC[c]?.registry === 'heavy') ? 'heavy' : 'light';
  }

  register(input: RegisterDriverInput): FleetDriver {
    if (!input.licenceClasses?.length) throw new GlosError('FIELD_REQUIRED', 'Select at least one vehicle class the driver can operate');
    for (const c of input.licenceClasses) if (!VEHICLE_SPEC[c]) throw new GlosError('INVALID_VEHICLE_CLASS', `Unknown vehicle class: ${c}`);
    if (input.managerDid) this.managers.requireActive(input.managerDid);
    const registry = this.registryFor(input.licenceClasses);

    // Heavy registry requires a real licence (number + expiry, not already expired).
    if (registry === 'heavy') {
      if (!input.licenceNumber?.trim()) throw new GlosError('LICENCE_REQUIRED', 'A driving licence number is required for this vehicle class');
      if (!input.licenceExpiresAt) throw new GlosError('LICENCE_REQUIRED', 'A licence expiry date is required for this vehicle class');
      if (this.isExpired(input.licenceExpiresAt)) throw new GlosError('LICENCE_EXPIRED', 'The driving licence has expired');
    }

    // Dedup — one national ID, one mobile, one licence number across the network.
    const prints = { id: fp(input.nationalId), mobile: fp(input.mobile), ...(input.licenceNumber ? { lic: fp(input.licenceNumber) } : {}) };
    if (this.fingerprints.has(prints.id)) throw new GlosError('DUPLICATE', 'A driver with this national ID already exists');
    if (this.fingerprints.has(prints.mobile)) throw new GlosError('DUPLICATE', 'A driver with this mobile already exists');
    if (prints.lic && this.fingerprints.has(prints.lic)) throw new GlosError('DUPLICATE', 'A driver with this licence number already exists');

    const did = this.dids.generate(`pudo-driver:${input.mobile}`, { role: 'pudo-driver' }).id;
    const { vaultRef } = this.vault.store({ fullName: input.fullName, governmentId: input.nationalId, phone: input.mobile }, { region: 'local' });
    this.core.upsert({ did, vaultRef, tier: 2, status: 'pending', capabilities: ['pudo-driver'], metadata: { registry, homeZone: input.homeZone } });
    for (const p of Object.values(prints)) this.fingerprints.add(p);

    // An INDEPENDENT courier is contracted by the sister where they legally reside — bicycle or truck,
    // it makes no difference. A fleet-attached driver gets neither field: their fleet is the supplier,
    // and the network has no business knowing where its suppliers' staff live.
    const independent = !input.managerDid;
    const jurisdiction = independent ? (input.jurisdiction || NETWORK_JURISDICTION).toUpperCase() : undefined;
    const entity = jurisdiction ? this.entities.requireForJurisdiction(jurisdiction) : undefined;

    const now = new Date().toISOString();
    const driver: FleetDriver = {
      driverId: `drv_${randomBytes(8).toString('hex')}`,
      did,
      managerDid: input.managerDid,
      jurisdiction,
      entityId: entity?.entityId,
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
  submitKyc(did: string, documents: { idCopyRef: string; licenceCopyRef: string; photoRef?: string }): FleetDriver {
    const driver = this.require(did);
    if (driver.registry !== 'heavy') throw new GlosError('INVALID_STATE', 'Light-registry drivers (bike/motorcycle) do not need KYC');
    if (driver.status !== 'DRAFT') throw new GlosError('INVALID_STATE', `Driver is ${driver.status}, expected DRAFT`);
    if (!documents.idCopyRef || !documents.licenceCopyRef) throw new GlosError('KYC_INCOMPLETE', 'KYC requires an ID copy and a licence copy');
    // The portrait rides along when there is one, and is absent without complaint when there is not —
    // see DriverPortrait for why the face is not a gate and the documents are.
    if (documents.photoRef) driver.portrait = { photoRef: documents.photoRef, addedAt: new Date().toISOString() };
    driver.kyc = { idCopyRef: documents.idCopyRef, licenceCopyRef: documents.licenceCopyRef, submittedAt: new Date().toISOString() } as DriverKyc;
    driver.status = 'KYC_PENDING';
    return driver;
  }

  /** Operator vetting (heavy): approve → ACTIVE (+ badge); reject → DRAFT. Re-checks licence + record. */
  decideKyc(did: string, approve: boolean, by?: string): FleetDriver {
    const driver = this.require(did);
    if (driver.status !== 'KYC_PENDING') throw new GlosError('INVALID_STATE', `Driver is ${driver.status}, expected KYC_PENDING`);
    if (!approve) { driver.status = 'DRAFT'; return driver; }
    if (!driver.kyc) throw new GlosError('KYC_INCOMPLETE', 'Cannot approve: KYC documents missing');
    if (!driver.criminalRecordClear) throw new GlosError('APPROVAL_BLOCKED', 'Cannot approve: criminal-record check not cleared');
    if (this.isExpired(driver.licence.expiresAt)) throw new GlosError('APPROVAL_BLOCKED', 'Cannot approve: the driving licence has expired');
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

  /**
   * "Do not wake me for less than this." Zero, or nothing, clears it.
   *
   * Deliberately NOT a search filter. This gates the INTERRUPTION; the list views keep their own typed
   * filter and the open board keeps none — a driver who is already looking is asking a different question
   * from a driver being tapped on the shoulder at the wheel.
   */
  setNudgeMinEarn(did: string, amount?: number): FleetDriver {
    const driver = this.require(did);
    if (amount != null && (!Number.isFinite(amount) || amount < 0 || amount > MAX_NUDGE_MIN_EARN)) {
      throw new GlosError('INVALID_INPUT', `A minimum must be between 0 and ${MAX_NUDGE_MIN_EARN}`);
    }
    // Zero and undefined are ONE state — no floor — rather than "a floor of nothing", which every load
    // clears anyway and which would leave two ways of saying the same thing.
    driver.nudgeMinEarn = amount != null && amount > 0 ? Math.round(amount * 100) / 100 : undefined;
    return driver;
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
    if (!driver) throw new GlosError('NOT_FOUND', `Driver not found: ${did}`);
    return driver;
  }
}
