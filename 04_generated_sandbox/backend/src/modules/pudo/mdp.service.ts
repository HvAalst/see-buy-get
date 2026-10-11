import { Injectable } from '@nestjs/common';
import { GlosError } from '../../foundation/http/glos-error';
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
import { DEFAULT_MDP_PRICE_PER_PARCEL } from './pudo.config';
import { countryOfSite, requireCountryCode } from './country';
import { EntityService } from '../../foundation/entity/entity.service';
import { PresenceService } from '../../foundation/presence/presence.service';
import { Mdp, NextHop, Tote } from './pudo.types';

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
  ) {}

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

  register(input: { name: string; zones: string[]; country?: string; location: { lat: number; lng: number }; contactPhone?: string; address?: string; pricePerParcel?: number }): Mdp {
    if (!input.zones?.length) throw new GlosError('ZONES_REQUIRED', 'An MDP must cover at least one zone');
    // Same question a shop answers: does the network operate here at all? Where we only match, a hub stands with
    // no sister behind it — it sorts and records custody, and nothing of ours is booked for the work.
    const country = requireCountryCode(input.country);
    if (!this.presence.can(country, 'takeIn')) throw new GlosError('FORBIDDEN', `The network does not operate in ${country} yet, so a hub cannot register there`);
    const entity = this.entities.forJurisdiction(country);
    // Real DID (S2) — an MDP worker is a first-class actor and their token binds to this, not to a
    // synthetic mdp_<hex> id. A pseudonymous operational profile makes it OperationalStore-resolvable
    // (tier/tokenVersion) like every other participant. No PII goes to the core (contact/address stay
    // on the domain record only).
    const did = this.dids.generate(`mdp:${input.name}`, { role: 'pudo-mdp' }).id;
    this.core.upsert({ did, tier: 2, status: 'active', capabilities: ['pudo-mdp'], metadata: { zones: input.zones } });
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
      pricePerParcel: input.pricePerParcel ?? DEFAULT_MDP_PRICE_PER_PARCEL,
      createdAt: new Date().toISOString(),
    };
    this.mdps.set(mdp.mdpId, mdp);
    return mdp;
  }

  /** Set the hub's open-data per-parcel sort price (public, drives the shipment quote). */
  setPrice(mdpId: string, pricePerParcel: number): Mdp {
    if (pricePerParcel < 0) throw new GlosError('AMOUNT_INVALID', 'Price cannot be negative');
    const mdp = this.require(mdpId);
    mdp.pricePerParcel = Math.round(pricePerParcel * 100) / 100;
    return mdp;
  }

  list(): Mdp[] {
    return [...this.mdps.values()];
  }

  require(mdpId: string): Mdp {
    const mdp = this.mdps.get(mdpId);
    if (!mdp) throw new GlosError('NOT_FOUND', `MDP not found: ${mdpId}`);
    return mdp;
  }

  /** The hub that last-mile-serves a delivery zone (the regional sort centre for that zone). */
  mdpForZone(zone: string): Mdp | undefined {
    return [...this.mdps.values()].find((m) => m.zones.includes(zone));
  }

  /** Register a fresh laminated tote into the pool at this MDP. */
  registerTote(mdpId: string): Tote {
    this.require(mdpId);
    return this.totes.register(mdpId);
  }

  // --- bag flow at a SHOP (tote genesis at the origin PUDO) ---

  /**
   * A shop opens a bag for one destination zone, so its outbound parcels leave as ONE scan instead of
   * a dozen. Bag genesis used to be MDP-only, which left the busiest hand-over in the network — a
   * shopkeeper and a waiting driver at a counter — working parcel by parcel.
   *
   * The bag is homed at the shop and addressed to the zone; the corridor decides the rest.
   */
  openShopBag(agentDid: string, destZone: string): Tote {
    this.agents.get(agentDid); // 404 for an unknown shop
    if (!destZone?.trim()) throw new GlosError('FIELD_REQUIRED', 'A bag needs a destination');
    // A bag is a physical object standing on a floor, and floors run out. The shelf has always been sized by
    // the shop; this is the same declaration for the other pile in the room. Counted as what is STANDING
    // there — filling, sealed and waiting, or claimed by a driver who has not arrived — because all three
    // take up the same square metre. A flat, unassigned tote takes none.
    this.assertStagingRoom(agentDid);
    const tote = this.totes.register(agentDid);
    // sealRequired: this bag leaves the shop when the SHOPKEEPER says it is closed, never when a sweep
    // decides it looks full. A bag on a counter is open until a human shuts it.
    return this.totes.assign(tote.code, destZone.trim(), destZone.trim(), { sealRequired: true });
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
    const shop = this.agents.list().find((a) => a.did === tote.locationId);
    if (shop) this.assertStagingRoom(shop.did);
    return this.totes.assign(code, destinationNodeId, destinationLabel);
  }

  /** Refuse a new bag when the shop's floor is already carrying as many as it declared it can. */
  private assertStagingRoom(agentDid: string): void {
    const bays = this.agents.bagBaysOf(this.agents.get(agentDid));
    const staged = this.stagedBags(agentDid);
    if (staged.length >= bays) {
      throw new GlosError(
        'STAGING_FULL',
        `This shop has room for ${bays} bag(s) and ${staged.length} are on the floor — hand one to a driver, or raise your bag space`,
        { capacity: bays, used: staged.length },
      );
    }
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
  fillShopBag(code: string, agentDid: string, parcelId: string): { tote: Tote; fillPct: number } {
    const bag = this.totes.requireByCode(code);
    if (bag.locationId !== agentDid) throw new GlosError('WRONG_PUDO', `Bag ${code} was not opened at this shop`);
    if (bag.status !== 'filling') throw new GlosError('INVALID_STATE', `Bag ${code} is ${bag.status}, it is closed`);

    const parcel = this.parcels.get(parcelId);
    if (parcel.originAgentDid !== agentDid || parcel.status !== 'At_PUDO') {
      throw new GlosError('INVALID_STATE', `Parcel ${parcelId} is not waiting at this shop`);
    }
    if (parcel.destZone !== bag.destinationNodeId) {
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
    return this.fillTote(code, parcelId);
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
  sealShopBag(code: string, agentDid: string, input: { acknowledgeShortShip?: boolean; shortShipReason?: string } = {}): { tote: Tote; parcels: string[]; missed: string[]; shortShipped: boolean } {
    const bag = this.totes.requireByCode(code);
    if (bag.locationId !== agentDid) throw new GlosError('WRONG_PUDO', `Bag ${code} was not opened at this shop`);
    // Closed once. A second seal would re-run the gate against parcels dropped off AFTER the bag was shut
    // and short-ship them for missing a bus they were never on.
    if (bag.sealedAt) throw new GlosError('INVALID_STATE', `Bag ${code} is already closed`);
    if (bag.status !== 'filling' && bag.status !== 'available') {
      throw new GlosError('INVALID_STATE', `Bag ${code} is ${bag.status}, it can no longer be closed`);
    }

    const inBag = new Set(bag.parcels);
    const expected = this.parcels
      .list({ status: 'At_PUDO', agentDid })
      .filter((p) => p.originAgentDid === agentDid && p.destZone === bag.destinationNodeId)
      .map((p) => p.parcelId);
    const missed = expected.filter((id) => !inBag.has(id));

    if (missed.length && !input.acknowledgeShortShip) {
      throw new GlosError(
        'INCOMPLETE_MANIFEST',
        `${missed.length} parcel(s) for ${bag.destinationLabel} are still on the shelf — bag them, or leave them on purpose.`,
        { missed, expected, code },
      );
    }
    if (missed.length) this.parcels.markShortShipped(missed, agentDid, `bag ${code}`, (input.shortShipReason ?? '').trim() || 'not bagged');

    // Sealed = published to the marketplace, so a driver can claim it and arrive knowing it is one scan.
    const announce = bag.status === 'filling'; // an already-published bag was announced when it was published
    const tote = announce ? this.totes.markAvailable(code) : bag;
    this.totes.markSealed(code);
    if (announce) {
      // …and tell the drivers near the shop. Without this the shop's deliberate "it is ready NOW" was the
      // only publish in the network that pinged nobody, while the passive 24 h sweep did.
      void this.events
        .publish(GlosEvent.Pudo.ToteAvailable, { code: tote.code, reason: 'sealed', weightKg: tote.weightKg, destination: tote.destinationLabel }, { source: 'pudo' })
        .catch(() => undefined);
    }
    return { tote, parcels: [...bag.parcels], missed, shortShipped: missed.length > 0 };
  }

  // --- bag flow ---

  /** Pack a parcel into a bag bound for a destination (used at the origin PUDO and after sorting). */
  fillTote(code: string, parcelId: string): { tote: Tote; fillPct: number } {
    const parcel = this.parcels.get(parcelId);
    // S31: this worker chose a specific bag — refuse to drop in a parcel whose cargo is incompatible with the
    // bag's current contents (cement dust into a fresh-produce bag). The bag stays internally compatible, so
    // loadBag can trust it later. sortParcel auto-routes around this; here the bag is explicit, so we throw.
    const bag = this.totes.requireByCode(code);
    if (!this.bagAccepts(parcel.natureCode ?? 'GEN', bag.parcels)) {
      throw new GlosError('CARGO_INCOMPATIBLE', `Parcel ${parcelId} cannot share bag ${code} — its cargo is incompatible with the bag's contents`);
    }
    const tote = this.totes.add(code, parcelId, parcel.size);
    this.parcels.get(parcelId).toteId = tote.toteId; // connect parcel ↔ bag (still where it was)
    return { tote, fillPct: this.totes.fillPct(tote) };
  }

  /** Scan a bag onto a bus — one scan moves the whole tote and every parcel in it to On_Bus.
   * When the badge resolves to a registered fleet vehicle, the bag must fit that vehicle's limits
   * (a bike/motorcycle feeder takes ≤ its capacity and no fragile items). Unknown badges pass through. */
  loadBag(code: string, driverBadgeId: string): { tote: Tote; moved: string[] } {
    const pending = this.totes.requireByCode(code);
    const fleet = this.fleet.resolveBadge(driverBadgeId);
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
      if (kg > fleet.capacityKg) throw new GlosError('CAPACITY_EXCEEDED', `Bag ${code} (${kg}kg) exceeds this ${fleet.vehicle.vehicleClass}'s ${fleet.capacityKg}kg capacity`);
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
    const tote = this.totes.load(code, driverBadgeId, fleet?.driverDid);
    for (const parcelId of tote.parcels) {
      this.parcels.setTransit(parcelId, 'On_Bus', driverBadgeId, `bag ${tote.code} → ${tote.destinationLabel ?? tote.destinationNodeId}`, tote.toteId);
      // Graduation: the tote path must raise HANDOVER on the M4 timeline like the direct handover does.
      void this.events.publish(GlosEvent.Pudo.ParcelHandedToBus, { parcelId, driverBadgeId, toteCode: tote.code }, { source: 'pudo' }).catch(() => undefined);
    }
    if (fleet) this.gate.payBagLoad(fleet.driverDid); // for scanning it aboard, at the driver's own company's figure
    void this.events.publish(GlosEvent.Pudo.BagLoaded, { toteId: tote.toteId, code: tote.code, driverBadgeId, destinationNodeId: tote.destinationNodeId, parcels: tote.parcels.length }, { source: 'pudo' }).catch(() => undefined);
    return { tote, moved: [...tote.parcels] };
  }

  /** A bus drops a bag at this MDP → scan the bag code, empty it; parcels become unsorted (At_MDP). */
  dropBag(mdpId: string, code: string): { mdpId: string; emptied: string[] } {
    const mdp = this.require(mdpId);
    const before = this.totes.requireByCode(code);
    if (!before.parcels.length) throw new GlosError('BAG_EMPTY', `Bag ${code} is already empty`);
    const carrier = before.claimedBy; // captured before empty() clears it, as deliverBag does
    const { parcels } = this.totes.empty(code, mdpId);
    this.payHaul(before, carrier);
    for (const parcelId of parcels) {
      const p = this.parcels.setTransit(parcelId, 'At_MDP', mdp.name, `dropped at ${mdp.name} · awaiting sort`, undefined);
      p.atMdpId = mdpId; // scope the inbound queue to this hub
    }
    void this.events.publish(GlosEvent.Pudo.BagArrivedAtMdp, { mdpId, mdpName: mdp.name, code, emptied: parcels.length }, { source: 'pudo' }).catch(() => undefined);
    return { mdpId, emptied: parcels };
  }

  /**
   * Deliver a bag at its destination PUDO: shelve each parcel for pickup (inbound) or issue an OTP
   * (outbound), then empty the tote — freeing it for reuse AND releasing the carrying driver's
   * reserved capacity. This closes the last mile of the tote flow (the PUDO-side equivalent of dropBag).
   */
  deliverBag(agentDid: string, code: string): { code: string; agentDid: string; delivered: string[]; driverDid?: string } {
    const agent = this.agents.get(agentDid);
    const tote = this.totes.requireByCode(code);
    if (!tote.parcels.length) throw new GlosError('BAG_EMPTY', `Bag ${code} is empty`);
    const driverDid = tote.claimedBy; // REP2 — the driver who carried the bag here, captured before empty() clears it
    if (tote.destinationNodeId && tote.destinationNodeId !== agentDid) throw new GlosError('BAG_MISADDRESSED', `Bag ${code} is addressed to ${tote.destinationLabel || tote.destinationNodeId}, not ${agent.shopName}`);
    const delivered: string[] = [];
    for (const parcelId of [...tote.parcels]) {
      const parcel = this.parcels.get(parcelId);
      if (parcel.direction === 'inbound') this.parcels.shelve(parcelId, agentDid);
      else this.parcels.arrive(parcelId, agentDid); // outbound → OTP issued to the receiver
      parcel.toteId = undefined;
      delivered.push(parcelId);
    }
    this.totes.empty(code, agentDid); // free the tote + release the driver's reserved capacity
    this.payHaul(tote, driverDid);
    void this.events.publish(GlosEvent.Pudo.BagDelivered, { code, agentDid, delivered: delivered.length }, { source: 'pudo' }).catch(() => undefined);
    return { code, agentDid, delivered, driverDid };
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
    this.gate.driverPayout(driverDid, tote.haul.road);
  }

  /**
   * Sort one parcel at an MDP: compute its next destination, find/open the destination bag, drop it
   * in. Returns exactly what the worker's screen shows — the next destination + the bag code to use.
   */
  sortParcel(mdpId: string, parcelId: string): { parcelId: string; nextDestination: NextHop; toteCode: string; toteId: string; fillPct: number } {
    const mdp = this.require(mdpId);
    const parcel = this.parcels.get(parcelId);
    if (parcel.status !== 'At_MDP') throw new GlosError('INVALID_STATE', `Parcel is ${parcel.status}, must be At_MDP to sort`);
    if (!parcel.destAgentDid) throw new GlosError('INVALID_STATE', 'Parcel has no destination PUDO to sort toward');

    const next = this.nextHop(mdp, parcel.destZone, parcel.destAgentDid);

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
    // MDP sort labour, recharged at cost when this hub's sister is not the one that sold the shipment.
    // At this hub's own company's figure; where no company of ours stands behind it, at the seller's, who buys the work.
    const hubEntity = this.entityIdOrNone(this.require(mdpId));
    const sortPay = this.entities.amountsFor(hubEntity ?? parcel.sellerEntityId).mdpSortFee;
    if (sortPay > 0) this.gate.sortLabour(mdpId, sortPay, parcelId, hubEntity, parcel.sellerEntityId);

    void this.events.publish(GlosEvent.Pudo.ParcelSorted, { parcelId, mdpId, nextDestinationId: next.id, nextDestinationType: next.type, toteCode: tote.code }, { source: 'pudo' }).catch(() => undefined);
    return { parcelId, nextDestination: next, toteCode: tote.code, toteId: tote.toteId, fillPct: this.totes.fillPct(tote) };
  }

  /**
   * Next hop for a parcel sitting at `mdp`, heading to `destAgentDid` in `destZone`:
   * if this MDP serves the destination zone → the destination PUDO (last mile);
   * otherwise → the MDP that serves the destination zone (inter-hub leg).
   */
  nextHop(mdp: Mdp, destZone: string, destAgentDid: string): NextHop {
    if (mdp.zones.includes(destZone)) {
      const dest = this.agents.get(destAgentDid);
      return { type: 'pudo', id: dest.did, label: dest.shopName, zone: destZone };
    }
    const onward = this.mdpForZone(destZone);
    if (!onward) throw new GlosError('INVALID_STATE', `No MDP serves destination zone ${destZone}`);
    return { type: 'mdp', id: onward.mdpId, label: onward.name, zone: destZone };
  }
}
