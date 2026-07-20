import { BadRequestException, ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { createHash, randomBytes } from 'crypto';
import { DidService } from '../../foundation/did/did.service';
import { IdentityVault } from '../../foundation/data-firewall/identity-vault.service';
import { OperationalStore } from '../../foundation/data-firewall/operational-store.service';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { geocodeAddress } from './geo';
import { FleetManager, FleetManagerKyc, FleetManagerRequirements, FleetManagerStatus } from './fleet.types';

interface RegisterManagerInput {
  companyName: string;
  tradingName?: string;
  contactPhone: string;
  contactEmail?: string;
  ownerFullName: string;
  ownerNationalId: string;
  depotAddress?: string;
  location?: { lat: number; lng: number };
  requirements: FleetManagerRequirements;
}

const fp = (value: string): string => createHash('sha256').update(value.trim().toLowerCase()).digest('hex');

/**
 * FleetManagerService — onboards the fleet OPERATOR who owns the vehicles and employs the drivers
 * (Compendium Ch 19), with its own eligibility filter distinct from agents/drivers: a valid business
 * registration, a regulated transport-operator licence, and a tax ID, plus a depot location. Lifecycle
 * DRAFT → KYC_PENDING → APPROVED → ACTIVE → SUSPENDED — APPROVED needs vetting + KYC docs; ACTIVE needs
 * a refundable operating bond. Only an ACTIVE manager may register vehicles + onboard drivers. Reuses
 * the GLOS backbone: a DID, the Golden Record in the vault, a tier-2 'fleet-manager' core entry.
 */
@Injectable()
export class FleetManagerService {
  // Durable: onboarded fleet managers (KYC state, bond, the tenant boundary S3 authorizes against).
  private readonly managers = new PersistentMap<string, FleetManager>('pudo-fleet-managers'); // keyed by DID
  private readonly fingerprints = new Set<string>();

  constructor(
    private readonly dids: DidService,
    private readonly vault: IdentityVault,
    private readonly core: OperationalStore,
    private readonly events: EventBus,
  ) {}

  /** The fleet-manager eligibility filter. Returns the list of unmet hard requirements. */
  unmetRequirements(input: { requirements: FleetManagerRequirements; location?: { lat: number; lng: number }; depotAddress?: string }): string[] {
    const r = input.requirements;
    const fails: string[] = [];
    if (!r.businessRegistrationNo?.trim()) fails.push('a registered business number is required');
    if (!r.transportOperatorLicence?.trim()) fails.push('a transport-operator licence is required');
    if (!r.taxId?.trim()) fails.push('a tax ID is required');
    if (!input.location && !input.depotAddress?.trim()) fails.push('a depot location (map pin and/or address) is required');
    return fails;
  }

  register(input: RegisterManagerInput): FleetManager {
    const unmet = this.unmetRequirements(input);
    if (unmet.length) throw new BadRequestException(`Does not meet fleet-manager requirements: ${unmet.join('; ')}`);
    const location = input.location ?? geocodeAddress(input.depotAddress!);

    // Dedup — one business registration / tax ID / operator licence across the network.
    const prints = { reg: fp(input.requirements.businessRegistrationNo), tax: fp(input.requirements.taxId), lic: fp(input.requirements.transportOperatorLicence) };
    if (this.fingerprints.has(prints.reg)) throw new ConflictException('A fleet manager with this business registration already exists');
    if (this.fingerprints.has(prints.tax)) throw new ConflictException('A fleet manager with this tax ID already exists');
    if (this.fingerprints.has(prints.lic)) throw new ConflictException('A fleet manager with this operator licence already exists');

    const did = this.dids.generate(`pudo-fleet:${input.contactPhone}`, { role: 'fleet-manager' }).id;
    const { vaultRef } = this.vault.store({ fullName: input.ownerFullName, governmentId: input.ownerNationalId, phone: input.contactPhone }, { region: 'local' });
    this.core.upsert({ did, vaultRef, tier: 2, status: 'pending', capabilities: ['fleet-manager'], metadata: { companyName: input.companyName } });
    for (const p of Object.values(prints)) this.fingerprints.add(p);

    const manager: FleetManager = {
      managerId: `flm_${randomBytes(8).toString('hex')}`,
      did,
      vaultRef,
      companyName: input.companyName,
      tradingName: input.tradingName,
      contactPhone: input.contactPhone,
      contactEmail: input.contactEmail,
      depotAddress: input.depotAddress?.trim() || undefined,
      location,
      requirements: input.requirements,
      bondPaid: false,
      status: 'DRAFT',
      createdAt: new Date().toISOString(),
    };
    this.managers.set(did, manager);
    return manager;
  }

  /** Upload KYC docs (business reg cert, operator licence, owner ID, proof of address) → KYC_PENDING. */
  submitKyc(did: string, documents: { businessRegCertRef: string; operatorLicenceRef: string; ownerIdRef: string; proofOfAddressRef: string }): FleetManager {
    const m = this.require(did);
    if (m.status !== 'DRAFT') throw new BadRequestException(`Manager is ${m.status}, expected DRAFT`);
    if (!documents.businessRegCertRef || !documents.operatorLicenceRef || !documents.ownerIdRef || !documents.proofOfAddressRef) {
      throw new BadRequestException('KYC requires a business registration certificate, operator licence, owner ID, and proof of address');
    }
    m.kyc = { ...documents, submittedAt: new Date().toISOString() } as FleetManagerKyc;
    return this.transition(m, 'KYC_PENDING');
  }

  /** Vetting decision: approve → APPROVED (post the bond next); reject → DRAFT. */
  decideKyc(did: string, approve: boolean, by?: string): FleetManager {
    const m = this.require(did);
    if (m.status !== 'KYC_PENDING') throw new BadRequestException(`Manager is ${m.status}, expected KYC_PENDING`);
    if (!approve) return this.transition(m, 'DRAFT');
    if (!m.kyc) throw new BadRequestException('Cannot approve: KYC documents missing');
    const unmet = this.unmetRequirements(m);
    if (unmet.length) throw new BadRequestException(`Cannot approve: ${unmet.join('; ')}`);
    this.core.upsert({ did, vaultRef: m.vaultRef, tier: 2, status: 'active', capabilities: ['fleet-manager'], metadata: { by } });
    return this.transition(m, 'APPROVED');
  }

  /** Record the refundable operating bond → ACTIVE (the manager may now register a fleet). */
  recordBond(did: string): FleetManager {
    const m = this.require(did);
    if (m.status !== 'APPROVED') throw new BadRequestException(`Manager is ${m.status}, expected APPROVED before posting the bond`);
    m.bondPaid = true;
    if (!m.loginCode) m.loginCode = `FM-${randomBytes(3).toString('hex').toUpperCase()}`; // console sign-in code
    this.transition(m, 'ACTIVE');
    void this.events.publish(GlosEvent.Pudo.FleetManagerActivated, { did, managerId: m.managerId, companyName: m.companyName }, { source: 'pudo' }).catch(() => undefined);
    return m;
  }

  /** Fleet-console sign-in: resolve an ACTIVE manager from their login code (or DID). */
  login(credential: string): FleetManager {
    const c = (credential || '').trim();
    const m = [...this.managers.values()].find((x) => x.loginCode === c.toUpperCase() || x.did === c);
    if (!m) throw new UnauthorizedException('Unknown sign-in code');
    if (m.status !== 'ACTIVE') throw new UnauthorizedException(`Fleet manager is ${m.status} — not yet active`);
    return m;
  }

  suspend(did: string): FleetManager {
    return this.transition(this.require(did), 'SUSPENDED');
  }

  isActive(did: string): boolean {
    return this.managers.get(did)?.status === 'ACTIVE';
  }

  /** Guard used by vehicle/driver registration — only an ACTIVE manager may build a fleet. */
  requireActive(did: string): FleetManager {
    const m = this.require(did);
    if (m.status !== 'ACTIVE') throw new BadRequestException(`Fleet manager is ${m.status} — must be ACTIVE to register vehicles or drivers`);
    return m;
  }

  kycQueue(): FleetManager[] {
    return [...this.managers.values()].filter((m) => m.status === 'KYC_PENDING');
  }

  get(did: string): FleetManager {
    return this.require(did);
  }

  list(): FleetManager[] {
    return [...this.managers.values()];
  }

  // --- internals ---

  private transition(m: FleetManager, status: FleetManagerStatus): FleetManager {
    m.status = status;
    return m;
  }

  private require(did: string): FleetManager {
    const m = this.managers.get(did);
    if (!m) throw new NotFoundException(`Fleet manager not found: ${did}`);
    return m;
  }
}
