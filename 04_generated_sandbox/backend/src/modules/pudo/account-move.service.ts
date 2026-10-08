import { Injectable, Optional } from '@nestjs/common';
import { randomBytes, randomInt } from 'crypto';
import { COUNTRY_CATALOGUE } from '../../foundation/countries/catalogue';
import { IdentityVault } from '../../foundation/data-firewall/identity-vault.service';
import { EntityService } from '../../foundation/entity/entity.service';
import { GlosError } from '../../foundation/http/glos-error';
import { hashPhone, isPlausiblePhone, normalizePhone } from '../../foundation/identity/phone';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { AccountRecoveryService } from './account-recovery.service';
import {
  MOVE_ASKS_PER_DAY,
  MOVE_LAPSES_AFTER_DAYS,
  MoveAccount,
  MoveAgainstMe,
  MoveAsked,
  MoveIdAnswer,
  MoveList,
  MoveRow,
  MoveState,
  MoveStatus,
  MoveSupport,
} from './account-move.types';
import { AgentService } from './agent.service';
import { ContactCardService } from './contact-card.service';
import { DriverService } from './driver.service';
import { FleetManagerService } from './fleet-manager.service';
import { OtpService } from './otp.service';
import { PersonService } from './person.service';
import type { Person } from './person.types';

const DAY_MS = 86_400_000;
/** Letters and digits nobody mistakes for one another when one person reads them to another over a telephone. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** A member of staff: a name for the record, and the key their sign-in answers to, which is what tells two apart. */
export interface StaffMember {
  name: string;
  key: string;
}

/** What is kept of a request. Never a whole phone number: keys, last digits, and the new number in the vault. */
interface StoredMove {
  moveId: string;
  reference: string;
  askedAt: string;
  lapsesAt: string;
  oldPhoneHash: string;
  oldEnds: string;
  /** The account the old number names, where it names one. Never told to whoever asked. */
  personDid?: string;
  newPhoneHash: string;
  newEnds: string;
  /** The new number itself, for the move. Blanked the moment the request is over. */
  newVaultRef: string;
  nationalId?: MoveIdAnswer;
  note?: string;
  state: MoveState;
  checked?: { by: string; byKey: string; at: string; what: string };
  decided?: { by: string; at: string; reason?: string };
  stoppedBy?: 'holder' | 'pin';
  /** The country the old number is in: whose support contact the asker is given. */
  country?: string;
}

const OPEN: MoveState[] = ['asked', 'checked'];

/**
 * TWO MEMBERS OF STAFF MOVE AN ACCOUNT (account-move.types.ts says why, and what guards it).
 *
 * The move itself is `AccountRecoveryService.moveByStaff` — the same move a person makes for themselves, with the
 * same notices and the same 24 hours to undo it. Everything here is about WHETHER it happens.
 */
@Injectable()
export class AccountMoveService {
  private readonly moves = new PersistentMap<string, StoredMove>('account-move-requests');

  constructor(
    private readonly persons: PersonService,
    private readonly recovery: AccountRecoveryService,
    private readonly otp: OtpService,
    private readonly vault: IdentityVault,
    private readonly drivers: DriverService,
    private readonly agents: AgentService,
    private readonly managers: FleetManagerService,
    @Optional() private readonly entities?: EntityService,
    @Optional() private readonly contacts?: ContactCardService,
  ) {}

  /* ------------------------------------------------------------------ the person asks -- */

  /**
   * ASK FOR AN ACCOUNT TO BE MOVED. Nobody is signed in. The new number has been confirmed by a code, so whoever asks
   * holds it; about the old one they prove nothing here — that is what the two members of staff are for.
   *
   * THE SAME ANSWER WHETHER OR NOT THE OLD NUMBER HAS AN ACCOUNT. A reference is handed back either way; that there
   * is nothing behind it is for staff to see, never for a stranger to learn by asking.
   */
  ask(input: { oldPhone: string; newPhone: string; nationalId?: string; note?: string }, now: number = Date.now()): MoveAsked {
    if (!isPlausiblePhone(input.oldPhone ?? '')) throw new GlosError('PHONE_INVALID', 'Enter the phone number the account is on', { field: 'oldPhone' });
    if (!isPlausiblePhone(input.newPhone ?? '')) throw new GlosError('PHONE_INVALID', 'Enter the new phone number', { field: 'newPhone' });
    const oldPhoneHash = hashPhone(input.oldPhone);
    const newPhoneHash = hashPhone(input.newPhone);
    if (oldPhoneHash === newPhoneHash) throw new GlosError('INVALID_STATE', 'That is the same number. An account is moved to a different one.', { field: 'newPhone' });
    if (!this.otp.isVerified(input.newPhone)) throw new GlosError('PHONE_NOT_VERIFIED', 'Verify the new number first — we send it a code', { field: 'newPhone' });
    // Said of the NEW number only, and only to somebody who has just proved they hold it.
    if (this.persons.findByPhone(input.newPhone)) {
      throw new GlosError('DUPLICATE', 'The new number already has an account of its own, so another account cannot be moved onto it. Sign in with it, or use a number that has none.', { field: 'newPhone' });
    }

    const country = countryOfPhone(input.oldPhone);
    const support = this.supportFor(country);
    // Asked again with the same two numbers — a lost reference, a second look: the same request, not another notice.
    const same = this.all(now).find((m) => OPEN.includes(m.state) && m.oldPhoneHash === oldPhoneHash && m.newPhoneHash === newPhoneHash);
    if (same) {
      this.otp.consume(input.newPhone);
      return { reference: same.reference, lapsesAt: same.lapsesAt, ...(support ? { support } : {}) };
    }
    const today = this.all(now).filter((m) => m.oldPhoneHash === oldPhoneHash && Date.parse(m.askedAt) > now - DAY_MS).length;
    if (today >= MOVE_ASKS_PER_DAY) throw new GlosError('RATE_LIMITED', 'This account has been asked about too many times today. Speak to SeeBuyGet staff with the reference you were given, or try again tomorrow.');

    const person = this.persons.findByPhone(input.oldPhone);
    const move: StoredMove = {
      moveId: `mv_${randomBytes(8).toString('hex')}`,
      reference: this.newReference(),
      askedAt: new Date(now).toISOString(),
      lapsesAt: new Date(now + MOVE_LAPSES_AFTER_DAYS * DAY_MS).toISOString(),
      oldPhoneHash,
      oldEnds: endsOf(input.oldPhone),
      ...(person ? { personDid: person.personDid } : {}),
      newPhoneHash,
      newEnds: endsOf(input.newPhone),
      newVaultRef: this.vault.store({ fullName: '', phone: normalizePhone(input.newPhone) }).vaultRef,
      ...(person ? this.idAnswer(person, input.nationalId) : {}),
      ...(input.note?.trim() ? { note: input.note.trim().slice(0, 280) } : {}),
      state: 'asked',
      ...(country ? { country } : {}),
    };
    this.moves.set(move.moveId, move);
    this.otp.consume(input.newPhone);

    // THE HOLDER HEARS IT NOW — before any member of staff has looked. If the asker is not them, they are the one
    // person who can say so with certainty, and the cheapest proof is the thing the asker said they cannot do.
    if (person) {
      this.recovery.tellHolder(person, {
        headline: 'Somebody asked for your account to be moved',
        what: `Somebody told SeeBuyGet that they have lost this account’s phone number and its PIN, and asked for the account to be moved to a number ending ${move.newEnds}. Two members of staff check who is asking before anything changes.`,
        next: 'If that is you, there is nothing to do here. If it is NOT you: sign in to any SeeBuyGet app with your number and PIN — that alone stops it — then open Settings, where you can stop it yourself, and choose a new PIN.',
      });
    }
    return { reference: move.reference, lapsesAt: move.lapsesAt, ...(support ? { support } : {}) };
  }

  /** What became of a request, for whoever holds its reference. Says nothing of whose account it was. */
  status(reference: string, now: number = Date.now()): MoveStatus {
    const wanted = normalizeReference(reference);
    const move = this.all(now).find((m) => normalizeReference(m.reference) === wanted);
    if (!move) throw new GlosError('NOT_FOUND', 'No request has that reference. Check it against what you wrote down.');
    const support = this.supportFor(move.country);
    return {
      state: move.state,
      askedAt: move.askedAt,
      ...(OPEN.includes(move.state) ? { lapsesAt: move.lapsesAt } : {}),
      ...(move.decided ? { decidedAt: move.decided.at } : {}),
      ...(move.state === 'refused' && move.decided?.reason ? { reason: move.decided.reason } : {}),
      ...(support ? { support } : {}),
    };
  }

  /* -------------------------------------------------------------- the account's holder -- */

  /** A request waiting against this person's account, for their own Settings. */
  openAgainst(personDid: string, now: number = Date.now()): MoveAgainstMe | undefined {
    const move = this.all(now).find((m) => m.personDid === personDid && OPEN.includes(m.state));
    return move ? { askedAt: move.askedAt, toEnds: move.newEnds } : undefined;
  }

  /**
   * THE HOLDER SAYS NO — signed in, which the asker said they could not be. Every request waiting against their
   * account ends, and cannot be approved. How many it stopped.
   */
  stop(personDid: string, now: number = Date.now()): number {
    const open = this.all(now).filter((m) => m.personDid === personDid && OPEN.includes(m.state));
    for (const m of open) this.end(m, 'stopped', now, { stoppedBy: 'holder' });
    return open.length;
  }

  /* ---------------------------------------------------------------------------- staff -- */

  /** Every request, for staff: the ones waiting on somebody first, oldest first; then what was decided, newest first. */
  list(staff?: StaffMember, now: number = Date.now()): MoveList {
    const all = this.all(now);
    const waiting = all.filter((m) => OPEN.includes(m.state)).sort((a, b) => a.askedAt.localeCompare(b.askedAt));
    const done = all.filter((m) => !OPEN.includes(m.state)).sort((a, b) => (b.decided?.at ?? b.askedAt).localeCompare(a.decided?.at ?? a.askedAt));
    return { items: [...waiting, ...done.slice(0, 100)].map((m) => this.row(m, staff, false)), waiting: waiting.length };
  }

  one(moveId: string, staff?: StaffMember, now: number = Date.now()): MoveRow {
    return this.row(this.require(moveId, now), staff, true);
  }

  /**
   * THE FIRST MEMBER OF STAFF: "I checked who is asking, and this is what I checked." It moves nothing.
   * What they checked is written down and kept, because the second one approves on the strength of it.
   */
  check(moveId: string, staff: StaffMember, what: string, now: number = Date.now()): MoveRow {
    const move = this.require(moveId, now);
    if (move.state !== 'asked') throw new GlosError('INVALID_STATE', move.state === 'checked' ? 'This has already been checked. A second member of staff approves it.' : 'This request is over.');
    if (!move.personDid) throw new GlosError('INVALID_STATE', 'The old number names no account, so there is nothing to move. Refuse the request, with a reason the person can act on.');
    const said = what?.trim();
    if (!said) throw new GlosError('FIELD_REQUIRED', 'Say what you checked and how — the second member of staff approves on the strength of it', { field: 'what' });
    this.stopIfPinUsed(move, now);
    move.state = 'checked';
    move.checked = { by: staff.name, byKey: staff.key, at: new Date(now).toISOString(), what: said.slice(0, 500) };
    this.moves.set(move.moveId, move);
    return this.row(move, staff, true);
  }

  /**
   * THE SECOND MEMBER OF STAFF APPROVES, AND THE ACCOUNT MOVES.
   *
   * Never the one who checked it. And everything that made it right to move is asked AGAIN here, at the moment of
   * the act: that it is still waiting, that the account is still there, and that nobody has used its PIN since it
   * was asked — which would mean the person asking is not the person who holds it.
   */
  approve(moveId: string, staff: StaffMember, now: number = Date.now()): MoveRow {
    const move = this.require(moveId, now);
    if (move.state !== 'checked') throw new GlosError('INVALID_STATE', move.state === 'asked' ? 'Nobody has checked who is asking yet. One member of staff checks; a second approves.' : 'This request is over.');
    if (move.checked?.byKey === staff.key) throw new GlosError('CONFLICT', 'A second member of staff has to approve — not the one who checked');
    if (!move.personDid || !this.persons.findByDid(move.personDid)) throw new GlosError('INVALID_STATE', 'The account this named is no longer there');
    this.stopIfPinUsed(move, now);

    const held = this.vault.reveal(move.newVaultRef, { purpose: 'account-move', requesterDid: `staff:${staff.key}` });
    if (typeof held.phone !== 'string' || !held.phone) throw new GlosError('INVALID_STATE', 'The new number is no longer on this request');
    // The ordinary move: every register that holds the number, every session ended, the holder told, 24 hours to undo.
    this.recovery.moveByStaff(move.personDid, held.phone, now);
    this.end(move, 'moved', now, { decided: { by: staff.name, at: new Date(now).toISOString() } });
    return this.row(move, staff, true);
  }

  /** A member of staff refuses — either of them, at either step — with a reason the person who asked can act on. */
  refuse(moveId: string, staff: StaffMember, reason: string, now: number = Date.now()): MoveRow {
    const move = this.require(moveId, now);
    if (!OPEN.includes(move.state)) throw new GlosError('INVALID_STATE', 'This request is over.');
    const why = reason?.trim();
    if (!why) throw new GlosError('FIELD_REQUIRED', 'Say why — it is what the person who asked will read', { field: 'reason' });
    this.end(move, 'refused', now, { decided: { by: staff.name, at: new Date(now).toISOString(), reason: why.slice(0, 500) } });
    const person = move.personDid ? this.persons.findByDid(move.personDid) : undefined;
    if (person) {
      this.recovery.tellHolder(person, {
        headline: 'The request to move your account was refused',
        what: 'SeeBuyGet staff looked at the request to move your account to another phone number, and refused it. Nothing about your account has changed.',
        next: 'If you did not ask for it, choose a new PIN: somebody knows your phone number and tried to take the account.',
      });
    }
    return this.row(move, staff, true);
  }

  /* ------------------------------------------------------------------------ internals -- */

  /**
   * THE ONE THING THE ASKER SAID THEY COULD NOT DO. If the account's PIN has been used since this was asked — at the
   * door or inside an app — or chosen again by a code to its number, somebody holds what the asker said was lost.
   * The request ends there, and says why to whoever pressed the button.
   */
  private stopIfPinUsed(move: StoredMove, now: number): void {
    const person = move.personDid ? this.persons.findByDid(move.personDid) : undefined;
    const since = person ? pinUsedSince(person, move.askedAt) : undefined;
    if (!since) return;
    this.end(move, 'stopped', now, { stoppedBy: 'pin' });
    throw new GlosError('CONFLICT', 'This account’s PIN was used after the request was made — and the person asking said they had lost it. The request has been stopped. If it really is them, they can sign in and move the number themselves.', { state: 'stopped' });
  }

  /** A request ends: its state is final, and the new number it carried is blanked. */
  private end(move: StoredMove, state: MoveState, now: number, more: Partial<Pick<StoredMove, 'decided' | 'stoppedBy'>> = {}): void {
    move.state = state;
    Object.assign(move, more);
    if (!move.decided) move.decided = { by: state === 'lapsed' ? 'nobody' : 'the account’s holder', at: new Date(now).toISOString() };
    this.moves.set(move.moveId, move);
    try {
      this.vault.update(move.newVaultRef, { fullName: '' });
    } catch {
      /* a vault that will not blank it holds a number nothing reads again */
    }
  }

  /** Every request, with the ones whose time has passed ended first — so nothing is ever read as waiting when it is not. */
  private all(now: number): StoredMove[] {
    const all = [...this.moves.values()];
    for (const m of all) if (OPEN.includes(m.state) && now >= Date.parse(m.lapsesAt)) this.end(m, 'lapsed', now);
    return all;
  }

  private require(moveId: string, now: number): StoredMove {
    const move = this.all(now).find((m) => m.moveId === moveId);
    if (!move) throw new GlosError('NOT_FOUND', 'No such request');
    return move;
  }

  private row(m: StoredMove, staff: StaffMember | undefined, full: boolean): MoveRow {
    const person = m.personDid ? this.persons.findByDid(m.personDid) : undefined;
    return {
      moveId: m.moveId,
      reference: m.reference,
      state: m.state,
      askedAt: m.askedAt,
      lapsesAt: m.lapsesAt,
      oldEnds: m.oldEnds,
      newEnds: m.newEnds,
      namesAccount: Boolean(person),
      ...(m.nationalId ? { nationalId: m.nationalId } : {}),
      ...(m.note ? { note: m.note } : {}),
      ...(m.checked ? { checkedBy: m.checked.by, checkedAt: m.checked.at, checkedWhat: m.checked.what } : {}),
      ...(m.decided ? { decidedBy: m.decided.by, decidedAt: m.decided.at, ...(m.decided.reason ? { reason: m.decided.reason } : {}) } : {}),
      ...(m.stoppedBy ? { stoppedBy: m.stoppedBy } : {}),
      ...(staff && m.checked?.byKey === staff.key ? { checkedByYou: true } : {}),
      ...(full && person ? { account: this.account(person, m) } : {}),
    };
  }

  /** What the system knows of the account — what there is to check the asker against, and what speaks against them. */
  private account(person: Person, m: StoredMove): MoveAccount {
    const active = person.roles.filter((r) => r.status === 'active');
    const roles = active.flatMap((r) => {
      try {
        if (r.role === 'driver') {
          const d = this.drivers.get(r.entityDid);
          let fleet: string | undefined;
          try {
            fleet = d.managerDid ? this.managers.get(d.managerDid).companyName : undefined;
          } catch {
            fleet = undefined;
          }
          return [{ role: 'driver', name: d.displayName, ...(fleet ? { with: fleet } : {}) }];
        }
        if (r.role === 'agent') return [{ role: 'shop', name: this.agents.get(r.entityDid).shopName }];
      } catch {
        /* a record that is gone names nobody */
      }
      return [];
    });
    const since = OPEN.includes(m.state) ? pinUsedSince(person, m.askedAt) : undefined;
    return {
      since: person.createdAt,
      hasPin: Boolean(person.pinHash),
      ...(person.emailMasked && person.emailVerifiedAt ? { email: person.emailMasked } : {}),
      roles,
      nationalIdOnRecord: active.some((r) => r.role === 'driver' || r.role === 'agent'),
      ...(since ? { pinUsedSince: since } : {}),
      ...(person.phoneChange ? { numberChangedAt: person.phoneChange.at } : {}),
    };
  }

  /** Is the ID they typed the one a driver or shop record on this account registered with? Only the answer is kept. */
  private idAnswer(person: Person, typed?: string): { nationalId?: MoveIdAnswer } {
    const id = typed?.trim();
    if (!id) return {};
    const drivers = person.roles.filter((r) => r.role === 'driver' && r.status === 'active').map((r) => r.entityDid);
    const shops = person.roles.filter((r) => r.role === 'agent' && r.status === 'active').map((r) => r.entityDid);
    if (!drivers.length && !shops.length) return { nationalId: 'none_on_record' };
    const matches = drivers.some((did) => this.drivers.holdsNationalId(did, id)) || shops.some((did) => this.agents.holdsNationalId(did, id));
    return { nationalId: matches ? 'matches' : 'differs' };
  }

  /** The company that answers for a country, as it wrote its own entry. Nothing when it wrote none. */
  private supportFor(country: string | undefined): MoveSupport | undefined {
    const sister = country ? this.entities?.forJurisdiction(country) : undefined;
    const card = sister ? this.contacts?.of(sister.entityId) : undefined;
    if (!sister || !card || (!card.phone && !card.email)) return undefined;
    return {
      company: sister.name,
      ...(card.contactName ? { contactName: card.contactName } : {}),
      ...(card.phone ? { phone: card.phone } : {}),
      ...(card.phoneAlt ? { phoneAlt: card.phoneAlt } : {}),
      ...(card.email ? { email: card.email } : {}),
      ...(card.hours ? { hours: card.hours } : {}),
    };
  }

  private newReference(): string {
    for (;;) {
      const pick = () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
      const reference = `MV-${pick()}-${pick()}`;
      if (![...this.moves.values()].some((m) => m.reference === reference)) return reference;
    }
  }
}

/** As somebody types what they wrote down: any case, with or without the dashes and the letters in front. */
export function normalizeReference(reference: string): string {
  return (reference ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^MV/, '');
}

/** The last three digits: enough for staff and the holder to tell two numbers apart, not enough to dial. */
function endsOf(phone: string): string {
  return normalizePhone(phone).replace(/\D/g, '').slice(-3);
}

/** Which country a number is in, by its dialling code — the longest that fits. */
export function countryOfPhone(phone: string): string | undefined {
  const p = normalizePhone(phone);
  return [...COUNTRY_CATALOGUE].filter((c) => p.startsWith(c.dialCode)).sort((a, b) => b.dialCode.length - a.dialCode.length)[0]?.code;
}

/** When the account's PIN was last used, or chosen again, if that was AFTER this moment. */
function pinUsedSince(person: Person, sinceIso: string): string | undefined {
  const since = Date.parse(sinceIso);
  return [person.pinUsedAt, person.pinChangedAt].filter((at): at is string => Boolean(at) && Date.parse(at as string) > since).sort()[0];
}
