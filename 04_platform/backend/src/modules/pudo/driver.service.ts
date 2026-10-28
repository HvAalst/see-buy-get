import { driverPapers, lapsedOf, offRoadLine, paperLapsesAt, type CarrierCoverProof } from './papers';
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
import { CourierAsk, DriverKyc, DriverRegistry, FleetDriver, FleetRemoval, Vehicle } from './fleet.types';
import { FleetManagerService } from './fleet-manager.service';
import { EntityService } from '../../foundation/entity/entity.service';
import { PresenceService } from '../../foundation/presence/presence.service';
import { NETWORK_CURRENCY, NETWORK_JURISDICTION } from './pudo.config';
import { catalogueEntry, isKnownCurrency } from '../../foundation/countries/catalogue';

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

/**
 * Round 39 — NOBODY HAS SEEN THIS RIDER'S ID: a bicycle or motorcycle rider in no fleet who rode at once, whose photo of
 * their ID no member of staff has looked at yet. A heavier vehicle's driver was vetted before they rode, and a courier
 * whose ask to ride alone was approved had their ID read then — both have `kyc`.
 */
export function idUnseen(driver: Pick<FleetDriver, 'registry' | 'managerDid' | 'kyc' | 'idCheck'>): boolean {
  return driver.registry === 'light' && !driver.managerDid && !driver.kyc && !driver.idCheck?.seenAt;
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

  /**
   * WHAT MONEY A VEHICLE'S PER-KM RATE IS IN: the money of the company that settles the work done in it — the
   * fleet's company for a fleet's vehicle, the courier's own for a courier's, the same answer `payTermsOf` gives
   * the driver at the wheel. A rate is a figure a driver weighs against other drivers' and then changes; said in
   * no money, or set beside rates in another, it is worse than no figure at all.
   *
   * Undefined where no company of ours settles that work — a fleet standing in a country we only match, a vehicle
   * with no fleet and no owner on record: there the money is whatever the two parties agree, and such a rate is
   * left out of a comparison rather than given a currency by guesswork.
   */
  rateCurrencyOf(vehicle: Pick<Vehicle, 'managerDid' | 'ownerDriverDid'>): string | undefined {
    let entityId: string | undefined;
    try {
      if (vehicle.managerDid) entityId = this.managers.entityIdOrNone(this.managers.get(vehicle.managerDid));
      else if (vehicle.ownerDriverDid) entityId = this.payeeOrNone(vehicle.ownerDriverDid).entityId;
    } catch {
      // An owner that is no longer on record: the rate stands in no money we can name.
    }
    return this.currencyOfCompany(entityId);
  }

  /**
   * The money a driver's per-km rate earns them: that of the company that pays them for the work (`payeeOrNone`, the
   * same answer `driverPayout` posts to), whichever vehicle they are in. Undefined where no company of ours pays them.
   */
  rateCurrencyForDriver(did: string): string | undefined {
    return this.currencyOfCompany(this.payeeOrNone(did).entityId);
  }

  private currencyOfCompany(entityId: string | undefined): string | undefined {
    return entityId ? (this.entities.amountsFor(entityId).currency ?? NETWORK_CURRENCY) : undefined;
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
   *
   * WHERE THEY STAND TODAY, AND WHOSE MONEY THE FIGURES ARE. Two things this got wrong:
   *
   *  - "No fleet" was read as "their own boss". A driver a fleet took off, or who left, is in no fleet
   *    and is nobody's courier either — and was told their earnings are paid to them, beside a figure of
   *    nothing. What they earned was paid to the fleet they drove for. `standing: 'none'` says so, and
   *    names no payee, because for work done now there is none.
   *  - For a fleet's driver the figures were the FLEET's: everything the network ever paid that fleet,
   *    for all its drivers, handed to each one of them. The app showed a sentence instead of the number,
   *    so nobody saw it; the answer carried it all the same. The figures are now only ever what reached
   *    THIS driver directly — usually nothing for a fleet's driver, and what they were paid as a courier
   *    for one who rode alone before or since.
   */
  settlementFor(did: string, payouts: { forPayee(payeeDid: string): { settled: number; inFlight: number; currency?: string } }): {
    payeeDid?: string;
    paidToMe: boolean;
    standing: 'own' | 'fleet' | 'none';
    settled: number;
    inFlight: number;
    currency?: string;
  } {
    const driver = this.require(did);
    // WHO is paid is a fact about the contract, not about money — so it is read without asking which sister
    // pays, which would refuse for a driver whose fleet stands where no sister does (a read must answer).
    const standing = driver.managerDid ? 'fleet' : betweenFleets(driver) ? 'none' : 'own';
    const payeeDid = standing === 'fleet' ? driver.managerDid : standing === 'own' ? driver.did : undefined;
    return { ...(payeeDid ? { payeeDid } : {}), paidToMe: standing === 'own', standing, ...payouts.forPayee(driver.did) };
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
    // Signing up is taken where the network operates and where it is COMING (2026-10-25): the account and its papers ahead of the day it opens.
    if (jurisdiction && !this.presence.can(jurisdiction, 'signUp')) throw new GlosError('FORBIDDEN', `SeeBuyGet does not take sign-ups in ${jurisdiction} yet, so a courier cannot register there`);

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
   * A DRIVER SENDS THEIR RENEWED LICENCE: the photograph, and the date they read off it.
   *
   * WHO READS IT is whoever records their licence, and there is only ever one: the office of the fleet
   * they drive for, or — for a courier without a fleet — network staff. A fleet driver used to be turned
   * away here ("show them the renewed card"), so their office typed a date off a card it may never have
   * seen. The card goes to that same office now. It is still one route to the date, not two: the driver
   * supplies the photograph, and the office that always recorded the date is the one that reads it.
   *
   * The date sent here switches nothing on; it waits beside the photograph until somebody reads the same
   * card and types it (renewLicence).
   */
  sendLicenceRenewal(did: string, input: { copyRef: string; expiresAt: string; number?: string }, now: number = Date.now()): FleetDriver {
    const driver = this.require(did);
    if (driver.status === 'SUSPENDED') throw new GlosError('INVALID_STATE', 'A suspended driver cannot send papers');
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
    // Staff read a queue that counts what is waiting. A fleet's office has no such queue, so it is told.
    void this.events
      .publish(GlosEvent.Pudo.DriverLicenceSent, { did, displayName: driver.displayName, expiresAt: input.expiresAt, ...(driver.managerDid ? { managerDid: driver.managerDid } : {}) }, { source: 'pudo' })
      .catch(() => undefined);
    return driver;
  }

  /**
   * WHICH PHOTOGRAPHS OF A DRIVER'S LICENCE THEIR FLEET'S OFFICE MAY OPEN: the card waiting to be read,
   * and the card the date on record was read from. Nothing else of the driver's — the caller names an id
   * and is answered only when it is one of those two, so this never becomes a way to walk a driver's
   * other photographs. An id that is neither answers NOT FOUND rather than "not yours".
   */
  licenceCardOf(did: string, mediaId: string): string {
    const driver = this.require(did);
    const readable = [driver.licenceRenewal?.copyRef, driver.licence.copyRef].filter(Boolean);
    if (!mediaId || !readable.includes(mediaId)) throw new GlosError('NOT_FOUND', 'No such photograph');
    return mediaId;
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
   * A REFUSAL CARRIES A REASON, as every refusal here does: the driver is shown it, and one they cannot
   * act on leaves them where silence did. The photograph is deleted now rather than kept on a clock:
   * nothing was recorded from it, so it is a picture of somebody's licence that proves nothing.
   */
  refuseLicenceRenewal(did: string, reason: string, by?: string, now: number = Date.now()): FleetDriver {
    const driver = this.require(did);
    const pending = driver.licenceRenewal;
    if (!pending) throw new GlosError('INVALID_STATE', 'Nothing has been sent to refuse');
    const why = reason?.trim();
    if (!why) throw new GlosError('REASON_REQUIRED', 'A refusal must say why: the driver is shown it');
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
    if (this.notOpenYet(driver)) return false;
    return lapsedOf(driverPapers(driver, now)).length === 0;
  }

  /**
   * COMING (the user, 2026-10-25: "can preregister before a country goes live"): a driver who signed up — or whose
   * fleet did — where the network takes sign-ups and is not open yet. Checked and ready; no shift starts until the day
   * it opens. Only COMING: a country lowered later stops new parcels, never a driver finishing what is aboard.
   */
  notOpenYet(driver: FleetDriver): string | undefined {
    let country: string;
    try {
      country = (driver.managerDid ? (this.managers.get(driver.managerDid).jurisdiction ?? NETWORK_JURISDICTION) : (driver.jurisdiction ?? NETWORK_JURISDICTION)).toUpperCase();
    } catch {
      return undefined;
    }
    return this.presence.resolve(country).level === 'coming' ? country : undefined;
  }

  /** FP4 — why this driver cannot start a shift, in words. Empty when they can (status aside). */
  offRoadReasons(did: string, now: number = Date.now()): string[] {
    const driver = this.drivers.get(did);
    if (!driver) return [];
    const opens = this.notOpenYet(driver);
    const papers = [
      ...(opens ? [`SeeBuyGet opens in ${catalogueEntry(opens)?.name ?? opens} soon: shifts start the day it opens`] : []),
      ...(driver.idHold ? [idHoldLine(driver.idHold.reference)] : []),
      ...lapsedOf(driverPapers(driver, now)).map(offRoadLine),
    ];
    if (!betweenFleets(driver)) return papers;
    const off = driver.removedFrom!;
    // Said as what happened: a driver who left is not told a fleet took them off.
    const how = off.reason === 'own' ? `you left ${off.companyName} on ${dayOf(off.at)}` : `${off.companyName} took you off on ${dayOf(off.at)}`;
    return [`you are not in a fleet — ${how}, and a fleet has to offer you a place first`, ...papers];
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
    delete driver.courierAsk; // …and an ask to ride for themselves lapses: they chose a fleet instead
    delete driver.courierAskRefusal;
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


  /**
   * WHERE A COURIER CAN REGISTER TODAY, and the company of ours that would contract them there — for somebody
   * about to become one. A country we only match in has no company behind it: a courier stands there without
   * one, and is paid by whoever they carry for.
   */
  courierCountries(): Array<{ jurisdiction: string; companyName?: string }> {
    return this.presence
      .list()
      .filter((p) => this.presence.can(p.jurisdiction, 'takeIn'))
      .map((p) => {
        const company = this.entities.forJurisdiction(p.jurisdiction);
        return { jurisdiction: p.jurisdiction, ...(company ? { companyName: company.name } : {}) };
      });
  }

  /**
   * RIDES FOR THEMSELVES — the driver record's half. FleetMoveService has already checked they may.
   *
   * The reverse of leaveFleet: somebody who is in no fleet becomes somebody the network contracts directly. That
   * takes the two things a fleet's driver never carried — where they legally reside, and so which company of
   * ours contracts them. The marker of the fleet they left goes: it described a state, and they are out of it.
   * Everything keyed to THEM stays as it is: papers, trips, rating, badge, sign-in.
   */
  rideAlone(did: string, jurisdiction: string): FleetDriver {
    const driver = this.require(did);
    const code = jurisdiction.toUpperCase();
    if (!this.presence.can(code, 'takeIn')) throw new GlosError('FORBIDDEN', `The network does not operate in ${code} yet, so a courier cannot register there`);
    const company = this.entities.forJurisdiction(code);
    driver.jurisdiction = code;
    if (company) driver.entityId = company.entityId;
    else delete driver.entityId;
    delete driver.removedFrom;
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

  /**
   * THE DRIVER CLOSED THEIR ACCOUNT (2026-10-22): name, national ID and phone leave the vault, the numbers (and the
   * licence's) leave the register, every photograph of them or their papers goes, and the registration is suspended.
   * The record stays for the loads it carried, named "Closed account" — a note already signed keeps what it said then.
   */
  forgetOwner(did: string): void {
    const driver = this.drivers.get(did);
    if (!driver) return;
    if (driver.vaultRef && this.vault.exists(driver.vaultRef)) {
      const pii = this.vault.reveal(driver.vaultRef, { purpose: 'account-closed', requesterDid: did });
      this.prints.release('nationalId', typeof pii.governmentId === 'string' ? pii.governmentId : undefined, did);
      this.prints.release('phone', typeof pii.phone === 'string' ? pii.phone : undefined, did);
      this.vault.forget(driver.vaultRef, { purpose: 'account-closed', requesterDid: did });
    }
    if (driver.licence?.number && driver.licence.number !== 'n/a') this.prints.release('licence', driver.licence.number, did);
    for (const ref of [driver.portrait?.photoRef, driver.kyc?.idCopyRef, driver.kyc?.licenceCopyRef]) this.media?.purgeByOwner(ref, did);
    this.media?.dropIdentityCheck(driver.idCheck?.photoRef);
    driver.displayName = 'Closed account';
    driver.status = 'SUSPENDED';
    this.drivers.set(did, driver);
    this.dids.forgetController(did);
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

  /** Waiting on staff: papers sent for vetting, and drivers in no fleet asking to ride for themselves on something heavy. */
  kycQueue(): FleetDriver[] {
    return [...this.drivers.values()].filter((d) => d.status === 'KYC_PENDING' || Boolean(d.courierAsk));
  }

  /**
   * ASKING TO RIDE FOR THEMSELVES — the driver record’s half. FleetMoveService has already checked they may ask.
   *
   * Their two photographs are adopted as theirs and nobody else’s (a picture uploaded by another account, or attached
   * elsewhere, is refused) before anything is written, and the ask waits for staff in the queue papers already go to.
   * Nothing about the driver changes while it waits: they are in no fleet, as they were.
   */
  askToRideAlone(did: string, ask: Omit<CourierAsk, 'askedAt'>, now: number = Date.now()): FleetDriver {
    const driver = this.require(did);
    if (!this.media) throw new GlosError('INVALID_STATE', 'Photographs cannot be kept in this deployment, so papers cannot be sent');
    if (!ask.idCopyRef || !ask.licenceCopyRef) throw new GlosError('KYC_INCOMPLETE', 'Send a photograph of your ID card and one of your driving licence');
    if (ask.idCopyRef === ask.licenceCopyRef) throw new GlosError('KYC_INCOMPLETE', 'Your ID card and your licence are two photographs, not one');
    const link = { type: 'driver' as const, id: did };
    if (!this.media.adopt(ask.idCopyRef, did, link, 'kyc_id') || !this.media.adopt(ask.licenceCopyRef, did, link, 'kyc_licence')) {
      throw new GlosError('PHOTO_REQUIRED', 'A photograph could not be attached — take it again');
    }
    driver.courierAsk = { ...ask, askedAt: new Date(now).toISOString() };
    delete driver.courierAskRefusal;
    this.drivers.set(did, driver);
    return driver;
  }

  /**
   * Round 39 — A LIGHT COURIER SENDS A PHOTO OF THEIR ID (the user: "Ride at once, smaller cap"). They ride already; until
   * it has been seen, their custody cap stays at its starting number. Only a bicycle or motorcycle rider in no fleet, whose
   * ID nobody has seen yet. The photo is adopted as theirs and nobody else's before anything is written.
   */
  sendIdPhoto(did: string, photoRef: string, now: number = Date.now()): FleetDriver {
    const driver = this.require(did);
    if (driver.registry !== 'light' || driver.managerDid) throw new GlosError('INVALID_STATE', 'A photo of your ID is asked of a bicycle or motorcycle rider in no fleet: your papers were seen when you joined');
    if (!idUnseen(driver)) throw new GlosError('INVALID_STATE', 'Your ID has been seen already');
    if (!this.media) throw new GlosError('INVALID_STATE', 'Photographs cannot be kept in this deployment, so an ID photo cannot be sent');
    if (!photoRef || !this.media.adopt(photoRef, did, { type: 'driver', id: did }, 'kyc_id')) throw new GlosError('PHOTO_REQUIRED', 'The photograph could not be attached — take it again');
    driver.idCheck = { photoRef, sentAt: new Date(now).toISOString() };
    delete driver.idCheckRefusal;
    this.drivers.set(did, driver);
    return driver;
  }

  /** Round 39 — the light couriers whose ID photo waits for a member of staff to look at it, oldest first. */
  idPhotoQueue(): FleetDriver[] {
    return [...this.drivers.values()].filter((d) => d.idCheck && !d.idCheck.seenAt && idUnseen(d)).sort((a, b) => a.idCheck!.sentAt.localeCompare(b.idCheck!.sentAt));
  }

  /**
   * Round 39 — A MEMBER OF STAFF LOOKS AT THE PHOTO: it is this rider's ID — seen, and from now their cap grows as anybody's
   * does — or it is not, with the reason they are shown, and they send another. Either way the rider is told.
   */
  decideIdPhoto(did: string, seen: boolean, by?: string, reason?: string, now: number = Date.now()): FleetDriver {
    const driver = this.require(did);
    if (!driver.idCheck || driver.idCheck.seenAt) throw new GlosError('INVALID_STATE', 'There is no photo of their ID waiting to be seen');
    const at = new Date(now).toISOString();
    if (seen) {
      driver.idCheck = { ...driver.idCheck, seenAt: at, ...(by ? { seenBy: by } : {}) };
    } else {
      const why = reason?.trim();
      if (!why) throw new GlosError('REASON_REQUIRED', 'Say why it is not their ID: they are shown it, and send another');
      delete driver.idCheck;
      driver.idCheckRefusal = { reason: why, at, ...(by ? { by } : {}) };
    }
    this.drivers.set(did, driver);
    void this.events.publish(GlosEvent.Pudo.DriverIdPhotoDecided, { did, seen, ...(seen ? {} : { reason: driver.idCheckRefusal?.reason }) }, { source: 'pudo' }).catch(() => undefined);
    return driver;
  }

  /** The ask is over — decided, or overtaken by a fleet’s place. A refusal is kept for the driver to read. */
  closeCourierAsk(did: string, refusal?: { reason: string; at: string; by?: string }): FleetDriver {
    const driver = this.require(did);
    delete driver.courierAsk;
    if (refusal) driver.courierAskRefusal = refusal;
    this.drivers.set(did, driver);
    return driver;
  }

  /** Staff’s own check, recorded when they approve an ask: one way, as at vetting. */
  recordCourierCheck(did: string, papers: { idCopyRef: string; licenceCopyRef: string; at: string }): FleetDriver {
    const driver = this.require(did);
    driver.criminalRecordClear = true;
    driver.kyc = { idCopyRef: papers.idCopyRef, licenceCopyRef: papers.licenceCopyRef, submittedAt: papers.at } as DriverKyc;
    this.drivers.set(did, driver);
    return driver;
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
  /**
   * WHERE THIS CARRIER IS, on its consignment notes (the user, 2026-10-28): its business address if it has one, otherwise
   * a pin of the station it works from. Only a driver riding for themselves is asked — they are the carrier; a fleet's
   * driver is carried for by the fleet, whose depot is the address.
   */
  setCarrierPlace(did: string, input: { address?: string; station?: { lat: number; lng: number; label?: string } }, now = Date.now()): FleetDriver {
    const driver = this.require(did);
    if (driver.managerDid) throw new GlosError('FORBIDDEN', 'A fleet’s driver carries for the fleet: the fleet’s depot is the carrier’s address on the notes');
    const address = input.address?.trim().slice(0, 300);
    const station = input.station && Number.isFinite(input.station.lat) && Number.isFinite(input.station.lng) ? { lat: Math.round(input.station.lat * 1e5) / 1e5, lng: Math.round(input.station.lng * 1e5) / 1e5, ...(input.station.label?.trim() ? { label: input.station.label.trim().slice(0, 120) } : {}) } : undefined;
    if (!address && !station) throw new GlosError('FIELD_REQUIRED', 'Give your business address, or pin the station you work from', { field: 'address' });
    driver.carrierPlace = { ...(address ? { address } : {}), ...(station ? { station } : {}), at: new Date(now).toISOString() };
    return driver;
  }

  /**
   * A DRIVER RIDING FOR THEMSELVES SENDS THEIR INSURANCE POLICY (the user, 2026-10-28: "owner drivers should be able to show
   * cover as well. Someone willing to invest in it should be rewarded for it"). The photograph, the expiry they read, the
   * policy number: it waits for staff to read the same policy. A fleet's driver is covered by the fleet's, and is told so.
   */
  sendCover(did: string, input: { copyRef: string; expiresAt: string; reference?: string }, now = Date.now()): FleetDriver {
    const driver = this.require(did);
    if (driver.managerDid) throw new GlosError('FORBIDDEN', 'A fleet’s driver is covered by the fleet’s insurance: the fleet’s office sends its policy from the Fleet app');
    if (driver.status === 'SUSPENDED') throw new GlosError('INVALID_STATE', 'A suspended driver cannot send papers');
    if (!input.expiresAt || paperLapsesAt(input.expiresAt) <= now) throw new GlosError('VALIDATION_FAILED', 'That date has already passed — a policy you send runs into the future', { field: 'expiresAt' });
    if (!this.media) throw new GlosError('INVALID_STATE', 'Photographs cannot be kept in this deployment, so a policy cannot be sent');
    if (!this.media.adopt(input.copyRef, did, { type: 'driver', id: did }, 'kyc_insurance')) throw new GlosError('PHOTO_REQUIRED', 'That photograph could not be attached — take it again');
    const earlier = driver.cover?.sent?.copyRef;
    if (earlier && earlier !== input.copyRef) this.media.purgeByOwner(earlier, did);
    const reference = input.reference?.trim().slice(0, 120);
    driver.cover = { ...(driver.cover ?? {}), sent: { copyRef: input.copyRef, expiresAt: input.expiresAt, ...(reference ? { reference } : {}), sentAt: new Date(now).toISOString() } };
    delete driver.cover.refused;
    this.drivers.set(did, driver);
    return driver;
  }

  /**
   * STAFF READ THE POLICY THEY SENT and record the cover off it: until when, what for, up to how much a load. Only a policy
   * that was SENT can be recorded — the proof is the document, never somebody's word.
   */
  recordCover(did: string, input: { expiresAt: string; policy?: string; covers?: 'goods_in_transit' | 'carrier_liability' | 'both'; limit?: number; currency?: string }, by: string, now = Date.now()): FleetDriver {
    const driver = this.require(did);
    const sent = driver.cover?.sent;
    if (!sent) throw new GlosError('INVALID_STATE', 'No policy has been sent to read: cover counts only when it is read off the policy the driver sent');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.expiresAt) || paperLapsesAt(input.expiresAt) <= now) throw new GlosError('VALIDATION_FAILED', 'The expiry read off the policy is a day still to come, written YYYY-MM-DD', { field: 'expiresAt' });
    const currency = input.currency?.trim().toUpperCase();
    if (input.limit != null && (!(input.limit > 0) || !isKnownCurrency(currency))) throw new GlosError('VALIDATION_FAILED', 'A cover limit is an amount above nothing, in a currency some country uses — like KES or USD', { field: 'limit' });
    const previous = driver.cover?.copyRef;
    if (previous && previous !== sent.copyRef) this.media?.retireAccountDoc(previous, new Date(now));
    const policy = (input.policy ?? sent.reference)?.trim().slice(0, 120);
    driver.cover = {
      ...(policy ? { policy } : {}),
      expiresAt: input.expiresAt,
      copyRef: sent.copyRef,
      ...(input.covers ? { covers: input.covers } : {}),
      ...(input.limit != null ? { limit: Math.round(input.limit), currency: currency! } : {}),
      recordedBy: by,
      recordedAt: new Date(now).toISOString(),
    };
    this.drivers.set(did, driver);
    return driver;
  }

  /** The policy they sent is not accepted, with a reason they are shown. The photograph is deleted: nothing rests on it. */
  refuseCover(did: string, reason: string, by?: string, now = Date.now()): FleetDriver {
    const driver = this.require(did);
    const sent = driver.cover?.sent;
    if (!sent) throw new GlosError('INVALID_STATE', 'Nothing has been sent to refuse');
    const why = reason?.trim();
    if (!why) throw new GlosError('REASON_REQUIRED', 'A refusal must say why: the driver is shown it');
    this.media?.purgeByOwner(sent.copyRef, did);
    const { sent: _gone, ...kept } = driver.cover!;
    driver.cover = { ...kept, refused: { reason: why, at: new Date(now).toISOString(), ...(by ? { by } : {}) } };
    this.drivers.set(did, driver);
    return driver;
  }

  /** Their cover, proven: read off the policy they sent, and still running. Nothing otherwise — and nothing for a fleet's driver. */
  coverOf(did: string, now = Date.now()): CarrierCoverProof | undefined {
    const d = this.drivers.get(did);
    const c = d?.cover;
    if (!d || d.managerDid || !c?.copyRef || !c.expiresAt || paperLapsesAt(c.expiresAt) <= now) return undefined;
    return { ...(c.policy ? { policy: c.policy } : {}), expiresAt: c.expiresAt, ...(c.covers ? { covers: c.covers } : {}), ...(c.limit != null && c.currency ? { limit: c.limit, currency: c.currency } : {}), ...(c.recordedAt ? { checkedAt: c.recordedAt } : {}) };
  }

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
