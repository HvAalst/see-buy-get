import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { NotificationService } from './notification.service';
import { ParcelService } from './parcel.service';
import { PersonService } from './person.service';
import { AgentService } from './agent.service';
import { FleetService } from './fleet.service';
import { ToteService } from './tote.service';
import { MdpService } from './mdp.service';
import { DispatchService } from './dispatch.service';
import { haversineKm } from './geo';
import { GeoPoint } from './pudo.types';
import { MARKET_SUPPLY_STALE_MIN } from './pudo.config';

/**
 * NotificationDispatcher (N2/N3) — the bridge from the event cascade to a person's devices. It
 * subscribes to domain events and, for each, resolves WHO should hear about it and pushes a real
 * notification (recorded to the inbox + fanned out to their subscribed devices). It is the outbound,
 * consumer-facing sibling of VendorCallbackService (which relays the same milestones to the store).
 *
 * Every handler is best-effort and self-contained: it catches its own errors so a notification failure
 * never throws back into the bus (which would retry/dead-letter the event and disturb other
 * subscribers) — a missed notification must never break the shipment flow that triggered it.
 *
 * Scenarios: the BUYER ("your parcel has arrived"), the DRIVER ("a load is near you" — a ready tote OR a
 * freshly-posted freight), and the PUDO AGENT ("a bus with your parcels is inbound" on arrival, and — at
 * GENESIS — "a parcel is coming in" so the DROP-OFF shop expects a minted vendor order / peer-send).
 */
@Injectable()
export class NotificationDispatcher implements OnModuleInit {
  private readonly logger = new Logger(NotificationDispatcher.name);

  /** "Near you" radius + a fan-out cap so one tote never pings a whole city of drivers. */
  private static readonly NEARBY_DRIVER_KM = 8;
  private static readonly NEARBY_DRIVER_CAP = 12;

  constructor(
    private readonly events: EventBus,
    private readonly notifications: NotificationService,
    private readonly parcels: ParcelService,
    private readonly persons: PersonService,
    private readonly agents: AgentService,
    private readonly fleet: FleetService,
    private readonly totes: ToteService,
    private readonly mdps: MdpService,
    private readonly dispatch: DispatchService,
  ) {}

  onModuleInit(): void {
    // Rule 1 (buyer) — a parcel reached its destination PUDO and is ready to collect.
    this.events.subscribe<{ parcelId: string }>(GlosEvent.Pudo.ParcelReadyForPickup, (e) =>
      this.onParcelReadyForPickup(e.payload.parcelId),
    );
    // Rule 1b (buyer) — the release secret was burned and an operator rotated it. The buyer is very
    // likely standing at the counter right now, so this is urgent and must NOT collapse onto the
    // parcel-ready notification (a fresh tag), or the one message telling them their code changed
    // would be swallowed by the one they already read.
    this.events.subscribe<{ parcelId: string }>(GlosEvent.Pudo.ParcelReleaseCodeReissued, (e) =>
      this.onReleaseCodeReissued(e.payload.parcelId),
    );
    // Rule 2 (driver) — a tote was published to the claim marketplace; ping active drivers near its pickup.
    this.events.subscribe<{ code: string; weightKg?: number; destination?: string }>(GlosEvent.Pudo.ToteAvailable, (e) =>
      this.onToteAvailable(e.payload),
    );
    // Rule 2b (PUDO agent) — a bag the shop must CLOSE itself is ready to go. The sweep cannot publish a
    // shop bag (it is open on a counter until a human shuts it), so the nudge is the whole mechanism that
    // stops a full bag sitting there all afternoon.
    this.events.subscribe<{ code: string; agentDid?: string; reason?: 'full' | 'max_wait'; destination?: string }>(GlosEvent.Pudo.ToteNeedsSeal, (e) =>
      this.onToteNeedsSeal(e.payload),
    );
    // Rule 3 (PUDO agent) — a bag went onto a bus bound for a PUDO; tell that shop its parcels are inbound.
    this.events.subscribe<{ destinationNodeId?: string; parcels?: number; code?: string }>(GlosEvent.Pudo.BagLoaded, (e) =>
      this.onBagLoaded(e.payload),
    );
    // Rule 4 (PUDO agent, at GENESIS) — a parcel was minted + PAID; tell its DROP-OFF PUDO to expect it.
    // ParcelPaid fires exactly ONCE per vendor parcel (at a paid mint, OR at a settle after a top-up), so
    // this catches both without double-recording; a person's peer-send fires ParcelMinted (cash at the
    // counter, no prepay). Both carry originAgentDid; an unpaid vendor order is silent until it settles.
    this.events.subscribe<{ parcelId: string; originAgentDid?: string }>(GlosEvent.Pudo.ParcelPaid, (e) => this.onMinted(e.payload));
    this.events.subscribe<{ parcelId: string; originAgentDid?: string }>(GlosEvent.Pudo.ParcelMinted, (e) => this.onMinted(e.payload));
    // Rule 5 (driver) — a dedicated-freight load was posted; ping active drivers near its pickup (same
    // live-GPS matching as a ready tote), so a heavy divert reaches a truck at genesis, not only via pull.
    this.events.subscribe<{ freightId: string; destLabel?: string; pickupLocation?: GeoPoint }>(GlosEvent.Pudo.FreightPosted, (e) => this.onFreightPosted(e.payload));
  }

  /**
   * The buyer scenario: on ParcelReadyForPickup, tell the RECEIVER their parcel is waiting. The event
   * carries only the parcelId, so we read the parcel for the receiver's phoneHash, resolve it to their
   * person account, and push. A receiver with no account yet (never signed up) is silently skipped —
   * there is nowhere to push to, and the collection code is still delivered in-app when they sign in.
   */
  private async onParcelReadyForPickup(parcelId: string): Promise<void> {
    try {
      const parcel = this.parcels.get(parcelId);
      const hash = parcel.receiverPhoneHash;
      if (!hash) return; // no receiver identity on this parcel (e.g. a legacy record) — nothing to target
      const person = this.persons.findByHash(hash);
      if (!person) return; // the receiver has no account — nothing to push to (they'll see it in-app later)

      const where = this.shopName(parcel.destAgentDid) ?? parcel.destZone ?? 'your pickup point';
      await this.notifications.notify(person.personDid, {
        kind: 'parcel_ready',
        title: 'Your parcel has arrived',
        body: `Ready to collect at ${where}.`,
        link: '/',
        // One notification per parcel-ready — a re-published event collapses onto the same one.
        tag: `parcel-ready:${parcelId}`,
        data: { parcelId },
      });
    } catch (err) {
      this.logger.warn(`parcel-ready notify failed for ${parcelId}: ${(err as Error).message}`);
    }
  }

  /**
   * The reissue scenario: the parcel's release secret was rotated, so the code the receiver is holding
   * no longer works. Push them the new one's existence — the code itself lives in their twin, never in a
   * notification body (a lock-screen preview is readable by anyone holding the phone).
   */
  private async onReleaseCodeReissued(parcelId: string): Promise<void> {
    try {
      const parcel = this.parcels.get(parcelId);
      const where = this.shopName(parcel.destAgentDid) ?? parcel.destZone ?? 'your pickup point';
      // On a PEER SEND the sender is told as well: they are the relay to a receiver with no app (the same
      // role the store plays on a vendor order), so a rotated code that reached only the receiver would
      // strand exactly the person the relay exists for. A vendor order tells the buyer only — its store
      // gets the new code over the callback instead.
      const targets = parcel.vendorId ? [parcel.receiverPhoneHash] : [parcel.receiverPhoneHash, parcel.senderPhoneHash];
      const seen = new Set<string>();
      for (const hash of targets) {
        if (!hash) continue;
        const person = this.persons.findByHash(hash);
        if (!person || seen.has(person.personDid)) continue; // a person sending to themselves is told once
        seen.add(person.personDid);
        await this.notifications.notify(person.personDid, {
          kind: 'parcel_ready',
          title: 'The pickup code has changed',
          body: `Open the app for the new code — the parcel is at ${where}.`,
          link: '/',
          tag: `parcel-code-reissued:${parcelId}`,
          data: { parcelId },
        });
      }
    } catch (err) {
      this.logger.warn(`code-reissued notify failed for ${parcelId}: ${(err as Error).message}`);
    }
  }

  /** Best-effort human label for a PUDO — its shop name, else undefined (caller falls back to the zone). */
  private shopName(agentDid?: string): string | undefined {
    if (!agentDid) return undefined;
    try {
      return this.agents.get(agentDid).shopName;
    } catch {
      return undefined;
    }
  }

  /**
   * The driver scenario: a tote was published to the claim marketplace. The event carries only the
   * tote code (no geo), so we read the tote for where it sits, resolve that node's coordinates, and ping
   * the ACTIVE drivers whose LIVE position is within range — the honest "near you", matched on the
   * driver's real GPS, not a declared route. Capped and distance-sorted so one tote never pings a city.
   */
  private async onToteAvailable(payload: { code: string; destination?: string }): Promise<void> {
    try {
      const tote = this.totes.byCodeMaybe(payload.code);
      if (!tote) return;
      const pickup = this.nodeLocation(tote.locationId);
      if (!pickup) return; // the origin isn't a fixed point (on a bus, or unknown) — can't say "near you"

      const nearby = this.nearbyActiveDrivers(pickup);
      if (nearby.length === 0) return;

      const where = tote.destinationLabel ?? payload.destination;
      await Promise.all(
        nearby.map((d) =>
          this.notifications.notify(d.driverDid, {
            kind: 'load_nearby',
            title: 'A load is near you',
            body: where ? `A bag heading to ${where} is ready for pickup nearby.` : 'A bag is ready for pickup nearby.',
            link: '/',
            // One notification per tote per driver — a re-publish collapses onto the same one.
            tag: `load:${tote.code}`,
            data: { code: tote.code },
          }),
        ),
      );
    } catch (err) {
      this.logger.warn(`load-nearby notify failed for ${payload.code}: ${(err as Error).message}`);
    }
  }

  /**
   * The shop scenario: one of this shop's own bags is ready to leave, but only the shop can close it. Two
   * different messages, because they are two different situations at a counter: "it is full" is good news
   * (close it and it goes), while "it has been open a day" is a warning that the parcels inside are late.
   * Tagged per reason so the second one is not swallowed by the first.
   */
  private async onToteNeedsSeal(payload: { code: string; agentDid?: string; reason?: 'full' | 'max_wait'; destination?: string }): Promise<void> {
    const agentDid = payload.agentDid;
    if (!agentDid) return;
    try {
      this.agents.get(agentDid); // the bag must be sitting at a real PUDO (throws for a hub/unknown node)
    } catch {
      return;
    }
    try {
      const where = payload.destination ? ` for ${payload.destination}` : '';
      const full = payload.reason !== 'max_wait';
      await this.notifications.notify(agentDid, {
        kind: 'bag_ready_to_close',
        title: full ? 'A bag is full' : 'A bag has been waiting',
        body: full
          ? `Bag ${payload.code}${where} is full. Close it so a driver can take it.`
          : `Bag ${payload.code}${where} has been open since yesterday. Close it, or the parcels inside will keep waiting.`,
        link: '/',
        tag: `bag-seal:${payload.code}:${payload.reason ?? 'full'}`,
        data: { code: payload.code },
      });
    } catch (err) {
      this.logger.warn(`bag-needs-seal notify failed for ${payload.code}: ${(err as Error).message}`);
    }
  }

  /**
   * The active drivers whose LIVE position is within range of a pickup, distance-sorted and capped — the
   * honest "near you", matched on real GPS not a declared route. "Near you" must mean near you NOW: an
   * active coupling keeps its LAST reported GPS forever (the app can background / lose signal without
   * ending the session), so a frozen hours-old position is not live. Apply the SAME freshness window the
   * market engine uses for this exact list (MARKET_SUPPLY_STALE_MIN) — a missing/too-old (or unparseable →
   * fail-safe excluded) fix drops out. Shared by the tote rule (2) and the freight rule (5).
   */
  private nearbyActiveDrivers(pickup: GeoPoint): Array<{ driverDid: string; km: number }> {
    const now = Date.now();
    const staleMs = MARKET_SUPPLY_STALE_MIN * 60_000;
    return this.fleet
      .list({ status: 'active' })
      .filter((a) => a.location && a.lastLocatedAt && now - new Date(a.lastLocatedAt).getTime() <= staleMs)
      .map((a) => ({ driverDid: a.driverDid, km: haversineKm(a.location as GeoPoint, pickup) }))
      .filter((d) => d.km <= NotificationDispatcher.NEARBY_DRIVER_KM)
      // …and HEADING there. Near is only half the question: a driver leaving town for the south is metres
      // from a bag going north. A driver who declared no leg is kept — we cannot say they are not going.
      .filter((d) => this.dispatch.headingTowards(d.driverDid, pickup))
      .sort((a, b) => a.km - b.km)
      .slice(0, NotificationDispatcher.NEARBY_DRIVER_CAP);
  }

  /**
   * The GENESIS scenario (Rule 4): a parcel was minted, so tell its DROP-OFF PUDO to expect it. The
   * recipient is the origin agent DID carried on the event; a mint whose origin isn't a real PUDO agent
   * (defensive — a hub/unknown node) is skipped. The copy differs for a vendor order vs a person's
   * peer-send (read from the parcel), but neither the fare nor any secret rides the lock screen — the
   * agent sees the cash due + details in-app when they scan it in.
   */
  private async onMinted(payload: { parcelId: string; originAgentDid?: string }): Promise<void> {
    const originDid = payload.originAgentDid;
    if (!originDid) return;
    try {
      this.agents.get(originDid); // the drop-off must be a real PUDO agent (throws for a hub/unknown node)
    } catch {
      return;
    }
    try {
      // Idempotent: a mint publishes ParcelPaid AND (for a paid vendor) fires once, but a future re-fire /
      // a naive second subscription must not stack a second inbox row (the dedupe tag is SW-only, not on the
      // record). If this parcel already told this shop it's coming, do nothing — mirrors graduation.onCreated.
      const already = this.notifications.inboxFor(originDid).some((n) => n.kind === 'intake_expected' && (n.data as { parcelId?: string } | undefined)?.parcelId === payload.parcelId);
      if (already) return;
      const parcel = this.parcels.get(payload.parcelId);
      const isPeerSend = parcel.senderMobile === 'app';
      await this.notifications.notify(originDid, {
        kind: 'intake_expected',
        title: 'A parcel is coming in',
        body: isPeerSend
          ? 'A booked parcel is on its way to your counter — take it in when the sender drops it off.'
          : 'A store shipment is on its way to your counter — scan it in when it arrives.',
        link: '/',
        // One notification per minted parcel — a re-published mint/settle collapses onto the same one.
        tag: `intake:${payload.parcelId}`,
        data: { parcelId: payload.parcelId },
      });
    } catch (err) {
      this.logger.warn(`intake-expected notify failed for ${payload.parcelId}: ${(err as Error).message}`);
    }
  }

  /**
   * The freight scenario (Rule 5): a dedicated-freight load was posted to the marketplace. Unlike a tote
   * the load carries its own pickup coordinate, so we match drivers on it directly and push. Reuses the
   * exact live-GPS matching of Rule 2, so a heavy divert reaches a nearby truck at genesis.
   */
  private async onFreightPosted(payload: { freightId: string; destLabel?: string; pickupLocation?: GeoPoint }): Promise<void> {
    try {
      if (!payload.pickupLocation) return;
      // Unlike a tote (any bus carries it), a dedicated freight needs a fit vehicle. Ping only the nearby
      // drivers whose CURRENT vehicle could actually carry it — a bike driver never gets a pallet alert.
      // (claim() re-checks capability regardless; this just keeps the audience honest.)
      const nearby = this.nearbyActiveDrivers(payload.pickupLocation).filter((d) => this.dispatch.freightCarryableByDriver(payload.freightId, d.driverDid));
      if (nearby.length === 0) return;
      await Promise.all(
        nearby.map((d) =>
          this.notifications.notify(d.driverDid, {
            kind: 'load_nearby',
            title: 'A load is near you',
            body: payload.destLabel ? `A freight load to ${payload.destLabel} is ready to claim nearby.` : 'A freight load is ready to claim nearby.',
            link: '/',
            tag: `freight:${payload.freightId}`,
            data: { freightId: payload.freightId },
          }),
        ),
      );
    } catch (err) {
      this.logger.warn(`freight-nearby notify failed for ${payload.freightId}: ${(err as Error).message}`);
    }
  }

  /**
   * The PUDO-agent scenario: a bag went onto a bus committed to its next hop. If that hop is a PUDO
   * AGENT (the final pickup point), tell the shop its parcels are inbound. A bag bound for an MDP hub is
   * a re-sort leg, not "your parcels are coming", so agents.get throws for a non-agent node and we skip.
   */
  private async onBagLoaded(payload: { destinationNodeId?: string; parcels?: number; code?: string }): Promise<void> {
    try {
      const dest = payload.destinationNodeId;
      if (!dest) return;
      try {
        this.agents.get(dest); // verify the destination is a PUDO agent (throws for an MDP / unknown node)
      } catch {
        return;
      }
      const n = payload.parcels ?? 0;
      await this.notifications.notify(dest, {
        kind: 'bus_inbound',
        title: 'A bus is inbound',
        body: n > 0 ? `A bus with ${n} parcel${n === 1 ? '' : 's'} is on its way to you.` : 'A bus is on its way to your shop.',
        link: '/',
        tag: payload.code ? `bus:${payload.code}` : undefined,
        data: { code: payload.code },
      });
    } catch (err) {
      this.logger.warn(`bus-inbound notify failed: ${(err as Error).message}`);
    }
  }

  /** Resolve a node id (an agentDid or an mdpId) to its coordinates — undefined if it is neither. */
  private nodeLocation(nodeId: string): GeoPoint | undefined {
    try {
      return this.agents.get(nodeId).location;
    } catch {
      /* not a PUDO agent — try an MDP */
    }
    try {
      return this.mdps.require(nodeId).location;
    } catch {
      return undefined;
    }
  }
}
