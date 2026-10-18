import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { AuthService } from '../../foundation/auth/auth.service';
import { IntrospectionResult } from '../../foundation/auth/auth.types';
import { GlosError } from '../../foundation/http/glos-error';
import { hashPhone, isPlausiblePhone, normalizePhone } from '../../foundation/identity/phone';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { AgentService } from './agent.service';
import { PersonService } from './person.service';
import { CounterAct, isShopStaff, MAX_SHOP_STAFF, ShopInvitationView, ShopStaffMember, ShopStaffSession, ShopStaffState, ShopStaffView, STAFF_KEY_PREFIX } from './shop-staff.types';

/** How much of the counter's history the owner reads at once, newest first. */
const LOG_LIMIT = 300;

/** The words for each counter act the log keeps, by the route handler that does it — or, where the body says which, by what it says. */
export const COUNTER_ACTS: Readonly<Record<string, string | ((body: Record<string, unknown>) => string)>> = {
  accept: 'took a parcel in',
  intake: 'took a parcel in',
  arrive: 'received a parcel off the bus',
  shelve: 'shelved a parcel',
  pickup: 'handed a parcel to its receiver',
  collectConfirm: 'handed a parcel to its receiver',
  voidParcel: 'voided a take-in',
  dispute: 'recorded a dispute',
  handover: 'handed parcels to the bus',
  receiveBag: 'received a bag',
  fillShopBag: 'filled a bag',
  sealShopBag: 'sealed a bag',
  bookFreight: 'booked a load',
  setAvailability: (body) => (body.open === true ? 'opened the shop' : 'closed the shop'),
};

/**
 * THE PEOPLE AT A SHOP'S COUNTER (shop-staff.types.ts): added by the owner, accepted from their own sign-in, a session on
 * the shop's phone under their own name, taken out at once — and the counter's own record of who did what.
 */
@Injectable()
export class ShopStaffService {
  private readonly members = new PersistentMap<string, ShopStaffMember>('shop-staff');
  private readonly log = new PersistentMap<string, CounterAct & { shopDid: string }>('shop-counter-log');

  constructor(
    private readonly agents: AgentService,
    private readonly persons: PersonService,
    private readonly auth: AuthService,
  ) {}

  /** The shop's people, and who is invited. The owner's. */
  list(shopDid: string): ShopStaffView[] {
    return [...this.members.values()]
      .filter((m) => m.shopDid === shopDid)
      .sort((a, b) => stateRank(stateOf(a)) - stateRank(stateOf(b)) || a.invitedAt.localeCompare(b.invitedAt))
      .map(viewOf);
  }

  /** Add somebody by their phone number, under the name the shop knows them by. The same answer whoever has that number. */
  invite(shopDid: string, input: { phone: string; name: string }, by: string, now: number = Date.now()): ShopStaffView {
    this.agents.get(shopDid);
    if (!isPlausiblePhone(input.phone ?? '')) throw new GlosError('PHONE_INVALID', 'Enter the phone number they sign in with', { field: 'phone' });
    const name = (input.name ?? '').trim().slice(0, 60);
    if (!name) throw new GlosError('FIELD_REQUIRED', 'Say who this is — what they do at the counter is recorded under this name', { field: 'name' });
    const phoneHash = hashPhone(input.phone);
    const live = this.live(shopDid);
    if (live.some((m) => m.phoneHash === phoneHash)) throw new GlosError('CONFLICT', 'That number is already at this counter, or invited to it', { field: 'phone' });
    if (live.length >= MAX_SHOP_STAFF) throw new GlosError('INVALID_STATE', `A shop can have ${MAX_SHOP_STAFF} people at its counter`);
    const settled = this.persons.settledAt(phoneHash, now);
    const member: ShopStaffMember = {
      memberId: `ssm_${randomBytes(8).toString('hex')}`,
      shopDid,
      phoneHash,
      ...(settled ? { forPersonDid: settled.personDid } : {}),
      phoneEnds: normalizePhone(input.phone).replace(/\D/g, '').slice(-3),
      name,
      invitedBy: by,
      invitedAt: new Date(now).toISOString(),
    };
    this.members.set(member.memberId, member);
    return viewOf(member);
  }

  /** Take somebody out: kept, so the owner sees who was, and every sign-in of theirs at this shop ends now. */
  remove(shopDid: string, memberId: string, by: string, now: number = Date.now()): ShopStaffView {
    const member = this.members.get(memberId);
    if (!member || member.shopDid !== shopDid) throw new GlosError('NOT_FOUND', 'No such person at this counter');
    if (!member.removedAt) {
      member.removedAt = new Date(now).toISOString();
      member.removedBy = by;
      this.members.set(member.memberId, member);
      this.auth.revokeAll(`${STAFF_KEY_PREFIX}${member.memberId}`);
    }
    return viewOf(member);
  }

  /** The shops a person was added to, from their own sign-in: invitations waiting, and the counters they work. */
  mine(personDid: string): ShopInvitationView[] {
    const person = this.persons.findByDid(personDid);
    if (!person) throw new GlosError('NOT_FOUND', 'Sign in first');
    return [...this.members.values()]
      .filter((m) => !m.removedAt && !m.declinedAt && (m.personDid === personDid || (!m.joinedAt && isFor(m, person.personDid, person.phoneHash))))
      .map((m) => ({ memberId: m.memberId, shopDid: m.shopDid, shopName: this.shopName(m.shopDid), name: m.name, state: m.joinedAt ? ('working' as const) : ('invited' as const), invitedAt: m.invitedAt }));
  }

  /** Yes — as the person the number was sent to, signed in with their own PIN. */
  accept(personDid: string, memberId: string, now: number = Date.now()): ShopInvitationView {
    const member = this.invitationFor(personDid, memberId);
    member.personDid = personDid;
    member.joinedAt = new Date(now).toISOString();
    this.members.set(member.memberId, member);
    return this.mine(personDid).find((m) => m.memberId === memberId)!;
  }

  /** No. Kept, so the owner sees it was declined. */
  decline(personDid: string, memberId: string, now: number = Date.now()): { declined: true } {
    const member = this.invitationFor(personDid, memberId);
    member.declinedAt = new Date(now).toISOString();
    this.members.set(member.memberId, member);
    return { declined: true };
  }

  /**
   * A SESSION AT THE COUNTER: a sign-in that acts as the shop, named for this person, revoked by their place at it — so
   * taking them out of this shop ends it, and nothing else of theirs.
   */
  session(personDid: string, shopDid: string): ShopStaffSession {
    const member = [...this.members.values()].find((m) => m.shopDid === shopDid && m.personDid === personDid && m.joinedAt && !m.removedAt);
    if (!member) throw new GlosError('FORBIDDEN', 'You are not at this shop’s counter. The owner adds you by your number; you say yes from your own sign-in.');
    const token = this.auth.mintActorToken({ role: 'agent', did: shopDid, actorName: member.name, personDid, revocationKey: `${STAFF_KEY_PREFIX}${member.memberId}` });
    return { shopDid, shopName: this.shopName(shopDid), name: member.name, memberId: member.memberId, token };
  }

  /** An act at the counter, under who did it: a person's name, or the owner for the shop's own sign-in. */
  note(actor: IntrospectionResult | undefined, handler: string, ref: string | undefined, body: Record<string, unknown> = {}, now: number = Date.now()): void {
    const words = COUNTER_ACTS[handler];
    if (!words || actor?.role !== 'agent' || !actor.did) return;
    const act = typeof words === 'function' ? words(body) : words;
    const staff = isShopStaff(actor);
    const id = `ca_${now.toString(36)}_${randomBytes(4).toString('hex')}`;
    this.log.set(id, { shopDid: actor.did, at: new Date(now).toISOString(), act, ...(ref ? { ref } : {}), by: staff ? (actor.actorName ?? 'a member of staff') : 'the owner', staff });
  }

  /** Who did what at the counter, newest first. The owner's. */
  counterLog(shopDid: string): CounterAct[] {
    return [...this.log.values()]
      .filter((a) => a.shopDid === shopDid)
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, LOG_LIMIT)
      .map((a): CounterAct => ({ at: a.at, act: a.act, ...(a.ref ? { ref: a.ref } : {}), by: a.by, staff: a.staff }));
  }

  private live(shopDid: string): ShopStaffMember[] {
    return [...this.members.values()].filter((m) => m.shopDid === shopDid && !m.removedAt && !m.declinedAt);
  }

  private invitationFor(personDid: string, memberId: string): ShopStaffMember {
    const person = this.persons.findByDid(personDid);
    const member = this.members.get(memberId);
    if (!person || !member || member.removedAt || member.declinedAt || member.joinedAt || !isFor(member, person.personDid, person.phoneHash)) {
      throw new GlosError('NOT_FOUND', 'No such invitation for you');
    }
    return member;
  }

  private shopName(shopDid: string): string {
    try {
      return this.agents.get(shopDid).shopName;
    } catch {
      return 'A shop';
    }
  }
}

/** For this person: the account the number was certainly for when they were added, or — none known then — the number. */
function isFor(m: ShopStaffMember, personDid: string, phoneHash: string): boolean {
  return m.forPersonDid ? m.forPersonDid === personDid : m.phoneHash === phoneHash;
}

function stateOf(m: ShopStaffMember): ShopStaffState {
  return m.removedAt ? 'removed' : m.declinedAt ? 'declined' : m.joinedAt ? 'working' : 'invited';
}

function stateRank(s: ShopStaffState): number {
  return ['working', 'invited', 'declined', 'removed'].indexOf(s);
}

function viewOf(m: ShopStaffMember): ShopStaffView {
  return {
    memberId: m.memberId,
    name: m.name,
    phoneEnds: m.phoneEnds,
    state: stateOf(m),
    invitedAt: m.invitedAt,
    ...(m.joinedAt ? { joinedAt: m.joinedAt } : {}),
    ...(m.removedAt ? { removedAt: m.removedAt } : {}),
  };
}
