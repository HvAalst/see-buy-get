import { Injectable, OnModuleInit } from '@nestjs/common';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';

/** A carrier is "cold-start" until it has completed this many deliveries. */
const COLD_START_THRESHOLD = 3;
/** New carriers are not offered jobs whose value exceeds this cap (M3-033/034). */
const COLD_START_VALUE_CAP = 1500;

interface Profile {
  assignments: number;
  completions: number;
}

/**
 * CarrierProfileService (M3-034). Tracks each carrier's track record from the event stream
 * (`match.confirmed` → assignment, `tracking.delivered` → completion) to drive cold-start handling:
 * new carriers get a scoring boost on low-risk work but are capped out of very-high-value jobs.
 */
@Injectable()
export class CarrierProfileService implements OnModuleInit {
  private readonly profiles = new Map<string, Profile>();
  private readonly carrierOfShipment = new Map<string, string>();

  constructor(private readonly events: EventBus) {}

  onModuleInit(): void {
    this.events.subscribe<{ glosShipmentId: string; carrierDid: string }>(GlosEvent.Match.Confirmed, (e) => {
      this.carrierOfShipment.set(e.payload.glosShipmentId, e.payload.carrierDid);
      this.profile(e.payload.carrierDid).assignments += 1;
    });
    this.events.subscribe<{ glosShipmentId: string }>(GlosEvent.Tracking.Delivered, (e) => {
      const carrier = this.carrierOfShipment.get(e.payload.glosShipmentId);
      if (carrier) this.profile(carrier).completions += 1;
    });
  }

  isColdStart(did: string): boolean {
    return (this.profiles.get(did)?.completions ?? 0) < COLD_START_THRESHOLD;
  }

  /**
   * May this carrier be offered a job of `value`? Cold-start carriers are kept off very-high-value
   * jobs — but only when an established alternative exists, so a new carrier is never denied work
   * the network can't otherwise cover (M3-033/034).
   */
  eligibleForValue(did: string, value: number, hasEstablishedAlternative: boolean): boolean {
    if (!this.isColdStart(did)) return true;
    if (value <= COLD_START_VALUE_CAP) return true;
    return !hasEstablishedAlternative;
  }

  stats(did: string): Profile {
    return { ...this.profile(did) };
  }

  private profile(did: string): Profile {
    let p = this.profiles.get(did);
    if (!p) {
      p = { assignments: 0, completions: 0 };
      this.profiles.set(did, p);
    }
    return p;
  }
}
