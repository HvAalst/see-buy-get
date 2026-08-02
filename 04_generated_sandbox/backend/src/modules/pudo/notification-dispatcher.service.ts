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
 * Three headline scenarios: the BUYER ("your parcel has arrived at the pickup point"), the DRIVER
 * ("a load is near you"), and the PUDO AGENT ("a bus with your parcels is inbound").
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
  ) {}

  onModuleInit(): void {
    // Rule 1 (buyer) — a parcel reached its destination PUDO and is ready to collect.
    this.events.subscribe<{ parcelId: string }>(GlosEvent.Pudo.ParcelReadyForPickup, (e) =>
      this.onParcelReadyForPickup(e.payload.parcelId),
    );
    // Rule 2 (driver) — a tote was published to the claim marketplace; ping active drivers near its pickup.
    this.events.subscribe<{ code: string; weightKg?: number; destination?: string }>(GlosEvent.Pudo.ToteAvailable, (e) =>
      this.onToteAvailable(e.payload),
    );
    // Rule 3 (PUDO agent) — a bag went onto a bus bound for a PUDO; tell that shop its parcels are inbound.
    this.events.subscribe<{ destinationNodeId?: string; parcels?: number; code?: string }>(GlosEvent.Pudo.BagLoaded, (e) =>
      this.onBagLoaded(e.payload),
    );
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

      // "Near you" must mean near you NOW. An active coupling keeps its LAST reported GPS forever (the
      // app can background / lose signal without ending the session), so a frozen hours-old position is
      // not live. Apply the SAME freshness window the market engine uses for this exact list
      // (MARKET_SUPPLY_STALE_MIN) — a missing or too-old (or unparseable → fail-safe excluded) fix drops out.
      const now = Date.now();
      const staleMs = MARKET_SUPPLY_STALE_MIN * 60_000;
      const nearby = this.fleet
        .list({ status: 'active' })
        .filter((a) => a.location && a.lastLocatedAt && now - new Date(a.lastLocatedAt).getTime() <= staleMs)
        .map((a) => ({ driverDid: a.driverDid, km: haversineKm(a.location as GeoPoint, pickup) }))
        .filter((d) => d.km <= NotificationDispatcher.NEARBY_DRIVER_KM)
        .sort((a, b) => a.km - b.km)
        .slice(0, NotificationDispatcher.NEARBY_DRIVER_CAP);
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
