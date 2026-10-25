import { Injectable, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';

/**
 * What changed, named the way a screen would ask about it again. A name only: whoever hears it reads what changed
 * through its own doors, which decide what it may see — the live connection itself carries no record of anybody's.
 */
export const LIVE_TOPICS = ['changed', 'bell', 'orders', 'loads', 'plan', 'vehicles', 'runs', 'cases', 'map'] as const;
export type LiveTopic = (typeof LIVE_TOPICS)[number];

/** Who is listening: the network's console (staff, and the administrators of our companies), or one fleet's office. */
export type LiveListener = { kind: 'console' } | { kind: 'fleet'; fleetDid: string };

/** The least time between two messages to one connection: what changes in between is said together, once. */
export const LIVE_GAP_MS = 2_000;
/** How often a quiet connection is told it is still open: inside every proxy's idle limit (Cloudflare's is 100 s). */
export const LIVE_BEAT_MS = 25_000;

interface Connection {
  id: number;
  who: LiveListener;
  send: (topics: LiveTopic[]) => void;
  pending: Set<LiveTopic>;
  /** When this connection was last told something; 0 before the first. */
  lastAt: number;
  timer?: ReturnType<typeof setTimeout>;
}

/**
 * ONE LIVE VIEW (assessment.html P4; the user, 2026-10-25: "Console and fleet offices"). The console and a fleet office's
 * screens are told the moment something they show may have changed, instead of waiting for somebody to press Refresh
 * (the console never read anything again by itself) or for the map's 45-second turn. Phones stay as they are, on push.
 *
 * WHAT IS SAID, TO WHOM:
 * - The console hears "changed" after any write anybody makes, and after any event the network publishes — except a
 *   phone saying where it is, which happens every few seconds and changes no queue. Staff may read the whole network,
 *   so being told something somewhere changed tells them nothing they could not ask.
 * - A fleet's office hears only of its own: what its own people did (their sign-in carries the fleet), each step of the
 *   orders, loads, runs, vehicles and plan its own screens show — the same fleets its own system's webhooks are told
 *   of, fleet-hooks.service.ts — a notice into its bell, and where its vehicles are.
 *
 * HOW: names only, at most one message every LIVE_GAP_MS a connection, the names in between gathered into it. One
 * server writes the records (store-postgres), so the connections live in its memory; a restart drops them, and each
 * screen connects again by itself and reads again once.
 */
@Injectable()
export class LiveService implements OnModuleInit, OnModuleDestroy {
  private readonly connections = new Map<number, Connection>();
  private nextId = 1;
  private stopListening?: () => void;

  constructor(@Optional() private readonly events?: EventBus) {}

  onModuleInit(): void {
    // Every event the network publishes may change a queue or a count on the console. A phone saying where it is does
    // neither, and comes every few seconds from every driver on a shift: that one goes only to its own fleet (map).
    this.stopListening = this.events?.subscribeAll((e) => {
      if (e.type !== GlosEvent.Pudo.DriverMoved) this.toConsole('changed');
    });
  }

  onModuleDestroy(): void {
    this.stopListening?.();
    for (const c of this.connections.values()) if (c.timer) clearTimeout(c.timer);
    this.connections.clear();
  }

  /** A screen starts listening. Returns what ends it, which is also what a closed connection calls. */
  open(who: LiveListener, send: (topics: LiveTopic[]) => void): () => void {
    const id = this.nextId++;
    this.connections.set(id, { id, who, send, pending: new Set(), lastAt: 0 });
    return () => {
      const c = this.connections.get(id);
      if (c?.timer) clearTimeout(c.timer);
      this.connections.delete(id);
    };
  }

  /** Something the console shows may have changed. */
  toConsole(topic: LiveTopic, now: number = Date.now()): void {
    for (const c of this.connections.values()) if (c.who.kind === 'console') this.queue(c, topic, now);
  }

  /** Something one fleet's office shows may have changed — told to that fleet's screens and nobody else's. */
  toFleet(fleetDid: string | undefined, topic: LiveTopic, now: number = Date.now()): void {
    if (!fleetDid) return;
    for (const c of this.connections.values()) if (c.who.kind === 'fleet' && c.who.fleetDid === fleetDid) this.queue(c, topic, now);
  }

  /**
   * A notice put into somebody's bell, or read there. The screens that listen and have a bell are a fleet office's, whose
   * notices are kept under the fleet's own did (every manager shares it); anybody else's bell has no live screen.
   */
  toOwner(ownerDid: string | undefined, topic: LiveTopic = 'bell', now: number = Date.now()): void {
    this.toFleet(ownerDid, topic, now);
  }

  /** How many screens are listening — for the server's own picture of itself, never who. */
  count(): { console: number; fleets: number } {
    let consoleN = 0;
    let fleets = 0;
    for (const c of this.connections.values()) {
      if (c.who.kind === 'console') consoleN += 1;
      else fleets += 1;
    }
    return { console: consoleN, fleets };
  }

  private queue(c: Connection, topic: LiveTopic, now: number): void {
    c.pending.add(topic);
    if (c.timer) return; // a message is already due: this name goes with it
    // The first message goes at once, and so does one after a quiet gap; one soon after the last waits out the gap.
    const wait = c.lastAt ? c.lastAt + LIVE_GAP_MS - now : 0;
    if (wait <= 0) {
      this.flush(c, now);
      return;
    }
    c.timer = setTimeout(() => this.flush(c, Date.now()), wait);
    c.timer.unref?.();
  }

  private flush(c: Connection, now: number): void {
    c.timer = undefined;
    if (!this.connections.has(c.id) || !c.pending.size) return;
    const topics = [...c.pending];
    c.pending.clear();
    c.lastAt = now;
    try {
      c.send(topics);
    } catch {
      // A connection that went away mid-message closes by itself; the others are not held up by it.
    }
  }
}
