import { driverPapers, lapsedOf, offRoadLine, paperLapsesAt } from './papers';
import { Injectable, Optional } from '@nestjs/common';
import { MediaService } from './media.service';
import { GlosError } from '../../foundation/http/glos-error';
import { MAX_NUDGE_MIN_EARN } from './pudo.config';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { randomBytes } from 'crypto';
import { RegistrationPrints, type IdentityFields, type PrintField } from '../../foundation/identity/registration-prints';
import { DidService } from '../../foundation/did/did.service';
import { IdentityVault } from '../../foundation/data-firewall/identity-vault.service';
import { OperationalStore } from '../../foundation/data-firewall/operational-store.service';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { VEHICLE_SPEC, VehicleClass } from './fleet.config';
import { DriverKyc, DriverRegistry, FleetDriver, FleetRemoval } from './fleet.types';
import { FleetManagerService } from './fleet-manager.service';
import { EntityService } from '../../foundation/entity/entity.service';
import { PresenceService } from '../../foundation/presence/presence.service';
import { NETWORK_CURRENCY, NETWORK_JURISDICTION } from './pudo.config';

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

/**
 * What a driver is told when their details are already held — the same sentences as before, now with the
 * field they name carried beside them, so an app can say what to do next rather than parse English.
 */
const DRIVER_HELD: Record<Exclude<PrintField, 'device'>, string> = {
  nationalId: 'A driver with this national ID already exists',
  phone: 'A driver with this mobile already exists',
  licence: 'A driver with this licence number already exists',
};
const driverHeld = (field: PrintField): GlosError =>
  new GlosError('DUPLICATE', DRIVER_HELD[field as Exclude<PrintField, 'device'>], { field, register: 'driver' });

/**
 * BETWEEN FLEETS: a fleet took them off and nobody has taken them on. No `managerDid` used to mean "an independent
 * courier" everywhere, and a driver a fleet let go would have read as one — paid as one, with a public page — while
 * the network never contracted them as anything. Ask this wherever "no fleet" is about to mean "their own boss".
 */
export function betweenFleets(driver: Pick<FleetDriver, 'managerDid' | 'removedFrom'>): boolean {
  return !driver.managerDid && Boolean(driver.removedFrom);
}

/** Why a driver whose ID went to somebody else cannot start a shift — and the one thing that ends it. */
export const idHoldLine = (reference: string): string =>
  `the national ID on your registration went to somebody else (reference ${reference}) — put the number of your own ID card on record, in Settings, and you can drive again`;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function dayOf(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

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
  // One national ID, one mobile, one licence number across the network — kept on disk, keyed, normalised.
  private readonly prints = new RegistrationPrints('driver');

  constructor(
    private readonly dids: DidService,
    private readonly vault: IdentityVault,
    private readonly core: OperationalStore,
    private readonly events: EventBus,
    private readonly managers: FleetManagerService,
    private readonly entities: EntityService,
    private readonly presence: PresenceService,
    // Optional so the specs that build this by hand keep working; app.boot.spec catches it missing from
    // the module. Without it a courier cannot send a photograph, and is told so rather than silently not.
    @Optional() private readonly media?: MediaService,
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
    if (driver.entityId) return driver.entityId;
    const country = driver.jurisdiction ?? NETWORK_JURISDICTION;
    const sister = this.entities.forJurisdiction(country);
    if (sister) return sister.entityId;
    this.presence.require(country, 'payouts'); // refuses by name where we only match
    return this.entities.requireForJurisdiction(country).entityId;
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

  /**
   * What loading a bag pays this driver, and in what money: the list of the company that settles them (their fleet's,
   * or their own country's for a courier). One answer for the offer that promises it and the scan that pays it.
   */
  payTermsOf(did: string): { bagLoadPay: number; currency: string } {
    const list = this.entities.amountsFor(this.payeeOrNone(did).entityId);
    return { bagLoadPay: list.toteLoadFee, currency: list.currency ?? NETWORK_CURRENCY };
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

  /**
   * CA6 — the country a vehicle is registered in, as far as the network knows: its fleet's, else the courier's own.
   * Undefined where neither is known, and a rule is then never applied on a guess.
   */
  homeCountryOf(driverDid: string, vehicleManagerDid?: string): string | undefined {
    const managerDid = vehicleManagerDid ?? this.drivers.get(driverDid)?.managerDid;
    if (managerDid) {
      try {
        return this.managers.get(managerDid).jurisdiction ?? NETWORK_JURISDICTION;
      } catch {
        return undefined;
      }
    }
    return this.drivers.get(driverDid)?.jurisdiction;
  }

  /** Whether the network contracts this driver directly (an independent courier) or through a fleet — and a driver between fleets is neither. */
  isIndependent(driver: FleetDriver): boolean {
    return !driver.managerDid && !betweenFleets(driver);
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
    // An INDEPENDENT courier is contracted where they legally reside — bicycle or truck, it makes no difference.
    // A fleet-attached driver gets neither field: their fleet is the supplier, and the network has no business
    // knowing where its suppliers' staff live. Asked before anything is fingerprinted, so a refusal costs nothing.
    const independent = !input.managerDid;
    const jurisdiction = independent ? (input.jurisdiction || NETWORK_JURISDICTION).toUpperCase() : undefined;
    if (jurisdiction && !this.presence.can(jurisdiction, 'takeIn')) throw new GlosError('FORBIDDEN', `The network does not operate in ${jurisdiction} yet, so a courier cannot register there`);

    // Heavy registry requires a real licence (number + expiry, not already expired).
    if (registry === 'heavy') {
      if (!input.licenceNumber?.trim()) throw new GlosError('LICENCE_REQUIRED', 'A driving licence number is required for this vehicle class');
      if (!input.licenceExpiresAt) throw new GlosError('LICENCE_REQUIRED', 'A licence expiry date is required for this vehicle class');
      if (this.isExpired(input.licenceExpiresAt)) throw new GlosError('LICENCE_EXPIRED', 'The driving licence has expired');
    }

    /*
     * THE THREE FIELDS THE REST OF THIS METHOD ASSUMES IT HAS.
     *
     * `SignupDto.profile` is an unvalidated `Record<string, unknown>` — class-validator checks that it is
     * an object and nothing inside it — so a join form that forgets a field reaches here with it missing.
     * Until then the first thing to touch it was the fingerprint helper, which called `.trim()` on undefined and answered
     * the person with a 500 and the word "Something went wrong". A missing name is not an internal error;
     * it is a question nobody was asked, and the answer has to name the field.
     */
    if (!input.fullName?.trim()) throw new GlosError('FIELD_REQUIRED', 'A driver needs their full name');
    if (!input.nationalId?.trim()) throw new GlosError('FIELD_REQUIRED', 'A national ID number is required to register a driver');
    if (!input.mobile?.trim()) throw new GlosError('FIELD_REQUIRED', 'A mobile number is required — it is how this driver signs in');

    // Dedup — one national ID, one mobile, one licence number across the network.
    const identity: IdentityFields = [
      ['nationalId', input.nationalId],
      ['phone', input.mobile],
      ...(input.licenceNumber ? ([['licence', input.licenceNumber]] as const) : []),
    ];
    const held = this.prints.taken(identity);
    if (held) throw driverHeld(held);

    const did = this.dids.generate(`pudo-driver:${input.mobile}`, { role: 'pudo-driver' }).id;
    const { vaultRef } = this.vault.store({ fullName: input.fullName, governmentId: input.nationalId, phone: input.mobile }, { region: 'local' });
    this.core.upsert({ did, vaultRef, tier: 2, status: 'pending', capabilities: ['pudo-driver'], metadata: { registry, homeZone: input.homeZone } });
    this.prints.claim(identity, did);

    // Where we only match there is no sister: the courier stands without one, and is paid by whoever they carry for.
    const entity = jurisdiction ? this.entities.forJurisdiction(jurisdiction) : undefined;

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

  /**
   * Operator vetting (heavy): approve → ACTIVE (+ badge); reject → DRAFT. Re-checks licence + record.
   *
   * A REFUSAL CARRIES A REASON, exactly as a shop's does and for the same reason: the driver is shown it,
   * and a refusal they cannot act on leaves them where saying nothing did. Their papers are cleared so a
   * replacement pair can be sent — `submitKyc` only accepts a full set, and only from DRAFT.
   */
  decideKyc(did: string, approve: boolean, by?: string, reason?: string, criminalRecordClear?: boolean): FleetDriver {
    const driver = this.require(did);
    // The record check, recorded by the staff member doing the vetting. One-way on purpose: this clears a
    // driver, it never un-clears one, and taking somebody off the road is `suspend` with its own trail.
    if (criminalRecordClear) driver.criminalRecordClear = true;
    if (driver.status !== 'KYC_PENDING') throw new GlosError('INVALID_STATE', `Driver is ${driver.status}, expected KYC_PENDING`);
    if (!approve) {
      const why = reason?.trim();
      if (!why) throw new GlosError('REASON_REQUIRED', 'A rejection must say why: the driver is shown it');
      driver.kycRejection = { reason: why, at: new Date().toISOString(), ...(by ? { by } : {}) };
      driver.kyc = undefined;
      driver.status = 'DRAFT';
      void this.events
        .publish(GlosEvent.Pudo.DriverKycRejected, { did, driverId: driver.driverId, displayName: driver.displayName, reason: why }, { source: 'pudo' })
        .catch(() => undefined);
      return driver;
    }
    driver.kycRejection = undefined;
    if (!driver.kyc) throw new GlosError('KYC_INCOMPLETE', 'Cannot approve: KYC documents missing');
    if (!driver.criminalRecordClear) throw new GlosError('APPROVAL_BLOCKED', 'Cannot approve: criminal-record check not cleared');
    if (this.isExpired(driver.licence.expiresAt)) throw new GlosError('APPROVAL_BLOCKED', 'Cannot approve: the driving licence has expired');
    this.core.upsert({ did, vaultRef: driver.vaultRef, tier: 2, status: 'active', capabilities: ['pudo-driver'], metadata: { by } });
    this.activate(driver, by ?? 'vetting');
    return driver;
  }

  /**
   * FP4 — record a renewed licence. The date must lie ahead: a "renewal" already in the past is a typo, and
   * recording it would take the driver off the road the moment it was saved. A changed number keeps the
   * one-licence-one-driver rule: the old print is released, the new one claimed.
   */
  renewLicence(did: string, input: { number?: string; expiresAt: string }, now: number = Date.now(), by?: string): FleetDriver {
    const driver = this.require(did);
    if (paperLapsesAt(input.expiresAt) <= now) throw new GlosError('LICENCE_EXPIRED', 'The expiry date given has already passed — a renewed licence runs into the future');
    const number = input.number?.trim();
    if (number && number !== driver.licence.number) {
      if (this.prints.taken([['licence', number]], did)) throw driverHeld('licence');
      if (driver.licence.number && driver.licence.number !== 'n/a') this.prints.release('licence', driver.licence.number, did);
      this.prints.claim([['licence', number]], did);
      driver.licence.number = number;
    }
    /*
     * WHAT THE DATE WAS READ FROM. A renewal the courier sent is the photograph this date came off, so it
     * becomes the licence's own copy. A date recorded with nothing sent was read off a card in somebody's
     * hand, and says so by having no copy — never by leaving the OLD card's photograph beside a NEW date.
     * Either way the previous card starts its clock (MediaService.retireAccountDoc).
     */
    const pending = driver.licenceRenewal;
    const previous = driver.licence.copyRef;
    driver.licence.copyRef = pending?.copyRef;
    if (previous && previous !== pending?.copyRef) this.media?.retireAccountDoc(previous, new Date(now));
    driver.licence.expiresAt = input.expiresAt;
    driver.licence.recordedAt = new Date(now).toISOString();
    driver.licence.recordedBy = by;
    driver.licenceRenewal = undefined;
    driver.licenceRenewalRefusal = undefined;
    this.drivers.set(did, driver);
    // The courier who sent a card is waiting on an answer; one whose fleet office typed the date is not.
    if (pending) {
      void this.events
        .publish(GlosEvent.Pudo.DriverLicenceChecked, { did, accepted: true, expiresAt: input.expiresAt }, { source: 'pudo' })
        .catch(() => undefined);
    }
    return driver;
  }

  /**
   * A COURIER WITHOUT A FLEET SENDS THEIR RENEWED LICENCE: the photograph, and the date they read off it.
   *
   * Until this existed their app told them to "show the fleet office" — which they do not have — and the
   * console asked staff to record a renewal they had no way to see. The date sent here switches nothing
   * on; it waits beside the photograph until somebody here reads the same card and types it
   * (renewLicence). A fleet driver is turned away with the reason: their office records their licence,
   * and a second route to the same date would be two people who each think the other checked it.
   */
  sendLicenceRenewal(did: string, input: { copyRef: string; expiresAt: string; number?: string }, now: number = Date.now()): FleetDriver {
    const driver = this.require(did);
    if (driver.managerDid) throw new GlosError('FORBIDDEN', 'Your fleet office records your licence — show them the renewed card');
    if (driver.status === 'SUSPENDED') throw new GlosError('INVALID_STATE', 'A suspended courier cannot send papers');
    if (!input.expiresAt || paperLapsesAt(input.expiresAt) <= now) throw new GlosError('LICENCE_EXPIRED', 'That date has already passed — a renewed licence runs into the future');
    if (!this.media) throw new GlosError('INVALID_STATE', 'Photographs cannot be kept in this deployment, so a licence cannot be sent');
    // Only the courier's OWN fresh photograph: adopt() refuses another actor's media and anything already
    // attached elsewhere, so this cannot relabel somebody else's picture as a licence.
    if (!this.media.adopt(input.copyRef, did, { type: 'driver', id: did }, 'kyc_licence')) {
      throw new GlosError('PHOTO_REQUIRED', 'That photograph could not be attached — take it again');
    }
    // A second send replaces the first. The earlier photograph was never accepted, so nothing rests on it.
    const earlier = driver.licenceRenewal?.copyRef;
    if (earlier && earlier !== input.copyRef) this.media.purgeByOwner(earlier, did);
    const number = input.number?.trim();
    driver.licenceRenewal = { copyRef: input.copyRef, expiresAt: input.expiresAt, ...(number ? { number } : {}), sentAt: new Date(now).toISOString() };
    driver.licenceRenewalRefusal = undefined;
    this.drivers.set(did, driver);
    return driver;
  }

  /**
   * How to reach a courier the network contracts directly: legal name and phone, revealed from the vault
   * with a receipt naming who asked and why.
   *
   * The minimum for the purpose — no national ID, no date of birth: this answers "how do we tell them",
   * not "who are they". A fleet driver is refused, and it is the contract line again: the network
   * contracts their fleet, so their fleet's office is who we call.
   *
   * `held: false` is an answer, not an error. A courier registered while the vault still lived in memory
   * points at a record that is gone, and the screen must be able to say "we hold no way to reach them"
   * rather than fail to open.
   */
  contactFor(did: string, requesterDid: string): { held: boolean; fullName?: string; phone?: string } {
    const driver = this.require(did);
    if (driver.managerDid) throw new GlosError('FORBIDDEN', 'This driver is in a fleet — reach them through the fleet office');
    if (!driver.vaultRef || !this.vault.exists(driver.vaultRef)) return { held: false };
    const pii = this.vault.reveal(driver.vaultRef, { purpose: 'papers-renewal', requesterDid });
    return { held: true, ...(pii.fullName ? { fullName: pii.fullName } : {}), ...(pii.phone ? { phone: pii.phone } : {}) };
  }

  /**
   * The card they sent is not accepted — unreadable, not a driving licence, a date that is not on it.
   *
   * A REFUSAL CARRIES A REASON, as every refusal here does: the courier is shown it, and one they cannot
   * act on leaves them where silence did. The photograph is deleted now rather than kept on a clock:
   * nothing was recorded from it, so it is a picture of somebody's licence that proves nothing.
   */
  refuseLicenceRenewal(did: string, reason: string, by?: string, now: number = Date.now()): FleetDriver {
    const driver = this.require(did);
    const pending = driver.licenceRenewal;
    if (!pending) throw new GlosError('INVALID_STATE', 'Nothing has been sent to refuse');
    const why = reason?.trim();
    if (!why) throw new GlosError('REASON_REQUIRED', 'A refusal must say why: the courier is shown it');
    this.media?.purgeByOwner(pending.copyRef, did);
    driver.licenceRenewal = undefined;
    driver.licenceRenewalRefusal = { reason: why, at: new Date(now).toISOString(), ...(by ? { by } : {}) };
    this.drivers.set(did, driver);
    void this.events
      .publish(GlosEvent.Pudo.DriverLicenceChecked, { did, accepted: false, reason: why }, { source: 'pudo' })
      .catch(() => undefined);
    return driver;
  }

  suspend(did: string, reason?: string): FleetDriver {
    const driver = this.require(did);
    driver.status = 'SUSPENDED';
    void this.events.publish(GlosEvent.Pudo.DriverSuspended, { did, driverId: driver.driverId, reason }, { source: 'pudo' }).catch(() => undefined);
    return driver;
  }

  /**
   * A driver may operate only if ACTIVE, no recorded licence expiry has passed (FP4 — any registry: a date given
   * is a date kept), and they are not between fleets: a driver a fleet took off has nobody to drive for until
   * another fleet offers them a place. Every way behind a wheel asks this — the coupling, a run, a load.
   */
  canOperate(did: string, now: number = Date.now()): boolean {
    const driver = this.drivers.get(did);
    if (!driver || driver.status !== 'ACTIVE') return false;
    // The ID they registered with went to somebody else: nothing new until an ID of their own is on record.
    if (driver.idHold) return false;
    if (betweenFleets(driver)) return false;
    return lapsedOf(driverPapers(driver, now)).length === 0;
  }

  /** FP4 — why this driver cannot start a shift, in words. Empty when they can (status aside). */
  offRoadReasons(did: string, now: number = Date.now()): string[] {
    const driver = this.drivers.get(did);
    if (!driver) return [];
    const papers = [...(driver.idHold ? [idHoldLine(driver.idHold.reference)] : []), ...lapsedOf(driverPapers(driver, now)).map(offRoadLine)];
    if (!betweenFleets(driver)) return papers;
    const off = driver.removedFrom!;
    return [`you are not in a fleet — ${off.companyName} took you off on ${dayOf(off.at)}, and a fleet has to offer you a place first`, ...papers];
  }

  /** Whether the driver's licence clears them for a given vehicle class. */
  clearedFor(did: string, vehicleClass: VehicleClass): boolean {
    return this.require(did).licence.classes.includes(vehicleClass);
  }

  /**
   * MOVE TO ANOTHER FLEET — the driver record's half. FleetMoveService has already checked they are free to go.
   *
   * What goes with the driver is everything keyed to THEM: papers, trips, ratings, badge, sign-in. What stays
   * with the old fleet is everything recorded as the fleet's — every haul carries the carrier it was taken for.
   * A courier joining a fleet drops their residence and their sister: a fleet driver carries neither, because
   * the network contracts with the fleet and has no business knowing where a supplier's staff live.
   */
  setFleet(did: string, managerDid: string): FleetDriver {
    const driver = this.require(did);
    driver.managerDid = managerDid;
    delete driver.jurisdiction;
    delete driver.entityId;
    delete driver.removedFrom; // a fleet took them on: whoever took them off before is history, not a state
    this.drivers.set(did, driver);
    return driver;
  }

  /**
   * TAKEN OFF A FLEET — the driver record's half. FleetMoveService has already checked nothing is left in the
   * driver's hands. They keep everything that is theirs (papers, trips, ratings, badge, sign-in); what they lose
   * is somebody to drive for, so they are between fleets — not an independent courier, which the network never
   * contracted them as — until another fleet offers them a place.
   */
  leaveFleet(did: string, removal: FleetRemoval): FleetDriver {
    const driver = this.require(did);
    if (driver.managerDid !== removal.fleetDid) throw new GlosError('FORBIDDEN', 'That driver is not in your fleet');
    delete driver.managerDid;
    delete driver.jurisdiction;
    delete driver.entityId;
    driver.removedFrom = removal;
    this.drivers.set(did, driver);
    return driver;
  }


  /* --- the registered number moves with the person (AccountRecoveryService) --- */

  /** Refuse, before anything moves, a number another registration in this register already holds. */
  assertPhoneFree(did: string, newPhone: string): void {
    if (this.prints.taken([['phone', newPhone]], did)) throw driverHeld('phone');
  }

  /**
   * Hold the new number for this registration and put it in the vault. The OLD number stays held too — its key is
   * returned — so for the 24 hours a change can be undone nobody else can register with it.
   */
  moveMobile(did: string, newPhone: string): string {
    const driver = this.require(did);
    this.assertPhoneFree(did, newPhone);
    this.prints.claim([['phone', newPhone]], did);
    if (!driver.vaultRef || !this.vault.exists(driver.vaultRef)) return '';
    const pii = this.vault.reveal(driver.vaultRef, { purpose: 'number-change', requesterDid: did });
    this.vault.update(driver.vaultRef, { ...pii, phone: newPhone, previousPhone: pii.phone });
    return this.prints.keyOf('phone', pii.phone);
  }

  /** The change was undone: the new number is let go, and the vault says the old one again. */
  undoMobile(did: string): void {
    const driver = this.require(did);
    if (!driver.vaultRef || !this.vault.exists(driver.vaultRef)) return;
    const pii = this.vault.reveal(driver.vaultRef, { purpose: 'number-change-undo', requesterDid: did });
    if (typeof pii.previousPhone !== 'string' || !pii.previousPhone) return;
    this.prints.release('phone', pii.phone, did);
    this.vault.update(driver.vaultRef, { ...pii, phone: pii.previousPhone, previousPhone: undefined });
  }

  /** The 24 hours are over: the old number is free for whoever holds it now. */
  releaseHeldPhone(key: string, did: string): void {
    this.prints.releaseKey(key, did);
  }

  /** Whether this registration was made with that national ID number — the question an email recovery has to answer. */
  holdsNationalId(did: string, nationalId: string | undefined): boolean {
    return Boolean(nationalId?.trim()) && this.prints.holder('nationalId', nationalId) === did;
  }

  /* --- a national ID two people say is theirs (id-dispute.service.ts) --- */

  /** The key a national ID number is kept under. The number itself is never stored beside it. */
  nationalIdKey(nationalId: string | undefined): string {
    return this.prints.keyOf('nationalId', nationalId);
  }

  /** Who holds the national ID kept under this key: a registration's DID, a keeping for somebody not yet registered, or nobody. */
  nationalIdHolderOfKey(key: string): string | undefined {
    return this.prints.holderOfKey(key);
  }

  /**
   * THE ID GOES FROM THIS REGISTRATION, BY A DECISION. The number under the key is not theirs: it leaves the
   * register for them and it leaves the vault, where it was kept under their name.
   */
  loseNationalId(did: string, key: string): void {
    const driver = this.require(did);
    this.prints.releaseKey(key, did);
    if (driver.vaultRef && this.vault.exists(driver.vaultRef)) {
      const pii = this.vault.reveal(driver.vaultRef, { purpose: 'id-dispute', requesterDid: did });
      if (this.prints.keyOf('nationalId', typeof pii.governmentId === 'string' ? pii.governmentId : undefined) === key) this.vault.update(driver.vaultRef, { ...pii, governmentId: undefined });
    }
  }

  /**
   * HELD: nothing new until an ID of their own is on record. Asked where every way behind a wheel already asks
   * (`canOperate`) — so a run under way is finished, and no shift, run or load is started.
   */
  holdForId(did: string, hold: { reference: string; at: string }): void {
    const driver = this.require(did);
    driver.idHold = hold;
    this.drivers.set(did, driver);
  }

  idHoldOf(did: string): { reference: string; at: string } | undefined {
    return this.drivers.get(did)?.idHold;
  }

  /**
   * THIS REGISTRATION IS ON RECORD WITH THIS NUMBER — its own, typed by its holder or read off their card by staff.
   * Refused when another registration holds it. Having an ID of their own on record is what ends a hold.
   */
  takeNationalId(did: string, nationalId: string): void {
    const driver = this.require(did);
    const number = nationalId?.trim();
    if (!number) throw new GlosError('FIELD_REQUIRED', 'Enter the number on the ID card', { field: 'nationalId' });
    if (this.prints.taken([['nationalId', number]], did)) throw new GlosError('DUPLICATE', 'A driver with this national ID already exists', { field: 'nationalId', register: 'driver' });
    this.prints.claim([['nationalId', number]], did);
    if (driver.vaultRef && this.vault.exists(driver.vaultRef)) {
      const pii = this.vault.reveal(driver.vaultRef, { purpose: 'id-dispute', requesterDid: did });
      this.vault.update(driver.vaultRef, { ...pii, governmentId: number });
    }
    delete driver.idHold;
    this.drivers.set(did, driver);
  }

  /** The ID under this key is this registration's, by a decision — given, or given back. A hold on it ends. */
  giveNationalId(did: string, key: string): void {
    const driver = this.require(did);
    this.prints.moveKey(key, 'nationalId', did);
    delete driver.idHold;
    this.drivers.set(did, driver);
  }

  /** Keep the ID under this key for whoever registers with this phone: a decision gave it to somebody with no registration yet. */
  keepNationalIdFor(key: string, phone: string, by: string): void {
    this.prints.keepFor(key, 'nationalId', phone, by);
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
