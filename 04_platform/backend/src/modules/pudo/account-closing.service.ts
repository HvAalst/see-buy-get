import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, Optional } from '@nestjs/common';
import { GlosError } from '../../foundation/http/glos-error';
import { MailService } from '../../foundation/mail/mail.service';
import { PersonService } from './person.service';
import { Person } from './person.types';
import { ParcelService } from './parcel.service';
import { DispatchService } from './dispatch.service';
import { AgentService } from './agent.service';
import { DriverService } from './driver.service';
import { FleetManagerService } from './fleet-manager.service';
import { VendorService } from './vendor.service';
import { AccountService } from './account.service';
import { NotificationService } from './notification.service';
import { IdDisputeService } from './id-dispute.service';
import { AccountMoveService } from './account-move.service';
import { PayoutNumberService } from './payout-number.service';
import { BusinessService } from './business.service';

/** Four years without a sign-in, and the owner is told the account can be closed (the user, 2026-10-22). */
export const INACTIVE_MONTHS = 48;
/** How often the notice is looked for: often enough to be on the day, rarely enough to cost nothing. */
const SWEEP_MS = 6 * 60 * 60 * 1000;

/** What keeps an account from closing, by kind: the app says each in the reader's words. */
export type OpenKind =
  | 'parcels' // parcels they sent, or are to collect, still on their way
  | 'shop-parcels' // parcels at, or on their way to or from, a shop of theirs
  | 'shop-money' // a shop's float, or credit it owes
  | 'loads' // loads aboard as a driver
  | 'driver-money' // earned as a driver and not yet paid
  | 'fleet-drivers' // a fleet of theirs still has drivers
  | 'fleet-loads' // loads a fleet of theirs is carrying
  | 'hub' // a sort hub: taken off the network by SeeBuyGet staff first
  | 'store-parcels' // a store's parcels still on their way
  | 'store-orders' // a store's orders not yet shipped
  | 'store-money' // a store's balance
  | 'claims' // a claim on a load they carried, posted or shipped
  | 'id-dispute' // a dispute over the national ID on a registration of theirs
  | 'account-move'; // somebody asked staff to move this account to another number

export interface ClosingStanding {
  /** Told it can be closed, since when. Absent: it cannot be closed yet. */
  closableSince?: string;
  /** What is still open, when it can be closed at all. Empty: it can be closed now. */
  open: Array<{ kind: OpenKind; count?: number }>;
}

/** The day `months` after `iso`, in UTC. */
export function monthsAfter(iso: string, months: number): number {
  const d = new Date(iso);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.getTime();
}

const DONE_PARCEL = new Set(['Delivered', 'Voided', 'Returned', 'Lost']);
const LOAD_MOVING = new Set(['ordered', 'claimed', 'in_transit']);

/**
 * CLOSING AN ACCOUNT (the user, 2026-10-22): "After it is inactive for 48 months the account owner will be informed that
 * his inactive account can be closed" — and the four answers that settled the rest: the owner closes it, from Settings;
 * only when NOTHING is open; and closing removes personal details only.
 *
 * THE NOTICE. Every few hours, each account that has gone 48 months without a sign-in (counted from its last, or from
 * when it was made) and was not told since is told: in the app, wherever it signs in, and by email where it has one —
 * both of which reach it even muted. From then Settings offers "Close my account". Nothing closes by itself.
 *
 * THE CLOSE. Asked with the PIN, refused while anything is open — said thing by thing — and then, in order: every
 * role's own record forgets its owner (their shop, driving, fleet, store), their number leaves every parcel, payout and
 * business, every email-and-password sign-in made with their number goes, and last the person: vault, photo, PIN,
 * devices, email, and the number itself. Every session ends. What stays is what other people's records point at —
 * parcels, hand-overs, consignment notes — reading "closed account" where the person was.
 */
@Injectable()
export class AccountClosingService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(AccountClosingService.name);
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly persons: PersonService,
    private readonly parcels: ParcelService,
    private readonly dispatch: DispatchService,
    private readonly agents: AgentService,
    private readonly drivers: DriverService,
    private readonly fleets: FleetManagerService,
    private readonly vendors: VendorService,
    private readonly accounts: AccountService,
    private readonly notifications: NotificationService,
    private readonly idDisputes: IdDisputeService,
    private readonly moves: AccountMoveService,
    private readonly payoutNumbers: PayoutNumberService,
    private readonly businesses: BusinessService,
    @Optional() private readonly mail?: MailService,
  ) {}

  onApplicationBootstrap(): void {
    void this.sweep().catch((err: Error) => this.logger.warn(`the closing notice did not run: ${err.message}`));
    this.timer = setInterval(() => void this.sweep().catch((err: Error) => this.logger.warn(`the closing notice did not run: ${err.message}`)), SWEEP_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Is this account due the notice: 48 months since it last signed in (or was made), and not told since? */
  due(person: Person, now: number = Date.now()): boolean {
    if (person.closedAt) return false;
    const last = person.lastSignInAt ?? person.createdAt;
    if (!last || monthsAfter(last, INACTIVE_MONTHS) > now) return false;
    // Told already, and not signed in since: once for each four years without a sign-in, never every day.
    return !person.closableNoticeAt || person.closableNoticeAt < last;
  }

  /** Tell every account that is due. Returns how many were told. */
  async sweep(now: number = Date.now()): Promise<number> {
    let told = 0;
    for (const person of this.persons.everyone()) {
      if (!this.due(person, now)) continue;
      const last = person.lastSignInAt ?? person.createdAt;
      this.persons.markClosable(person.personDid, now);
      await this.tell(person, last);
      told += 1;
    }
    return told;
  }

  private async tell(person: Person, last: string): Promise<void> {
    const payload = {
      // About the account itself: it reaches the owner even with the account muted.
      kind: 'security' as const,
      title: 'Your account can be closed',
      body: 'Your SeeBuyGet account has not been signed in to for four years. If you no longer need it, you can close it under Settings › Close my account. Nothing happens unless you do it.',
      link: '/',
    };
    // Wherever they sign in: as themselves, and as each shop, driver, fleet or store of theirs.
    const owners = [person.personDid, ...person.roles.filter((r) => r.role !== 'consumer' && r.entityDid).map((r) => r.entityDid)];
    for (const owner of new Set(owners)) await this.notifications.notify(owner, payload).catch(() => undefined);
    const address = this.persons.emailOf(person);
    if (address) await this.mail?.send('account-may-close', { address }, { lastSignInAt: last }).catch(() => false);
  }

  /** Can this account be closed, and if so what is still open — for Settings, before the PIN is asked. */
  standing(personDid: string): ClosingStanding {
    const person = this.persons.requireByDid(personDid);
    if (!person.closableSince || person.closedAt) return { open: [] };
    return { closableSince: person.closableSince, open: this.openOf(person) };
  }

  /** Everything that keeps this account from closing, by kind, across every role it owns. */
  openOf(person: Person): ClosingStanding['open'] {
    const open: ClosingStanding['open'] = [];
    const add = (kind: OpenKind, count: number) => {
      if (count > 0) open.push({ kind, count });
    };
    const roles = person.roles.filter((r) => r.role !== 'consumer' && r.entityDid);
    const dids = new Set([person.personDid, ...roles.map((r) => r.entityDid)]);

    add('parcels', this.parcels.openFor(person.personDid));
    for (const role of roles) {
      const did = role.entityDid;
      if (role.role === 'agent') {
        add('shop-parcels', this.parcels.list({ agentDid: did }).filter((p) => !DONE_PARCEL.has(p.status)).length);
        const balance = this.agents.balance(did) ?? 0;
        add('shop-money', Math.abs(balance) >= 0.01 || this.agents.creditOwed(did) >= 0.01 ? 1 : 0);
      } else if (role.role === 'driver') {
        add('loads', this.dispatch.loadsAboard(did));
        add('driver-money', this.dispatch.driverJobsSummary(did, {}).unpaid >= 0.01 ? 1 : 0);
      } else if (role.role === 'fleet_manager') {
        add('fleet-drivers', this.drivers.list({ managerDid: did }).filter((d) => d.status !== 'SUSPENDED').length);
        add('fleet-loads', this.dispatch.listFreight().filter((f) => LOAD_MOVING.has(f.status) && this.dispatch.carrierOf(f) === did).length);
      } else if (role.role === 'mdp') {
        // A sort hub is part of every route through its zones: SeeBuyGet staff take it off the network first.
        add('hub', 1);
      } else if (role.role === 'vendor') {
        const store = this.vendors.byDid(did);
        if (store) {
          add('store-parcels', this.parcels.list({ vendorId: store.vendorId }).filter((p) => !DONE_PARCEL.has(p.status)).length);
          add('store-orders', this.vendors.checkoutsFor(store.vendorId).length);
          add('store-money', Math.abs(this.vendors.balanceOrNone(store.vendorId) ?? 0) >= 0.01 ? 1 : 0);
        }
      }
    }
    add(
      'claims',
      this.dispatch.openFreightClaims().filter((f) => {
        const posted = (f as { postedByDid?: string }).postedByDid;
        return [f.claimedBy, f.shipperDid, posted, this.dispatch.carrierOf(f)].some((d) => d && dids.has(d));
      }).length,
    );
    add('id-dispute', this.idDisputes.against(person.personDid) ? 1 : 0);
    add('account-move', this.moves.openAgainst(person.personDid) ? 1 : 0);
    return open;
  }

  /**
   * CLOSE IT — the owner, with their PIN, once told it can be closed and with nothing open. Personal details only:
   * see the class comment for what goes and what stays. Answers what the app needs to say it is done; the session that
   * asked has ended with every other.
   */
  async close(personDid: string, pin: string, now: number = Date.now()): Promise<{ closedAt: string }> {
    const person = this.persons.requireByDid(personDid);
    if (person.closedAt) return { closedAt: person.closedAt };
    if (!person.closableSince) {
      throw new GlosError('INVALID_STATE', 'This account cannot be closed yet. An account can be closed once it has gone four years without a sign-in, and its owner has been told so.', { reason: 'not_closable' });
    }
    // The PIN, as for every change that cannot be undone: an open session is not proof of who holds the phone.
    this.persons.confirmPin(personDid, pin);
    const open = this.openOf(person);
    if (open.length) throw new GlosError('INVALID_STATE', 'This account still has something open, so it cannot be closed yet. Settings says what.', { reason: 'still_open', open });

    // Told on the way out, at the address that is about to go: a close somebody else made with a stolen PIN is an alarm.
    const address = this.persons.emailOf(person);
    if (address) {
      await this.mail
        ?.send('account-safety', { address }, { headline: 'Your account was closed', what: 'Your SeeBuyGet account was closed. Your name, ID number, phone number, email and ID photos have been removed.', next: 'If it was not you, write to us at once from the SeeBuyGet help, under “My data, or closing my account”.', when: new Date(now).toISOString() })
        .catch(() => false);
    }

    const phoneHash = person.phoneHash;
    for (const role of person.roles) {
      const did = role.entityDid;
      if (!did || role.role === 'consumer') continue;
      if (role.role === 'agent') this.agents.forgetOwner(did);
      else if (role.role === 'driver') this.drivers.forgetOwner(did);
      else if (role.role === 'fleet_manager') this.fleets.forgetOwner(did);
      else if (role.role === 'vendor') this.vendors.forgetOwner(did);
      this.payoutNumbers.forget(did);
    }
    this.parcels.forgetPerson(phoneHash, personDid, address);
    this.businesses.forgetPerson(personDid, phoneHash, now);
    this.accounts.forgetForPhone(phoneHash);
    const closed = this.persons.close(personDid, now);
    this.logger.log(`an account was closed by its owner (${personDid})`);
    return { closedAt: closed.closedAt as string };
  }
}
