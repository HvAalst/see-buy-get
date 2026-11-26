import { MollieConnectService } from '../../foundation/mollie/mollie-connect.service';
import type { MolliePartnerChange } from '../../foundation/mollie/mollie.types';
import { MailService } from '../../foundation/mail/mail.service';
import { Injectable, Optional } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { randomBytes } from 'crypto';
import { AuthService } from '../../foundation/auth/auth.service';
import type { IntrospectionResult } from '../../foundation/auth/auth.types';
import { EntityService } from '../../foundation/entity/entity.service';
import type { Entity } from '../../foundation/entity/entity.types';
import { GlosError } from '../../foundation/http/glos-error';
import { hashPhone, isPlausiblePhone, normalizePhone } from '../../foundation/identity/phone';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { isFor, waitsAt, type Addressed } from './addressed-to';
import { PartnerLedgerView } from './partner-ledger.service';
import { PersonService } from './person.service';

/**
 * 2026-11-20 — A PARTNER'S OWN PEOPLE (the payments plan, 3c; the owner: "console for staff and partner app with live view";
 * a separate Partner app). Our staff add them by phone number from the partner's own page; they sign in to the Partner app
 * with their phone and their own PIN, say yes, and read live what their company owes its shops, hubs and drivers. Who is in
 * it is our staff's to say, and whether somebody still is, is asked on every request — so taking a person out holds from
 * their next tap. The same discipline as a business's people: an invitation follows the account, never the number.
 */
export interface PartnerMember {
  memberId: string;
  entityId: string;
  phoneHash: string;
  /** The last three digits, so staff can tell two invitations apart. Never the number. */
  phoneEnds: string;
  /** The account that number was certainly for when they were added: the invitation stays theirs if the number moves on. */
  forPersonDid?: string;
  /** Set when they say yes. */
  personDid?: string;
  /** How they appear, and what everything they do is recorded under. Given by our staff. */
  name: string;
  invitedBy: string;
  invitedAt: string;
  joinedAt?: string;
  declinedAt?: string;
  /** Taken out people are KEPT: who read what, and when, stays answerable after they leave. */
  removedAt?: string;
  removedBy?: string;
}

const MAX_MEMBERS = 25;

export class PartnerMemberView {
  @ApiProperty() memberId: string;
  @ApiProperty() name: string;
  @ApiProperty({ description: 'The last three digits of their number.' }) phoneEnds: string;
  @ApiProperty({ enum: ['invited', 'joined', 'declined', 'removed'] }) state: 'invited' | 'joined' | 'declined' | 'removed';
  @ApiProperty() invitedBy: string;
  @ApiProperty() invitedAt: string;
  @ApiPropertyOptional() joinedAt?: string;
  @ApiPropertyOptional() removedBy?: string;
}

export class PartnerMembershipView {
  @ApiProperty() memberId: string;
  @ApiProperty() entityId: string;
  @ApiProperty({ description: 'The partner company.' }) name: string;
  @ApiProperty() country: string;
  @ApiProperty({ enum: ['invited', 'joined'] }) state: 'invited' | 'joined';
  @ApiProperty() invitedBy: string;
}

export class PartnerMembershipList {
  @ApiProperty({ type: [PartnerMembershipView] }) items: PartnerMembershipView[];
}

export class PartnerMeView {
  @ApiProperty() entityId: string;
  @ApiProperty({ description: 'The partner company.' }) name: string;
  @ApiProperty() country: string;
  @ApiProperty() currency: string;
  @ApiProperty({ description: 'The person signed in, as our staff named them.' }) memberName: string;
}

/** What the partner owes, as its own people read it: the record our staff read, with each hand's name as the partner knows it. */
export class PartnerOwedForPartner extends PartnerLedgerView {
  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' }, description: 'Each hand’s name: a shop’s, a hub’s, a courier’s shop-floor label, a fleet’s. Never a phone number.' })
  names: Record<string, string>;
}

export class PartnerToken {
  @ApiProperty() access_token: string;
  @ApiProperty() token_type: 'Bearer';
  @ApiProperty() expires_in: number;
}

export class PartnerSession {
  @ApiProperty({ type: PartnerToken }) token: PartnerToken;
  @ApiProperty({ type: PartnerMeView }) partner: PartnerMeView;
}

export class InvitePartnerMemberDto {
  @ApiProperty({ description: 'The number they sign in with.' })
  @IsString()
  @MinLength(5)
  @MaxLength(32)
  phone: string;

  @ApiProperty({ description: 'Who this is: what they read is recorded under this name.' })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name: string;
}

const invitedOf = (m: PartnerMember): Addressed => ({ hash: m.phoneHash, owner: m.forPersonDid });
const stateOf = (m: PartnerMember): PartnerMemberView['state'] => (m.removedAt ? 'removed' : m.declinedAt ? 'declined' : m.joinedAt ? 'joined' : 'invited');

@Injectable()
export class PartnerMemberService {
  private readonly members = new PersistentMap<string, PartnerMember>('partner-members');

  constructor(
    private readonly entities: EntityService,
    private readonly persons: PersonService,
    private readonly auth: AuthService,
    // 2026-11-26 — every member told when the counters' Mollie account is connected or disconnected.
    @Optional() private readonly mollie?: MollieConnectService,
    @Optional() private readonly mail?: MailService,
  ) {
    this.persons.onNumberLeft((personDid, fromHash) => this.keepWith(personDid, fromHash));
    this.mollie?.onPartnerChange((c) => this.tellMollieChange(c));
  }

  /**
   * 2026-11-26 — THE COUNTERS' MOLLIE ACCOUNT CHANGED: every member who joined is told by email — who did it, and which company's
   * account it is now — so a member who connected an account that is not the company's own is seen at once. Never a text.
   */
  private tellMollieChange(c: MolliePartnerChange): void {
    const entity = this.entities.get(c.entityId);
    const org = c.organization?.name ? `${c.organization.name}${c.organization.registrationNumber ? `, registration ${c.organization.registrationNumber}` : ''}` : 'a Mollie account';
    const headline = c.change === 'connected' ? `${entity.name}: the counters' Mollie account was connected` : `${entity.name}: the counters' Mollie account was disconnected`;
    const what = c.change === 'connected' ? `${c.by} connected ${org}. From now on the money your counters take goes into it.` : `${c.by} disconnected ${org}. Your counters take test money until an account is connected again.`;
    const next = c.change === 'connected' ? 'If that is not your company’s own account, disconnect it in the Partner app, under Money, and tell SeeBuyGet straight away.' : 'If that was not meant, connect your company’s own account again in the Partner app, under Money.';
    for (const m of this.members.values()) {
      if (m.entityId !== c.entityId || !m.personDid || m.removedAt || !m.joinedAt) continue;
      let address: string | undefined;
      try {
        const person = this.persons.findByDid(m.personDid);
        address = person ? this.persons.emailOf(person) : undefined;
      } catch {
        address = undefined;
      }
      if (address) void this.mail?.send('account-safety', { address }, { headline, what, next, when: c.at }).catch(() => false);
    }
  }

  /* ------------------------------------------------------------------ our staff -- */

  /** Add somebody by the number they sign in with. The same answer whether or not the number has an account. */
  invite(entityId: string, input: { phone: string; name: string }, by: string, now: number = Date.now()): PartnerMemberView {
    const partner = this.partner(entityId);
    if (!isPlausiblePhone(input.phone ?? '')) throw new GlosError('PHONE_INVALID', 'Enter the phone number they sign in with', { field: 'phone' });
    const name = input.name?.trim();
    if (!name) throw new GlosError('FIELD_REQUIRED', 'Say who this is: what they read is recorded under this name', { field: 'name' });
    const phoneHash = hashPhone(input.phone);
    const live = this.live(partner.entityId);
    if (live.some((m) => m.phoneHash === phoneHash)) throw new GlosError('CONFLICT', 'That number is already in this partner, or invited to it', { field: 'phone' });
    if (live.length >= MAX_MEMBERS) throw new GlosError('INVALID_STATE', `A partner can have ${MAX_MEMBERS} people in the Partner app`);
    const settled = this.persons.settledAt(phoneHash, now);
    const member: PartnerMember = {
      memberId: `pm_${randomBytes(8).toString('hex')}`,
      entityId: partner.entityId,
      phoneHash,
      phoneEnds: normalizePhone(input.phone).replace(/\D/g, '').slice(-3),
      ...(settled ? { forPersonDid: settled.personDid } : {}),
      name,
      invitedBy: by,
      invitedAt: new Date(now).toISOString(),
    };
    this.members.set(member.memberId, member);
    return viewOf(member);
  }

  /** Who is in the partner's app, who is invited, and who said no or was taken out — newest first. */
  membersOf(entityId: string): PartnerMemberView[] {
    this.partner(entityId);
    return [...this.members.values()]
      .filter((m) => m.entityId === entityId)
      .sort((a, b) => Number(Boolean(a.removedAt || a.declinedAt)) - Number(Boolean(b.removedAt || b.declinedAt)) || b.invitedAt.localeCompare(a.invitedAt))
      .map(viewOf);
  }

  /** Take somebody out, by name: from their next tap they read nothing more. Kept on the record. */
  remove(entityId: string, memberId: string, by: string, now: number = Date.now()): PartnerMemberView {
    this.partner(entityId);
    const member = this.live(entityId).find((m) => m.memberId === memberId);
    if (!member) throw new GlosError('NOT_FOUND', 'There is no such person in this partner');
    member.removedAt = new Date(now).toISOString();
    member.removedBy = by;
    this.members.set(member.memberId, member);
    return viewOf(member);
  }

  /* ------------------------------------------------------- a person, as themselves -- */

  /** The partners this person is in, and the ones they are invited to. */
  mine(personDid: string): PartnerMembershipView[] {
    const person = this.persons.requireByDid(personDid);
    return [...this.members.values()]
      .filter((m) => !m.removedAt && !m.declinedAt && (m.personDid === personDid || (!m.joinedAt && isFor(invitedOf(m), person))))
      .flatMap((m) => {
        const entity = this.entities.find(m.entityId);
        if (!entity || entity.kind !== 'partner') return [];
        return [{ memberId: m.memberId, entityId: m.entityId, name: entity.name, country: entity.jurisdiction ?? '', state: m.joinedAt ? ('joined' as const) : ('invited' as const), invitedBy: m.invitedBy }];
      });
  }

  /** Say yes — as the person whose number it was addressed to, signed in with their own PIN. */
  accept(personDid: string, memberId: string, now: number = Date.now()): PartnerMembershipView {
    const member = this.invitationFor(personDid, memberId);
    member.personDid = personDid;
    member.joinedAt = new Date(now).toISOString();
    this.members.set(member.memberId, member);
    return this.mine(personDid).find((m) => m.memberId === memberId)!;
  }

  /** Say no. Kept, so our staff see it was declined rather than wondering. */
  decline(personDid: string, memberId: string, now: number = Date.now()): { declined: true } {
    const member = this.invitationFor(personDid, memberId);
    member.declinedAt = new Date(now).toISOString();
    this.members.set(member.memberId, member);
    return { declined: true };
  }

  /**
   * A session for one partner, for a person who is in it: the token carries the partner's own DID and its entityId as the
   * tenant, the person's name for the record, and the person — so changing their PIN ends this session too.
   */
  session(personDid: string, entityId: string): PartnerSession {
    const entity = this.partner(entityId);
    const member = this.joined(entityId, personDid);
    if (!member) throw new GlosError('NOT_FOUND', 'No such partner');
    const token = this.auth.mintActorToken({ role: 'partner', did: entity.did, tenant: entity.entityId, actorName: member.name, personDid, revocationKey: personDid });
    return { token: token as unknown as PartnerToken, partner: this.meOf(entity, member) };
  }

  /* ------------------------------------------------------- acting for the partner -- */

  /** WHO IS READING, ASKED AGAIN ON EVERY REQUEST: still in this partner, which is still a partner. */
  requireMember(actor: IntrospectionResult | undefined): { member: PartnerMember; entity: Entity } {
    if (actor?.role !== 'partner' || !actor.tenant || !actor.personDid) throw new GlosError('FORBIDDEN', 'This needs a Partner app sign-in');
    const entity = this.entities.find(actor.tenant);
    const member = entity?.kind === 'partner' ? this.joined(entity.entityId, actor.personDid) : undefined;
    if (!entity || !member) throw new GlosError('FORBIDDEN', 'You are no longer in this partner. Ask SeeBuyGet’s staff.');
    return { member, entity };
  }

  me(actor: IntrospectionResult | undefined): PartnerMeView {
    const { member, entity } = this.requireMember(actor);
    return this.meOf(entity, member);
  }

  /* ------------------------------------------------------------- an account's life -- */

  /** An account closed: every place it held in a partner is closed with it, its name and number gone. */
  forgetPerson(personDid: string, phoneHash: string, now: number = Date.now()): number {
    let touched = 0;
    for (const m of this.members.values()) {
      if (m.personDid !== personDid && m.forPersonDid !== personDid && m.phoneHash !== phoneHash) continue;
      m.removedAt ??= new Date(now).toISOString();
      m.removedBy ??= 'Closed by its owner';
      m.name = 'Closed account';
      m.phoneHash = `closed:${personDid}`;
      m.phoneEnds = '';
      this.members.set(m.memberId, m);
      touched += 1;
    }
    return touched;
  }

  /** An account is moving off a number: every open invitation still addressed to that number and to no account is theirs. */
  keepWith(personDid: string, fromHash: string): number {
    let kept = 0;
    for (const m of this.members.values()) {
      if (m.joinedAt || m.removedAt || m.declinedAt || !waitsAt(invitedOf(m), fromHash)) continue;
      m.forPersonDid = personDid;
      this.members.set(m.memberId, m);
      kept += 1;
    }
    return kept;
  }

  private meOf(entity: Entity, member: PartnerMember): PartnerMeView {
    return { entityId: entity.entityId, name: entity.name, country: entity.jurisdiction ?? '', currency: this.entities.amountsFor(entity.entityId).currency ?? entity.currency ?? '', memberName: member.name };
  }

  private partner(entityId: string): Entity {
    const entity = this.entities.find(entityId);
    if (!entity || entity.kind !== 'partner') throw new GlosError('NOT_FOUND', 'There is no such partner company');
    return entity;
  }

  private live(entityId: string): PartnerMember[] {
    return [...this.members.values()].filter((m) => m.entityId === entityId && !m.removedAt && !m.declinedAt);
  }

  private joined(entityId: string, personDid: string): PartnerMember | undefined {
    return this.live(entityId).find((m) => m.personDid === personDid && m.joinedAt);
  }

  private invitationFor(personDid: string, memberId: string): PartnerMember {
    const person = this.persons.requireByDid(personDid);
    const member = this.members.get(memberId);
    // One answer for "no such invitation" and "not yours": an invitation id is not a way to learn whose number is whose.
    if (!member || member.joinedAt || member.removedAt || member.declinedAt || !isFor(invitedOf(member), person)) throw new GlosError('NOT_FOUND', 'No such invitation');
    return member;
  }
}

function viewOf(m: PartnerMember): PartnerMemberView {
  return {
    memberId: m.memberId,
    name: m.name,
    phoneEnds: m.phoneEnds,
    state: stateOf(m),
    invitedBy: m.invitedBy,
    invitedAt: m.invitedAt,
    ...(m.joinedAt ? { joinedAt: m.joinedAt } : {}),
    ...(m.removedBy ? { removedBy: m.removedBy } : {}),
  };
}
