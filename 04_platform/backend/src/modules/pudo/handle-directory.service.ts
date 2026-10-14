import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { HandleService } from '../../foundation/handle/handle.service';
import { EntityService } from '../../foundation/entity/entity.service';
import { listedPublicly } from '../../foundation/entity/entity.types';
import { AgentService } from './agent.service';
import { MdpService } from './mdp.service';
import { FleetManagerService } from './fleet-manager.service';
import { DriverService } from './driver.service';

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
 * own companies are the records we are surest of. Owner-drivers are swept LAST for the same reason read
 * the other way round: where a person's display name collides with a trading name, the business keeps the
 * bare form, because that is the name a customer is typing.
 *
 * WHICH DRIVERS. Independent ones, and only once they are ACTIVE. Independent because a handle goes to
 * whoever the network contracts with and a fleet-attached driver is contracted through their fleet (see
 * HandleService). Active because a page is an address a stranger may type, and an address for somebody
 * still being vetted — or refused — publishes a decision that is nobody's business but ours and theirs.
 */
/**
 * WHICH DRIVERS HOLD AN ADDRESS: the ones the network contracts with, once we have actually said yes.
 *
 * Exported and pure so the boundary can be asserted without standing up the whole module — the rule is
 * the interesting part of this file, and a rule only reachable through eight injected services is a rule
 * nobody will write a test for.
 */
export function ownerDrivers<T extends { managerDid?: string; removedFrom?: unknown; status: string }>(drivers: T[]): T[] {
  // No fleet is not the same as their own boss: a driver a fleet took off is between fleets, contracted by nobody.
  return drivers.filter((d) => !d.managerDid && !d.removedFrom && d.status === 'ACTIVE');
}

@Injectable()
export class HandleDirectory implements OnApplicationBootstrap {
  private lastSweptCount = -1;

  constructor(
    private readonly handles: HandleService,
    private readonly entities: EntityService,
    private readonly agents: AgentService,
    private readonly mdps: MdpService,
    private readonly managers: FleetManagerService,
    private readonly drivers: DriverService,
  ) {}

  onApplicationBootstrap(): void {
    this.ensure();
  }

  /** Issue anything missing, and only when the population has actually moved. */
  ensure(): void {
    // A customer's business only once two members of staff have checked its papers: the name is its own claim until
    // then, and a handle is never taken back. Filtered BEFORE the count, so the check passing is itself the change
    // that makes the next sweep run.
    const companies = this.entities.list().filter(listedPublicly);
    const shops = this.agents.list();
    const hubs = this.mdps.list();
    const fleets = this.managers.list();
    const owners = ownerDrivers(this.drivers.list());
    const total = companies.length + shops.length + hubs.length + fleets.length + owners.length;
    if (total === this.lastSweptCount) return;

    for (const c of companies) this.handles.issue({ kind: 'company', id: c.entityId, name: c.name, country: c.jurisdiction });
    for (const s of shops) this.handles.issue({ kind: 'shop', id: s.did, name: s.shopName, country: this.agents.countryOf(s) });
    for (const h of hubs) this.handles.issue({ kind: 'hub', id: h.did, name: h.name, country: this.mdps.countryOf(h) });
    for (const f of fleets) this.handles.issue({ kind: 'fleet', id: f.did, name: f.companyName, country: f.jurisdiction });
    // The DISPLAY NAME, never the vault. FleetDriver defines it as the non-PII shop-floor label precisely
    // so there is a name to use in public, and the Golden Record stays where it is.
    for (const d of owners) this.handles.issue({ kind: 'driver', id: d.did, name: d.displayName, country: d.jurisdiction });

    this.lastSweptCount = total;
  }
}
