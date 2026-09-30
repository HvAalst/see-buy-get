import { Injectable } from '@nestjs/common';
import { GlosError } from '../../foundation/http/glos-error';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { AuthService } from '../../foundation/auth/auth.service';
import { AccountService } from './account.service';
import { DepartureService } from './departure.service';
import { DispatchService } from './dispatch.service';
import { DriverService } from './driver.service';
import { FleetManagerService } from './fleet-manager.service';
import { FleetService } from './fleet.service';
import { PersonService } from './person.service';
import type { FleetDriver, FleetManager } from './fleet.types';

/** What a driver is shown before they move: which fleet the code belongs to, and what is in the way. */
export interface FleetMoveCheck {
  fleetDid: string;
  companyName: string;
  /** The fleet they drive for now — absent for a courier who drives for themselves. */
  fromCompany?: string;
  /** Each thing to finish first, as a sentence the driver can act on. Empty means they are free to move. */
  blockers: string[];
}

/**
 * A DRIVER MOVES TO ANOTHER FLEET — with that fleet's code, from their own app.
 *
 * The user's answer (2026-09-30), once registration stopped forgetting who is registered: a driver who wants to
 * drive for another fleet enters that fleet's join code, the same code drivers already use to sign up to one. It
 * happens at once — no request sent, nothing left waiting on an answer — or it is refused by name.
 *
 * REFUSED WHILE ANYTHING IS UNFINISHED: a shift running, a load in hand, a run of the current fleet's still to go
 * or with goods aboard. Stop new commitments, never the finishing of old ones: the shippers on those planned
 * around this driver, and a driver who could walk off mid-run would leave them with a truck and nobody in it.
 *
 * WHAT MOVES AND WHAT STAYS. Everything keyed to the driver goes with them — papers, trips, ratings, badge. What
 * the old fleet did stays the old fleet's: every haul carries the carrier it was taken for (Freight.carrierDid),
 * so its earnings statement, its track record and its consignment notes are untouched, and the new fleet reads
 * none of them. The sign-in follows: the person link and the email account are re-pointed at the new fleet, and
 * every session the driver already holds ends, because each carries the old fleet as its tenant.
 */
@Injectable()
export class FleetMoveService {
  constructor(
    private readonly drivers: DriverService,
    private readonly managers: FleetManagerService,
    private readonly fleet: FleetService,
    private readonly dispatch: DispatchService,
    private readonly departures: DepartureService,
    private readonly persons: PersonService,
    private readonly accounts: AccountService,
    private readonly auth: AuthService,
    private readonly events: EventBus,
  ) {}

  /** Which fleet the code belongs to, and what (if anything) has to be finished first. Changes nothing. */
  check(driverDid: string, code: string, now: number = Date.now()): FleetMoveCheck {
    const driver = this.drivers.get(driverDid);
    const fleet = this.fleetFor(code);
    if (driver.managerDid === fleet.did) throw new GlosError('INVALID_STATE', `You already drive for ${fleet.companyName}`);
    const fromCompany = driver.managerDid ? this.companyOf(driver.managerDid) : undefined;
    return { fleetDid: fleet.did, companyName: fleet.companyName, ...(fromCompany ? { fromCompany } : {}), blockers: this.blockers(driverDid, now) };
  }

  /** Move now, or refuse by name. Returns the driver as they now stand and the fleet they joined. */
  move(driverDid: string, code: string, now: number = Date.now()): { driver: FleetDriver; companyName: string } {
    const check = this.check(driverDid, code, now);
    if (check.blockers.length) throw new GlosError('INVALID_STATE', `Finish this first: ${check.blockers.join('; ')}`, { blockers: check.blockers });

    const from = this.drivers.get(driverDid).managerDid;
    const driver = this.drivers.setFleet(driverDid, check.fleetDid);
    // The sign-in follows the driver: the person link and the email account now name the new fleet...
    this.persons.retenant('driver', driverDid, check.fleetDid);
    this.accounts.retenant(driverDid, check.fleetDid);
    // ...and every token already issued to this driver — each of which carries the OLD fleet as its tenant — ends.
    // Keyed to the driver, not the person: the same person's shop or consumer sign-in has nothing to do with this.
    this.auth.revokeAll(driverDid);

    void this.events
      .publish(
        GlosEvent.Pudo.DriverChangedFleet,
        { driverDid, driverName: driver.displayName, ...(from ? { fromManagerDid: from } : {}), toManagerDid: check.fleetDid, toCompany: check.companyName },
        { source: 'pudo' },
      )
      .catch(() => undefined);
    return { driver, companyName: check.companyName };
  }

  /** The fleet a join code belongs to — in the words a driver needs, not the console's sign-in words. */
  private fleetFor(code: string): FleetManager {
    try {
      return this.managers.login(code);
    } catch (err) {
      if (err instanceof GlosError && err.code === 'AUTH_CODE_INVALID') throw new GlosError('NOT_FOUND', 'No fleet has that code — check it with the fleet office', { field: 'code' });
      if (err instanceof GlosError && err.code === 'AUTH_NOT_ACTIVE') throw new GlosError('INVALID_STATE', 'That fleet is not taking on drivers right now');
      throw err;
    }
  }

  private companyOf(managerDid: string): string | undefined {
    try {
      return this.managers.get(managerDid).companyName;
    } catch {
      return undefined;
    }
  }

  /** What has to be finished before this driver may leave the fleet they are in. */
  private blockers(driverDid: string, now: number): string[] {
    const out: string[] = [];
    if (this.fleet.activeForDriver(driverDid)) out.push('you are on a shift — end it first');
    const cargo = this.dispatch.activeCargo(new Set([driverDid])).items;
    if (cargo.length === 1) out.push(`you are carrying ${cargo[0].ref} — deliver it or hand it back`);
    else if (cargo.length > 1) out.push(`you are carrying ${cargo.length} loads — deliver them or hand them back`);
    const runs = this.departures.unfinishedFor(driverDid, now);
    if (runs.length === 1) out.push(`you are on the ${runs[0].lineName} run — your fleet office has to take you off it`);
    else if (runs.length > 1) out.push(`you are on ${runs.length} of your fleet's runs — your fleet office has to take you off them`);
    return out;
  }
}
