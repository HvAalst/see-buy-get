import { Inject, Injectable } from '@nestjs/common';
import { GlosError } from '../../foundation/http/glos-error';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { createHash, randomBytes } from 'crypto';
import { DidService } from '../../foundation/did/did.service';
import { IdentityVault } from '../../foundation/data-firewall/identity-vault.service';
import { OperationalStore } from '../../foundation/data-firewall/operational-store.service';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { Geocoder, GEOCODER } from './geocoder';
import { FleetManager, FleetManagerKyc, FleetManagerRequirements, FleetManagerStatus } from './fleet.types';
import { EntityService } from '../../foundation/entity/entity.service';
import { PresenceService } from '../../foundation/presence/presence.service';
import { NETWORK_JURISDICTION } from './pudo.config';

interface RegisterManagerInput {
  companyName: string;
  /** ISO-3166-alpha-2 country of incorporation; defaults to the network's own jurisdiction. */
  jurisdiction?: string;
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
    private readonly entities: EntityService,
    private readonly presence: PresenceService,
    @Inject(GEOCODER) private readonly geocoder: Geocoder,
  ) {}

  /**
   * The sister that contracts and pays this fleet — THE MONEY GATE, refusing by name.
   *
   * A fleet may now stand where no sister does (the presence ladder: in a country we only match, the fleet IS
   * the local operator). What it cannot do there is be paid by us, and this says so in those words rather than
   * "no daughter company".
   */
  entityIdOf(manager: FleetManager): string {
    const own = this.entityIdOrNone(manager);
    if (own) return own;
    const country = manager.jurisdiction ?? NETWORK_JURISDICTION;
    this.presence.require(country, 'payouts');
    return this.entities.requireForJurisdiction(country).entityId;
  }

  /** The sister behind this fleet, or nothing — for read paths, which must answer rather than refuse. */
  entityIdOrNone(manager: FleetManager): string | undefined {
    return manager.entityId ?? this.entities.forJurisdiction(manager.jurisdiction ?? NETWORK_JURISDICTION)?.entityId;
  }

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
    if (unmet.length) throw new GlosError('REQUIREMENTS_NOT_MET', `Does not meet fleet-manager requirements: ${unmet.join('; ')}`);
    // Where this company is incorporated decides which sister contracts it. It used to REFUSE a country with no
    // sister — which made the presence ladder's central promise false: in a country we only match, the fleet is
    // the local operator, and a fleet that cannot register there cannot be matched there. So the question is now
    // the one the shops were asked (P2): does the network operate here at all? Where it does and no sister
    // exists, the fleet stands with no entity, and the money gate (entityIdOf) refuses by name if money is asked.
    const jurisdiction = (input.jurisdiction || NETWORK_JURISDICTION).toUpperCase();
    if (!this.presence.can(jurisdiction, 'takeIn')) {
      throw new GlosError('FORBIDDEN', `The network does not operate in ${jurisdiction} yet, so a fleet cannot register there`);
    }
    const entity = this.entities.forJurisdiction(jurisdiction);
    const location = input.location ?? this.geocoder.geocode(input.depotAddress!).location;

    // Dedup — one business registration / tax ID / operator licence across the network.
    const prints = { reg: fp(input.requirements.businessRegistrationNo), tax: fp(input.requirements.taxId), lic: fp(input.requirements.transportOperatorLicence) };
    if (this.fingerprints.has(prints.reg)) throw new GlosError('DUPLICATE', 'A fleet manager with this business registration already exists');
    if (this.fingerprints.has(prints.tax)) throw new GlosError('DUPLICATE', 'A fleet manager with this tax ID already exists');
    if (this.fingerprints.has(prints.lic)) throw new GlosError('DUPLICATE', 'A fleet manager with this operator licence already exists');

    const did = this.dids.generate(`pudo-fleet:${input.contactPhone}`, { role: 'fleet-manager' }).id;
    const { vaultRef } = this.vault.store({ fullName: input.ownerFullName, governmentId: input.ownerNationalId, phone: input.contactPhone }, { region: 'local' });
    this.core.upsert({ did, vaultRef, tier: 2, status: 'pending', capabilities: ['fleet-manager'], metadata: { companyName: input.companyName } });
    for (const p of Object.values(prints)) this.fingerprints.add(p);

    const manager: FleetManager = {
      managerId: `flm_${randomBytes(8).toString('hex')}`,
      did,
      vaultRef,
      companyName: input.companyName,
      jurisdiction,
      // Absent where no sister operates: nothing of ours contracts or pays this fleet there.
      ...(entity ? { entityId: entity.entityId } : {}),
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
    if (m.status !== 'DRAFT') throw new GlosError('INVALID_STATE', `Manager is ${m.status}, expected DRAFT`);
    if (!documents.businessRegCertRef || !documents.operatorLicenceRef || !documents.ownerIdRef || !documents.proofOfAddressRef) {
      throw new GlosError('KYC_INCOMPLETE', 'KYC requires a business registration certificate, operator licence, owner ID, and proof of address');
    }
    m.kyc = { ...documents, submittedAt: new Date().toISOString() } as FleetManagerKyc;
    return this.transition(m, 'KYC_PENDING');
  }

  /** Vetting decision: approve → APPROVED (post the bond next); reject → DRAFT. */
  decideKyc(did: string, approve: boolean, by?: string): FleetManager {
    const m = this.require(did);
    if (m.status !== 'KYC_PENDING') throw new GlosError('INVALID_STATE', `Manager is ${m.status}, expected KYC_PENDING`);
    if (!approve) return this.transition(m, 'DRAFT');
    if (!m.kyc) throw new GlosError('KYC_INCOMPLETE', 'Cannot approve: KYC documents missing');
    const unmet = this.unmetRequirements(m);
    if (unmet.length) throw new GlosError('APPROVAL_BLOCKED', `Cannot approve: ${unmet.join('; ')}`);
    this.core.upsert({ did, vaultRef: m.vaultRef, tier: 2, status: 'active', capabilities: ['fleet-manager'], metadata: { by } });
    return this.transition(m, 'APPROVED');
  }

  /** Record the refundable operating bond → ACTIVE (the manager may now register a fleet). */
  recordBond(did: string): FleetManager {
    const m = this.require(did);
    if (m.status !== 'APPROVED') throw new GlosError('INVALID_STATE', `Manager is ${m.status}, expected APPROVED before posting the bond`);
    m.bondPaid = true;
    if (!m.loginCode) m.loginCode = `FM-${randomBytes(3).toString('hex').toUpperCase()}`; // console sign-in code
    this.transition(m, 'ACTIVE');
    void this.events.publish(GlosEvent.Pudo.FleetManagerActivated, { did, managerId: m.managerId, companyName: m.companyName }, { source: 'pudo' }).catch(() => undefined);
    return m;
  }

  /** Fleet-console sign-in: resolve an ACTIVE manager from their login code (or DID). */
  login(credential: string): FleetManager {
    const c = (credential || '').trim();
    // The CODE only. It used to accept the manager's DID as well, and a DID is an identifier rather than
    // a secret: it is returned by the fleet dashboard, stamped on vehicles and drivers, and printed by
    // the seeder. Anything published by design cannot also be the thing that proves who you are.
    const m = [...this.managers.values()].find((x) => x.loginCode === c.toUpperCase());
    if (!m) throw new GlosError('AUTH_CODE_INVALID', 'Unknown sign-in code');
    if (m.status !== 'ACTIVE') throw new GlosError('AUTH_NOT_ACTIVE', `Fleet manager is ${m.status} — not yet active`);
    return m;
  }

  /**
   * Which fleet a code belongs to — a NAME, not a session.
   *
   * Deliberately returns nothing that could be used against the company: the console shows "Kilima
   * Logistics" so the person can see they are signing into the right fleet before they type a PIN, and
   * a wrong code is caught here rather than blamed on their PIN two fields later.
   */
  lookup(code: string): FleetManager {
    return this.login(code);
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
    if (m.status !== 'ACTIVE') throw new GlosError('INVALID_STATE', `Fleet manager is ${m.status} — must be ACTIVE to register vehicles or drivers`);
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

  /**
   * The list as anyone who is NOT this fleet may see it.
   *
   * The raw list carried `loginCode` — which IS the credential for the fleet console — alongside the
   * company's tax id, transport-operator licence, business registration and depot address. The route had
   * no role on it, so every authenticated actor in the network could read them: a shopkeeper's token, a
   * driver's, a vendor's. That is not a leak of company data, it is a sign-in for every fleet we host.
   *
   * The same raw-object lesson the vehicle read already learned: build the outside view by DELETING from
   * a copy, so a field added later is exposed only if somebody decides it should be.
   */
  listScoped(tenant: string | undefined, isOperator: boolean): Array<FleetManager | Partial<FleetManager>> {
    return this.list().map((m) => this.viewFor(m, tenant, isOperator));
  }

  /**
   * One fleet as THIS caller may see it — the whole record for the fleet itself and for network staff, the outside
   * view for everybody else. The single-fleet read used to return the raw record to any signed-in account that
   * knew the DID, which is the same hole the list had, one route over.
   */
  viewFor(m: FleetManager, tenant: string | undefined, isOperator: boolean): FleetManager | Partial<FleetManager> {
    if (isOperator || (tenant && m.did === tenant)) return m;
    const view: Partial<FleetManager> = { ...m };
    delete view.loginCode; // the console credential — never anybody else's business
    delete view.vaultRef; // the pointer into the identity vault
    delete view.contactPhone;
    delete view.requirements; // registration number, transport licence, tax id
    delete view.depotAddress;
    delete view.kyc;
    return view;
  }

  /**
   * The fleet a person CHOSE after proving themselves with phone + PIN — so a forgotten code locks nobody out.
   * A DID is not a secret and is not treated as one: it only names the fleet, exactly as the code does now, and the
   * session is still granted only to a person holding the manager role for it.
   */
  requireSignInByDid(did?: string): FleetManager {
    if (!did?.trim()) throw new GlosError('FIELD_REQUIRED', 'Give the fleet code, or choose the fleet');
    const m = this.managers.get(did.trim());
    if (!m) throw new GlosError('AUTH_CODE_INVALID', 'Unknown fleet');
    if (m.status !== 'ACTIVE') throw new GlosError('AUTH_NOT_ACTIVE', `Fleet manager is ${m.status} — not yet active`);
    return m;
  }

  /** Issue the fleet a new code. The old one stops naming the fleet at once; sessions are the person's and stay. */
  rotateCode(did: string): FleetManager {
    const m = this.requireActive(did);
    let code: string;
    do code = `FM-${randomBytes(3).toString('hex').toUpperCase()}`;
    while ([...this.managers.values()].some((x) => x.loginCode === code));
    m.loginCode = code;
    m.codeRotatedAt = new Date().toISOString();
    this.managers.set(m.did, m);
    return m;
  }

  // --- internals ---

  private transition(m: FleetManager, status: FleetManagerStatus): FleetManager {
    m.status = status;
    return m;
  }

  private require(did: string): FleetManager {
    const m = this.managers.get(did);
    if (!m) throw new GlosError('NOT_FOUND', `Fleet manager not found: ${did}`);
    return m;
  }
}
