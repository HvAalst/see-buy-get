import { Injectable, Optional } from '@nestjs/common';
import { MediaService } from './media.service';
import { currencyForJurisdiction } from '../../foundation/money/currency';
import { SecurityDeclarationService } from './security-declaration.service';
import { RiskRegisterService } from './risk-register.service';
import { CorridorService } from './corridor.service';
import { GlosError } from '../../foundation/http/glos-error';
import { catalogueEntry } from '../../foundation/countries/catalogue';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { randomBytes } from 'crypto';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { DidService } from '../../foundation/did/did.service';
import { OperationalStore } from '../../foundation/data-firewall/operational-store.service';
import { AgentService } from './agent.service';
import { ParcelService } from './parcel.service';
import { ToteService } from './tote.service';
import { toteCapacityOf } from './fleet.config';
import { FleetService } from './fleet.service';
import { WalletGateService } from './wallet-gate.service';
import { CargoService } from './cargo.service';
import { CargoNature, VehicleCapability } from './cargo.types';
import { countryOfSite, requireCountryCode } from './country';
import { EntityService } from '../../foundation/entity/entity.service';
import { PresenceService } from '../../foundation/presence/presence.service';
import { HubPapers, HubSpaceView, Mdp, NextHop, Parcel, Tote } from './pudo.types';
import type { OffPlanSaid, RouteKeeper } from './route-plan.types';
import { handedAt } from './observed-at';
import { BagClosureService } from './bag-closure.service';
import type { BagClosureKind } from './bag-closure.types';
import { FINDING_WORDS } from './tamper.types';
import { roadLeftToPay } from './pricing';
import { clockAt, clocksOfCountry } from './fleet-clock';
import { NotificationService } from './notification.service';
import { HubDrop, HubFloorBook, spaceProblem } from './hub-space';

/**
 * MdpService — Main Distribution Point hubs + the tote-bag sort flow (Compendium Ch 17).
 *
 * An MDP is the middle of a multi-hop journey: a regional sort centre that covers a set of zones.
 * Unlike a PUDO it does not shelve parcels — it sorts them into tote bags by next destination. The
 * field choreography this service implements:
 *
 *   1. fillTote / loadBag  — an upstream node packs a bag toward this MDP; the driver scans the BAG.
 *   2. dropBag             — the bus drops a bag; the MDP scans its code and EMPTIES it (tote freed).
 *   3. sortParcel          — the worker scans each parcel; the system computes its next destination
 *                            and the destination bag code; the worker drops it into that bag.
 *   4. loadBag             — once a destination bag is full/ready, the onward driver scans it away.
 *
 * Bulk goods never enter a tote — they go truck-direct and are rejected here.
 */
@Injectable()
export class MdpService {
  // Durable: onboarded MDP sort-hubs (a signed-up participant type).
  private readonly mdps = new PersistentMap<string, Mdp>('pudo-mdps');

  constructor(
    private readonly agents: AgentService,
    private readonly parcels: ParcelService,
    private readonly totes: ToteService,
    private readonly fleet: FleetService,
    private readonly gate: WalletGateService,
    private readonly events: EventBus,
    private readonly dids: DidService,
    private readonly core: OperationalStore,
    private readonly cargo: CargoService,
    private readonly entities: EntityService,
    private readonly presence: PresenceService,
    private readonly closures: BagClosureService,
    // Round 39 — the security declarations: a hub adds no new tote, and no bag goes onto a driver, without one in force.
    @Optional() private readonly declarations?: SecurityDeclarationService,
    // Round 39 — the risk register: a hub or corridor rated high asks for a coded seal, and no night running.
    @Optional() private readonly risk?: RiskRegisterService,
    @Optional() private readonly corridors?: CorridorService,
    // The papers' ID photo is deleted at staff's decision (2026-11-01). Optional for the specs that build this by hand.
    @Optional() private readonly media?: MediaService,
    // 2026-11-02 — a bag held for room at its hub, and let go on, is told to whoever holds it; a hub whose day is full is
    // told so. In the bell, never a text. Optional for the specs that build this by hand.
    @Optional() private readonly notifications?: NotificationService,
  ) {}

  /**
   * 2026-11-02 — WHAT STANDS ON EACH HUB'S FLOOR THAT ITS BAGS NO LONGER SAY: the bags emptied at it on arrival, until every
   * parcel in them is sorted (a bag is emptied in the records the moment it is received, and stands on the floor until its
   * parcels are in other bags); the parcels sorted on its clock's day; the day it was told its sorting was full.
   */
  private readonly floors = new PersistentMap<string, HubFloorBook>('pudo-hub-floors');

  /** The kilos left on a driver's vehicle, everything they hold counted (DispatchService.remainingCapacity). */
  private roomOf?: (driverDid: string) => number | undefined;

  /** Registered rather than injected: dispatch reads the hub. Without it a bag is weighed against an empty vehicle. */
  registerRoom(fn: (driverDid: string) => number | undefined): void {
    this.roomOf = fn;
  }

  /** 2026-11-03 — why a bag cannot go beside the cold loads on a driver's vehicle (DispatchService.coldRefusal). */
  private coldOf?: (driverDid: string, bagCode: string) => string | undefined;

  /** Registered as the room is: dispatch knows what is aboard. Without it a bag of chilled parcels could join a frozen load. */
  registerCold(fn: (driverDid: string, bagCode: string) => string | undefined): void {
    this.coldOf = fn;
  }

  /**
   * 2026-11-05 — PRE-DROP-OFF: a closed bag is given first to the driver who took its parcels on ahead (PickupAheadService
   * registers it; it sits above this service). True when it was given — then it is offered to nobody else.
   */
  private promisedFor?: (tote: Tote, now: number) => boolean;

  registerPromised(fn: (tote: Tote, now: number) => boolean): void {
    this.promisedFor = fn;
  }

  /** 2026-11-06 — the parcel's plan, asked at every hand-over (RoutePlanService registers it: it reads routing, above this). */
  private routeKeeper?: RouteKeeper;

  registerRouteKeeper(k: RouteKeeper): void {
    this.routeKeeper = k;
  }

  /** Whether this bag is not where the parcel's plan sends it next: the stop it should go to, or nothing. Either of a readdressed bag's addresses will do. */
  private offPlanInto(parcel: Parcel, bag: Tote) {
    const keeper = this.routeKeeper;
    if (!keeper || !bag.destinationNodeId) return undefined;
    const off = keeper.offPlan(parcel, bag.destinationNodeId);
    if (!off || (bag.packedFor && !keeper.offPlan(parcel, bag.packedFor))) return undefined;
    return off;
  }

  /** 2026-11-05 — where a parcel waiting at its shop goes NEXT (BagPlanService.nextHopFor): a hub's id, or its own zone. */
  private nextHopOf?: (parcel: Parcel) => string;

  /** Registered as the room is: the bag plan reads routing, and routing reads the hub. Without it a shop's bag is matched by zone alone. */
  registerNextHop(fn: (parcel: Parcel) => string): void {
    this.nextHopOf = fn;
  }

  /**
   * 2026-11-05 — WHETHER A PARCEL WAITING AT A SHOP BELONGS IN THIS SHOP'S BAG: the bag goes where the parcel goes next —
   * its zone, as always, or the hub its route runs through (the bag plan's group). A hub's bag was compared with the zone
   * and took nothing. A bag room sent on to another hub still answers for the hub it was packed for (Tote.packedFor).
   */
  private belongsInShopBag(parcel: Parcel, bag: Tote): boolean {
    // 2026-11-06 — by its plan, where it has one: its next stop is where this bag goes.
    if (this.routeKeeper?.nextStop(parcel)) return !this.offPlanInto(parcel, bag);
    const to = [bag.destinationNodeId, bag.packedFor].filter((id): id is string => Boolean(id));
    if (to.includes(parcel.destZone)) return true;
    if (parcel.destAgentDid && to.includes(parcel.destAgentDid)) return true; // 2026-11-06 — a bag for its own shop
    const hubs = to.filter((id) => this.mdps.has(id));
    if (!hubs.length || !this.nextHopOf) return false;
    return hubs.includes(this.nextHopOf(parcel));
  }

  /** The country this hub stands in — declared at registration, this deployment's home for older records. */
  countryOf(mdp: Mdp): string {
    return countryOfSite(mdp);
  }

  /** The sister that contracts this hub, resolved from the country the hub is in (see AgentService). The money
   *  gate: a hub in a country we only match has none, and the refusal is the presence's, by name. */
  entityIdOf(mdp: Mdp): string {
    const own = this.entityIdOrNone(mdp);
    if (own) return own;
    this.presence.require(this.countryOf(mdp), 'payouts');
    return this.entities.requireForJurisdiction(this.countryOf(mdp)).entityId;
  }

  /** The read-and-custody twin: the sister, or nothing where the hub stands in a country we only match. */
  entityIdOrNone(mdp: Mdp): string | undefined {
    return mdp.entityId ?? this.entities.forJurisdiction(this.countryOf(mdp))?.entityId;
  }

  /**
   * The money a hub's sort fee is in: the company's that contracts it, as a shop's price is its company's. Where no
   * company of ours stands yet, the money of the country the hub is in — a hub signing up in the Netherlands before a
   * company there was shown its fee in Kenyan shillings (the owner, 2026-10-30: "we must settle for EURO").
   */
  currencyOf(mdp: Mdp): string {
    return this.entities.amountsFor(this.entityIdOrNone(mdp)).currency ?? currencyForJurisdiction(this.countryOf(mdp));
  }

  // --- cargo helpers (S31): the tote path's view of what its parcels are + need ---

  /** The primary cargo nature of a parcel (default GEN for legacy/unstamped parcels). */
  private natureOf(parcelId: string): CargoNature {
    return this.parcels.get(parcelId).natureCode ?? 'GEN';
  }

  /** The distinct cargo natures currently in a tote (via its parcels). */
  toteNatures(tote: Tote): CargoNature[] {
    return [...new Set(tote.parcels.map((id) => this.natureOf(id)))];
  }

  /** The vehicle capabilities a tote's contents collectively require (cold chain, hazmat, …). */
  toteRequiredCapabilities(tote: Tote): VehicleCapability[] {
    return this.cargo.requiredCapabilities(this.toteNatures(tote));
  }

  /** May a parcel of `nature` join a bag already holding `parcels`? Only if compatible with every one. */
  private bagAccepts(nature: CargoNature, parcels: string[]): boolean {
    return parcels.every((id) => this.cargo.canShareVehicle(nature, this.natureOf(id)));
  }

  // --- registry ---

  /**
   * `vouched` says who stands behind the hub (the ISO 28000 check: "hubs are not vetted at all"): a member of staff who
   * registered it themselves, and so approved it, by name — or `'joining'`, a hub that signed itself up and is vetted
   * from its papers before it works. Asked of every caller, so that no new way in can skip it by leaving it out.
   */
  register(input: { name: string; zones: string[]; country?: string; location: { lat: number; lng: number }; contactPhone?: string; address?: string; pricePerParcel?: number; bagPlaces?: number; sortPerDay?: number }, vouched: { approvedBy: string } | 'joining'): Mdp {
    if (!input.zones?.length) throw new GlosError('ZONES_REQUIRED', 'An MDP must cover at least one zone');
    // 2026-11-02 — its space, asked at sign-up ("About your hub"): both numbers, or neither — a hub that says neither is asked
    // on its start screen. The sign-up's profile is the form's own object, so the numbers are checked here, not by a DTO.
    const saysSpace = input.bagPlaces != null || input.sortPerDay != null;
    const wrongSpace = saysSpace ? spaceProblem(input.bagPlaces, input.sortPerDay) : null;
    if (wrongSpace) throw new GlosError('INVALID_INPUT', wrongSpace.words, { field: wrongSpace.field });
    // Same question a shop answers: does the network operate here at all? Where we only match, a hub stands with
    // no sister behind it — it sorts and records custody, and nothing of ours is booked for the work.
    const country = requireCountryCode(input.country);
    // Signing up is taken where the network operates and where it is COMING (2026-10-25): the account and its papers ahead of the day it opens.
    if (!this.presence.can(country, 'signUp')) throw new GlosError('FORBIDDEN', `SeeBuyGet does not take sign-ups in ${country} yet, so a hub cannot register there`);
    const entity = this.entities.forJurisdiction(country);
    // Real DID (S2) — an MDP worker is a first-class actor and their token binds to this, not to a
    // synthetic mdp_<hex> id. A pseudonymous operational profile makes it OperationalStore-resolvable
    // (tier/tokenVersion) like every other participant. No PII goes to the core (contact/address stay
    // on the domain record only).
    const did = this.dids.generate(`mdp:${input.name}`, { role: 'pudo-mdp' }).id;
    const now = new Date().toISOString();
    this.core.upsert({ did, tier: 2, status: vouched === 'joining' ? 'pending' : 'active', capabilities: ['pudo-mdp'], metadata: { zones: input.zones } });
    const mdp: Mdp = {
      mdpId: `mdp_${randomBytes(5).toString('hex')}`,
      did,
      name: input.name,
      country, // where the hub stands — a leg into a hub in another country is a border crossing
      ...(entity ? { entityId: entity.entityId } : {}), // the sister that contracts this hub, where one exists
      zones: input.zones,
      location: input.location,
      contactPhone: input.contactPhone,
      address: input.address?.trim() || undefined,
      // Its own fee — what senders are charged and what it is paid for each parcel it sorts. A hub that names none starts
      // at its company's list (the user, 2026-10-26: "Its own fee"), and sets its own from its home screen.
      pricePerParcel: input.pricePerParcel ?? this.entities.amountsFor(entity?.entityId).mdpSortFee,
      createdAt: now,
      vetting: vouched === 'joining' ? { state: 'draft' } : { state: 'approved', approvedAt: now, approvedBy: vouched.approvedBy },
      ...(saysSpace ? { bagPlaces: input.bagPlaces, sortPerDay: input.sortPerDay, spaceSaidAt: now } : {}),
    };
    this.mdps.set(mdp.mdpId, mdp);
    return mdp;
  }

  // --- vetting (the ISO 28000 check: "hubs are not vetted at all") ---

  /** Approved by a member of staff who saw its papers, or who registered it. Nothing else lets a hub work. */
  isApproved(mdp: Mdp): boolean {
    return mdp.vetting?.state === 'approved';
  }

  /**
   * THE HUB, IF IT MAY WORK. Every act on a hub's floor asks this first: a bag received, a parcel sorted, a tote added, a
   * bag filled, closed, addressed or loaded. Refused before anything is written, in words the hub can act on.
   */
  working(mdpId: string): Mdp {
    const mdp = this.require(mdpId);
    if (!this.isApproved(mdp)) throw this.notApproved(mdp);
    // COMING (2026-10-25): approved ahead of the day its country opens — the floor opens on that day.
    const country = this.countryOf(mdp);
    if (this.notOpenYet(mdp)) {
      throw new GlosError('COUNTRY_NOT_OPEN', `SeeBuyGet is not open in ${catalogueEntry(country)?.name ?? country} yet: ${mdp.name} works from the day it opens`, { country });
    }
    return mdp;
  }

  /** The same for a bag: where it stands, if that is a hub, must be one that may work. A shop's bag is the shop's to answer. */
  private workingWhereBagIs(locationId: string): void {
    const hub = this.mdps.get(locationId);
    if (hub && !this.isApproved(hub)) throw this.notApproved(hub);
  }

  private notApproved(mdp: Mdp): GlosError {
    const state = mdp.vetting?.state ?? 'draft';
    const why = state === 'pending' ? 'its papers are with SeeBuyGet' : mdp.vetting?.refusal ? 'its papers were not accepted: send them again' : 'it has not sent its papers yet';
    return new GlosError('HUB_NOT_APPROVED', `${mdp.name} is not approved yet — ${why}. A hub works once SeeBuyGet has seen its papers.`, { state });
  }

  /**
   * The hub sends its papers: a copy of the responsible person's ID, its trading licence, a photograph of the premises.
   * From `draft` only — papers with staff are not sent twice, and an approved hub has nothing to send. The controller has
   * checked each is a photograph this hub took, before this writes anything.
   */
  submitPapers(mdpId: string, papers: { idCopyRef: string; licenceRef: string; photoRefs: string[] }, now: Date = new Date()): Mdp {
    const mdp = this.require(mdpId);
    this.assertCanSend(mdp);
    if (!papers.idCopyRef || !papers.licenceRef || !papers.photoRefs?.length) throw new GlosError('KYC_INCOMPLETE', 'Send a copy of an ID, the trading licence and a photograph of the hub');
    const sent: HubPapers = { idCopyRef: papers.idCopyRef, licenceRef: papers.licenceRef, photoRefs: [...papers.photoRefs], submittedAt: now.toISOString() };
    mdp.vetting = { ...(mdp.vetting ?? { state: 'draft' }), state: 'pending', papers: sent };
    this.mdps.set(mdp.mdpId, mdp);
    return mdp;
  }

  /** Refused unless the hub is still to send its papers: asked before the photographs are taken in. */
  assertCanSend(mdp: Mdp): void {
    const state = mdp.vetting?.state ?? 'draft';
    if (state === 'pending') throw new GlosError('INVALID_STATE', 'Your papers are with SeeBuyGet already');
    if (state === 'approved') throw new GlosError('INVALID_STATE', 'This hub is approved: there are no papers to send');
  }

  /**
   * A member of staff decides, having seen the papers. Approved: the hub works from now on. Refused: back to `draft`, with
   * the reason — required, because the hub is shown it — and the papers let go, so it sends a fresh set. The hub is told.
   */
  decidePapers(mdpId: string, approve: boolean, by: string, reason?: string, now: Date = new Date()): Mdp {
    const mdp = this.require(mdpId);
    if (mdp.vetting?.state !== 'pending') throw new GlosError('INVALID_STATE', `${mdp.name} has no papers waiting for a decision`);
    const at = now.toISOString();
    // The responsible person's ID photo goes with the decision, either way (the owner, 2026-11-01: "People's ID photos only" — as a driver's since 2026-10-30); the licence and the photos of
    // the premises are the hub's record and are kept.
    this.media?.dropCheckedPaper(mdp.vetting.papers?.idCopyRef);
    if (approve) {
      const papers = mdp.vetting.papers ? { ...mdp.vetting.papers, idCopyRef: undefined, idPhotoDeletedAt: at } : undefined;
      mdp.vetting = { state: 'approved', ...(papers ? { papers } : {}), approvedAt: at, approvedBy: by };
      this.core.upsert({ did: mdp.did, tier: 2, status: 'active', capabilities: ['pudo-mdp'], metadata: { zones: mdp.zones, by } });
    } else {
      const why = reason?.trim();
      if (!why) throw new GlosError('REASON_REQUIRED', 'A refusal says why: the hub is shown it');
      mdp.vetting = { state: 'draft', refusal: { reason: why, at, by } };
    }
    this.mdps.set(mdp.mdpId, mdp);
    void this.events
      .publish(GlosEvent.Pudo.HubPapersDecided, { did: mdp.did, mdpId: mdp.mdpId, name: mdp.name, approved: approve, ...(approve ? {} : { reason: mdp.vetting.refusal?.reason }) }, { source: 'pudo' })
      .catch(() => undefined);
    return mdp;
  }

  /** Hubs whose papers wait for a member of staff, the oldest first. */
  papersQueue(): Mdp[] {
    return [...this.mdps.values()].filter((m) => m.vetting?.state === 'pending').sort((a, b) => (a.vetting?.papers?.submittedAt ?? '').localeCompare(b.vetting?.papers?.submittedAt ?? ''));
  }

  /** The hubs that may work: what anybody but the hub itself and staff is shown, and all the network routes through. */
  approvedList(): Mdp[] {
    return this.list().filter((m) => this.isApproved(m));
  }

  /**
   * The hub sets its own sort fee: public (nearby hubs compete on it), what senders are charged for each parcel it sorts,
   * and what it is paid for each (the user, 2026-10-26: "Its own fee"). Parcels already sold keep the fee they were sold
   * at. Written at once — it is money.
   */
  setPrice(mdpId: string, pricePerParcel: number): Mdp {
    if (pricePerParcel < 0) throw new GlosError('AMOUNT_INVALID', 'Price cannot be negative');
    const mdp = this.require(mdpId);
    mdp.pricePerParcel = Math.round(pricePerParcel * 100) / 100;
    this.mdps.set(mdp.mdpId, mdp);
    return mdp;
  }

  /**
   * WHAT A HUB IS PAID TO SORT A PARCEL: its own fee, in its own money — the one it advertised when the parcel was sold,
   * which is what the store paid for; its fee now where the parcel was never sold through this hub (sent another way
   * since, or sold before fees were kept per stop), or where the hub's money has changed since.
   */
  /**
   * 2026-11-06 — sent another way than its plan by whoever holds it — a store's or a business's own place — with the reason
   * said: the step and the reason kept on its plan, where it is heading kept until it arrives (RouteKeeper.leave).
   */
  sendAnotherWay(parcel: Parcel, to: string, by: string, said: OffPlanSaid): void {
    this.routeKeeper?.leave(parcel, to, by, said);
  }

  sortPayOf(mdp: Mdp, parcel: Pick<Parcel, 'stopFees'>): number {
    const sold = parcel.stopFees?.find((s) => s.type === 'mdp' && s.id === mdp.mdpId);
    return sold && sold.currency === this.currencyOf(mdp) ? sold.fee : mdp.pricePerParcel;
  }

  // --- its space (2026-11-02, the owner: "shouldn't a hub also declare its space?") ---

  /**
   * THE HUB'S OWNER SAYS ITS SPACE: how many bags can stand on its floor at once, and how many parcels it sorts in a day. Its
   * own word, as its fee is — its people read it and staff change nothing in its name (the controller says who). Bags held
   * for room here go on at once where the new number makes room for them.
   */
  setSpace(mdpId: string, input: { bagPlaces: number; sortPerDay: number }, now: number = Date.now()): HubSpaceView {
    const wrong = spaceProblem(input.bagPlaces, input.sortPerDay);
    if (wrong) throw new GlosError('INVALID_INPUT', wrong.words, { field: wrong.field });
    const mdp = this.require(mdpId);
    mdp.bagPlaces = input.bagPlaces;
    mdp.sortPerDay = input.sortPerDay;
    mdp.spaceSaidAt = new Date(now).toISOString();
    this.mdps.set(mdp.mdpId, mdp);
    this.letWaitingGo(now);
    return this.spaceOf(mdp, now);
  }

  /** Its owner has said both numbers. */
  declaresSpace(mdp: Mdp): boolean {
    return typeof mdp.bagPlaces === 'number' && mdp.bagPlaces > 0 && typeof mdp.sortPerDay === 'number' && mdp.sortPerDay > 0;
  }

  /**
   * WHAT STANDS ON A HUB'S FLOOR NOW, against what its owner said: the bags waiting to be sorted (emptied here, their parcels
   * not all in other bags yet) and the bags going out (being filled, waiting for a driver, or claimed by one who has not
   * come) — a flat empty bag takes no place; what is on its way to it; what it has sorted today, on its own clock.
   *
   * FULL is two things, and they are not the same. The FLOOR is full when the bags standing on it fill every place — what its
   * start screen says, in red past it. No room to SEND one more is the floor and what is already on its way to it together:
   * a bag offered to drivers, claimed or on the road takes its place the moment it comes, so counting only what stands there
   * would send every waiting bag the minute one place came free, and a driver would arrive at a floor fuller than ever.
   *
   * A HUB THAT HAS NOT SAID IS NEVER FULL. "Absence of a report is not clearance", turned the other way round: nobody has
   * told us its floor is full, so nothing is held back for it — bags held on a number nobody gave would strand real parcels
   * on a guess. Its start screen asks its owner instead.
   */
  spaceOf(mdp: Mdp, now: number = Date.now()): HubSpaceView {
    const inbound = this.inboundBags(mdp.mdpId).length;
    const outbound = this.outboundBags(mdp.mdpId).length;
    const onFloor = inbound + outbound;
    const comingIn = this.bagsComingTo(mdp.mdpId).length;
    const waiting = this.totes.list().filter((t) => t.waitsForRoom?.hubId === mdp.mdpId && t.status === 'available').length;
    const day = this.dayOf(mdp, now);
    const sortedToday = this.sortedOn(mdp.mdpId, day);
    const declared = this.declaresSpace(mdp);
    const places = mdp.bagPlaces ?? 0;
    const perDay = mdp.sortPerDay ?? 0;
    return {
      mdpId: mdp.mdpId,
      name: mdp.name,
      declared,
      ...(declared ? { bagPlaces: places, sortPerDay: perDay, free: Math.max(0, places - onFloor), ...(onFloor > places ? { overBy: onFloor - places } : {}) } : {}),
      ...(mdp.spaceSaidAt ? { saidAt: mdp.spaceSaidAt } : {}),
      inbound,
      outbound,
      onFloor,
      comingIn,
      waiting,
      sortedToday,
      day,
      floorFull: declared && onFloor >= places,
      dayFull: declared && sortedToday >= perDay,
      noRoom: declared && onFloor + comingIn >= places,
    };
  }

  /** The bags emptied at this hub whose parcels are not all sorted yet; the book is kept to those. */
  private inboundBags(mdpId: string): HubDrop[] {
    const book = this.floors.get(mdpId);
    if (!book?.drops.length) return [];
    const standing = book.drops.filter((d) => d.parcelIds.some((id) => this.unsortedHere(id, mdpId)));
    if (standing.length !== book.drops.length) this.floors.set(mdpId, { ...book, drops: standing });
    return standing;
  }

  /** A parcel still loose on this hub's floor: here, and in no bag yet. One sorted, sent back or gone is not. */
  private unsortedHere(parcelId: string, mdpId: string): boolean {
    try {
      const p = this.parcels.get(parcelId);
      return p.status === 'At_MDP' && p.atMdpId === mdpId && !p.toteId;
    } catch {
      return false;
    }
  }

  /** The bags on this hub's floor going out: being filled, waiting for a driver, or claimed by one who has not come. */
  private outboundBags(mdpId: string): Tote[] {
    return this.totes.atLocation(mdpId).filter((t) => t.status === 'filling' || t.status === 'available' || t.status === 'claimed');
  }

  /** The hub a bag is sent to, where it is sent to one: its address, or — a zone's bag — the hub chosen for it when offered. */
  private hubOfBag(tote: Tote): string | undefined {
    if (tote.toHubId) return tote.toHubId;
    return tote.destinationNodeId && this.mdps.has(tote.destinationNodeId) ? tote.destinationNodeId : undefined;
  }

  /** The bags on their way to this hub — offered to drivers, claimed, or on the road — none of them held for room. */
  private bagsComingTo(mdpId: string): Tote[] {
    return this.totes.list().filter((t) => !t.waitsForRoom && (t.status === 'available' || t.status === 'claimed' || t.status === 'in_transit') && t.locationId !== mdpId && this.hubOfBag(t) === mdpId);
  }

  /** Today on the hub's clock: its country's, where the country keeps one clock — UTC where it keeps several, as its hours are read. */
  private dayOf(mdp: Mdp, now: number): string {
    const clocks = clocksOfCountry(this.countryOf(mdp), now);
    return clockAt(now, clocks.length === 1 ? clocks[0] : 'UTC').day;
  }

  private sortedOn(mdpId: string, day: string): number {
    const sorted = this.floors.get(mdpId)?.sorted;
    return sorted && sorted.day === day ? sorted.count : 0;
  }

  /** A bag received here: it stands on the floor until its parcels are sorted. */
  private noteDrop(mdpId: string, code: string, parcelIds: string[], now: number): void {
    const book = this.floors.get(mdpId) ?? { mdpId, drops: [] };
    this.floors.set(mdpId, { ...book, drops: [...book.drops.filter((d) => d.code !== code), { code, parcelIds: [...parcelIds], at: new Date(now).toISOString() }] });
  }

  /**
   * One more parcel sorted here today. The parcel that fills the day's sorting tells the hub, once a day, in its bell: it
   * goes on sorting — nothing is refused — and new bags go to another hub with room today where there is one.
   */
  private noteSorted(mdp: Mdp, now: number): void {
    const day = this.dayOf(mdp, now);
    const book = this.floors.get(mdp.mdpId) ?? { mdpId: mdp.mdpId, drops: [] };
    const count = (book.sorted?.day === day ? book.sorted.count : 0) + 1;
    const fills = this.declaresSpace(mdp) && count >= (mdp.sortPerDay ?? 0) && book.dayFullToldOn !== day;
    this.floors.set(mdp.mdpId, { ...book, sorted: { day, count }, ...(fills ? { dayFullToldOn: day } : {}) });
    if (!fills) return;
    void this.notifications
      ?.notify(mdp.did, {
        kind: 'hub_space',
        title: 'Today’s sorting is full',
        body: `${mdp.name} has sorted ${count} parcels today, as many as you said it sorts in a day. Bags are still taken from every driver. New bags go to another hub for your areas where one has room today; what is not sorted today is sorted tomorrow.`,
        link: '/',
        tag: `hub-space:${mdp.mdpId}:day:${day}`,
        data: { mdpId: mdp.mdpId, day },
      })
      .catch(() => undefined);
  }

  /** The hubs that may work and serve every one of these zones, in the order they joined. */
  private hubsServing(zones: string[]): Mdp[] {
    return [...this.mdps.values()].filter((m) => zones.every((z) => m.zones.includes(z)) && this.isApproved(m) && !this.notOpenYet(m));
  }

  /**
   * OF THE HUBS THAT COULD TAKE A BAG, THE FIRST WITH ROOM (the owner: "new bags go to another approved hub that serves the
   * same zones"): room on its floor and in today's sorting first; room on its floor alone next — a full day goes on, and is
   * sorted tomorrow; none with room on its floor, and nothing: the bag waits where it is. A hub that has not said its space
   * always has room (spaceOf).
   */
  private withRoom(hubs: Mdp[], now: number): Mdp | undefined {
    const room = hubs.map((h) => ({ h, s: this.declaresSpace(h) ? this.spaceOf(h, now) : undefined })).filter(({ s }) => !s?.noRoom);
    return (room.find(({ s }) => !s?.dayFull) ?? room[0])?.h;
  }

  /**
   * WHERE A BAG GOES, WHERE IT GOES TO A HUB, AND WHETHER IT MAY GO NOW. A bag sorted for another hub may go to any approved
   * hub serving where every parcel in it is going; a bag addressed to a zone (a shop's, a dock's), to any approved hub serving
   * the zone. The one it was going to first, where that has room. Nothing for a bag going to a shop, or to a zone no hub
   * serves (it runs direct). Nothing is written: the caller keeps what this says.
   */
  private placeBag(tote: Tote, now: number): { goes: true; hub: Mdp; zoneBag: boolean } | { goes: false; current: Mdp; areas: string[] } | undefined {
    const id = tote.destinationNodeId;
    if (!id) return undefined;
    const addressed = this.mdps.get(id);
    let current: Mdp;
    let candidates: Mdp[];
    let areas: string[];
    if (addressed) {
      areas = [...new Set(tote.parcels.map((p) => this.destZoneOf(p)).filter((z): z is string => Boolean(z)))];
      const others = areas.length ? this.hubsServing(areas).filter((h) => h.mdpId !== addressed.mdpId && h.mdpId !== tote.locationId) : [];
      current = addressed;
      candidates = [addressed, ...others];
    } else {
      if (this.agents.find(id)) return undefined; // a shop: the last mile, no hub's floor on it
      const serving = this.hubsServing([id]);
      if (!serving.length) return undefined;
      current = serving.find((h) => h.mdpId === tote.toHubId) ?? serving[0];
      candidates = [current, ...serving.filter((h) => h.mdpId !== current.mdpId)];
      areas = [id];
    }
    const hub = this.withRoom(candidates, now);
    return hub ? { goes: true, hub, zoneBag: !addressed } : { goes: false, current, areas };
  }

  private destZoneOf(parcelId: string): string | undefined {
    try {
      return this.parcels.get(parcelId).destZone;
    } catch {
      return undefined;
    }
  }

  /** Keep the hub a bag was placed at: a hub's bag readdressed to it, a zone's bag given it. */
  private keepPlace(tote: Tote, hub: Mdp, zoneBag: boolean): void {
    const moved = zoneBag ? tote.toHubId !== hub.mdpId : tote.destinationNodeId !== hub.mdpId;
    if (zoneBag) {
      if (tote.toHubId !== hub.mdpId) this.totes.pointTo(tote.code, { toHubId: hub.mdpId });
    } else if (tote.destinationNodeId !== hub.mdpId) {
      this.totes.pointTo(tote.code, { destinationNodeId: hub.mdpId, destinationLabel: hub.name });
    }
    // 2026-11-06 — the hub it goes to is each parcel's next stop now: where their plans said another hub, that hub was full,
    // and the plans are made again through this one — kept, with why (movement unification). Only where the bag goes to
    // another hub than it was addressed to: a bag going where it was addressed changes no plan. A parcel put in it for
    // another way had its own reason kept as it went in, and was recorded as sent on for room when it was not.
    if (!moved) return;
    for (const parcelId of tote.parcels) {
      try {
        this.routeKeeper?.redirect(this.parcels.get(parcelId), hub.mdpId, 'room', 'system');
      } catch {
        // a parcel the bag lists and the store does not: nothing to plan
      }
    }
  }

  /**
   * A BAG PUT UP FOR DRIVERS, WHERE ITS HUB HAS ROOM (2026-11-02). Every way a bag is offered comes here — a shop's or a
   * dock's bag closed, a hub's closed, full or out of time, or let go early. Going to a hub: to one with room on its floor
   * (the one it was going to, or another approved hub for its areas), and offered. None has room: it waits where it stands,
   * offered to nobody, and whoever holds it is told — once. It goes on by itself when room frees (letWaitingGo). True when
   * it was offered.
   */
  offerBag(code: string, reason: string, now: number = Date.now()): boolean {
    const tote = this.totes.requireByCode(code);
    const placed = this.placeBag(tote, now);
    if (placed && !placed.goes) {
      if (!tote.waitsForRoom) {
        const since = new Date(now).toISOString();
        this.totes.markWaiting(code, { hubId: placed.current.mdpId, hubName: placed.current.name, since });
        this.tellHolder(tote, 'waits', placed.current, placed.areas, since);
      }
      return false;
    }
    if (placed) this.keepPlace(tote, placed.hub, placed.zoneBag);
    // Taken on ahead by a driver: theirs, and offered to nobody else (2026-11-05). Read again — keepPlace may have readdressed it.
    if (this.promisedFor?.(this.totes.requireByCode(code), now)) return true;
    void this.events.publish(GlosEvent.Pudo.ToteAvailable, { code, reason, weightKg: tote.weightKg, destination: tote.destinationLabel }, { source: 'pudo' }).catch(() => undefined);
    return true;
  }

  /**
   * ROOM FREED: THE BAGS HELD FOR IT GO ON BY THEMSELVES, OLDEST FIRST (the owner: "whoever is waiting is told"). Asked
   * wherever a hub's floor can have changed — a parcel sorted, a bag dropped or collected, its owner raising its places — and
   * by the dispatch sweep. Each placed again: to the hub it waits for where that has room now, to another where that has, or
   * it keeps waiting. Each let go is offered to drivers and its holder told. The codes let go.
   */
  letWaitingGo(now: number = Date.now()): string[] {
    const waiting = this.totes
      .list()
      .filter((t) => t.waitsForRoom && t.status === 'available')
      .sort((a, b) => a.waitsForRoom!.since.localeCompare(b.waitsForRoom!.since) || a.code.localeCompare(b.code));
    const gone: string[] = [];
    for (const tote of waiting) {
      const placed = this.placeBag(tote, now);
      if (placed && !placed.goes) continue;
      const since = tote.waitsForRoom!.since;
      this.totes.markWaiting(tote.code, undefined);
      if (placed) this.keepPlace(tote, placed.hub, placed.zoneBag);
      if (placed) this.tellHolder(tote, 'goes', placed.hub, [], since);
      // Taken on ahead by a driver: theirs now (2026-11-05).
      if (this.promisedFor?.(this.totes.requireByCode(tote.code), now)) {
        gone.push(tote.code);
        continue;
      }
      void this.events.publish(GlosEvent.Pudo.ToteAvailable, { code: tote.code, reason: 'room', weightKg: tote.weightKg, destination: tote.destinationLabel }, { source: 'pudo' }).catch(() => undefined);
      gone.push(tote.code);
    }
    return gone;
  }

  /**
   * Whoever holds a bag held for room, or let go on, told in their bell — never a text — with the way to their bags: a
   * hub's load screen, a shop's bags, a store's dock.
   */
  private tellHolder(tote: Tote, what: 'waits' | 'goes', hub: Mdp, areas: string[], since: string): void {
    if (!this.notifications) return;
    const atHub = this.mdps.get(tote.locationId);
    const did = atHub ? atHub.did : tote.locationId;
    const link = atHub ? '/?go=load' : this.agents.find(tote.locationId) ? '/?go=bag' : '/?go=dock';
    const where = areas.length ? areas.join(', ') : (tote.destinationLabel ?? 'its area');
    const words =
      what === 'waits'
        ? {
            title: `Bag ${tote.code} waits for room at ${hub.name}`,
            body: `${hub.name} has no room on its floor for another bag, and no other hub for ${where} has room either. Keep bag ${tote.code} where it is: it is offered to drivers again by itself when there is room, and you are told then.`,
          }
        : { title: `Bag ${tote.code} can go on`, body: `There is room for it now: bag ${tote.code} goes to ${hub.name}, and is offered to drivers again.` };
    void this.notifications
      .notify(did, { kind: 'hub_space', ...words, link, tag: `hub-space:${tote.code}:${what}:${since}`, data: { code: tote.code, mdpId: hub.mdpId } })
      .catch(() => undefined);
  }

  list(): Mdp[] {
    return [...this.mdps.values()];
  }

  require(mdpId: string): Mdp {
    const mdp = this.mdps.get(mdpId);
    if (!mdp) throw new GlosError('NOT_FOUND', `MDP not found: ${mdpId}`);
    return mdp;
  }

  /**
   * The hub that last-mile-serves a delivery zone (the regional sort centre for that zone) — and where several do, the
   * first with room (2026-11-02: placeBag's rule, read by the plan, the sort and the driver's offer alike). One hub for a
   * zone is that zone's hub, full or not: a bag for it waits for it, it is never sent anywhere else.
   */
  mdpForZone(zone: string, now: number = Date.now()): Mdp | undefined {
    // Only a hub that may work: one not yet approved is chosen for nothing, so nothing is routed to it — nor one in a
    // country not open yet, whose floor opens the day it does.
    const serving = this.hubsServing([zone]);
    if (serving.length < 2) return serving[0];
    return this.withRoom(serving, now) ?? serving[0];
  }

  /** COMING (2026-10-25): signed up where SeeBuyGet takes sign-ups and is not open yet. Only COMING — see DriverService. */
  notOpenYet(mdp: Mdp): boolean {
    return this.presence.resolve(this.countryOf(mdp)).level === 'coming';
  }

  /** Register a fresh laminated tote into the pool at this MDP. */
  registerTote(mdpId: string): Tote {
    const hub = this.working(mdpId);
    // Round 39 — a new tote is new work: not without the hub's security declaration in force.
    this.declarations?.assertHubMayOpen(hub.did, hub.name);
    return this.totes.register(mdpId);
  }

  // --- bag flow at a SHOP (tote genesis at the origin PUDO) ---

  /**
   * A shop opens a bag for one destination zone, so its outbound parcels leave as ONE scan instead of
   * a dozen. Bag genesis used to be MDP-only, which left the busiest hand-over in the network — a
   * shopkeeper and a waiting driver at a counter — working parcel by parcel.
   *
   * The bag is homed at the shop and addressed to the next hop the bag plan names: a zone, where the corridor decides the
   * rest, or the hub the route runs through.
   */
  openShopBag(agentDid: string, destZone: string): Tote {
    this.agents.get(agentDid); // 404 for an unknown shop
    if (!destZone?.trim()) throw new GlosError('FIELD_REQUIRED', 'A bag needs a destination');
    // 2026-11-05 — a route through a hub: the bag plan's next hop is the hub's id. Addressed to it as a hub's bag is
    // (assignTote: an approved hub only), and called by its name — its id was the label a driver and a tracking page read.
    const hub = this.mdps.get(destZone.trim());
    if (hub && !this.isApproved(hub)) throw this.notApproved(hub);
    // 2026-11-06 — or the shop a direct route runs to (the bag plan's group, by the parcels' plans): called by its name, and
    // received there (deliverBag takes a bag addressed to that shop). Never to this shop itself: a parcel collected here stays.
    const shop = hub ? undefined : this.agents.find(destZone.trim());
    if (shop?.did === agentDid) throw new GlosError('INVALID_INPUT', 'A bag goes to another place: a parcel collected at this shop stays on its shelf here', { field: 'destZone' });
    // A bag is a physical object standing on a floor, and floors run out. The shelf has always been sized by
    // the shop; this is the same declaration for the other pile in the room. Counted as what is STANDING
    // there — filling, sealed and waiting, or claimed by a driver who has not arrived — because all three
    // take up the same square metre. A flat, unassigned tote takes none.
    this.assertStagingRoom(agentDid);
    const tote = this.totes.register(agentDid);
    // sealRequired: this bag leaves the shop when the SHOPKEEPER says it is closed, never when a sweep
    // decides it looks full. A bag on a counter is open until a human shuts it.
    return this.totes.assign(tote.code, destZone.trim(), hub ? hub.name : shop ? shop.shopName : destZone.trim(), { sealRequired: true });
  }

  /** The bags physically taking up room at this shop right now (see openShopBag for why these three). */
  stagedBags(agentDid: string): Tote[] {
    return this.totes.atLocation(agentDid).filter((t) => t.status === 'filling' || t.status === 'available' || t.status === 'claimed');
  }

  /**
   * Address a bag to its next destination — the generic route, which a HUB uses freely.
   *
   * A bag becomes staged the moment it is addressed, not when it is registered (a flat, unassigned tote
   * takes no floor room), so the shop's bay limit has to be applied here too. Otherwise the limit is walked
   * around by opening a bare tote and addressing it afterwards, which is two calls the same app can make.
   */
  assignTote(code: string, destinationNodeId: string, destinationLabel: string): Tote {
    const tote = this.totes.requireByCode(code);
    this.workingWhereBagIs(tote.locationId);
    const toHub = this.mdps.get(destinationNodeId);
    if (toHub && !this.isApproved(toHub)) throw this.notApproved(toHub);
    const shop = this.agents.list().find((a) => a.did === tote.locationId);
    if (shop) this.assertStagingRoom(shop.did);
    return this.totes.assign(code, destinationNodeId, destinationLabel);
  }

  /**
   * 2026-11-06 — A SHOP'S ROOM FOR BAGS, as the shop declared it (the owner: "open bags need space to work around, but full
   * bags can be kept in any empty corner"): the bags it works on at once (`places`), and the closed bags it can keep waiting
   * for a driver in a corner (`corner`). A closed bag the corner has no room for stands where it was filled and takes one of
   * the places. So `free` — the bags it may open now — is the places less the open bags and the closed ones on the floor.
   * A shop that has not said has no corner: every closed bag stands on the floor, as every bag was counted before.
   */
  bagRoomOf(agentDid: string): { places: number; open: number; closed: number; corner: number; onFloor: number; free: number } {
    const agent = this.agents.get(agentDid);
    const places = this.agents.bagBaysOf(agent);
    const corner = this.agents.closedBagRoomOf(agent);
    const staged = this.stagedBags(agentDid);
    const open = staged.filter((t) => t.status === 'filling').length;
    const closed = staged.length - open;
    const onFloor = Math.max(0, closed - corner);
    return { places, open, closed, corner, onFloor, free: Math.max(0, places - open - onFloor) };
  }

  /** Refuse a new bag when the shop's floor is already carrying as many as it declared it can. Closing one is never refused. */
  private assertStagingRoom(agentDid: string): void {
    const room = this.bagRoomOf(agentDid);
    if (room.free > 0) return;
    // Said as it is: its open bags fill the places, or closed bags the corner has no room for stand in them.
    const why =
      room.onFloor === 0
        ? `This shop has room for ${room.places} bag(s) open at once and ${room.open} are open — close one first, or raise your bag space under Set up shelves`
        : room.corner === 0
          ? `This shop has room for ${room.places} bag(s) and ${room.open + room.onFloor} are on the floor — hand one to a driver, or under Set up shelves say how many closed bags you can keep in a corner`
          : `This shop has room for ${room.places} bag(s) on its floor, and its corner for closed bags is full (${room.corner}): ${room.onFloor} more closed bag(s) stand where you work — hand one to a driver, or say you have more room under Set up shelves`;
    throw new GlosError('STAGING_FULL', why, { capacity: room.places, used: room.open + room.onFloor, open: room.open, closed: room.closed, corner: room.corner });
  }

  /**
   * 2026-11-06 — the shop told, in its bell, when its corner for closed bags has just filled: no bag stands in it any more, the
   * next closed one takes a place it works in, and drivers are what empties it. Once as it fills — not at every bag after.
   * A shop that has said it has no corner is not told: its closed bags stand where they were filled, as they always have.
   */
  private tellCornerFull(agentDid: string, before: number): void {
    const room = this.bagRoomOf(agentDid);
    if (!this.notifications || room.corner === 0 || before >= room.corner || room.closed < room.corner) return;
    const shop = this.agents.get(agentDid);
    void this.notifications
      .notify(shop.did, {
        kind: 'bag_room',
        title: 'Your corner for closed bags is full',
        body: `${room.closed} closed bags are waiting for drivers, as many as you said your corner holds. The next one you close stands where you work, and you can open ${room.free} more now. Each one a driver takes makes room again.`,
        link: '/?go=bag',
        tag: `bag-room:${agentDid}:${new Date().toISOString().slice(0, 13)}`,
        data: { closed: room.closed, corner: room.corner },
      })
      .catch(() => undefined);
  }

  /**
   * Drop one of the shop's waiting parcels into its open bag.
   *
   * The check the generic fillTote cannot make: **a parcel may only go in a bag that is going where the
   * parcel is going.** fillTote guards capacity and cargo compatibility, and is shared with MDP sorting
   * where a bag is addressed to a NEXT HOP rather than a final zone — so the destination rule belongs
   * here, on the shop path, where both sides mean the same thing.
   *
   * Without it a parcel for one city rides to another in a sealed bag, and nothing notices: the seal gate
   * only checks that everything EXPECTED is in the bag, never that everything in the bag BELONGS.
   */
  fillShopBag(code: string, agentDid: string, parcelId: string, observedAt?: string, said?: OffPlanSaid): { tote: Tote; fillPct: number } {
    const bag = this.totes.requireByCode(code);
    if (bag.locationId !== agentDid) throw new GlosError('WRONG_PUDO', `Bag ${code} was not opened at this shop`);
    if (bag.status !== 'filling') throw new GlosError('INVALID_STATE', `Bag ${code} is ${bag.status}, it is closed`);

    const parcel = this.parcels.get(parcelId);
    if (parcel.originAgentDid !== agentDid || parcel.status !== 'At_PUDO') {
      throw new GlosError('INVALID_STATE', `Parcel ${parcelId} is not waiting at this shop`);
    }
    // 2026-11-06 — a parcel with a plan is asked its way by fillTote (refused, or put in with a reason said); one without,
    // here as before.
    if (!this.routeKeeper?.nextStop(parcel) && !this.belongsInShopBag(parcel, bag)) {
      throw new GlosError(
        'WRONG_DESTINATION',
        `${parcelId} is going to ${parcel.destZone}, but this bag goes to ${bag.destinationLabel}`,
        { parcelId, parcelDest: parcel.destZone, bagDest: bag.destinationLabel },
      );
    }
    // One parcel, one bag. A parcel stays At_PUDO until the driver takes the bag, so a sealed bag still on
    // the shop floor would happily let its contents be scanned into the NEXT bag — and then two manifests
    // both claim it. Checked across every bag at this shop, not off parcel.toteId, which can be stale.
    const holder = this.totes.list({ locationId: agentDid }).find((t) => t.parcels.includes(parcelId));
    if (holder) {
      throw new GlosError('ALREADY_IN_BAG', `Parcel ${parcelId} is already in bag ${holder.code}`, {
        parcelId,
        bagCode: holder.code,
        sameBag: holder.code === code,
      });
    }
    return this.fillTote(code, parcelId, observedAt, said, agentDid);
  }

  /**
   * Seal the bag: the shop's commitment about what is going.
   *
   * This is where the S25 completeness gate moves for a bagged hand-over, and it has to move, because
   * loadBag is ATOMIC and driver-initiated — a bag holding three of the five parcels waiting for that
   * bus would otherwise sail through with no INCOMPLETE_MANIFEST and no short-ship record, making a bag
   * a way to leave parcels behind quietly. The check belongs with the person who can actually fix it:
   * the shopkeeper, before the driver arrives.
   *
   * Everything waiting at this shop for the bag's destination goes in, or is knowingly left — and a
   * knowing omission is stamped exactly as handover stamps it, so the control tower sees the same thing
   * either way. Nothing is mutated on the refusal path.
   *
   * Sealing is also what TELLS the network: it publishes the bag AND pings the drivers near the shop, so
   * the fast path (the shop says "it is ready now") reaches a driver, which is the whole point of closing
   * it early. An ALREADY published bag can still be sealed — a bag published by the old sweep, or by a
   * manual release, must not lock its shop out of the completeness gate — it is reconciled and stamped,
   * but not re-announced.
   */
  sealShopBag(code: string, agentDid: string, input: { acknowledgeShortShip?: boolean; shortShipReason?: string; observedAt?: string; closure?: { seal?: string; photoRef?: string }; by?: string } = {}): { tote: Tote; parcels: string[]; missed: string[]; shortShipped: boolean } {
    const bag = this.totes.requireByCode(code);
    if (bag.locationId !== agentDid) throw new GlosError('WRONG_PUDO', `Bag ${code} was not opened at this shop`);
    // Closed once. A second seal would re-run the gate against parcels dropped off AFTER the bag was shut
    // and short-ship them for missing a bus they were never on.
    if (bag.sealedAt) throw new GlosError('INVALID_STATE', `Bag ${code} is already closed`);
    if (bag.status !== 'filling' && bag.status !== 'available') {
      throw new GlosError('INVALID_STATE', `Bag ${code} is ${bag.status}, it can no longer be closed`);
    }

    const inBag = new Set(bag.parcels);
    // 2026-11-05 — a parcel already in ANOTHER bag at this shop (closed and waiting for its driver, say) is not on the shelf:
    // it was counted as missed, and leaving it "on purpose" marked it short-shipped while it sat in the first bag. Read from
    // the bags themselves, as ALREADY_IN_BAG is — parcel.toteId can be stale.
    const inOtherBags = new Set(this.totes.list({ locationId: agentDid }).filter((t) => t.code !== bag.code).flatMap((t) => t.parcels));
    const expected = this.parcels
      .list({ status: 'At_PUDO', agentDid })
      // round 35 — a held parcel is not missed. 2026-11-05 — matched by where it goes next, as it is filled (belongsInShopBag).
      .filter((p) => p.originAgentDid === agentDid && !p.held && !inOtherBags.has(p.parcelId) && this.belongsInShopBag(p, bag))
      .map((p) => p.parcelId);
    const missed = expected.filter((id) => !inBag.has(id));

    if (missed.length && !input.acknowledgeShortShip) {
      throw new GlosError(
        'INCOMPLETE_MANIFEST',
        `${missed.length} parcel(s) for ${bag.destinationLabel} are still on the shelf — bag them, or leave them on purpose.`,
        { missed, expected, code },
      );
    }
    // Round 36 — closed for the road: its coded seal's number and a photograph, or a photograph alone. Checked with the
    // rest, before anything is written.
    const shopName = this.agents.get(agentDid).shopName;
    const keepClosure = this.closures.checkClose(bag, { did: agentDid, name: input.by?.trim() || shopName, place: shopName }, agentDid, input.closure);
    // Closed when the shop closed it (round 23): a seal kept on the phone with no signal is dated then, never before the
    // bag was first filled; the parcels it left behind were left behind at that moment.
    const sealed = handedAt(input.observedAt, Date.now(), [bag.filledAt, bag.availableAt]);
    if (missed.length) this.parcels.markShortShipped(missed, agentDid, `bag ${code}`, (input.shortShipReason ?? '').trim() || 'not bagged', input.observedAt, [bag.filledAt, bag.availableAt]);

    // Sealed = published to the marketplace, so a driver can claim it and arrive knowing it is one scan.
    const announce = bag.status === 'filling'; // an already-published bag was announced when it was published
    const closedBefore = this.bagRoomOf(agentDid).closed;
    const tote = announce ? this.totes.markAvailable(code, sealed.at) : bag;
    this.totes.markSealed(code, sealed);
    keepClosure(sealed);
    // 2026-11-06 — closed: into the corner, if it has room. Filled by this one, the shop is told.
    if (announce) this.tellCornerFull(agentDid, closedBefore);
    // …and tell the drivers near the shop. Without this the shop's deliberate "it is ready NOW" was the
    // only publish in the network that pinged nobody, while the passive 24 h sweep did. 2026-11-02 — offered where its hub
    // has room; held at the counter, and the shop told, where none has (offerBag).
    if (announce) this.offerBag(tote.code, 'sealed');
    return { tote, parcels: [...bag.parcels], missed, shortShipped: missed.length > 0 };
  }

  /**
   * Round 36 — CLOSING A BAG FOR THE ROAD where it stands: a hub's bag, or a bag at a shop that is not the shop's own
   * bag (that one is closed with "Close the bag", where the shop's completeness check runs). Its coded seal and a
   * photograph, or a photograph alone; then nothing more goes in, and a bag still filling is offered to drivers.
   */
  closeBag(code: string, place: { shopDid?: string; mdpId?: string }, byName: string | undefined, closure: { seal?: string; photoRef?: string } | undefined, observedAt?: string): { tote: Tote; closedWith: BagClosureKind } {
    const bag = this.totes.requireByCode(code);
    const hub = place.mdpId ? this.working(place.mdpId) : undefined;
    const placeId = hub ? hub.mdpId : place.shopDid;
    if (!placeId || bag.locationId !== placeId) throw new GlosError('WRONG_PUDO', `Bag ${code} is not here`);
    if (bag.sealRequired) throw new GlosError('INVALID_STATE', `Bag ${code} is the shop's own bag: close it with “Close the bag”, where the shop's check runs`);
    if (bag.status !== 'filling' && bag.status !== 'available' && bag.status !== 'claimed') throw new GlosError('INVALID_STATE', `Bag ${code} is ${bag.status}: there is nothing here to close`);
    const HELD = bag.held;
    if (HELD) throw new GlosError('UNIT_HELD', `Bag ${code} is held: ${FINDING_WORDS[HELD.finding]} (${HELD.where}). Keep it closed: operations has been told and releases it.`, { exceptionId: HELD.exceptionId });
    const placeName = hub ? hub.name : this.agents.get(placeId).shopName;
    const ownerDid = hub ? hub.did : placeId;
    // Round 39 — a bag leaves a hub rated high only on a coded seal: asked before anything is written.
    if (hub) this.risk?.assertHubSeal(hub, closure);
    const keep = this.closures.checkClose(bag, { did: ownerDid, name: byName?.trim() || placeName, place: placeName }, ownerDid, closure);
    const step = handedAt(observedAt, Date.now(), [bag.filledAt, bag.availableAt]);
    const announce = bag.status === 'filling';
    if (announce) this.totes.markAvailable(code, step.at);
    const closed = keep(step);
    // 2026-11-02 — offered where the hub it goes to has room; held where it stands, its holder told, where none has.
    if (announce) this.offerBag(code, 'sealed');
    return { tote: this.totes.requireByCode(code), closedWith: closed.kind };
  }

  /**
   * Round 37 — A DRIVER READS THE BAG THEY CARRY, after a hub or shop scanned their pass to load it: the number off the
   * seal, a photograph, as it was closed. Until they have, nobody receives it (BagClosureService.checkReceipt).
   */
  takeBag(code: string, driverDid: string, name: string | undefined, reading: { sealNumber?: string; photoRef?: string; asClosed?: boolean } | undefined, observedAt?: string): { code: string; taken: true } {
    const bag = this.totes.requireByCode(code);
    if (bag.status !== 'in_transit' || bag.carriedBy !== driverDid) throw new GlosError('NOT_FOUND', 'No bag you carry has that code');
    const HELD = bag.held;
    if (HELD) throw new GlosError('UNIT_HELD', `Bag ${code} is held: ${FINDING_WORDS[HELD.finding]} (${HELD.where}). Keep it closed: operations has been told and releases it.`, { exceptionId: HELD.exceptionId });
    const keep = this.closures.checkTake(bag, { did: driverDid, name: name?.trim() || 'the driver', place: 'the driver' }, driverDid, reading);
    keep(handedAt(observedAt, Date.now(), [bag.availableAt, bag.sealedAt]));
    return { code, taken: true };
  }

  // --- bag flow ---

  /** Pack a parcel into a bag bound for a destination (used at the origin PUDO and after sorting). */
  fillTote(code: string, parcelId: string, observedAt?: string, said?: OffPlanSaid, by?: string): { tote: Tote; fillPct: number } {
    this.workingWhereBagIs(this.totes.requireByCode(code).locationId); // a bag at a hub that may not work takes nothing
    const parcel = this.parcels.get(parcelId);
    this.parcels.refuseIfHeld(parcel); // round 35 — set apart: into no bag
    // S31: this worker chose a specific bag — refuse to drop in a parcel whose cargo is incompatible with the
    // bag's current contents (cement dust into a fresh-produce bag). The bag stays internally compatible, so
    // loadBag can trust it later. sortParcel auto-routes around this; here the bag is explicit, so we throw.
    const bag = this.totes.requireByCode(code);
    if (!this.bagAccepts(parcel.natureCode ?? 'GEN', bag.parcels)) {
      throw new GlosError('CARGO_INCOMPATIBLE', `Parcel ${parcelId} cannot share bag ${code} — its cargo is incompatible with the bag's contents`);
    }
    // 2026-11-06 — ITS NEXT STOP BY ITS PLAN (movement unification): into a bag going elsewhere only with the reason said.
    const offPlan = this.offPlanInto(parcel, bag);
    if (offPlan && !said) {
      throw new GlosError('OFF_PLAN', `${parcelId} goes to ${offPlan.label} next by its plan, not ${bag.destinationLabel ?? bag.destinationNodeId}. Put it in the bag for ${offPlan.label} — or say why it goes this way.`, { parcelId, planned: offPlan.id, plannedLabel: offPlan.label, bag: code });
    }
    // Bagged when it was bagged (round 23): never before the parcel's own last step — it was not here to bag before then.
    const tote = this.totes.add(code, parcelId, parcel.size, this.parcels.stepOf(parcelId, observedAt));
    if (offPlan && said) this.routeKeeper!.leave(parcel, bag.destinationNodeId!, by ?? bag.locationId, said);
    this.parcels.get(parcelId).toteId = tote.toteId; // connect parcel ↔ bag (still where it was)
    // 2026-11-05 — in a bag now, off the shelf slot it waited on at its shop: the slot is free for the next one.
    this.parcels.leftShelf(parcelId);
    return { tote, fillPct: this.totes.fillPct(tote) };
  }

  /** Scan a bag onto a bus — one scan moves the whole tote and every parcel in it to On_Bus.
   * When the badge resolves to a registered fleet vehicle, the bag must fit that vehicle's limits
   * (a bike/motorcycle feeder takes ≤ its capacity and no fragile items). Unknown badges pass through. */
  loadBag(code: string, driverBadgeId: string, observedAt?: string, take?: { driverDid: string; name?: string; reading: { sealNumber?: string; photoRef?: string; asClosed?: boolean } | undefined }): { tote: Tote; moved: string[] } {
    const pending = this.totes.requireByCode(code);
    this.workingWhereBagIs(pending.locationId);
    // Round 35 — a bag moves whole: one held parcel in it and it does not move, refused before anything is written.
    for (const id of pending.parcels) this.parcels.refuseIfHeld(this.parcels.get(id));
    // Round 36 — a bag leaves closed (its coded seal on, or photographed closed), and never while it is held.
    const HELD = pending.held;
    if (HELD) throw new GlosError('UNIT_HELD', `Bag ${code} is held: ${FINDING_WORDS[HELD.finding]} (${HELD.where}). Keep it closed: operations has been told and releases it.`, { exceptionId: HELD.exceptionId });
    // 2026-11-02 — held for room at the hub it goes to: it stays where it is (the owner: "they wait at the shop or hub they
    // are at"), handed to no driver across a counter either, until it goes on by itself.
    const WAITS = pending.waitsForRoom;
    if (WAITS) throw new GlosError('BAG_WAITS_FOR_ROOM', `Bag ${code} waits for room at ${WAITS.hubName}: keep it here. It is offered to drivers again by itself when there is room, and you are told.`, { hubId: WAITS.hubId });
    // Round 39 — nothing new onto a rider whose security declaration (or whose fleet's) is not in force: said before the bag's
    // own state, because no closing of the bag makes it signed.
    const fleet = this.fleet.resolveBadge(driverBadgeId);
    if (fleet) this.declarations?.assertMayCarry(fleet.driverDid, Date.now(), true);
    if (!pending.closureId) throw new GlosError('BAG_NOT_CLOSED', `Close bag ${code} first: put a coded seal on it and photograph it, or photograph it closed`);
    // Round 39 — a corridor or a hub rated high: a bag goes onto it only on a coded seal, and nothing at night.
    if (this.risk) {
      const hereHub = this.mdps.get(pending.locationId);
      const country = hereHub ? this.countryOf(hereHub) : this.agents.find(pending.locationId) ? this.agents.countryOf(this.agents.get(pending.locationId)) : undefined;
      if (hereHub) this.risk.assertHubDay(hereHub, country);
      const corridorId = fleet?.corridorId ?? this.corridors?.driverByBadge(driverBadgeId)?.corridorId;
      const corridor = corridorId ? this.corridors?.listCorridors().find((c) => c.corridorId === corridorId) : undefined;
      this.risk.assertCorridorAllows(corridor, { bagSealed: this.closures.current(pending)?.kind === 'seal', country });
    }
    // Round 38 — a new independent rider carries no more than their company's cap: the bag counts every parcel in it.
    if (fleet) this.parcels.assertRiderWithinCap(fleet.driverDid, pending.parcels.length);
    // A claimed bag may only be loaded by the driver who claimed it.
    if (pending.claimedBy && (!fleet || fleet.driverDid !== pending.claimedBy)) throw new GlosError('BAG_RESERVED', `Bag ${code} is reserved for another driver`);
    // S31: this is the tote/MDP mixing point — the second place cargo rides a vehicle. A bag loads ATOMICALLY
    // (one scan moves every parcel), so unlike handover it cannot short-ship one parcel — it accepts or refuses
    // the WHOLE bag. Two gates: (1) an internal-compatibility BACKSTOP (defence in depth — sortParcel/fillTote
    // already keep a bag internally compatible, so this should never fire, but a legacy/hand-built bag might);
    // (2) the vehicle must satisfy every capability the bag's cargo requires (perishable → cold chain,
    // hazardous → hazmat), mirroring handover's per-parcel capability check.
    // KNOWN LIMITATION (shared with handover, deferred to the vehicle-manifest / digital-twin work): neither
    // path checks a newly-loaded bag against cargo ALREADY on the vehicle from a PRIOR load — compatibility is
    // guaranteed WITHIN one load operation, not across a vehicle's whole live manifest.
    if (pending.parcels.length) {
      for (let i = 0; i < pending.parcels.length; i++) {
        for (let j = i + 1; j < pending.parcels.length; j++) {
          if (!this.cargo.canShareVehicle(this.natureOf(pending.parcels[i]), this.natureOf(pending.parcels[j]))) {
            throw new GlosError('CARGO_INCOMPATIBLE', `Bag ${code} mixes incompatible cargo — re-sort it before loading`);
          }
        }
      }
    }
    if (fleet && pending.parcels.length) {
      let kg = 0;
      for (const id of pending.parcels) {
        const p = this.parcels.get(id);
        kg += p.weightKg;
        if (p.weightKg > fleet.maxParcelKg) throw new GlosError('CAPACITY_EXCEEDED', `Parcel ${id} (${p.weightKg}kg) exceeds the ${fleet.maxParcelKg}kg limit of this ${fleet.vehicle.vehicleClass}`);
        if (p.fragile && !fleet.allowsFragile) throw new GlosError('FRAGILE_NOT_ALLOWED', `A ${fleet.vehicle.vehicleClass} cannot carry fragile parcels (${id})`);
      }
      // Every capability the bag's cargo needs must be present on the vehicle, else the whole bag is refused.
      for (const cap of this.toteRequiredCapabilities(pending)) {
        if (!fleet.vehicle[cap]) throw new GlosError('VEHICLE_MISSING_CAPABILITY', `A ${fleet.vehicle.vehicleClass} lacks ${cap} that bag ${code}'s cargo requires`);
      }
      // 2026-11-03 — a bag of chilled parcels, beside a load aboard kept at a temperature the two cannot share one body at.
      const cold = this.coldOf?.(fleet.driverDid, pending.code);
      if (cold) throw new GlosError('CARGO_INCOMPATIBLE', `Bag ${code}: ${cold}`);
      if (kg > fleet.capacityKg) throw new GlosError('CAPACITY_EXCEEDED', `Bag ${code} (${kg}kg) exceeds this ${fleet.vehicle.vehicleClass}'s ${fleet.capacityKg}kg capacity`);
      // …and against what is aboard already: a counter loading by the driver's pass loads onto a vehicle that may be half
      // full, and a bag weighed against an empty one could overload it. A bag this driver already holds is counted in what
      // they hold, so it is given back before it is weighed.
      const left = this.roomOf?.(fleet.driverDid);
      const heldKg = pending.claimedBy === fleet.driverDid || pending.carriedBy === fleet.driverDid ? pending.weightKg : 0;
      if (left !== undefined && kg > left + heldKg) {
        const aboard = Math.round((fleet.capacityKg - left - heldKg) * 100) / 100;
        throw new GlosError('CAPACITY_EXCEEDED', `This ${fleet.vehicle.vehicleClass} is carrying ${aboard} kg of its ${fleet.capacityKg} kg: bag ${code} (${kg} kg) does not fit — drop something before loading it`);
      }
    }
    // And room in the hold for one more BAG. This is the moment the bag physically goes in, so it is the last
    // honest place to refuse it: a bus whose boot is full is full whatever the scales say. Counted over what
    // this driver is already carrying, and only for a bag they have NOT already reserved (a claimed bag was
    // counted the moment it was claimed — loading it must not charge for the same space twice).
    if (fleet) {
      // Claimed OR carried. Counting claims alone let a driver be handed bag after bag across a counter
      // while the vehicle's capacity read zero — a physical limit that could be exceeded silently.
      const held = this.totes.list().filter((t) => (t.claimedBy === fleet.driverDid || t.carriedBy === fleet.driverDid) && (t.status === 'claimed' || t.status === 'in_transit')).length;
      const capacity = toteCapacityOf(fleet.vehicle);
      const alreadyMine = pending.claimedBy === fleet.driverDid || pending.carriedBy === fleet.driverDid;
      if (!alreadyMine && held >= capacity) {
        throw new GlosError('CAPACITY_EXCEEDED', `This ${fleet.vehicle.vehicleClass} is carrying all ${capacity} bag(s) it holds — drop one before loading bag ${code}`);
      }
    }
    // Round 37 — a driver loading it themselves takes it on its seal: read, photographed, as it was closed. Checked last,
    // after every other refusal and before anything is written; kept once it is on the vehicle.
    const keepTake = take ? this.closures.checkTake(pending, { did: take.driverDid, name: take.name?.trim() || 'the driver', place: 'the driver' }, take.driverDid, take.reading) : undefined;
    // Loaded when it was loaded (round 23), never before the bag was filled, published or sealed.
    const after = [pending.filledAt, pending.availableAt, pending.sealedAt];
    const offHubFloor = this.mdps.has(pending.locationId); // read before the load moves it onto the vehicle
    const tote = this.totes.load(code, driverBadgeId, fleet?.driverDid);
    keepTake?.(handedAt(observedAt, Date.now(), after));
    for (const parcelId of tote.parcels) {
      this.parcels.setTransit(parcelId, 'On_Bus', driverBadgeId, `bag ${tote.code} → ${tote.destinationLabel ?? tote.destinationNodeId}`, tote.toteId, { observedAt, after });
      // Graduation: the tote path must raise HANDOVER on the M4 timeline like the direct handover does.
      void this.events.publish(GlosEvent.Pudo.ParcelHandedToBus, { parcelId, driverBadgeId, toteCode: tote.code }, { source: 'pudo' }).catch(() => undefined);
    }
    if (fleet) this.gate.payBagLoad(fleet.driverDid); // for scanning it aboard, at the driver's own company's figure
    void this.events.publish(GlosEvent.Pudo.BagLoaded, { toteId: tote.toteId, code: tote.code, driverBadgeId, destinationNodeId: tote.destinationNodeId, parcels: tote.parcels.length }, { source: 'pudo' }).catch(() => undefined);
    // 2026-11-02 — a bag collected off a hub's floor frees its place: bags held for room there go on.
    if (offHubFloor) this.letWaitingGo();
    return { tote, moved: [...tote.parcels] };
  }

  /**
   * A bus drops a bag at this MDP → scan the bag code, empty it; parcels become unsorted (At_MDP).
   *
   * 2026-11-02 — NEVER REFUSED FOR ROOM (the owner: "a driver is never turned away at the door with bags in hand"): a floor
   * past its places takes the bag all the same, and says so in red on the hub's start screen (spaceOf.overBy). The bag
   * stands on the floor until its parcels are sorted.
   */
  dropBag(mdpId: string, code: string, receipt: { sealNumber?: string; photoRef?: string; asClosed?: boolean } | undefined, byName?: string, now: number = Date.now()): { mdpId: string; emptied: string[]; offPlan?: Array<{ parcelId: string; planned: string }> } {
    const mdp = this.working(mdpId);
    const before = this.totes.requireByCode(code);
    if (!before.parcels.length) throw new GlosError('BAG_EMPTY', `Bag ${code} is already empty`);
    for (const id of before.parcels) this.parcels.refuseIfHeld(this.parcels.get(id)); // round 35 — the bag moves whole
    // Round 36 — received on its seal: a photograph as it arrived, the number read off it, as it was closed. Before it opens.
    const HELD = before.held;
    if (HELD) throw new GlosError('UNIT_HELD', `Bag ${code} is held: ${FINDING_WORDS[HELD.finding]} (${HELD.where}). Keep it closed: operations has been told and releases it.`, { exceptionId: HELD.exceptionId });
    const keepReceipt = this.closures.checkReceipt(before, { did: mdp.did, name: byName?.trim() || mdp.name, place: mdp.name }, mdp.did, receipt);
    const carrier = before.claimedBy; // captured before empty() clears it, as deliverBag does
    keepReceipt({ at: new Date().toISOString() });
    const { parcels } = this.totes.empty(code, mdpId);
    this.payHaul(before, carrier);
    // 2026-11-06 — each kept, and planned on from here; those its plan did not have coming here, nobody having said why, are
    // said to the hub (its drop screen): not its fault, and planned on from here — sorted as the screen says.
    const offPlan: Array<{ parcelId: string; planned: string }> = [];
    for (const parcelId of parcels) {
      const p = this.parcels.setTransit(parcelId, 'At_MDP', mdp.name, `dropped at ${mdp.name} · awaiting sort`, undefined);
      p.atMdpId = mdpId; // scope the inbound queue to this hub
      const off = this.routeKeeper?.arrived(p, mdpId, byName?.trim() || mdp.name);
      if (off) offPlan.push({ parcelId, planned: off.planned });
    }
    this.noteDrop(mdpId, code, parcels, now);
    void this.events.publish(GlosEvent.Pudo.BagArrivedAtMdp, { mdpId, mdpName: mdp.name, code, emptied: parcels.length }, { source: 'pudo' }).catch(() => undefined);
    // A bag sent to another hub and dropped here instead is no longer on its way there: room may have freed at that one.
    this.letWaitingGo(now);
    return { mdpId, emptied: parcels, ...(offPlan.length ? { offPlan } : {}) };
  }

  /**
   * Deliver a bag at its destination PUDO: shelve each parcel for pickup (inbound) or issue an OTP
   * (outbound), then empty the tote — freeing it for reuse AND releasing the carrying driver's
   * reserved capacity. This closes the last mile of the tote flow (the PUDO-side equivalent of dropBag).
   *
   * THE WHOLE BAG, OR NONE OF IT. Each parcel was shelved in turn, and a shelf that filled up part-way was refused
   * there: the first parcels shelved and paid for, the rest not, the bag still listing all of them — and a second
   * scan refused too, because the first ones were no longer on the bus. A bag nobody could ever receive. So the
   * shelf is asked first whether it takes all of them.
   *
   * AND WHERE EACH ONE GOES. `shelved` names the slot every parcel was given. The shop was told "5 parcels
   * shelved" and nothing else — at the one moment it has five parcels in its hands and has to put each in the
   * slot its customer will be sent to.
   */
  deliverBag(agentDid: string, code: string, receipt: { sealNumber?: string; photoRef?: string; asClosed?: boolean } | undefined, byName?: string): { code: string; agentDid: string; delivered: string[]; shelved: Array<{ parcelId: string; slot: string }>; driverDid?: string } {
    const agent = this.agents.get(agentDid);
    const tote = this.totes.requireByCode(code);
    if (!tote.parcels.length) throw new GlosError('BAG_EMPTY', `Bag ${code} is empty`);
    for (const id of tote.parcels) this.parcels.refuseIfHeld(this.parcels.get(id)); // round 35 — the bag moves whole
    const driverDid = tote.claimedBy; // REP2 — the driver who carried the bag here, captured before empty() clears it
    if (tote.destinationNodeId && tote.destinationNodeId !== agentDid) throw new GlosError('BAG_MISADDRESSED', `Bag ${code} is addressed to ${tote.destinationLabel || tote.destinationNodeId}, not ${agent.shopName}`);
    if (!this.parcels.shelfTakes(agentDid, tote.parcels)) {
      const holds = tote.parcels.length === 1 ? '1 parcel' : `${tote.parcels.length} parcels`;
      throw new GlosError('SHELF_FULL', `Bag ${code} holds ${holds} and your shelf has no room for all of them. Hand over parcels that are waiting, or add a row under “Set up shelves”, then scan the bag again`, { parcels: tote.parcels.length });
    }
    // Round 36 — received on its seal: a photograph as it arrived, the number read off it, as it was closed. Before it opens.
    const HELD = tote.held;
    if (HELD) throw new GlosError('UNIT_HELD', `Bag ${code} is held: ${FINDING_WORDS[HELD.finding]} (${HELD.where}). Keep it closed: operations has been told and releases it.`, { exceptionId: HELD.exceptionId });
    const keepReceipt = this.closures.checkReceipt(tote, { did: agentDid, name: byName?.trim() || agent.shopName, place: agent.shopName }, agentDid, receipt);
    keepReceipt({ at: new Date().toISOString() });
    const delivered: string[] = [];
    const shelved: Array<{ parcelId: string; slot: string }> = [];
    for (const parcelId of [...tote.parcels]) {
      const parcel = this.parcels.get(parcelId);
      // inbound → shelved for its collection code; outbound → the receiver's code goes live
      const put = parcel.direction === 'inbound' ? this.parcels.shelve(parcelId, agentDid) : this.parcels.arrive(parcelId, agentDid);
      parcel.toteId = undefined;
      delivered.push(parcelId);
      shelved.push({ parcelId, slot: put.binSlot });
    }
    this.totes.empty(code, agentDid); // free the tote + release the driver's reserved capacity
    this.payHaul(tote, driverDid);
    void this.events.publish(GlosEvent.Pudo.BagDelivered, { code, agentDid, delivered: delivered.length }, { source: 'pudo' }).catch(() => undefined);
    return { code, agentDid, delivered, shelved, driverDid };
  }

  /**
   * Pay the road, once the road has been driven.
   *
   * Deliberately settled on ARRIVAL rather than at load, unlike the handling fee beside it. `TOTE_LOAD_FEE`
   * pays for the act of scanning a bag aboard and is earned the moment it happens; this pays for a journey,
   * and a journey that has not happened yet is not owed. The flat fifty cents was small enough that nobody
   * had to care where it was paid — a distance-priced haul is not.
   *
   * Silent where there is nothing to pay: a bag loaded without ever being claimed through the marketplace
   * carries no locked price, and an unresolvable destination locked a road of 0. Both are visible on the
   * bag's own `haul.basis` rather than inferred from an absent ledger line.
   */
  private payHaul(tote: Tote, driverDid?: string): void {
    if (!driverDid || !tote.haul || !(tote.haul.road > 0)) return;
    // The road is paid once: a stretch already paid to a driver it was taken over from on the way is not paid again.
    const left = roadLeftToPay(tote.haul);
    if (left > 0) this.gate.driverPayout(driverDid, left);
  }

  /**
   * Sort one parcel at an MDP: compute its next destination, find/open the destination bag, drop it
   * in. Returns exactly what the worker's screen shows — the next destination + the bag code to use.
   */
  sortParcel(mdpId: string, parcelId: string, now: number = Date.now()): { parcelId: string; nextDestination: NextHop; toteCode: string; toteId: string; fillPct: number } {
    const mdp = this.working(mdpId);
    const parcel = this.parcels.get(parcelId);
    // Called off at this hub by its store (2026-10-27): the box still wears its old label. Told which label to put on it, and
    // nothing is sorted under the old one.
    // …or going to its store's own door as a load: set aside, for the driver who took that load.
    if (parcel.status === 'Returned' && parcel.returnLoad && parcel.atMdpId === mdpId) {
      const where = parcel.vendorId ? `was called off by its store: it goes to the store's door` : `goes to its sender's own door, paid for`;
      throw new GlosError('SET_ASIDE', `${parcelId} ${where} as load ${parcel.returnLoad.code}. Set it aside, and hand it only to the driver who comes for it — scan their pass at the counter.`, { parcelId, loadCode: parcel.returnLoad.code });
    }
    // A person's goods, held while their sender pays for a load to their door (2026-10-27): not sorted before the time runs out.
    if (parcel.doorHold && Date.parse(parcel.doorHold.until) > Date.now() && parcel.atMdpId === mdpId) {
      throw new GlosError('SET_ASIDE', `${parcelId} waits for its sender to pay for a load to their door, until ${parcel.doorHold.until.slice(11, 16)} UTC. Set it aside: if they have not paid by then, sort it as its label says.`, { parcelId });
    }
    if (parcel.status === 'Returned' && parcel.returnParcelId) {
      const back = this.parcels.get(parcel.returnParcelId);
      if (back.status === 'At_MDP' && back.atMdpId === mdpId) {
        // A store's parcel called off by the store, or a person's withdrawn by staff (2026-10-27): either way, a new label.
        throw new GlosError('NEW_LABEL', `${parcelId} was ${parcel.vendorId ? 'called off by its store' : 'withdrawn'}: it goes back as ${back.parcelId}. Print its new label, put it over the old one, then scan ${back.parcelId}.`, { parcelId, returnParcelId: back.parcelId });
      }
    }
    if (parcel.status !== 'At_MDP') throw new GlosError('INVALID_STATE', `Parcel is ${parcel.status}, must be At_MDP to sort`);
    this.parcels.refuseIfHeld(parcel); // round 35 — set apart: not sorted on
    if (!parcel.destAgentDid) throw new GlosError('INVALID_STATE', 'Parcel has no destination PUDO to sort toward');

    // 2026-11-06 — ITS NEXT STOP BY ITS PLAN, where that can still be used (movement unification). Where it cannot — a hub
    // no longer to be used, or a plan that does not have it here — the hub chooses as it always did (2026-11-02: onward, of
    // the hubs serving its zone, one with room), and the plan is made again from that choice, with why.
    const planned = this.routeKeeper?.sortTarget(parcel, mdpId);
    const next: NextHop = planned ?? this.nextHop(mdp, parcel.destZone, parcel.destAgentDid, now);
    if (!planned) this.routeKeeper?.redirect(parcel, next.id, 'network_changed', mdp.name);

    // Find a filling bag already bound to that next hop with room AND cargo-compatible with this parcel, else
    // open a fresh one (S31). Passing the compatibility gate to findFilling means an incompatible parcel never
    // co-totes — every bag stays internally compatible, so loadBag can trust the whole bag as one unit.
    const nature = parcel.natureCode ?? 'GEN';
    let tote = this.totes.findFilling(mdpId, next.id, parcel.size, (parcels) => this.bagAccepts(nature, parcels));
    if (!tote) {
      tote = this.totes.register(mdpId);
      this.totes.assign(tote.code, next.id, next.label);
    }
    this.totes.add(tote.code, parcelId, parcel.size);
    parcel.toteId = tote.toteId; // bag ↔ parcel; stays At_MDP until the bag is loaded onward
    // MDP sort labour at the hub's OWN fee (the user, 2026-10-26: "Its own fee"), recharged at cost when this hub's
    // sister is not the one that sold the shipment.
    const hub = this.require(mdpId);
    const hubEntity = this.entityIdOrNone(hub);
    const sortPay = this.sortPayOf(hub, parcel);
    if (sortPay > 0) this.gate.sortLabour(mdpId, sortPay, parcelId, hubEntity, parcel.sellerEntityId);
    // 2026-11-06 — kept on its plan as paid, priced through this hub or not (what another way cost: the lanes).
    this.parcels.notePaid(parcel, { type: 'mdp', id: mdpId, label: hub.name }, sortPay, this.currencyOf(hub), now);

    void this.events.publish(GlosEvent.Pudo.ParcelSorted, { parcelId, mdpId, nextDestinationId: next.id, nextDestinationType: next.type, toteCode: tote.code }, { source: 'pudo' }).catch(() => undefined);
    // 2026-11-02 — counted against the day's sorting; and the last parcel of a bag sorted frees that bag's place.
    this.noteSorted(hub, now);
    this.letWaitingGo(now);
    return { parcelId, nextDestination: next, toteCode: tote.code, toteId: tote.toteId, fillPct: this.totes.fillPct(tote) };
  }

  /**
   * Next hop for a parcel sitting at `mdp`, heading to `destAgentDid` in `destZone`:
   * if this MDP serves the destination zone → the destination PUDO (last mile);
   * otherwise → the MDP that serves the destination zone (inter-hub leg).
   */
  nextHop(mdp: Mdp, destZone: string, destAgentDid: string, now: number = Date.now()): NextHop {
    if (mdp.zones.includes(destZone)) {
      const dest = this.agents.get(destAgentDid);
      return { type: 'pudo', id: dest.did, label: dest.shopName, zone: destZone };
    }
    const onward = this.mdpForZone(destZone, now);
    if (!onward) throw new GlosError('INVALID_STATE', `No MDP serves destination zone ${destZone}`);
    return { type: 'mdp', id: onward.mdpId, label: onward.name, zone: destZone };
  }
}
