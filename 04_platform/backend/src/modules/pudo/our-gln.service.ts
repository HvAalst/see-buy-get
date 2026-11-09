import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { AgentService } from './agent.service';
import { haversineKm } from './geo';
import { MdpService } from './mdp.service';
import { NotificationService } from './notification.service';
import { GLN_MOVED_KM, OurGlnBook, type OurGln, type OurPlaceKind } from './our-gln.book';
import type { Agent, GeoPoint } from './pudo.types';

export { OurGlnBook } from './our-gln.book';
export type { OurGln, OurGs1Status, OurPlaceKind } from './our-gln.book';

/** How often the sweeper looks for places without a number: a shop approved now has its number within this. */
const SWEEP_MS = 10 * 60_000;

/** A shop is numbered once SeeBuyGet approved it: from then it is a place in the network. */
const NUMBERED_SHOP: ReadonlyArray<Agent['status']> = ['APPROVED_UNFUNDED', 'ACTIVE', 'LOCKED'];

@Injectable()
export class OurGlnSweeper implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OurGlnSweeper.name);
  private timer?: ReturnType<typeof setInterval>;
  private first?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly book: OurGlnBook,
    private readonly agents: AgentService,
    private readonly mdps: MdpService,
    @Optional() private readonly notifications?: NotificationService,
  ) {}

  onModuleInit(): void {
    const run = () => {
      try {
        this.sweep();
      } catch (err) {
        this.logger.warn(`numbering our places did not run: ${(err as Error).message}`);
      }
    };
    this.first = setTimeout(run, 30_000);
    this.first.unref?.();
    this.timer = setInterval(run, SWEEP_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.first) clearTimeout(this.first);
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Number every approved place without a GLN; give a place that moved a new one and retire the old; retire the number of a
   * place that is gone. How many GLNs were given. Without SeeBuyGet's prefix on the server, nothing.
   */
  sweep(now: number = Date.now(), env: NodeJS.ProcessEnv = process.env): number {
    const prefix = this.book.prefix(env);
    if (!prefix) return 0;
    const places: Array<{ kind: OurPlaceKind; id: string; did: string; name: string; country?: string; location: GeoPoint }> = [];
    for (const a of this.agents.list()) {
      if (!NUMBERED_SHOP.includes(a.status) || !a.location) continue;
      places.push({ kind: 'shop', id: a.did, did: a.did, name: a.shopName, country: this.agents.countryOf(a), location: a.location });
    }
    for (const m of this.mdps.list()) {
      if (!this.mdps.isApproved(m) || !m.location) continue;
      places.push({ kind: 'hub', id: m.mdpId, did: m.did, name: m.name, country: this.mdps.countryOf(m), location: m.location });
    }
    // A place gone from the network: its number is retired, never given to another.
    const present = new Set(places.map((p) => `${p.kind}:${p.id}`));
    for (const g of this.book.all()) if (!g.retiredAt && !present.has(`${g.kind}:${g.id}`) && !this.stillThere(g)) this.book.retire(g.gln, 'gone', now);
    let given = 0;
    for (const p of places) {
      const live = this.book.liveOf(p.kind, p.id);
      if (live && haversineKm(live.location, p.location) <= GLN_MOVED_KM) continue;
      if (live) this.book.retire(live.gln, 'moved', now);
      const g = this.book.give(prefix, { kind: p.kind, id: p.id, name: p.name, ...(p.country ? { country: p.country } : {}), location: { ...p.location } }, now);
      if (!g) break;
      given += 1;
      this.tell(p.did, g, Boolean(live));
    }
    return given;
  }

  /** A place still on the record but not numbered now (a shop back in draft, a hub's approval withdrawn) keeps its number. */
  private stillThere(g: OurGln): boolean {
    return g.kind === 'shop' ? Boolean(this.agents.find(g.id)) : this.mdps.list().some((m) => m.mdpId === g.id);
  }

  private tell(did: string, g: OurGln, moved: boolean): void {
    const where = g.kind === 'shop' ? 'collection point' : 'hub';
    void this.notifications
      ?.notify(did, {
        kind: 'place_gln',
        title: `Your ${where} has its GS1 location number`,
        body: `${moved ? `${g.name} moved, so it is a new place with a new number` : `SeeBuyGet gave ${g.name} its number`}: GLN ${g.gln} (Global Location Number). ${g.kind === 'shop' ? 'It is printed on the labels of parcels coming to you, and' : 'It is shown on your hub’s page, and'} businesses can use it to address goods to this place.${moved ? ' The old number is never given to another place.' : ' It names this place only: if you move, you get a new one.'}`,
        link: '/',
        tag: `gln:${g.gln}`,
        data: { ref: g.gln },
      })
      .catch(() => undefined);
  }
}
