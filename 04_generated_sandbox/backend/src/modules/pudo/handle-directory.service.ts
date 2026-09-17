import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { HandleService } from '../../foundation/handle/handle.service';
import { EntityService } from '../../foundation/entity/entity.service';
import { AgentService } from './agent.service';
import { MdpService } from './mdp.service';
import { FleetManagerService } from './fleet-manager.service';

/**
 * ISSUING THE HANDLES — every shop, hub, fleet and company gets its address.
 *
 * Deliberately a sweep rather than four edits to four creation paths. `HandleService.issue` is idempotent
 * on the participant, so running this repeatedly costs nothing and cannot mint a second handle for anybody;
 * the alternative was injecting the namespace into AgentService, MdpService, FleetManagerService and
 * EntityService, which is four constructor changes and four chances of a dependency cycle for a fact none
 * of those services needs to know.
 *
 * It runs at bootstrap and again whenever the population has changed, which is what makes a shop that
 * registered a minute ago reachable at its page without waiting for a restart. The dirty check is a count
 * rather than a timer: nothing here should run on a clock, and a sweep that finds nothing new is wasted
 * work on every page view.
 *
 * ORDER IS NOT INCIDENTAL. Companies are swept FIRST so that a sister or partner company holds the bare
 * form of a contested name, and a shop that happens to share it takes the discriminated one. The network's
 * own companies are the records we are surest of.
 */
@Injectable()
export class HandleDirectory implements OnApplicationBootstrap {
  private lastSweptCount = -1;

  constructor(
    private readonly handles: HandleService,
    private readonly entities: EntityService,
    private readonly agents: AgentService,
    private readonly mdps: MdpService,
    private readonly managers: FleetManagerService,
  ) {}

  onApplicationBootstrap(): void {
    this.ensure();
  }

  /** Issue anything missing, and only when the population has actually moved. */
  ensure(): void {
    const companies = this.entities.list();
    const shops = this.agents.list();
    const hubs = this.mdps.list();
    const fleets = this.managers.list();
    const total = companies.length + shops.length + hubs.length + fleets.length;
    if (total === this.lastSweptCount) return;

    for (const c of companies) this.handles.issue({ kind: 'company', id: c.entityId, name: c.name, country: c.jurisdiction });
    for (const s of shops) this.handles.issue({ kind: 'shop', id: s.did, name: s.shopName, country: this.agents.countryOf(s) });
    for (const h of hubs) this.handles.issue({ kind: 'hub', id: h.did, name: h.name, country: this.mdps.countryOf(h) });
    for (const f of fleets) this.handles.issue({ kind: 'fleet', id: f.did, name: f.companyName, country: f.jurisdiction });

    this.lastSweptCount = total;
  }
}
