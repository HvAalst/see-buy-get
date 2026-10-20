import { Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { GlosError } from '../../foundation/http/glos-error';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { DispatchService } from './dispatch.service';
import type { Freight } from './dispatch.types';
import { FlagCaseService } from './flag-case.service';
import { HELD_BY, HELD_BY_WORDS, heldView, type HeldBy, type HeldByAuthority, type HeldSaid, type LoadDetention } from './load-detention.types';
import { handedAt } from './observed-at';
import type { GeoPoint } from './pudo.types';

/**
 * A LOAD HELD BY THE POLICE OR CUSTOMS (load-detention.types.ts): said by the driver carrying it, and let go the same way.
 * Read by dispatch for the views, the delivery and the standstill watch through what it registers there; told to the
 * shipper, the fleet's office and both their systems by the events it publishes.
 */
@Injectable()
export class LoadDetentionService implements OnModuleInit {
  private readonly held = new PersistentMap<string, LoadDetention>('load-detentions');

  constructor(
    private readonly dispatch: DispatchService,
    private readonly events: EventBus,
    // Operations' case opens at once, as the tamper protocol's does, rather than at the next sweep. Optional for the specs.
    @Optional() private readonly cases?: FlagCaseService,
  ) {}

  /** Registered rather than injected into dispatch: this reads the load. */
  onModuleInit(): void {
    this.dispatch.registerDetentions({ current: (freightId) => this.current(freightId) });
  }

  /** Held now: the last time it was held, while it has not been let go. */
  current(freightId: string): HeldByAuthority | undefined {
    const open = this.open(freightId);
    return open ? heldView(open) : undefined;
  }

  /** Every time it was held, oldest first: for staff. */
  history(freightId: string): HeldByAuthority[] {
    return this.of(freightId).map(heldView);
  }

  /**
   * HELD: by the police, customs or another authority, who and where in the driver's words. Only the driver carrying it,
   * only on the road. Held already by the same is the tap sent twice; held by another is said once the first lets go.
   */
  sayHeld(freightId: string, driverDid: string, input: { by: HeldBy; who?: string; note?: string; location?: GeoPoint; observedAt?: string }, now: number = Date.now()): HeldSaid {
    const f = this.carried(freightId, driverDid);
    if (!HELD_BY.includes(input.by)) throw new GlosError('INVALID_INPUT', 'Say who holds it: the police, customs, or somebody else', { field: 'by' });
    const open = this.open(f.freightId);
    if (open) {
      if (open.by === input.by) return { held: heldView(open), replayed: true };
      throw new GlosError('INVALID_STATE', `It is held by ${HELD_BY_WORDS[open.by]} already: say it was let go before it is held by ${HELD_BY_WORDS[input.by]}`);
    }
    const location = input.location && validPoint(input.location) ? { lat: input.location.lat, lng: input.location.lng } : undefined;
    if (input.location && !location) throw new GlosError('INVALID_INPUT', 'Where the phone was is not a place on the map', { field: 'location' });
    const last = this.of(f.freightId).at(-1);
    const step = handedAt(input.observedAt, now, [f.pickedUpAt, last?.letGo?.at]);
    const d: LoadDetention = {
      detentionId: `hld_${randomBytes(8).toString('hex')}`,
      freightId: f.freightId,
      by: input.by,
      ...(words(input.who) ? { who: words(input.who) } : {}),
      ...(words(input.note) ? { note: words(input.note) } : {}),
      at: step.at,
      ...(step.receivedAt ? { receivedAt: step.receivedAt } : {}),
      driverDid,
      ...(location ? { location } : {}),
    };
    this.held.set(d.detentionId, d);
    const held = heldView(d);
    void this.events.publish(GlosEvent.Pudo.FreightHeld, { freightId: f.freightId, code: f.code, driverDid, posterDid: f.postedByDid ?? f.shipperDid, carrierDid: this.dispatch.carrierOf(f), held }, { source: 'pudo' }).catch(() => undefined);
    this.cases?.sync(now);
    return { held, replayed: false };
  }

  /** LET GO: the hold ends, as the driver says it. Said again once it has ended, the tap sent twice. */
  sayLetGo(freightId: string, driverDid: string, input: { note?: string; observedAt?: string }, now: number = Date.now()): HeldSaid {
    const f = this.carried(freightId, driverDid);
    const open = this.open(f.freightId);
    if (!open) {
      const last = this.of(f.freightId).at(-1);
      if (last?.letGo) return { held: heldView(last), replayed: true };
      throw new GlosError('INVALID_STATE', 'It is not held: nothing to be let go of');
    }
    const step = handedAt(input.observedAt, now, [open.at]);
    const done: LoadDetention = { ...open, letGo: { at: step.at, ...(step.receivedAt ? { receivedAt: step.receivedAt } : {}), ...(words(input.note) ? { note: words(input.note) } : {}) } };
    this.held.set(done.detentionId, done);
    const held = heldView(done);
    void this.events.publish(GlosEvent.Pudo.FreightLetGo, { freightId: f.freightId, code: f.code, driverDid, posterDid: f.postedByDid ?? f.shipperDid, carrierDid: this.dispatch.carrierOf(f), held }, { source: 'pudo' }).catch(() => undefined);
    this.cases?.sync(now);
    return { held, replayed: false };
  }

  /** The load this driver carries, on the road: anybody else's, or one not on the road, is refused. */
  private carried(freightId: string, driverDid: string): Freight {
    const f = this.dispatch.requireFreightPublic(freightId);
    if (f.claimedBy !== driverDid) throw new GlosError('FORBIDDEN', 'This freight was claimed by another driver');
    if (f.status !== 'in_transit') throw new GlosError('INVALID_STATE', `Freight is ${f.status}: held is said while it is on the road`);
    return f;
  }

  private open(freightId: string): LoadDetention | undefined {
    const last = this.of(freightId).at(-1);
    return last && !last.letGo ? last : undefined;
  }

  private of(freightId: string): LoadDetention[] {
    return [...this.held.values()].filter((d) => d.freightId === freightId).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  }
}

function words(raw: string | undefined): string | undefined {
  const s = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : '';
  return s || undefined;
}

function validPoint(p: GeoPoint): boolean {
  return Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;
}
