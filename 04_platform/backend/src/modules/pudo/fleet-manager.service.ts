import { Inject, Injectable, Optional } from '@nestjs/common';
import { RestingAccounts } from '../../foundation/auth/resting-accounts';
import { GlosError } from '../../foundation/http/glos-error';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { createHash, randomBytes } from 'crypto';
import { DidService } from '../../foundation/did/did.service';
import { IdentityVault } from '../../foundation/data-firewall/identity-vault.service';
import { OperationalStore } from '../../foundation/data-firewall/operational-store.service';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { Geocoder, GEOCODER } from './geocoder';
import { CarrierPapers, FleetClockView, FleetManager, FleetManagerKyc, FleetManagerRequirements, FleetManagerStatus, FleetSetupRow } from './fleet.types';
import { sameSigner, type Signer } from '../../foundation/entity/same-person';
import { clockAt, clocksOfCountry, isTimeZone, utcDay, zoneName } from './fleet-clock';
import { CARRIER_PAPER_KINDS, fleetPapers, lapsedOf, offRoadLine, paperLabel, paperLapsesAt, type CarrierPaperKind, type PaperStatus } from './papers';
import { MediaService } from './media.service';
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
  /**
   * WHOSE ACCOUNT put a fleet's papers on record — kept BESIDE the fleet, never on it: the record is the fleet's own
   * to read, and it has no business holding a member of staff's account. Asked when somebody approves.
   */
  private readonly enteredKeys = new PersistentMap<string, string>('pudo-fleet-kyc-entered-keys'); // fleet DID → account

  constructor(
    private readonly dids: DidService,
    private readonly vault: IdentityVault,
    private readonly core: OperationalStore,
    private readonly events: EventBus,
    private readonly entities: EntityService,
    private readonly presence: PresenceService,
    @Inject(GEOCODER) private readonly geocoder: Geocoder,
    // Optional so the specs that build this by hand keep working, exactly as DriverService does it; the
    // boot spec is what catches it missing from the real module.
    @Optional() private readonly media?: MediaService,
    // Optional for the same reason: without it no fleet is ever at rest.
    @Optional() private readonly rest?: RestingAccounts,
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
  submitKyc(
    did: string,
    documents: { businessRegCertRef: string; operatorLicenceRef: string; ownerIdRef: string; proofOfAddressRef: string },
    /** The member of staff putting them on record, where it is staff: asked again when somebody approves. */
    by?: Signer,
  ): FleetManager {
    const m = this.require(did);
    if (m.status !== 'DRAFT') throw new GlosError('INVALID_STATE', `Manager is ${m.status}, expected DRAFT`);
    if (!documents.businessRegCertRef || !documents.operatorLicenceRef || !documents.ownerIdRef || !documents.proofOfAddressRef) {
      throw new GlosError('KYC_INCOMPLETE', 'KYC requires a business registration certificate, operator licence, owner ID, and proof of address');
    }
    const { businessRegCertRef, operatorLicenceRef, ownerIdRef, proofOfAddressRef } = documents;
    m.kyc = { businessRegCertRef, operatorLicenceRef, ownerIdRef, proofOfAddressRef, submittedAt: new Date().toISOString(), ...(by?.name ? { enteredBy: by.name } : {}) };
    if (by?.key) this.enteredKeys.set(did, by.key);
    else this.enteredKeys.delete(did);
    m.kycRejection = undefined;
    return this.transition(m, 'KYC_PENDING');
  }

  /** Did this reader put the fleet's papers on record? Then they are not the one to approve them. */
  papersEnteredBy(m: Pick<FleetManager, 'did' | 'kyc'>, reader: Signer): boolean {
    if (!m.kyc?.enteredBy) return false;
    return sameSigner(reader, { name: m.kyc.enteredBy, key: this.enteredKeys.get(m.did) });
  }

  /**
   * Vetting decision: approve → APPROVED (post the bond next); refuse → DRAFT, with the reason kept for whoever puts
   * the papers on record again.
   *
   * TWO PEOPLE. A fleet's papers are put on record by a member of staff (the fleet cannot sign in until it is
   * active), so the one check on them is that somebody ELSE looks before the fleet is approved. Refusing is not held
   * to that: taking one's own entry back is not approving it.
   */
  decideKyc(did: string, approve: boolean, by?: string, reason?: string, signer?: Signer): FleetManager {
    const m = this.require(did);
    if (m.status !== 'KYC_PENDING') throw new GlosError('INVALID_STATE', `Manager is ${m.status}, expected KYC_PENDING`);
    if (!approve) {
      const why = reason?.trim();
      if (why) m.kycRejection = { reason: why, at: new Date().toISOString(), ...(by ? { by } : {}) };
      m.kyc = undefined;
      this.enteredKeys.delete(did);
      return this.transition(m, 'DRAFT');
    }
    if (!m.kyc) throw new GlosError('KYC_INCOMPLETE', 'Cannot approve: KYC documents missing');
    if (signer && this.papersEnteredBy(m, signer)) throw new GlosError('FORBIDDEN', 'You put these papers on record — a different person must approve them');
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

  /**
   * Record the operator's own papers. Staff only — these are dates read off a document, not self-declared.
   *
   * Recorded whatever the sister enforces, because a date nobody asked for is a date nobody can act on
   * the day somebody decides to. Passing null clears one; leaving a field out leaves it alone.
   */
  recordPapers(
    did: string,
    input: { licenceExpiresAt?: string | null; licenceNumber?: string | null; insurancePolicy?: string | null; insuranceExpiresAt?: string | null },
    by?: string,
    now = Date.now(),
  ): FleetManager {
    const m = this.require(did);
    const who = by?.trim();
    if (!who) throw new GlosError('FIELD_REQUIRED', 'Say who is recording these dates');
    const next: CarrierPapers = { ...(m.papers ?? {}), sent: { ...(m.papers?.sent ?? {}) }, refused: { ...(m.papers?.refused ?? {}) } };
    const set = (key: 'licenceExpiresAt' | 'insurancePolicy' | 'insuranceExpiresAt', value: string | null | undefined, isDate: boolean) => {
      if (value === undefined) return;
      if (value === null || !value.trim()) return void delete next[key];
      const v = value.trim();
      if (isDate && (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v)))) {
        throw new GlosError('VALIDATION_FAILED', 'An expiry must be a date written YYYY-MM-DD');
      }
      next[key] = isDate ? v : v.slice(0, 120);
    };
    set('licenceExpiresAt', input.licenceExpiresAt, true);
    set('insuranceExpiresAt', input.insuranceExpiresAt, true);
    set('insurancePolicy', input.insurancePolicy, false);

    // A renewed licence can carry a new number. Checked BEFORE anything is written, so a refused number
    // is not also a half-recorded date — the same one-licence-one-operator rule registration keeps.
    const number = input.licenceNumber?.trim();
    const numberChanges = Boolean(number && number !== m.requirements.transportOperatorLicence);
    if (numberChanges && this.fingerprints.has(fp(number!))) {
      throw new GlosError('DUPLICATE', 'A fleet manager with this operator licence already exists');
    }

    /*
     * WHAT EACH DATE WAS READ FROM, for the papers whose date this call recorded.
     *
     * A document the fleet sent is the image this date came off, so it becomes that paper's own copy and
     * leaves the waiting list. A date recorded with nothing sent was read off a document in somebody's hand,
     * and says so by having no copy — never by leaving the OLD document beside a NEW date. Either way the
     * previous copy starts its clock rather than sitting in a drawer for the life of the fleet.
     *
     * CLEARING a date is a correction, not a reading, so a document still waiting stays waiting.
     */
    const retire: string[] = [];
    // Papers whose sent document this recorded — the fleet was waiting on these answers, and is told.
    const answered: Array<{ kind: CarrierPaperKind; expiresAt: string }> = [];
    const settle = (kind: CarrierPaperKind, date: string | null | undefined, copyKey: 'licenceCopyRef' | 'insuranceCopyRef') => {
      if (date === undefined) return;
      const previous = next[copyKey];
      const recorded = Boolean(date?.trim());
      const pending = next.sent?.[kind];
      if (recorded && pending) {
        next[copyKey] = pending.copyRef;
        answered.push({ kind, expiresAt: date!.trim() });
      } else delete next[copyKey];
      if (previous && previous !== next[copyKey]) retire.push(previous);
      if (recorded) {
        delete next.sent![kind];
        delete next.refused![kind];
      }
    };
    settle('operator_licence', input.licenceExpiresAt, 'licenceCopyRef');
    settle('carrier_insurance', input.insuranceExpiresAt, 'insuranceCopyRef');

    if (numberChanges) {
      this.fingerprints.delete(fp(m.requirements.transportOperatorLicence));
      this.fingerprints.add(fp(number!));
      m.requirements = { ...m.requirements, transportOperatorLicence: number! };
    }
    m.papers = {
      ...next,
      sent: Object.keys(next.sent!).length ? next.sent : undefined,
      refused: Object.keys(next.refused!).length ? next.refused : undefined,
      recordedBy: who,
      recordedAt: new Date(now).toISOString(),
    };
    this.managers.set(m.did, m);
    for (const ref of retire) this.media?.retireAccountDoc(ref, new Date(now));
    for (const a of answered) {
      void this.events.publish(GlosEvent.Pudo.FleetPaperChecked, { did: m.did, kind: a.kind, accepted: true, expiresAt: a.expiresAt }, { source: 'pudo' }).catch(() => undefined);
    }
    return m;
  }

  /**
   * THE FLEET SENDS ITS RENEWED DOCUMENT: an image of it, and the expiry it read off it.
   *
   * Until this existed the fleet app told the office to "send the renewed document to SeeBuyGet" with no
   * way to do it, and staff were asked to record a date they had no way to see. The date sent here
   * switches nothing on; it waits beside the image until somebody here reads the same document and types
   * it (recordPapers). One waiting document per paper — a second send replaces the first, which was never
   * accepted, so nothing rests on it.
   *
   * `ownerDid` is who UPLOADED the image. adopt() refuses anybody else's media and anything already
   * attached elsewhere, so this cannot relabel another account's picture as a licence.
   */
  sendPaper(
    did: string,
    input: { kind: string; copyRef: string; expiresAt: string; reference?: string },
    sender: { ownerDid: string; by?: string },
    now = Date.now(),
  ): FleetManager {
    const m = this.require(did);
    if (!CARRIER_PAPER_KINDS.includes(input.kind as CarrierPaperKind)) throw new GlosError('VALIDATION_FAILED', `Unknown paper: ${input.kind}`);
    const kind = input.kind as CarrierPaperKind;
    const expiresAt = input.expiresAt?.trim();
    if (!expiresAt || !/^\d{4}-\d{2}-\d{2}$/.test(expiresAt) || Number.isNaN(Date.parse(expiresAt))) {
      throw new GlosError('VALIDATION_FAILED', 'An expiry must be a date written YYYY-MM-DD');
    }
    // A renewal already in the past is a misreading — sent, it would ask staff to record a lapse.
    if (paperLapsesAt(expiresAt) <= now) {
      throw new GlosError('VALIDATION_FAILED', `That date has already passed — a renewed ${paperLabel(kind).toLowerCase()} runs into the future`);
    }
    if (!this.media) throw new GlosError('INVALID_STATE', 'Documents cannot be kept in this deployment, so a paper cannot be sent');
    if (!this.media.adopt(input.copyRef, sender.ownerDid, { type: 'fleet', id: did }, kind === 'operator_licence' ? 'kyc_licence' : 'kyc_insurance')) {
      throw new GlosError('PHOTO_REQUIRED', 'That image could not be attached — take the photograph again');
    }

    const papers: CarrierPapers = { ...(m.papers ?? {}) };
    const earlier = papers.sent?.[kind];
    if (earlier && earlier.copyRef !== input.copyRef) this.media.purgeByOwner(earlier.copyRef, earlier.ownerDid);
    const reference = input.reference?.trim().slice(0, 120);
    papers.sent = {
      ...(papers.sent ?? {}),
      [kind]: { copyRef: input.copyRef, ownerDid: sender.ownerDid, expiresAt, ...(reference ? { reference } : {}), sentAt: new Date(now).toISOString(), ...(sender.by ? { sentBy: sender.by } : {}) },
    };
    // Sending again answers the last refusal; leaving it up would tell them to fix what they just fixed.
    if (papers.refused?.[kind]) {
      const refused = { ...papers.refused };
      delete refused[kind];
      papers.refused = Object.keys(refused).length ? refused : undefined;
    }
    m.papers = papers;
    this.managers.set(m.did, m);
    return m;
  }

  /**
   * The document they sent is not accepted — unreadable, the wrong paper, a date that is not on it.
   *
   * A REFUSAL CARRIES A REASON, because the fleet is shown it and one it cannot act on leaves it where
   * silence did. The image is deleted now rather than kept on a clock: nothing was recorded from it, so it
   * is a picture of somebody's licence that proves nothing.
   */
  refusePaper(did: string, kindInput: string, reason: string, by?: string, now = Date.now()): FleetManager {
    const m = this.require(did);
    if (!CARRIER_PAPER_KINDS.includes(kindInput as CarrierPaperKind)) throw new GlosError('VALIDATION_FAILED', `Unknown paper: ${kindInput}`);
    const kind = kindInput as CarrierPaperKind;
    const pending = m.papers?.sent?.[kind];
    if (!pending) throw new GlosError('INVALID_STATE', 'Nothing has been sent to refuse');
    const why = reason?.trim();
    if (!why) throw new GlosError('REASON_REQUIRED', 'A refusal must say why: the fleet is shown it');

    const sent = { ...(m.papers!.sent ?? {}) };
    delete sent[kind];
    m.papers = {
      ...m.papers,
      sent: Object.keys(sent).length ? sent : undefined,
      refused: { ...(m.papers!.refused ?? {}), [kind]: { reason: why.slice(0, 500), at: new Date(now).toISOString(), ...(by ? { by } : {}) } },
    };
    this.managers.set(m.did, m);
    this.media?.purgeByOwner(pending.copyRef, pending.ownerDid);
    void this.events.publish(GlosEvent.Pudo.FleetPaperChecked, { did: m.did, kind, accepted: false, reason: why.slice(0, 500) }, { source: 'pudo' }).catch(() => undefined);
    return m;
  }

  /** The operator's own papers as of now — always derived, never stored (see papers.ts). */
  papersOf(did: string, now = Date.now()): PaperStatus[] {
    return fleetPapers(this.require(did), now);
  }

  /**
   * Which of this fleet's own papers the sister behind it will not trade without. Usually none.
   *
   * A fleet standing where no sister does enforces nothing, and that is the honest answer rather than a
   * gap: in a country the network only matches, the fleet IS the local operator and nobody here is
   * carrying the regulatory exposure that would entitle us to make the call.
   */
  enforcedFor(m: FleetManager): string[] {
    const entityId = this.entityIdOrNone(m);
    return entityId ? this.entities.carrierPapersFor(entityId).enforce : [];
  }

  /**
   * WHY THIS FLEET MAY NOT TAKE ON NEW WORK, in words a person can act on. Empty when it may.
   *
   * One gate, two reasons — being suspended, and a lapsed paper the sister behind it enforces — because
   * they are the same question asked of the same fleet at the same moment, and two gates would have been
   * two places to forget.
   *
   * It answers about NEW commitments only. A fleet that is suspended or out of licence halfway through a
   * run must still deliver, sign the note and be settled: stopping that would strand somebody's cargo and
   * lose the delivery signature, which punishes the shipper for the carrier's paperwork.
   */
  tradingBlocks(did: string, now = Date.now()): string[] {
    const m = this.managers.get(did);
    if (!m) return ['We do not know this fleet'];
    if (m.status !== 'ACTIVE') return [`${m.companyName} is ${m.status.toLowerCase().replace('_', ' ')} on the network`];
    // Its owner muted the account: no new commitment, and what it is already carrying is finished (above).
    if (this.rest?.isResting(did)) return [`${m.companyName} has paused its account`];

    const enforced = new Set(this.enforcedFor(m));
    if (!enforced.size) return [];
    return lapsedOf(fleetPapers(m, now))
      .filter((p) => enforced.has(p.kind))
      .map(offRoadLine);
  }

  /** The same question, refused by name. Thrown wherever a NEW commitment to this carrier would begin. */
  assertMayTakeWork(did: string, now = Date.now()): void {
    const blocks = this.tradingBlocks(did, now);
    if (blocks.length) throw new GlosError('CARRIER_NOT_TRADING', `This carrier is not taking new work: ${blocks.join('; ')}`);
  }

  /**
   * THE OWNER CLOSED THEIR ACCOUNT (2026-10-22): their name, national ID and phone leave the vault, the contact phone
   * and email go, the owner's ID and proof-of-address photographs go, and the fleet is suspended. The company's own
   * papers (registration, operator licence) stay with the loads it carried: they are the company's, not a person's.
   */
  forgetOwner(did: string): void {
    const m = this.managers.get(did);
    if (!m) return;
    if (m.vaultRef && this.vault.exists(m.vaultRef)) this.vault.forget(m.vaultRef, { purpose: 'account-closed', requesterDid: did });
    for (const ref of [m.kyc?.ownerIdRef, m.kyc?.proofOfAddressRef]) this.media?.purgeByOwner(ref, did);
    m.contactPhone = '';
    delete m.contactEmail;
    m.status = 'SUSPENDED';
    this.managers.set(did, m);
    this.dids.forgetController(did);
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
   * EVERY FLEET, AS THE STAFF WHO SET FLEETS UP READ THEM: where each stands, what is next, and whether this reader is
   * the one who put its papers on record (and so not the one to approve them). A fleet does not sign itself up — it
   * is set up by staff and its office then signs in with the code it is given — so this is where one comes to be.
   */
  settingUp(reader: Signer): FleetSetupRow[] {
    return this.list()
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .map((m) => ({
        did: m.did,
        companyName: m.companyName,
        ...(m.tradingName ? { tradingName: m.tradingName } : {}),
        status: m.status,
        ...(m.jurisdiction ? { jurisdiction: m.jurisdiction } : {}),
        contactPhone: m.contactPhone,
        ...(m.depotAddress ? { depotAddress: m.depotAddress } : {}),
        requirements: m.requirements,
        createdAt: m.createdAt,
        ...(m.kyc ? { papers: { ...m.kyc, enteredByMe: this.papersEnteredBy(m, reader) } } : {}),
        ...(m.kycRejection ? { refused: m.kycRejection } : {}),
        // The code is the office's way in once the fleet is active, and staff are who pass it on.
        ...(m.status === 'ACTIVE' && m.loginCode ? { loginCode: m.loginCode } : {}),
      }));
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

  /* ---------------------------------------------------------------- the fleet's own clock -- */

  /**
   * THE TIME ZONE A FLEET KEEPS. What its office said, where it said; otherwise its country's, where the country
   * keeps exactly one clock. A country with several is not guessed at: the fleet has no clock until its office
   * chooses. Never throws — it is asked about fleets from places that only hold a DID.
   */
  zoneOf(did: string | undefined, now: number = Date.now()): string | undefined {
    const m = did ? this.managers.get(did) : undefined;
    if (!m) return undefined;
    if (m.timeZone && isTimeZone(m.timeZone)) return m.timeZone;
    const kept = clocksOfCountry(m.jurisdiction ?? NETWORK_JURISDICTION, now);
    return kept.length === 1 ? kept[0] : undefined;
  }

  /** The day it is for this fleet: on its own clock, or in UTC where it has none. */
  todayOf(did: string | undefined, now: number = Date.now()): string {
    const zone = this.zoneOf(did, now);
    return zone ? clockAt(now, zone).day : utcDay(now);
  }

  /** The clock as the office is shown it: which zone, where it comes from, what time it is there, what it may choose. */
  clockOf(did: string, now: number = Date.now()): FleetClockView {
    const m = this.require(did);
    const choices = clocksOfCountry(m.jurisdiction ?? NETWORK_JURISDICTION, now).map((timeZone) => ({ timeZone, name: zoneName(timeZone, now), now: clockAt(now, timeZone).clock }));
    const zone = this.zoneOf(did, now);
    if (!zone) return { source: 'none', choices };
    const t = clockAt(now, zone);
    return { timeZone: zone, name: zoneName(zone, now), now: t.clock, today: t.day, source: m.timeZone === zone ? 'office' : 'country', choices };
  }

  /**
   * The office says which clock it keeps. Any place's own zone: a fleet near a border may well keep its neighbour's.
   * Changing it changes what "today" is from the next request on, and nothing already recorded: a delivery's time
   * was written down on the clock the fleet kept that day.
   */
  setTimeZone(did: string, zone: string): FleetManager {
    const m = this.require(did);
    const z = (zone ?? '').trim();
    if (!isTimeZone(z)) throw new GlosError('INVALID_INPUT', 'That is not a time zone — choose a place’s own, such as Africa/Nairobi', { field: 'timeZone' });
    m.timeZone = z;
    this.managers.set(did, m);
    return m;
  }

  private require(did: string): FleetManager {
    const m = this.managers.get(did);
    if (!m) throw new GlosError('NOT_FOUND', `Fleet manager not found: ${did}`);
    return m;
  }
}
