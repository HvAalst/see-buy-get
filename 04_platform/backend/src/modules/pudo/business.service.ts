import { Injectable, Optional } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { GlosError } from '../../foundation/http/glos-error';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { AuthService } from '../../foundation/auth/auth.service';
import { IntrospectionResult } from '../../foundation/auth/auth.types';
import { EntityService } from '../../foundation/entity/entity.service';
import { CompanyDocumentService } from '../../foundation/entity/company-documents.service';
import { BUSINESS_ACTIVITIES, type BusinessActivity, type BusinessVerification, type Entity } from '../../foundation/entity/entity.types';
import { HandleService } from '../../foundation/handle/handle.service';
import { MailService } from '../../foundation/mail/mail.service';
import { hashPhone, isPlausiblePhone, normalizePhone } from '../../foundation/identity/phone';
import { PersonService } from './person.service';
import { ShipperCodesService } from './shipper-codes.service';
import { isFor, waitsAt, type Addressed } from './addressed-to';
import {
  BUSINESS_MEMBER_ROLES,
  BusinessMember,
  BusinessMemberRole,
  BusinessMemberView,
  BusinessMembershipView,
  BusinessStaffRow,
  BusinessGs1View,
  BusinessView,
  LoadPoster,
  ReceiptPerson,
} from './business.types';

/** What a business needs on record before it may ask to be checked: who it is, and who is speaking for it. */
export const PAPERS_TO_BE_CHECKED = ['certificate_of_incorporation', 'representative_id'] as const;

/** A person may set up this many businesses that nobody has checked yet. Enough for a group of companies; not a spam run. */
export const MAX_UNCHECKED_PER_PERSON = 5;
/** Enough for a real office; a ceiling, not a target. */
export const MAX_MEMBERS = 50;

/** Who is acting on a business, resolved live — never trusted from the token alone. */
export interface ActingMember {
  member: BusinessMember;
  entity: Entity;
}

/**
 * B1 — A CUSTOMER'S BUSINESS: set up by a person, run by the people they add, checked by two members of staff.
 *
 * THE RULES THIS SERVICE HOLDS:
 *
 * 1. **A person sets up a business with their own sign-in**, and becomes its first owner. There is no company login
 *    to share: everybody in it signs in as themselves, with their own phone and PIN, so every act has a person on it
 *    and taking somebody out is one click that takes effect on their next one.
 * 2. **A phone number addresses, it never admits.** An owner adds people by number; nothing opens until that person
 *    signs in with their own phone and PIN and accepts. The answer to adding a number is the same whether or not it has
 *    an account.
 * 3. **There is always an owner.** The last one cannot be removed or made something else.
 * 4. **Checked by two members of staff, from its papers.** One approves, a second, different one completes it. Until
 *    then the business works, but is shown to no stranger: no public address, no listing in a finder.
 * 5. **We hold none of its money** (the user, 2026-10-04). Nothing here has a balance, a credit line or a price.
 */
@Injectable()
export class BusinessService {
  private readonly members = new PersistentMap<string, BusinessMember>('business-members');
  /** Which of its people posted each load (business.types.ts says why this is here and not on the load). */
  private readonly posters = new PersistentMap<string, LoadPoster>('business-load-posters');
  /** Whoever has to hear that somebody is no longer in a business. Registered, not injected: they depend on this. */
  private readonly whenGone: Array<(businessDid: string, personDid: string) => void> = [];

  constructor(
    private readonly entities: EntityService,
    private readonly persons: PersonService,
    private readonly auth: AuthService,
    private readonly documents: CompanyDocumentService,
    private readonly handles: HandleService,
    @Optional() private readonly mail?: MailService,
    @Optional() private readonly codes?: ShipperCodesService,
  ) {
    // An account moving off a number takes its unanswered invitations with it.
    this.persons.onNumberLeft((personDid, fromHash) => this.keepWith(personDid, fromHash));
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

  /* ------------------------------------------------------------------ setting up -- */

  /** Set up a business, as the person signed in. They become its owner and get a session for it. */
  create(
    personDid: string,
    input: { name: string; country: string; registrationNo: string; taxNo?: string; activities: string[]; yourName: string },
  ): { entity: Entity; member: BusinessMember } {
    const person = this.persons.requireByDid(personDid);
    if (!person.pinHash) throw new GlosError('INVALID_STATE', 'Choose your PIN first: a business account is only as safe as the sign-in of the people in it');
    const yourName = input.yourName?.trim();
    if (!yourName) throw new GlosError('FIELD_REQUIRED', 'Say who you are — what you do for the business is recorded under this name', { field: 'yourName' });
    const registrationNo = input.registrationNo?.trim();
    if (!registrationNo) throw new GlosError('FIELD_REQUIRED', 'Give the number the company registry knows the business by', { field: 'registrationNo' });
    const activities = cleanActivities(input.activities);

    const unchecked = this.entities
      .businesses()
      .filter((e) => e.business?.createdByPersonDid === personDid && e.business.verification.state !== 'verified');
    if (unchecked.length >= MAX_UNCHECKED_PER_PERSON) {
      throw new GlosError('INVALID_STATE', `You already have ${unchecked.length} businesses that SeeBuyGet has not checked yet. Have one checked before setting up another.`);
    }

    const entity = this.entities.createBusiness({
      name: input.name,
      jurisdiction: input.country,
      profile: { activities, registrationNo, ...(input.taxNo?.trim() ? { taxNo: input.taxNo.trim() } : {}), createdBy: yourName, createdByPersonDid: personDid },
    });
    const now = new Date().toISOString();
    const member: BusinessMember = {
      memberId: newId(),
      entityId: entity.entityId,
      phoneHash: person.phoneHash,
      phoneEnds: '',
      personDid,
      name: yourName,
      role: 'owner',
      invitedBy: yourName,
      invitedAt: now,
      joinedAt: now,
    };
    this.members.set(member.memberId, member);
    return { entity, member };
  }

  /** The business as its member reads it. */
  view(entityId: string, readerPersonDid: string): BusinessView {
    const entity = this.business(entityId);
    const you = this.joined(entityId, readerPersonDid);
    if (!you) throw new GlosError('NOT_FOUND', 'No such business');
    const p = entity.business!;
    return {
      entityId: entity.entityId,
      name: entity.name,
      country: entity.jurisdiction ?? '',
      activities: p.activities,
      registrationNo: p.registrationNo,
      ...(p.taxNo ? { taxNo: p.taxNo } : {}),
      check: {
        state: p.verification.state,
        ...(p.verification.askedAt ? { askedAt: p.verification.askedAt } : {}),
        ...(p.verification.verifiedAt ? { verifiedAt: p.verification.verifiedAt } : {}),
        ...(p.verification.refusedAt ? { refusedAt: p.verification.refusedAt } : {}),
        ...(p.verification.state === 'refused' && p.verification.reason ? { reason: p.verification.reason } : {}),
        missing: this.missingPapers(entityId),
      },
      ...(this.handleOf(entity) ? { handle: this.handleOf(entity) } : {}),
      createdAt: entity.createdAt,
      you: memberView(you, readerPersonDid),
      ...this.gs1Of(entity.entityId),
    };
  }

  private gs1Of(entityId: string): { gs1?: BusinessGs1View } {
    const s = this.codes?.of(entityId);
    return s ? { gs1: { companyPrefix: s.companyPrefix, extensionDigit: s.extensionDigit, left: this.codes!.left(entityId) ?? 0, setAt: s.setAt, setBy: s.setBy } } : {};
  }

  /**
   * The business's GS1 company prefix, set or cleared. Owner only, like everything else the business says about itself;
   * staff never reach this (a business sign-in only).
   */
  setGs1(acting: ActingMember, input: { companyPrefix: string; extensionDigit: number } | null): void {
    this.requireOwner(acting);
    if (!this.codes) throw new GlosError('INVALID_STATE', 'GS1 codes are not available here');
    this.codes.set(acting.entity.entityId, input, acting.member.name);
  }

  /**
   * Change what the business says about itself. Owner only.
   *
   * THE NAME AND THE REGISTRATION NUMBER ARE WHAT WAS CHECKED, so changing either puts the business back to unchecked:
   * a verified "Acme Ltd" renamed to something else is not something anybody verified. Its public address, once issued,
   * does not move (a handle never follows a rename).
   */
  update(acting: ActingMember, patch: { name?: string; registrationNo?: string; taxNo?: string | null; activities?: string[] }): Entity {
    this.requireOwner(acting);
    const entity = acting.entity;
    const p = entity.business!;
    const name = patch.name !== undefined ? patch.name.trim() : undefined;
    if (name !== undefined && !name) throw new GlosError('FIELD_REQUIRED', 'A business needs its name', { field: 'name' });
    const registrationNo = patch.registrationNo !== undefined ? patch.registrationNo.trim() : undefined;
    if (registrationNo !== undefined && !registrationNo) throw new GlosError('FIELD_REQUIRED', 'Give the number the company registry knows the business by', { field: 'registrationNo' });
    const identityChanged = (name !== undefined && name !== entity.name) || (registrationNo !== undefined && registrationNo !== p.registrationNo);
    const profile = {
      ...(registrationNo !== undefined ? { registrationNo } : {}),
      ...(patch.taxNo !== undefined ? { taxNo: patch.taxNo?.trim() || undefined } : {}),
      ...(patch.activities !== undefined ? { activities: cleanActivities(patch.activities) } : {}),
      ...(identityChanged && p.verification.state !== 'unverified' ? { verification: { state: 'unverified' as const } } : {}),
    };
    return this.entities.updateBusiness(entity.entityId, { ...(name !== undefined ? { name } : {}), profile }, acting.member.name);
  }

  /* ---------------------------------------------------------------- the people -- */

  /**
   * Every business this person is in, and every one they are invited to. An invitation is theirs when it is for their
   * account — or, while it is for no account, for the number they sign in with.
   */
  mine(personDid: string): BusinessMembershipView[] {
    const person = this.persons.requireByDid(personDid);
    return [...this.members.values()]
      .filter((m) => !m.removedAt && !m.declinedAt && (m.personDid === personDid || (!m.joinedAt && isFor(invitedOf(m), person))))
      .flatMap((m) => {
        const entity = this.entities.find(m.entityId);
        if (!entity?.business) return [];
        return [
          {
            memberId: m.memberId,
            entityId: m.entityId,
            name: entity.name,
            country: entity.jurisdiction ?? '',
            role: m.role,
            state: m.joinedAt ? ('joined' as const) : ('invited' as const),
            invitedBy: m.invitedBy,
            checked: entity.business.verification.state,
          },
        ];
      })
      .sort((a, b) => (a.state === b.state ? a.name.localeCompare(b.name) : a.state === 'invited' ? -1 : 1));
  }

  /**
   * Add somebody by their phone number. Owner only.
   *
   * THE SAME ANSWER whether or not the number has an account — the invitation simply waits for whoever signs in with it.
   */
  invite(acting: ActingMember, input: { phone: string; name: string; role: string }): BusinessMemberView {
    this.requireOwner(acting);
    if (!isPlausiblePhone(input.phone ?? '')) throw new GlosError('PHONE_INVALID', 'Enter the phone number they sign in with', { field: 'phone' });
    const name = input.name?.trim();
    if (!name) throw new GlosError('FIELD_REQUIRED', 'Say who this is — what they do is recorded under this name', { field: 'name' });
    const role = cleanRole(input.role);
    const phoneHash = hashPhone(input.phone);
    const invited = this.persons.settledAt(phoneHash);
    const live = this.liveMembers(acting.entity.entityId);
    if (live.some((m) => m.phoneHash === phoneHash)) throw new GlosError('CONFLICT', 'That number is already in this business, or invited to it', { field: 'phone' });
    if (live.length >= MAX_MEMBERS) throw new GlosError('INVALID_STATE', `A business can have ${MAX_MEMBERS} people`);
    const member: BusinessMember = {
      memberId: newId(),
      entityId: acting.entity.entityId,
      phoneHash,
      // The account that number is certainly for today, if any: the invitation then stays theirs if the number moves on.
      ...(invited ? { forPersonDid: invited.personDid } : {}),
      phoneEnds: normalizePhone(input.phone).replace(/\D/g, '').slice(-3),
      name,
      role,
      invitedBy: acting.member.name,
      invitedAt: new Date().toISOString(),
    };
    this.members.set(member.memberId, member);
    return memberView(member, acting.member.personDid);
  }

  /** Say yes to an invitation — as the person whose phone it was sent to, signed in with their own PIN. */
  accept(personDid: string, memberId: string): BusinessMembershipView {
    const member = this.invitationFor(personDid, memberId);
    member.personDid = personDid;
    member.joinedAt = new Date().toISOString();
    this.members.set(member.memberId, member);
    return this.mine(personDid).find((m) => m.memberId === memberId)!;
  }

  /** Say no. Kept, so the owner sees it was declined rather than wondering. */
  decline(personDid: string, memberId: string): { declined: true } {
    const member = this.invitationFor(personDid, memberId);
    member.declinedAt = new Date().toISOString();
    this.members.set(member.memberId, member);
    return { declined: true };
  }

  /** Who is in this business, and who is invited. Any member may read it. */
  list(acting: ActingMember): BusinessMemberView[] {
    return this.liveMembers(acting.entity.entityId)
      .sort((a, b) => (a.joinedAt ? 0 : 1) - (b.joinedAt ? 0 : 1) || a.invitedAt.localeCompare(b.invitedAt))
      .map((m) => memberView(m, acting.member.personDid));
  }

  /** Make somebody an owner, a booker, finance or a viewer. Owner only; there is always an owner. */
  setRole(acting: ActingMember, memberId: string, role: string): BusinessMemberView {
    this.requireOwner(acting);
    const member = this.memberOf(acting.entity.entityId, memberId);
    const next = cleanRole(role);
    if (member.role === 'owner' && next !== 'owner') this.requireAnotherOwner(acting.entity.entityId, member.memberId);
    member.role = next;
    this.members.set(member.memberId, member);
    return memberView(member, acting.member.personDid);
  }

  /**
   * Take somebody out, or leave yourself. An owner may remove anybody; anybody may remove themselves. There is always an
   * owner. KEPT, not deleted, and it takes effect on their next click: membership is read live on every request.
   */
  remove(acting: ActingMember, memberId: string): BusinessMemberView {
    const member = this.memberOf(acting.entity.entityId, memberId);
    const self = member.memberId === acting.member.memberId;
    if (!self) this.requireOwner(acting);
    if (member.role === 'owner' && member.joinedAt) this.requireAnotherOwner(acting.entity.entityId, member.memberId);
    member.removedAt = new Date().toISOString();
    member.removedBy = acting.member.name;
    this.members.set(member.memberId, member);
    // What was sent to them as one of this business's people stops with their place in it — their sign-in stops on
    // the next click, and a link in their own mailbox would otherwise go on opening the business's notes for a month.
    if (member.personDid) for (const tell of this.whenGone) tell(acting.entity.did, member.personDid);
    return memberView(member, acting.member.personDid);
  }

  /** Be told when somebody is taken out of a business, or leaves it. */
  onMemberGone(listener: (businessDid: string, personDid: string) => void): void {
    this.whenGone.push(listener);
  }

  /* ------------------------------------------------------- a load and its receipt -- */

  /** A load was posted with a business's sign-in: keep which of its people did it. Nothing for any other sign-in. */
  notePosted(freightId: string, actor: IntrospectionResult | undefined, now: number = Date.now()): void {
    if (actor?.role !== 'business' || !actor.tenant || !actor.personDid || !freightId) return;
    this.posters.set(freightId, { freightId, entityId: actor.tenant, personDid: actor.personDid, at: new Date(now).toISOString() });
  }

  /**
   * WHO IN A BUSINESS IS SENT A LOAD'S RECEIPT.
   *
   * The person who posted it, at their own recovery email: they are the one waiting to hear. When they cannot be
   * emailed — they have left the business, or have given no address — it goes to the owners in their place, so that a
   * delivery is never known to nobody.
   *
   * ASKED WHEN THE LOAD IS DELIVERED, not when it was posted: somebody taken out of the business in between is sent
   * nothing. Nobody, and not an error, for a DID that is not a business.
   */
  receiptPeople(businessDid: string, freightId: string): ReceiptPerson[] {
    const entity = this.entities.byDid(businessDid);
    if (!entity?.business) return [];
    const inIt = this.liveMembers(entity.entityId).filter((m) => m.joinedAt && m.personDid);
    const reach = (m: BusinessMember, as: ReceiptPerson['as']): ReceiptPerson[] => {
      const person = this.persons.findByDid(m.personDid!);
      const address = person ? this.persons.emailOf(person) : undefined;
      return address ? [{ address, name: m.name, personDid: m.personDid!, as, business: entity.name }] : [];
    };
    const posted = this.posters.get(freightId);
    const poster = posted && posted.entityId === entity.entityId ? inIt.find((m) => m.personDid === posted.personDid) : undefined;
    const first = poster ? reach(poster, 'poster') : [];
    if (first.length) return first;
    return inIt
      .filter((m) => m.role === 'owner')
      .sort((a, b) => (a.joinedAt ?? '').localeCompare(b.joinedAt ?? ''))
      .flatMap((m) => reach(m, 'owner'));
  }

  /* ------------------------------------------------------------------ sessions -- */

  /**
   * A session for one business, for a person who is in it.
   *
   * The token carries the BUSINESS's DID (it acts as the business, like a company's administrator does), its entityId
   * as the tenant, the member's name for the audit trail, and the person — so changing their PIN ends this session too.
   */
  session(personDid: string, entityId: string) {
    const entity = this.business(entityId);
    const member = this.joined(entityId, personDid);
    if (!member) throw new GlosError('NOT_FOUND', 'No such business');
    const token = this.auth.mintActorToken({ role: 'business', did: entity.did, tenant: entity.entityId, actorName: member.name, personDid, revocationKey: personDid });
    return { token, business: this.view(entityId, personDid) };
  }

  /**
   * WHO IS ACTING, ASKED AGAIN ON EVERY REQUEST. The token says which business and which person; whether that person is
   * still in it, and in what role, is read here — so removing somebody, or making them a viewer, holds from their next
   * click rather than when their session happens to end.
   */
  requireMember(actor: IntrospectionResult | undefined): ActingMember {
    if (actor?.role !== 'business' || !actor.tenant || !actor.personDid) throw new GlosError('FORBIDDEN', 'This needs a business sign-in');
    const entity = this.entities.find(actor.tenant);
    const member = entity?.business ? this.joined(entity.entityId, actor.personDid) : undefined;
    if (!entity || !member) throw new GlosError('FORBIDDEN', 'You are no longer in this business. Ask one of its owners.');
    return { member, entity };
  }

  /** May this member change things, or only read? A viewer reads. */
  mayAct(acting: ActingMember): boolean {
    return acting.member.role !== 'viewer';
  }

  /* --------------------------------------------------------- the check by staff -- */

  /** Ask SeeBuyGet to check the business. Owner only, and only with the papers the check is made from. */
  askForCheck(acting: ActingMember): Entity {
    this.requireOwner(acting);
    const v = acting.entity.business!.verification;
    if (v.state === 'verified') throw new GlosError('INVALID_STATE', 'This business is already checked');
    if (v.state === 'asked' || v.state === 'checking') throw new GlosError('INVALID_STATE', 'SeeBuyGet is already checking this business');
    const missing = this.missingPapers(acting.entity.entityId);
    if (missing.length) throw new GlosError('FIELD_REQUIRED', 'Add the registration certificate and the ID of the person speaking for the business first', { missing });
    return this.setCheck(acting.entity.entityId, { state: 'asked', askedAt: new Date().toISOString(), askedBy: acting.member.name }, acting.member.name);
  }

  /**
   * A member of staff approves. The first approval waits for a second, DIFFERENT member of staff; the second verifies.
   *
   * `staffKey` is what tells two people apart: a named staff account's own session key. Two typed names are not two
   * people, so outside a sandbox the controller refuses a staff session that cannot say who it is.
   *
   * The papers themselves must have been verified first (by somebody other than whoever uploaded them — CA4's rule),
   * so the approval is a decision about the business made on checked papers, not a second look at unchecked ones.
   */
  approve(entityId: string, staff: { name: string; key: string }): Entity {
    const entity = this.business(entityId);
    const v = entity.business!.verification;
    if (v.state === 'verified') throw new GlosError('INVALID_STATE', `${entity.name} is already checked`);
    if (v.state !== 'asked' && v.state !== 'checking') throw new GlosError('INVALID_STATE', `${entity.name} has not asked to be checked`);
    const unverified = PAPERS_TO_BE_CHECKED.filter((kind) => !this.currentPaper(entityId, kind, 'verified'));
    if (unverified.length) throw new GlosError('INVALID_STATE', 'Verify the registration certificate and the representative’s ID first', { unverified });
    const now = new Date().toISOString();
    if (v.state === 'asked') {
      return this.setCheck(entityId, { ...v, state: 'checking', firstBy: staff.name, firstById: staff.key, firstAt: now }, staff.name);
    }
    if (v.firstById === staff.key) throw new GlosError('CONFLICT', 'A second member of staff has to approve — not the one who approved first');
    const done = this.setCheck(entityId, { ...v, state: 'verified', verifiedBy: staff.name, verifiedAt: now }, staff.name);
    // Its public address, from the name two people just checked. The sweep would issue the same one later; issuing it
    // here means the email the owners are about to read can point at a page that already exists.
    this.handles.issue({ kind: 'company', id: done.entityId, name: done.name, country: done.jurisdiction });
    this.tellOwners(done, 'verified');
    return done;
  }

  /** A member of staff refuses, always with a reason the business can act on. It may ask again once it has. */
  refuse(entityId: string, staff: { name: string }, reason: string): Entity {
    const entity = this.business(entityId);
    const why = reason?.trim();
    if (!why) throw new GlosError('FIELD_REQUIRED', 'Say why — a business cannot put right what it was not told', { field: 'reason' });
    const v = entity.business!.verification;
    if (v.state !== 'asked' && v.state !== 'checking') throw new GlosError('INVALID_STATE', `${entity.name} is not waiting to be checked`);
    const done = this.setCheck(entityId, { state: 'refused', askedAt: v.askedAt, askedBy: v.askedBy, refusedBy: staff.name, refusedAt: new Date().toISOString(), reason: why }, staff.name);
    this.tellOwners(done, 'refused');
    return done;
  }

  /** Every business, for staff: those waiting on a check first, then newest. */
  staffList(): BusinessStaffRow[] {
    const waiting = (s: string) => (s === 'checking' ? 0 : s === 'asked' ? 1 : 2);
    return this.entities
      .businesses()
      .map((e) => this.staffRow(e))
      .sort((a, b) => waiting(a.state) - waiting(b.state) || b.createdAt.localeCompare(a.createdAt));
  }

  staffRow(entityOrId: Entity | string): BusinessStaffRow {
    const e = typeof entityOrId === 'string' ? this.business(entityOrId) : entityOrId;
    const p = e.business!;
    const v = p.verification;
    return {
      entityId: e.entityId,
      name: e.name,
      country: e.jurisdiction ?? '',
      activities: p.activities,
      registrationNo: p.registrationNo,
      ...(p.taxNo ? { taxNo: p.taxNo } : {}),
      createdAt: e.createdAt,
      createdBy: p.createdBy,
      state: v.state,
      ...pick(v, ['askedAt', 'askedBy', 'firstBy', 'firstAt', 'verifiedBy', 'verifiedAt', 'refusedBy', 'refusedAt', 'reason']),
      members: this.liveMembers(e.entityId).filter((m) => m.joinedAt).length,
      missing: this.missingPapers(e.entityId),
      ...(this.handleOf(e) ? { handle: this.handleOf(e) } : {}),
    };
  }

  /* ------------------------------------------------------------------ internals -- */

  /** The papers the check is made from that are not on record (or were rejected or replaced without a successor). */
  missingPapers(entityId: string): string[] {
    return PAPERS_TO_BE_CHECKED.filter((kind) => !this.currentPaper(entityId, kind));
  }

  private currentPaper(entityId: string, kind: string, status?: 'verified') {
    return this.documents
      .list(entityId)
      .find((d) => d.kind === kind && (status ? d.status === status : d.status === 'awaiting_verification' || d.status === 'verified'));
  }

  private setCheck(entityId: string, verification: BusinessVerification, by: string): Entity {
    return this.entities.updateBusiness(entityId, { profile: { verification } }, by, 'verification');
  }

  /** The owners are told what was decided, at their recovery email. Best effort: the app shows it either way. */
  private tellOwners(entity: Entity, outcome: 'verified' | 'refused'): void {
    if (!this.mail) return;
    for (const m of this.liveMembers(entity.entityId).filter((x) => x.role === 'owner' && x.personDid)) {
      const person = this.persons.findByDid(m.personDid!);
      const address = person ? this.persons.emailOf(person) : undefined;
      if (!address) continue;
      void this.mail.send(
        'business-checked',
        { address, name: m.name },
        { business: entity.name, outcome, ...(outcome === 'refused' && entity.business?.verification.reason ? { reason: entity.business.verification.reason } : {}), when: new Date().toISOString() },
      );
    }
  }

  private business(entityId: string): Entity {
    const entity = this.entities.find(entityId);
    if (!entity?.business) throw new GlosError('NOT_FOUND', 'No such business');
    return entity;
  }

  private handleOf(entity: Entity): string | undefined {
    return entity.business?.verification.state === 'verified' ? this.handles.forId(entity.entityId)?.handle : undefined;
  }

  private liveMembers(entityId: string): BusinessMember[] {
    return [...this.members.values()].filter((m) => m.entityId === entityId && !m.removedAt && !m.declinedAt);
  }

  private joined(entityId: string, personDid: string): BusinessMember | undefined {
    return this.liveMembers(entityId).find((m) => m.personDid === personDid && m.joinedAt);
  }

  private memberOf(entityId: string, memberId: string): BusinessMember {
    const member = this.liveMembers(entityId).find((m) => m.memberId === memberId);
    if (!member) throw new GlosError('NOT_FOUND', 'No such person in this business');
    return member;
  }

  private invitationFor(personDid: string, memberId: string): BusinessMember {
    const person = this.persons.requireByDid(personDid);
    const member = this.members.get(memberId);
    // One answer for "no such invitation" and "not yours": an invitation id is not a way to learn whose number is whose.
    if (!member || member.joinedAt || member.removedAt || member.declinedAt || !isFor(invitedOf(member), person)) {
      throw new GlosError('NOT_FOUND', 'No such invitation');
    }
    return member;
  }

  private requireOwner(acting: ActingMember): void {
    if (acting.member.role !== 'owner') throw new GlosError('FORBIDDEN', 'Only an owner of the business can do that');
  }

  private requireAnotherOwner(entityId: string, exceptMemberId: string): void {
    const others = this.liveMembers(entityId).filter((m) => m.role === 'owner' && m.joinedAt && m.memberId !== exceptMemberId);
    if (!others.length) throw new GlosError('INVALID_STATE', 'A business always has an owner. Make somebody else an owner first.');
  }
}

function cleanActivities(raw: string[] | undefined): BusinessActivity[] {
  const list = [...new Set((raw ?? []).map((a) => String(a).trim()))];
  if (!list.length) throw new GlosError('FIELD_REQUIRED', 'Say what the business does — it decides what you are shown', { field: 'activities' });
  const unknown = list.filter((a) => !BUSINESS_ACTIVITIES.includes(a as BusinessActivity));
  if (unknown.length) throw new GlosError('VALIDATION_FAILED', `Not something a business here does: ${unknown.join(', ')}`, { field: 'activities' });
  return list as BusinessActivity[];
}

function cleanRole(raw: string): BusinessMemberRole {
  if (!BUSINESS_MEMBER_ROLES.includes(raw as BusinessMemberRole)) throw new GlosError('VALIDATION_FAILED', 'A person is an owner, a booker, finance or a viewer', { field: 'role' });
  return raw as BusinessMemberRole;
}

/** The number an invitation was sent to, and the account it is for once one is certain. */
function invitedOf(m: BusinessMember): Addressed {
  return { hash: m.phoneHash, owner: m.forPersonDid };
}

function memberView(m: BusinessMember, readerPersonDid?: string): BusinessMemberView {
  return {
    memberId: m.memberId,
    name: m.name,
    role: m.role,
    state: m.joinedAt ? 'joined' : 'invited',
    phoneEnds: m.phoneEnds,
    invitedBy: m.invitedBy,
    invitedAt: m.invitedAt,
    ...(m.joinedAt ? { joinedAt: m.joinedAt } : {}),
    you: Boolean(readerPersonDid && m.personDid === readerPersonDid),
  };
}

function pick<T extends object, K extends keyof T>(o: T, keys: K[]): Partial<Pick<T, K>> {
  const out: Partial<Pick<T, K>> = {};
  for (const k of keys) if (o[k] !== undefined) out[k] = o[k];
  return out;
}

function newId(): string {
  return `bm_${randomBytes(8).toString('hex')}`;
}
