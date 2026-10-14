import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { randomBytes, randomInt } from 'crypto';
import { IdentityVault } from '../../foundation/data-firewall/identity-vault.service';
import { EntityService } from '../../foundation/entity/entity.service';
import { GlosError } from '../../foundation/http/glos-error';
import { MailService } from '../../foundation/mail/mail.service';
import { hashPhone, isPlausiblePhone, normalizePhone } from '../../foundation/identity/phone';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { countryOfPhone } from './account-move.service';
import { AccountRecoveryService } from './account-recovery.service';
import { AgentService } from './agent.service';
import { ContactCardService, WEEKDAYS, placesIn, slotEnd, visitWindowOn, visitingHours, weekdayOf, type Weekday } from './contact-card.service';
import { DriverService } from './driver.service';
import { FleetManagerService } from './fleet-manager.service';
import {
  APPOINTMENT_CHANGES,
  APPOINTMENT_REMINDER_HOURS,
  APPOINTMENT_WITHIN_DAYS,
  BRING,
  CardAnswer,
  DISPUTE_ANSWER_DAYS,
  DISPUTE_CONTEST_DAYS,
  DISPUTE_OPENS_PER_DAY,
  DISPUTE_PHOTOS,
  DisputeAgainstMe,
  DisputeDay,
  DisputeList,
  DisputeOpened,
  DisputeParty,
  DisputePhoto,
  DisputePlace,
  DisputeRow,
  DisputeSide,
  DisputeState,
  DisputeStatus,
  DisputeTicket,
  HolderEffect,
  IdRegister,
} from './id-dispute.types';
import { MediaService } from './media.service';
import { NotificationService } from './notification.service';
import { OtpService } from './otp.service';
import { PersonService } from './person.service';
import { accountFor, waitsAt, type Addressed } from './addressed-to';

const DAY_MS = 86_400_000;
/** Letters and digits nobody mistakes for one another — it is written on paper by hand and read off a photograph. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** What holds an ID that a decision gave to somebody with no registration yet. */
const KEPT = 'id-dispute:';

/** A member of staff: a name for the record, and the key their sign-in answers to, which is what tells two apart. */
export interface DisputeStaff {
  name: string;
  key: string;
}

/** What a register of national IDs has to be able to do for a decision. A driver's and a shop's both can. */
interface IdRegisterPort {
  nationalIdKey(nationalId: string | undefined): string;
  nationalIdHolderOfKey(key: string): string | undefined;
  loseNationalId(did: string, key: string): void;
  holdForId(did: string, hold: { reference: string; at: string }): void;
  idHoldOf(did: string): { reference: string; at: string } | undefined;
  takeNationalId(did: string, nationalId: string): void;
  giveNationalId(did: string, key: string): void;
  keepNationalIdFor(key: string, phone: string, by: string): void;
}

interface StoredParty {
  reference: string;
  personDid?: string;
  photos: Partial<Record<DisputePhoto, string>>;
  sentAt?: string;
  card?: CardAnswer;
  retake?: { reason: string; at: string };
}

interface Proposal {
  to: DisputeSide;
  by: string;
  byKey: string;
  at: string;
  what: string;
  reason: string;
  /** After an appointment: who came. */
  came?: { claimant: boolean; holder: boolean };
}

/** What is kept of a dispute. Never the ID number: the key it is kept under, and the answers staff were given. */
interface StoredDispute {
  disputeId: string;
  register: IdRegister;
  idKey: string;
  openedAt: string;
  state: DisputeState;
  /** The claimant's phone itself is in the vault — it is what an ID is kept for — and blanked when this is over. */
  claimant: StoredParty & { phoneHash: string; phoneEnds: string; phoneVaultRef: string };
  /** The number staff read on the holder's own card, where it is a DIFFERENT one: in the vault until this is over. */
  holder: StoredParty & { did: string; ownVaultRef?: string };
  photosBy: string;
  answerBy?: string;
  proposal?: Proposal;
  sentBack?: { by: string; at: string; why: string };
  decided?: { to: DisputeSide; by: string; at: string; reason: string; holderEffect: HolderEffect };
  contestBy?: string;
  /**
   * `setAt` — when it was made, or last moved. `reminded` — the day-before reminder was dealt with for THIS day and
   * hour (`for`), and whether it was sent: it is not, when the appointment was made after the reminder was due.
   */
  appointment?: { by: DisputeSide; date: string; at?: string; madeAt: string; setAt?: string; changes: number; reminded?: { for: string; at: string; sent: boolean } };
  final?: { to: DisputeSide; by: string; at: string; reason: string; came?: { claimant: boolean; holder: boolean } };
  endedAt?: string;
  country?: string;
}

/** Not over: something can still happen to it. */
const ALIVE: DisputeState[] = ['opened', 'answering', 'ready', 'checked', 'decided', 'appointment', 'rechecked'];
/** Before any decision. */
const UNDECIDED: DisputeState[] = ['opened', 'answering', 'ready', 'checked'];
const WORD: Record<IdRegister, string> = { driver: 'driver', shop: 'shop' };
/** How often the clock is looked at for reminders that have come due. */
const REMINDER_SWEEP_MS = 30 * 60 * 1000;

/**
 * TWO PEOPLE SAY ONE NATIONAL ID IS THEIRS (id-dispute.types.ts says what the user decided, and why each step).
 *
 * What this never does is choose by itself. Everything that moves an ID from one registration to another is a
 * member of staff's proposal that a second, different one approved — except the holder saying their own number was
 * mistyped, which only they can say and which costs nobody anything.
 */
@Injectable()
export class IdDisputeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IdDisputeService.name);
  private readonly disputes = new PersistentMap<string, StoredDispute>('id-disputes');

  constructor(
    private readonly persons: PersonService,
    private readonly recovery: AccountRecoveryService,
    private readonly otp: OtpService,
    private readonly vault: IdentityVault,
    private readonly drivers: DriverService,
    private readonly agents: AgentService,
    private readonly managers: FleetManagerService,
    @Optional() private readonly media?: MediaService,
    @Optional() private readonly notifications?: NotificationService,
    @Optional() private readonly entities?: EntityService,
    @Optional() private readonly contacts?: ContactCardService,
    @Optional() private readonly mail?: MailService,
  ) {
    // Whoever opened a dispute is known by the phone they opened it with, until an account answers for it. When that
    // account moves to another number the dispute goes with the ACCOUNT (addressed-to.ts) — or the registration it
    // holds, or gives back, would be looked for under whoever has the old number next.
    this.persons.onNumberLeft((personDid, fromHash) => this.keepWith(personDid, fromHash));
  }

  /** An account is moving off a number: every dispute opened from that number, and named for no account yet, is theirs. */
  keepWith(personDid: string, fromHash: string): number {
    let kept = 0;
    for (const d of this.disputes.values()) {
      if (!waitsAt(claimantOf(d), fromHash)) continue;
      d.claimant.personDid = personDid;
      this.disputes.set(d.disputeId, d);
      kept += 1;
    }
    return kept;
  }

  private timer?: NodeJS.Timeout;

  /** The reminders go by the clock, not by anybody remembering: looked at every half hour while the server runs. */
  onModuleInit(): void {
    this.timer = setInterval(() => {
      try {
        this.remindAppointments();
      } catch (err) {
        this.logger.warn(`appointment reminders failed: ${(err as Error).message}`);
      }
    }, REMINDER_SWEEP_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /* ------------------------------------------------------------ the one who was refused -- */

  /**
   * OPEN A DISPUTE. Whoever asks has confirmed their phone by a code, and names the register and the number that
   * registration refused. They are handed a reference — to write on paper and hold in the photographs.
   *
   * THE HOLDER IS NOT TOLD YET. A reference with no photographs behind it is nothing; they hear of it when there is
   * a claim somebody has put their face to.
   */
  open(input: { register: IdRegister; nationalId: string; phone: string }, now: number = Date.now()): DisputeOpened {
    if (!isPlausiblePhone(input.phone ?? '')) throw new GlosError('PHONE_INVALID', 'Enter your phone number', { field: 'phone' });
    const number = input.nationalId?.trim();
    if (!number) throw new GlosError('FIELD_REQUIRED', 'Enter the number on your ID card', { field: 'nationalId' });
    if (!this.otp.isVerified(input.phone)) throw new GlosError('PHONE_NOT_VERIFIED', 'Confirm your phone number first — we send it a code', { field: 'phone' });

    const reg = this.reg(input.register);
    const idKey = reg.nationalIdKey(number);
    const phoneHash = hashPhone(input.phone);
    const all = this.all(now);
    const country = countryOfPhone(input.phone);

    // Asked again by the same person about the same ID — a lost reference: the same dispute, not a second one.
    const same = all.find((d) => d.register === input.register && d.idKey === idKey && d.claimant.phoneHash === phoneHash && UNDECIDED.includes(d.state));
    if (same) {
      this.otp.consume(input.phone);
      return this.opened(same);
    }

    const holderDid = reg.nationalIdHolderOfKey(idKey);
    // Said to somebody who has just proved a phone number, and no more than registration itself would tell them.
    if (!holderDid) {
      throw new GlosError('NOT_FOUND', `No ${WORD[input.register]} is registered with that ID number, so there is nothing to dispute. Check it against your card — if it is right, you can register with it.`, { field: 'nationalId' });
    }
    if (holderDid.startsWith(KEPT)) throw new GlosError('CONFLICT', 'That ID has just been decided on, and is being kept for the person it was given to. Speak to SeeBuyGet staff.', { field: 'nationalId' });
    const me = this.persons.findByPhone(input.phone);
    if (me?.roles.some((r) => r.entityDid === holderDid)) throw new GlosError('INVALID_STATE', 'That ID is on your own registration. Sign in with your number instead.', { field: 'nationalId' });
    if (all.some((d) => d.register === input.register && d.idKey === idKey && UNDECIDED.includes(d.state))) {
      throw new GlosError('CONFLICT', 'Somebody has already disputed that ID, and it is being looked at. Speak to SeeBuyGet staff.', { field: 'nationalId' });
    }
    const today = all.filter((d) => d.claimant.phoneHash === phoneHash && Date.parse(d.openedAt) > now - DAY_MS).length;
    if (today >= DISPUTE_OPENS_PER_DAY) throw new GlosError('RATE_LIMITED', 'Too many disputes have been opened from this number today. Try again tomorrow, or speak to SeeBuyGet staff.');

    const holderPerson = this.persons.findByEntity(holderDid);
    const dispute: StoredDispute = {
      disputeId: `idd_${randomBytes(8).toString('hex')}`,
      register: input.register,
      idKey,
      openedAt: iso(now),
      state: 'opened',
      claimant: {
        reference: this.newReference(),
        ...(me ? { personDid: me.personDid } : {}),
        photos: {},
        phoneHash,
        phoneEnds: normalizePhone(input.phone).replace(/\D/g, '').slice(-3),
        phoneVaultRef: this.vault.store({ fullName: '', phone: normalizePhone(input.phone) }).vaultRef,
      },
      holder: { reference: this.newReference(), did: holderDid, ...(holderPerson ? { personDid: holderPerson.personDid } : {}), photos: {} },
      photosBy: iso(now + DISPUTE_ANSWER_DAYS * DAY_MS),
      ...(country ? { country } : {}),
    };
    this.disputes.set(dispute.disputeId, dispute);
    this.otp.consume(input.phone);
    return this.opened(dispute);
  }

  /** Where it stands, for whoever holds ONE of its two references. Says nothing of the other person. */
  status(reference: string, now: number = Date.now()): DisputeStatus {
    const { dispute, side } = this.byReference(reference, now);
    return this.statusOf(dispute, side, now);
  }

  /** One of the three photographs. Taking it again replaces it, and the one it replaces is deleted. */
  photo(input: { reference: string; which: DisputePhoto; dataUrl: string; thumbDataUrl?: string }, now: number = Date.now()): DisputeStatus {
    const { dispute, side } = this.byReference(input.reference, now);
    this.assertMaySend(dispute, side);
    if (!this.media) throw new GlosError('INVALID_STATE', 'Photographs cannot be taken in right now. Try again later.');
    const party = dispute[side];
    const { mediaId } = this.media.upload({ ownerDid: `${KEPT}${dispute.disputeId}:${side}`, kind: 'id_check', dataUrl: input.dataUrl, ...(input.thumbDataUrl ? { thumbDataUrl: input.thumbDataUrl } : {}) });
    this.media.link(mediaId, { type: 'id-dispute', id: dispute.disputeId }, 'id_check');
    this.media.dropIdentityCheck(party.photos[input.which]);
    party.photos[input.which] = mediaId;
    this.disputes.set(dispute.disputeId, dispute);
    return this.statusOf(dispute, side, now);
  }

  /**
   * THE THREE PHOTOGRAPHS GO TO STAFF. From the claimant, the first time, this is also when the holder is told —
   * and when their week starts.
   */
  send(reference: string, now: number = Date.now()): DisputeStatus {
    const { dispute, side } = this.byReference(reference, now);
    this.assertMaySend(dispute, side);
    const party = dispute[side];
    const missing = DISPUTE_PHOTOS.filter((p) => !party.photos[p]);
    if (missing.length) throw new GlosError('FIELD_REQUIRED', `All three photographs are needed. Still missing: ${missing.map((p) => PHOTO_WORD[p]).join(', ')}.`, { field: missing[0] });
    party.sentAt = iso(now);
    delete party.retake;
    if (side === 'claimant') {
      if (!dispute.answerBy) {
        dispute.answerBy = iso(now + DISPUTE_ANSWER_DAYS * DAY_MS);
        this.tell(dispute.holder.personDid, {
          headline: 'Somebody says the national ID on your registration is theirs',
          what: `Somebody tried to register as a ${WORD[dispute.register]} with the national ID number that is on your ${WORD[dispute.register]} registration, and has sent SeeBuyGet staff photographs of themselves holding their ID card. Two members of staff decide whose it is.`,
          next: `Open Settings in your SeeBuyGet app before ${dayOf(dispute.answerBy)}: show your own card the same way, or — if the number on your record was mistyped — put the right one there, which ends this at once. If you do nothing, the ID goes to the other person and your ${WORD[dispute.register]} registration is held until an ID of your own is on record.`,
        });
      }
      dispute.state = dispute.holder.sentAt || now >= Date.parse(dispute.answerBy) ? 'ready' : 'answering';
    } else if (dispute.claimant.sentAt) {
      dispute.state = 'ready';
    }
    this.disputes.set(dispute.disputeId, dispute);
    return this.statusOf(dispute, side, now);
  }

  /** The claimant takes it back, while nothing has been decided. Nothing changes for anybody. */
  withdraw(reference: string, now: number = Date.now()): DisputeStatus {
    const { dispute, side } = this.byReference(reference, now);
    if (side !== 'claimant') throw new GlosError('FORBIDDEN', 'Only the person who opened a dispute can withdraw it.');
    if (!UNDECIDED.includes(dispute.state)) throw new GlosError('INVALID_STATE', 'This can no longer be withdrawn.');
    const told = Boolean(dispute.answerBy);
    dispute.state = 'withdrawn';
    this.end(dispute, now);
    if (told) {
      this.tell(dispute.holder.personDid, {
        headline: 'The dispute over your national ID was withdrawn',
        what: 'The person who said the national ID on your registration was theirs has withdrawn that. Nothing about your registration has changed.',
        next: 'There is nothing for you to do.',
      });
    }
    return this.statusOf(dispute, side, now);
  }

  /**
   * STILL DISPUTED: AN APPOINTMENT IN PERSON. Whoever did not get the ID names a day, and both are given a ticket —
   * where, when, what to bring. Whoever made it may change the day, twice, before it comes.
   *
   * WHICH DAYS AND HOURS is the country's own to say, in its own entry: the days of the week it receives visitors,
   * the dates it is closed, and how many it sees in an hour. Each is asked here, of what it says NOW.
   */
  appoint(reference: string, date: string, at?: string, now: number = Date.now()): DisputeStatus {
    const { dispute, side } = this.byReference(reference, now);
    const today = iso(now).slice(0, 10);
    const day = Date.parse(`${date}T00:00:00.000Z`);
    const place = this.placeFor(dispute.country);
    /** Is this a day — and, where the country counts by the hour, an hour — that can be taken? Answers the hour. */
    const hourOn = (): string | undefined => {
      if (Number.isNaN(day) || date <= today) throw new GlosError('INVALID_INPUT', 'Choose a day from tomorrow on.', { field: 'date' });
      if (day > now + APPOINTMENT_WITHIN_DAYS * DAY_MS) throw new GlosError('INVALID_INPUT', `Choose a day within the next ${APPOINTMENT_WITHIN_DAYS} days.`, { field: 'date' });
      // "It's up to the countries to set visiting days and visiting hours." Where one has, no other day is taken.
      if (notVisitingDay(place, date)) {
        throw new GlosError('INVALID_INPUT', `${place!.company} does not receive visitors on a ${DAY_NAME[weekdayOf(date) as Weekday]}. It does on ${daysInWords(place!.visitDays as Weekday[])}.`, { field: 'date', visitDays: place!.visitDays });
      }
      // "The country should set it's own public holidays and/or one off closure."
      const closed = closedOn(place, date);
      if (closed) throw new GlosError('INVALID_INPUT', `${place!.company} is closed on ${dayOf(date)}${closed.note ? ` (${closed.note})` : ''}. Choose another day.`, { field: 'date' });
      // "The limitation is set by the country as an actual number of visitors per hour." Where it has set one, the
      // appointment is for an hour, and an hour that is full is refused. Where it has not, a day is enough.
      if (!place?.visitorsPerHour) return undefined;
      // That DATE's hours: a day of the week may keep its own, and a date may be shorter.
      const hours = visitingHours(place, date);
      if (!at || !hours.includes(at)) throw new GlosError('INVALID_INPUT', `Choose the hour you will come: ${hours.join(', ')}.`, { field: 'at', hours });
      if (this.takenAt(dispute, date, at, now) >= placesIn(place, date, at)) throw new GlosError('CONFLICT', `${at} on ${dayOf(date)} is full. Choose another hour.`, { field: 'at' });
      return at;
    };
    if (dispute.state === 'decided') {
      if (!dispute.decided || dispute.decided.to === side) throw new GlosError('INVALID_STATE', 'The ID is yours: there is nothing for you to contest.');
      if (!dispute.contestBy || now >= Date.parse(dispute.contestBy)) throw new GlosError('INVALID_STATE', 'The time to contest this decision has passed.');
      const hour = hourOn();
      dispute.appointment = { by: side, date, ...(hour ? { at: hour } : {}), madeAt: iso(now), setAt: iso(now), changes: 0 };
      dispute.state = 'appointment';
    } else if (dispute.state === 'appointment' && dispute.appointment) {
      if (dispute.appointment.by !== side) throw new GlosError('FORBIDDEN', 'Only the person who made the appointment can change its day.');
      if (dispute.appointment.date <= today) throw new GlosError('INVALID_STATE', 'The day has come: it can no longer be changed.');
      if (dispute.appointment.changes >= APPOINTMENT_CHANGES) throw new GlosError('INVALID_STATE', 'The day has been changed as often as it can be. Speak to SeeBuyGet staff.');
      const hour = hourOn();
      dispute.appointment = { by: dispute.appointment.by, date, ...(hour ? { at: hour } : {}), madeAt: dispute.appointment.madeAt, setAt: iso(now), changes: dispute.appointment.changes + 1 };
    } else {
      throw new GlosError('INVALID_STATE', 'There is nothing here to make an appointment for.');
    }
    // The photographs are kept until the day has come and gone: it is the one reason to keep them longer.
    this.anchorPhotos(dispute, day);
    this.disputes.set(dispute.disputeId, dispute);
    const hour = dispute.appointment!.at;
    const when = hour ? `${dayOf(date)} at ${hour}` : dayOf(date);
    const window = visitWindowOn(place, date);
    const visitors = !hour && window ? `, between ${window.from} and ${window.to}` : '';
    const where = place ? `${place.company}${place.address ? `, ${place.address}` : ''}${visitors}` : 'the SeeBuyGet office for your country';
    for (const s of ['claimant', 'holder'] as const) {
      const mine = dispute.appointment!.by === s;
      this.tell(dispute[s].personDid, {
        headline: mine ? 'Your appointment about the national ID' : 'The decision about the national ID is being looked at again, in person',
        what: mine
          ? `You are expected on ${when} at ${where}. Two members of staff decide again on what they see, and that decision is final.`
          : `The other person does not accept the decision and comes in on ${when} to ${where}. You may come too, with your card, so that yours is looked at as well: staff decide on what they see.`,
        next: `Bring: your ID card itself — not a copy or a photograph; the phone you use with SeeBuyGet; your reference, ${dispute[s].reference}; and a second document in your name if you have one. Your ticket is in the app, under the same reference.`,
      });
    }
    return this.statusOf(dispute, side, now);
  }

  /**
   * THE DAY BEFORE, EACH OF THE TWO IS REMINDED — in the app and by email: when, where, and what to bring. The user,
   * 2026-10-08: "a reminder notification/email with which docs to bring along a day before the appointment".
   *
   * ONCE for each day and hour: moved, an appointment is reminded of again. NOT when it was made or moved after
   * the reminder was already due — they were told all of it a moment ago — and not once the day itself has come,
   * when "tomorrow" would be wrong. Where the office has since changed when it receives visitors, the reminder says
   * to choose again instead of what to bring. Somebody with no account cannot be reached: their ticket says so.
   * How many appointments were reminded of.
   */
  remindAppointments(now: number = Date.now()): number {
    let sent = 0;
    const today = iso(now).slice(0, 10);
    for (const d of this.all(now)) {
      const a = d.appointment;
      if (d.state !== 'appointment' || !a) continue;
      const key = a.at ? `${a.date} ${a.at}` : a.date;
      if (a.reminded?.for === key) continue;
      const due = Date.parse(`${a.date}T00:00:00.000Z`) - APPOINTMENT_REMINDER_HOURS * 3_600_000;
      if (now < due) continue;
      const tell = Date.parse(a.setAt ?? a.madeAt) < due && today < a.date;
      if (tell) {
        this.remind(d);
        sent += 1;
      }
      a.reminded = { for: key, at: iso(now), sent: tell };
      this.disputes.set(d.disputeId, d);
    }
    return sent;
  }

  private remind(d: StoredDispute): void {
    const a = d.appointment!;
    const place = this.placeFor(d.country);
    const fits = !offDay(place, a.date, a.at);
    const hour = a.at ? `${a.at} to ${slotEnd(place, a.date, a.at)}` : undefined;
    const when = hour ? `${dayOf(a.date)}, ${hour}` : dayOf(a.date);
    const where = place ? `${place.company}${place.address ? `, ${place.address}` : ''}` : 'the SeeBuyGet office for your country';
    for (const side of ['claimant', 'holder'] as const) {
      const person = d[side].personDid ? this.persons.findByDid(d[side].personDid as string) : undefined;
      if (!person) continue;
      const yours = a.by === side;
      const bring = bringWords(d.register, d[side].reference);
      const title = !fits ? 'Your appointment tomorrow no longer fits' : yours ? 'Your appointment about the national ID is tomorrow' : 'The appointment about the national ID is tomorrow';
      const body = !fits
        ? `The office has changed when it receives visitors, and ${when} is no longer one of its times. ${yours ? 'Open the app with your reference and choose another day, today.' : 'The other person has been asked to choose another day: look at your ticket before you travel.'}`
        : `Tomorrow, ${when}, at ${where}. ${yours ? '' : 'The other person is coming in; you may come too, with your card. '}Bring: ${bring.join('; ')}.`;
      // The person's own bell, and the bell of the app they drive in: wherever they look first.
      const drivers = person.roles.filter((r) => r.role === 'driver' && r.status === 'active').map((r) => r.entityDid);
      for (const to of [person.personDid, ...drivers]) {
        void this.notifications
          ?.notify(to, { kind: 'security', title, body, link: '/', tag: `id-dispute:${d.disputeId}:reminder:${a.date}${a.at ?? ''}` })
          .catch((err) => this.logger.warn(`appointment reminder failed: ${(err as Error).message}`));
      }
      const address = this.persons.emailOf(person);
      if (address) void this.mail?.send('appointment-reminder', { address }, { yours, fits, day: dayOf(a.date), ...(hour ? { hour } : {}), where, reference: d[side].reference, bring: fits ? bring : [] });
    }
  }

  /** How many OTHER appointments at this country's office are already made for that hour of that day. */
  private takenAt(d: StoredDispute, date: string, at: string, now: number): number {
    return this.all(now).filter((x) => x.disputeId !== d.disputeId && x.country === d.country && x.state === 'appointment' && x.appointment?.date === date && x.appointment?.at === at).length;
  }

  /**
   * THE DAYS — AND HOURS — THERE ARE TO CHOOSE FROM, for somebody who may make an appointment or move the one they
   * made. Worked out HERE, because only here are the company's days, its closed dates and what is already taken
   * known together: its visiting days in the next three weeks, without the dates it is closed, and — where it
   * counts visitors by the hour — only the days that still have a free hour, each hour with its places left.
   * Nothing where it has set no visiting days: then any day may be asked for, and the person is told to ask first.
   */
  private choicesFor(d: StoredDispute, side: DisputeSide, now: number): DisputeDay[] | undefined {
    const today = iso(now).slice(0, 10);
    const mayMove = d.state === 'appointment' && d.appointment?.by === side && d.appointment.changes < APPOINTMENT_CHANGES && d.appointment.date > today;
    if (!this.mayContest(d, side, now) && !mayMove) return undefined;
    const place = this.placeFor(d.country);
    if (!place?.visitDays?.length) return undefined;
    const days: DisputeDay[] = [];
    for (let i = 1; i <= APPOINTMENT_WITHIN_DAYS; i++) {
      const date = iso(now + i * DAY_MS).slice(0, 10);
      if (notVisitingDay(place, date) || closedOn(place, date)) continue;
      if (!place.visitorsPerHour) {
        days.push({ date });
        continue;
      }
      const hours = visitingHours(place, date).map((at) => ({ at, until: slotEnd(place, date, at), free: Math.max(0, placesIn(place, date, at) - this.takenAt(d, date, at, now)) }));
      if (hours.some((h) => h.free > 0)) days.push({ date, hours });
    }
    return days;
  }

  /* ---------------------------------------------------------------------- the holder -- */

  /** A dispute over the ID on one of this person's own registrations, or a hold it left — for their Settings. */
  against(personDid: string, now: number = Date.now()): DisputeAgainstMe | undefined {
    const person = this.persons.findByDid(personDid);
    if (!person) return undefined;
    const mine = new Set(person.roles.filter((r) => r.role === 'driver' || r.role === 'agent').map((r) => r.entityDid));
    const found = this.all(now)
      .map((d) => ({ d, side: mine.has(d.holder.did) ? ('holder' as const) : this.claimantRecord(d) && mine.has(this.claimantRecord(d) as string) ? ('claimant' as const) : undefined }))
      .filter((x): x is { d: StoredDispute; side: DisputeSide } => Boolean(x.side))
      .map(({ d, side }) => ({ d, side, held: this.heldOf(d, side), told: side === 'holder' ? Boolean(d.answerBy) : false }))
      // Something they can still act on, or a hold they are living with. A claimant has their own reference already.
      // `opened` is here for the holder who HAS been told and is waiting while the other takes their photographs
      // again: it is still theirs to answer. A dispute nobody has put a face to yet is opened too, and not told.
      .filter(({ d, side, held, told }) => held || (side === 'holder' && told && (['opened', 'answering', 'ready', 'checked', 'appointment', 'rechecked'].includes(d.state) || this.mayContest(d, side, now))))
      .sort((a, b) => b.d.openedAt.localeCompare(a.d.openedAt))[0];
    if (!found) return undefined;
    const { d, side, held } = found;
    return {
      reference: d[side].reference,
      register: d.register,
      state: d.state,
      ...(side === 'holder' && this.maySend(d, 'holder') && d.answerBy ? { answerBy: d.answerBy } : {}),
      ...(held ? { held: true } : {}),
    };
  }

  /**
   * "THE NUMBER ON MY RECORD IS NOT MINE — THIS ONE IS." Said signed in, by the one person who can say it.
   *
   * While a dispute over their ID is open this ends it at once: their registration takes its own number, and the
   * disputed one is kept for the other person. On a registration that is HELD it is what ends the hold. Either way
   * the number has to be free — nobody takes a second person's ID by typing it here.
   */
  ownId(personDid: string, nationalId: string, now: number = Date.now()): { saved: boolean } {
    const person = this.persons.requireByDid(personDid);
    const number = nationalId?.trim();
    if (!number) throw new GlosError('FIELD_REQUIRED', 'Enter the number on your ID card', { field: 'nationalId' });
    const mine = person.roles.filter((r) => (r.role === 'driver' || r.role === 'agent') && r.status === 'active');
    const all = this.all(now);

    const open = all.find((d) => mine.some((r) => r.entityDid === d.holder.did) && Boolean(d.answerBy) && UNDECIDED.includes(d.state));
    if (open) {
      const reg = this.reg(open.register);
      if (reg.nationalIdKey(number) === open.idKey) {
        throw new GlosError('INVALID_STATE', 'That is the number being disputed. If it is yours, show your card: send the three photographs.', { field: 'nationalId' });
      }
      reg.takeNationalId(open.holder.did, number); // refuses a number somebody else holds, before anything is given up
      reg.loseNationalId(open.holder.did, open.idKey);
      this.giveToClaimant(open);
      open.state = 'conceded';
      this.end(open, now);
      this.tell(open.claimant.personDid, {
        headline: 'The national ID is free for you to register with',
        what: 'The person who held your national ID number said it was not theirs, and has put their own on record.',
        next: 'Register again with the same phone number and your ID number: it will go through now.',
      });
      return { saved: true };
    }

    for (const role of mine) {
      const reg = role.role === 'driver' ? this.reg('driver') : this.reg('shop');
      if (!reg.idHoldOf(role.entityDid)) continue;
      reg.takeNationalId(role.entityDid, number);
      return { saved: true };
    }
    throw new GlosError('INVALID_STATE', 'Nothing on your account is waiting for an ID number.');
  }

  /* --------------------------------------------------------------------------- staff -- */

  /** Every dispute, for staff: what waits on one of us first, oldest first; then the rest, newest first. */
  list(staff?: DisputeStaff, now: number = Date.now()): DisputeList {
    const all = this.all(now);
    const waiting = all.filter((d) => this.waitsOnStaff(d, now)).sort((a, b) => a.openedAt.localeCompare(b.openedAt));
    const rest = all.filter((d) => !this.waitsOnStaff(d, now)).sort((a, b) => b.openedAt.localeCompare(a.openedAt));
    return { items: [...waiting, ...rest.slice(0, 100)].map((d) => this.row(d, staff, false)), waiting: waiting.length };
  }

  one(disputeId: string, staff?: DisputeStaff, now: number = Date.now()): DisputeRow {
    return this.row(this.require(disputeId, now), staff, true);
  }

  /**
   * A MEMBER OF STAFF TYPES THE NUMBER THEY READ ON A CARD — in the photograph, or in the hand at an appointment —
   * and is told whether it is the disputed one. That answer is all that is kept, except a holder's DIFFERENT
   * number, which waits in the vault: if the ID goes to the other person, it is what the holder's record takes.
   */
  readCard(disputeId: string, staff: DisputeStaff, side: DisputeSide, number: string, now: number = Date.now()): DisputeRow {
    const dispute = this.require(disputeId, now);
    if (dispute.state !== 'ready' && dispute.state !== 'appointment') {
      throw new GlosError('INVALID_STATE', dispute.state === 'checked' || dispute.state === 'rechecked' ? 'A proposal is waiting for a second member of staff. Send it back first to read a card again.' : 'There is no card to read on this dispute now.');
    }
    const read = number?.trim();
    if (!read) throw new GlosError('FIELD_REQUIRED', 'Type the number as it is on the card', { field: 'number' });
    const party = dispute[side];
    if (dispute.state === 'ready' && !party.sentAt) throw new GlosError('INVALID_STATE', 'They have sent no photographs: there is no card to read.');
    party.card = this.reg(dispute.register).nationalIdKey(read) === dispute.idKey ? 'matches' : 'differs';
    if (side === 'holder') {
      this.blank(dispute.holder.ownVaultRef);
      delete dispute.holder.ownVaultRef;
      if (party.card === 'differs') dispute.holder.ownVaultRef = this.vault.store({ fullName: '', governmentId: read }).vaultRef;
    }
    this.disputes.set(dispute.disputeId, dispute);
    return this.row(dispute, staff, true);
  }

  /** The photographs will not do — blurred, no reference in them, a card that cannot be read. They are asked again. */
  retake(disputeId: string, staff: DisputeStaff, side: DisputeSide, reason: string, now: number = Date.now()): DisputeRow {
    const dispute = this.require(disputeId, now);
    if (dispute.state !== 'ready') throw new GlosError('INVALID_STATE', 'Photographs can be asked for again only while this waits to be decided.');
    const why = reason?.trim();
    if (!why) throw new GlosError('FIELD_REQUIRED', 'Say what is wrong with them — it is what the person reads before taking them again', { field: 'reason' });
    const party = dispute[side];
    if (!party.sentAt) throw new GlosError('INVALID_STATE', 'They have sent no photographs to take again.');
    for (const p of DISPUTE_PHOTOS) this.media?.dropIdentityCheck(party.photos[p]);
    party.photos = {};
    delete party.sentAt;
    delete party.card;
    party.retake = { reason: why.slice(0, 300), at: iso(now) };
    const by = iso(now + DISPUTE_ANSWER_DAYS * DAY_MS);
    if (side === 'claimant') {
      dispute.photosBy = by;
      dispute.state = 'opened';
    } else {
      this.blank(dispute.holder.ownVaultRef);
      delete dispute.holder.ownVaultRef;
      dispute.answerBy = by;
      dispute.state = 'answering';
    }
    this.disputes.set(dispute.disputeId, dispute);
    this.tell(party.personDid, {
      headline: 'Your photographs need taking again',
      what: `SeeBuyGet staff could not use the photographs you sent about the national ID: ${party.retake.reason}`,
      next: `Take the three photographs again before ${dayOf(by)}, with your reference ${party.reference} written on paper in the first one.`,
    });
    return this.row(dispute, staff, true);
  }

  /**
   * THE FIRST MEMBER OF STAFF SAYS WHOSE IT IS, and why. It changes nothing: a second, different one approves.
   *
   * FROM THE PHOTOGRAPHS the ID can go only to somebody whose card has been read as carrying it. AFTER AN
   * APPOINTMENT the decision can change only for somebody who came.
   */
  check(disputeId: string, staff: DisputeStaff, input: { to: DisputeSide; what: string; reason: string; claimantCame?: boolean; holderCame?: boolean }, now: number = Date.now()): DisputeRow {
    const dispute = this.require(disputeId, now);
    const what = input.what?.trim();
    const reason = input.reason?.trim();
    if (!what) throw new GlosError('FIELD_REQUIRED', 'Say what you checked and how — the second member of staff approves on the strength of it', { field: 'what' });
    if (!reason) throw new GlosError('FIELD_REQUIRED', 'Say why — it is what the one who does not get it will read', { field: 'reason' });
    const base = { to: input.to, by: staff.name, byKey: staff.key, at: iso(now), what: what.slice(0, 500), reason: reason.slice(0, 500) };

    if (dispute.state === 'ready') {
      if (input.to === 'claimant' && dispute.claimant.card !== 'matches') {
        throw new GlosError('INVALID_STATE', 'Read the number on the claimant’s card first. The ID can only go to somebody whose card carries it.');
      }
      if (input.to === 'holder' && dispute.holder.card !== 'matches' && dispute.claimant.card !== 'differs') {
        throw new GlosError('INVALID_STATE', 'The holder has shown no card carrying this number, and the claimant’s card has not been read as carrying a different one. Read the cards first.');
      }
      dispute.proposal = base;
      dispute.state = 'checked';
    } else if (dispute.state === 'appointment' && dispute.appointment && dispute.decided) {
      if (iso(now).slice(0, 10) < dispute.appointment.date) throw new GlosError('INVALID_STATE', `The appointment is on ${dayOf(dispute.appointment.date)}. What was seen can be recorded from that day.`);
      if (typeof input.claimantCame !== 'boolean' || typeof input.holderCame !== 'boolean') throw new GlosError('FIELD_REQUIRED', 'Say who came', { field: 'claimantCame' });
      const came = { claimant: input.claimantCame, holder: input.holderCame };
      if (input.to !== dispute.decided.to && !came[input.to]) throw new GlosError('INVALID_STATE', 'The decision can change only for somebody who came with their card.');
      dispute.proposal = { ...base, came };
      dispute.state = 'rechecked';
    } else {
      throw new GlosError('INVALID_STATE', dispute.state === 'checked' || dispute.state === 'rechecked' ? 'A proposal is already waiting for a second member of staff.' : 'This dispute is not waiting to be decided.');
    }
    delete dispute.sentBack;
    this.disputes.set(dispute.disputeId, dispute);
    return this.row(dispute, staff, true);
  }

  /** The second member of staff does not approve it as it stands. It goes back to be looked at again. */
  sendBack(disputeId: string, staff: DisputeStaff, why: string, now: number = Date.now()): DisputeRow {
    const dispute = this.require(disputeId, now);
    if (dispute.state !== 'checked' && dispute.state !== 'rechecked') throw new GlosError('INVALID_STATE', 'There is no proposal here to send back.');
    const said = why?.trim();
    if (!said) throw new GlosError('FIELD_REQUIRED', 'Say why — the next member of staff to look at it reads this', { field: 'why' });
    dispute.sentBack = { by: staff.name, at: iso(now), why: said.slice(0, 300) };
    delete dispute.proposal;
    dispute.state = dispute.state === 'checked' ? 'ready' : 'appointment';
    this.disputes.set(dispute.disputeId, dispute);
    return this.row(dispute, staff, true);
  }

  /**
   * THE SECOND MEMBER OF STAFF APPROVES, AND IT IS DONE. Never the one who proposed it.
   *
   * From the photographs: the ID is given, and whoever did not get it has two weeks to make an appointment. After
   * an appointment: it is given again if the decision changed, and that is final.
   */
  approve(disputeId: string, staff: DisputeStaff, now: number = Date.now()): DisputeRow {
    const dispute = this.require(disputeId, now);
    const proposal = dispute.proposal;
    if ((dispute.state !== 'checked' && dispute.state !== 'rechecked') || !proposal) {
      throw new GlosError('INVALID_STATE', dispute.state === 'ready' || dispute.state === 'appointment' ? 'Nobody has said whose it is yet. One member of staff does; a second approves.' : 'This dispute is not waiting for an approval.');
    }
    if (proposal.byKey === staff.key) throw new GlosError('CONFLICT', 'A second member of staff has to approve — not the one who proposed it');
    const word = WORD[dispute.register];

    if (dispute.state === 'checked') {
      const holderEffect = this.give(dispute, proposal.to, now);
      dispute.decided = { to: proposal.to, by: staff.name, at: iso(now), reason: proposal.reason, holderEffect };
      dispute.contestBy = iso(now + DISPUTE_CONTEST_DAYS * DAY_MS);
      dispute.state = 'decided';
      delete dispute.proposal;
      this.anchorPhotos(dispute, now);
      this.disputes.set(dispute.disputeId, dispute);
      const contest = `If you do not accept this, you can make an appointment to come in with your card, until ${dayOf(dispute.contestBy)}: open the app with your reference.`;
      if (proposal.to === 'claimant') {
        this.tell(dispute.claimant.personDid, { headline: 'The national ID is yours', what: 'Two members of SeeBuyGet staff looked at the photographs and decided the national ID you disputed is yours.', next: 'Register again with the same phone number and your ID number: it will go through now.' });
        this.tell(dispute.holder.personDid, {
          headline: 'The national ID on your registration went to somebody else',
          what: `Two members of SeeBuyGet staff looked at the photographs and decided the national ID on your ${word} registration is the other person’s. Their reason: ${proposal.reason}`,
          next:
            (holderEffect === 'corrected'
              ? `The number staff read on your own card is on your registration now, and nothing else has changed. `
              : `Your ${word} registration is held: you finish what you have in hand and start nothing new until the number of your own ID card is on record — put it there in Settings. `) + contest,
        });
      } else {
        this.tell(dispute.holder.personDid, { headline: 'The national ID stays yours', what: 'Two members of SeeBuyGet staff looked at the photographs and decided the national ID on your registration is yours.', next: 'There is nothing for you to do.' });
        this.tell(dispute.claimant.personDid, { headline: 'The national ID stays with the person who holds it', what: `Two members of SeeBuyGet staff looked at the photographs and decided the national ID you disputed is not yours to register with. Their reason: ${proposal.reason}`, next: contest });
      }
      return this.row(dispute, staff, true);
    }

    const before = dispute.decided!.to;
    if (proposal.to !== before) dispute.decided = { ...dispute.decided!, holderEffect: this.give(dispute, proposal.to, now) };
    dispute.final = { to: proposal.to, by: staff.name, at: iso(now), reason: proposal.reason, ...(proposal.came ? { came: proposal.came } : {}) };
    dispute.state = 'final';
    delete dispute.proposal;
    this.end(dispute, now);
    for (const s of ['claimant', 'holder'] as const) {
      const yours = proposal.to === s;
      this.tell(dispute[s].personDid, {
        headline: yours ? 'Decided in person: the national ID is yours' : 'Decided in person: the national ID is the other person’s',
        what: `Two members of SeeBuyGet staff decided again after the appointment${proposal.to === before ? ', and the decision stands' : ', and the decision has changed'}. ${yours ? '' : `Their reason: ${proposal.reason}`}`.trim(),
        next: yours ? 'If your registration was held, it is not any more. If you have not registered yet, do so with the same phone number and your ID number.' : this.heldOf(dispute, s) ? `Your ${word} registration is held until the number of your own ID card is on record — put it there in Settings. This decision is final.` : 'This decision is final.',
      });
    }
    return this.row(dispute, staff, true);
  }

  /* ------------------------------------------------------------------------ internals -- */

  /**
   * THE ID GOES TO ONE OF THEM. Whoever's registration holds it and should not, loses it — and is HELD unless a
   * number of their own was read off their card and is free, in which case their record takes that instead and
   * nothing else changes for them. Whoever it goes to has it on their registration, or kept for them until they
   * register with the phone they opened this with.
   */
  private give(d: StoredDispute, to: DisputeSide, now: number): HolderEffect {
    const reg = this.reg(d.register);
    const at = iso(now);
    const current = reg.nationalIdHolderOfKey(d.idKey);
    const claimantDid = this.claimantRecord(d);
    if (to === 'holder') {
      // They registered with it since the first decision: it goes back, and that registration is the one held now.
      if (claimantDid && current === claimantDid) {
        reg.loseNationalId(claimantDid, d.idKey);
        reg.holdForId(claimantDid, { reference: d.claimant.reference, at });
        this.tellFleetOfHold(d.register, claimantDid);
      }
      reg.giveNationalId(d.holder.did, d.idKey);
      return 'none';
    }
    let effect: HolderEffect = 'none';
    if (current === d.holder.did) {
      const own = this.reveal(d.holder.ownVaultRef, 'governmentId');
      reg.loseNationalId(d.holder.did, d.idKey);
      let corrected = false;
      if (own) {
        try {
          reg.takeNationalId(d.holder.did, own);
          corrected = true;
        } catch (err) {
          this.logger.warn(`a holder's own number could not be put on record: ${(err as Error).message}`);
        }
      }
      if (corrected) effect = 'corrected';
      else {
        reg.holdForId(d.holder.did, { reference: d.holder.reference, at });
        this.tellFleetOfHold(d.register, d.holder.did);
        effect = 'held';
      }
    }
    if (claimantDid) reg.giveNationalId(claimantDid, d.idKey);
    else this.giveToClaimant(d);
    return effect;
  }

  /** Kept for the claimant until they register with the phone they opened this with. */
  private giveToClaimant(d: StoredDispute): void {
    const phone = this.reveal(d.claimant.phoneVaultRef, 'phone');
    if (!phone) throw new GlosError('INVALID_STATE', 'The claimant’s phone number is no longer on this dispute');
    this.reg(d.register).keepNationalIdFor(d.idKey, phone, `${KEPT}${d.disputeId}`);
  }

  /** The claimant's own registration in this register, once they have one. */
  private claimantRecord(d: StoredDispute): string | undefined {
    // Their account where one is named; until then, the account on the phone they opened this with.
    const person = accountFor(claimantOf(d), this.persons);
    const role = d.register === 'driver' ? 'driver' : 'agent';
    return person?.roles.find((r) => r.role === role && r.status === 'active' && r.entityDid !== d.holder.did)?.entityDid;
  }

  /** This side's registration is held over THIS dispute. */
  private heldOf(d: StoredDispute, side: DisputeSide): boolean {
    const did = side === 'holder' ? d.holder.did : this.claimantRecord(d);
    return Boolean(did) && this.reg(d.register).idHoldOf(did as string)?.reference === d[side].reference;
  }

  private maySend(d: StoredDispute, side: DisputeSide): boolean {
    if (side === 'claimant') return d.state === 'opened';
    return (d.state === 'answering' || d.state === 'ready' || (d.state === 'opened' && Boolean(d.answerBy))) && !d.holder.sentAt;
  }

  private assertMaySend(d: StoredDispute, side: DisputeSide): void {
    if (this.maySend(d, side)) return;
    throw new GlosError('INVALID_STATE', d[side].sentAt ? 'Your photographs have been sent already. Staff will ask if they need them again.' : 'Photographs are not being taken for this any more.');
  }

  /** They did not get it, and the time to make an appointment has not passed. */
  private mayContest(d: StoredDispute, side: DisputeSide, now: number): boolean {
    return d.state === 'decided' && Boolean(d.decided) && d.decided!.to !== side && Boolean(d.contestBy) && now < Date.parse(d.contestBy as string);
  }

  private waitsOnStaff(d: StoredDispute, now: number): boolean {
    if (d.state === 'ready' || d.state === 'checked' || d.state === 'rechecked') return true;
    return d.state === 'appointment' && Boolean(d.appointment) && d.appointment!.date <= iso(now).slice(0, 10);
  }

  private statusOf(d: StoredDispute, side: DisputeSide, now: number): DisputeStatus {
    const party = d[side];
    const to = d.final?.to ?? d.decided?.to;
    const lost = Boolean(to) && to !== side;
    const reason = d.final?.reason ?? d.decided?.reason;
    const support = this.placeFor(d.country);
    const ticket = this.ticketFor(d, side, support);
    const choices = this.choicesFor(d, side, now);
    const due = side === 'claimant' ? d.photosBy : d.answerBy;
    return {
      reference: party.reference,
      side,
      register: d.register,
      state: d.state,
      openedAt: d.openedAt,
      photos: DISPUTE_PHOTOS.filter((p) => Boolean(party.photos[p])),
      sent: Boolean(party.sentAt),
      ...(this.maySend(d, side) && due ? { photosDueBy: due } : {}),
      ...(party.retake ? { retakeWhy: party.retake.reason } : {}),
      ...(to ? { yours: to === side } : d.state === 'conceded' ? { yours: side === 'claimant' } : {}),
      ...(lost && reason ? { reason } : {}),
      ...(this.heldOf(d, side) ? { held: true } : {}),
      ...(this.mayContest(d, side, now) ? { contestBy: d.contestBy } : {}),
      ...(ticket ? { ticket } : {}),
      ...(choices ? { choices } : {}),
      ...(support ? { support } : {}),
    };
  }

  private ticketFor(d: StoredDispute, side: DisputeSide, place: DisputePlace | undefined): DisputeTicket | undefined {
    if (!d.appointment || (d.state !== 'appointment' && d.state !== 'rechecked')) return undefined;
    const yours = d.appointment.by === side;
    return {
      reference: d[side].reference,
      date: d.appointment.date,
      ...(d.appointment.at ? { at: d.appointment.at, until: slotEnd(place, d.appointment.date, d.appointment.at) } : {}),
      yours,
      bring: [...BRING],
      changesLeft: yours ? Math.max(0, APPOINTMENT_CHANGES - d.appointment.changes) : 0,
      // Only somebody with an account can be reminded: the one refused at registration may have none.
      willRemind: Boolean(d[side].personDid && this.persons.findByDid(d[side].personDid as string)),
      ...(d.appointment.reminded?.sent && d[side].personDid ? { remindedAt: d.appointment.reminded.at } : {}),
      ...(offDay(place, d.appointment.date, d.appointment.at) ? { offDay: true } : {}),
      ...(place ? { place } : {}),
    };
  }

  private opened(d: StoredDispute): DisputeOpened {
    const support = this.placeFor(d.country);
    return { reference: d.claimant.reference, photosBy: d.photosBy, ...(support ? { support } : {}) };
  }

  private row(d: StoredDispute, staff: DisputeStaff | undefined, full: boolean): DisputeRow {
    const p = d.proposal;
    const place = full ? this.placeFor(d.country) : undefined;
    return {
      disputeId: d.disputeId,
      reference: d.claimant.reference,
      holderReference: d.holder.reference,
      register: d.register,
      state: d.state,
      openedAt: d.openedAt,
      ...(d.state === 'opened' ? { photosBy: d.photosBy } : {}),
      ...(d.state === 'answering' && d.answerBy ? { answerBy: d.answerBy } : {}),
      claimant: this.party(d, 'claimant', full),
      holder: this.party(d, 'holder', full),
      ...(p ? { proposedTo: p.to, proposedBy: p.by, proposedAt: p.at, proposedWhat: p.what, proposedReason: p.reason } : {}),
      ...(p && staff && p.byKey === staff.key ? { proposedByYou: true } : {}),
      ...(d.sentBack ? { sentBackWhy: `${d.sentBack.by}: ${d.sentBack.why}` } : {}),
      ...(d.decided ? { decidedTo: d.decided.to, decidedBy: d.decided.by, decidedAt: d.decided.at, reason: d.final?.reason ?? d.decided.reason, holderEffect: d.decided.holderEffect } : {}),
      ...(d.state === 'decided' && d.contestBy ? { contestBy: d.contestBy } : {}),
      ...(d.appointment ? { appointmentDate: d.appointment.date, appointmentBy: d.appointment.by, ...(d.appointment.at ? { appointmentAt: d.appointment.at } : {}), ...(d.appointment.reminded?.sent ? { appointmentRemindedAt: d.appointment.reminded.at } : {}) } : {}),
      ...(d.appointment && d.state === 'appointment' && offDay(this.placeFor(d.country), d.appointment.date, d.appointment.at) ? { appointmentOffDay: true } : {}),
      ...(place ? { place } : {}),
      ...(d.final ? { finalTo: d.final.to, finalBy: d.final.by, finalAt: d.final.at } : {}),
      ...(d.endedAt ? { endedAt: d.endedAt } : {}),
    };
  }

  private party(d: StoredDispute, side: DisputeSide, full: boolean): DisputeParty {
    const party = d[side];
    const did = side === 'holder' ? d.holder.did : this.claimantRecord(d);
    const person = party.personDid ? this.persons.findByDid(party.personDid) : undefined;
    const came = (d.final?.came ?? d.proposal?.came)?.[side];
    return {
      ...(party.sentAt ? { sentAt: party.sentAt } : {}),
      ...(full ? party.photos : {}),
      ...(party.card ? { card: party.card } : {}),
      ...(did ? this.who(d.register, did) : {}),
      ...(person ? { since: person.createdAt } : {}),
      ...(side === 'claimant' ? { phoneEnds: d.claimant.phoneEnds } : {}),
      ...(full && side === 'holder' ? { onRecord: this.onRecord(d.register, d.holder.did) } : {}),
      ...(party.retake ? { retakeWhy: party.retake.reason } : {}),
      ...(typeof came === 'boolean' ? { came } : {}),
    };
  }

  /** Who a registration is, in a line: a driver and their fleet, or a shop. */
  private who(register: IdRegister, did: string): { who?: string } {
    try {
      if (register === 'shop') return { who: `Shop: ${this.agents.get(did).shopName}` };
      const driver = this.drivers.get(did);
      let fleet: string | undefined;
      try {
        fleet = driver.managerDid ? this.managers.get(driver.managerDid).companyName : undefined;
      } catch {
        fleet = undefined;
      }
      return { who: `Driver: ${driver.displayName}${fleet ? `, with ${fleet}` : ''}` };
    } catch {
      return {};
    }
  }

  /** What the holder sent when they registered, where they sent anything — the one thing on record to look at. */
  private onRecord(register: IdRegister, did: string): string[] {
    try {
      if (register === 'shop') return [this.agents.get(did).kyc?.idCopyRef].filter((x): x is string => Boolean(x));
      const driver = this.drivers.get(did);
      return [driver.kyc?.idCopyRef, driver.portrait?.photoRef].filter((x): x is string => Boolean(x));
    } catch {
      return [];
    }
  }

  /** A fleet's office is told when one of its drivers is held: it is the fleet that plans them onto a run. */
  private tellFleetOfHold(register: IdRegister, did: string): void {
    if (register !== 'driver') return;
    try {
      const driver = this.drivers.get(did);
      if (!driver.managerDid) return;
      void this.notifications
        ?.notify(driver.managerDid, {
          kind: 'security',
          title: `${driver.displayName} cannot start a shift for now`,
          body: 'The national ID on their registration went to somebody else, after a check by two members of SeeBuyGet staff. They finish what they carry and start nothing new until the number of their own ID card is on record — they put it there themselves, in Settings in their app.',
          link: '/',
          tag: `driver:${did}:id-hold`,
        })
        .catch(() => undefined);
    } catch {
      /* a driver that is gone has no fleet to tell */
    }
  }

  private tell(personDid: string | undefined, s: { headline: string; what: string; next: string }): void {
    const person = personDid ? this.persons.findByDid(personDid) : undefined;
    if (person) this.recovery.tellHolder(person, s);
  }

  /** The photographs' clock: thirty days from this moment. Started at a decision, and again for an appointment. */
  private anchorPhotos(d: StoredDispute, at: number): void {
    for (const side of ['claimant', 'holder'] as const) for (const p of DISPUTE_PHOTOS) this.media?.anchorIdentityCheck(d[side].photos[p], new Date(at));
  }

  /** It is over: nothing more can happen to it, so what it kept in the vault is blanked and the photographs' clock runs. */
  private end(d: StoredDispute, now: number): void {
    d.endedAt = iso(now);
    this.blank(d.claimant.phoneVaultRef);
    this.blank(d.holder.ownVaultRef);
    delete d.holder.ownVaultRef;
    delete d.proposal;
    if (d.state !== 'decided') this.anchorPhotos(d, now);
    this.disputes.set(d.disputeId, d);
  }

  private blank(vaultRef: string | undefined): void {
    if (!vaultRef) return;
    try {
      this.vault.update(vaultRef, { fullName: '' });
    } catch {
      /* a vault that will not blank it holds something nothing reads again */
    }
  }

  private reveal(vaultRef: string | undefined, field: 'phone' | 'governmentId'): string | undefined {
    if (!vaultRef) return undefined;
    try {
      const held = this.vault.reveal(vaultRef, { purpose: 'id-dispute', requesterDid: 'staff:id-dispute' })[field];
      return typeof held === 'string' && held ? held : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Every dispute, with what time alone decides settled first: photographs never sent, a holder's week that ran
   * out, a decision nobody contested in time. So nothing is read as waiting on somebody when it no longer is.
   */
  private all(now: number): StoredDispute[] {
    const all = [...this.disputes.values()];
    for (const d of all) {
      if (d.state === 'opened' && now >= Date.parse(d.photosBy)) {
        d.state = 'lapsed';
        this.end(d, now);
        // A holder who had been told is told it is over: otherwise it sits on their account as a question.
        if (d.answerBy) {
          this.tell(d.holder.personDid, {
            headline: 'The dispute over your national ID has ended',
            what: 'The person who said the national ID on your registration was theirs did not send what staff asked for in time. Nothing about your registration has changed.',
            next: 'There is nothing for you to do.',
          });
        }
      } else if (d.state === 'answering' && d.answerBy && now >= Date.parse(d.answerBy)) {
        d.state = 'ready';
        this.disputes.set(d.disputeId, d);
      } else if (d.state === 'decided' && !d.endedAt && d.contestBy && now >= Date.parse(d.contestBy)) {
        this.end(d, now);
      }
    }
    return all;
  }

  private require(disputeId: string, now: number): StoredDispute {
    const dispute = this.all(now).find((d) => d.disputeId === disputeId);
    if (!dispute) throw new GlosError('NOT_FOUND', 'No such dispute');
    return dispute;
  }

  private byReference(reference: string, now: number): { dispute: StoredDispute; side: DisputeSide } {
    const wanted = normalizeIdReference(reference);
    for (const dispute of this.all(now)) {
      if (normalizeIdReference(dispute.claimant.reference) === wanted) return { dispute, side: 'claimant' };
      if (normalizeIdReference(dispute.holder.reference) === wanted) return { dispute, side: 'holder' };
    }
    throw new GlosError('NOT_FOUND', 'No dispute has that reference. Check it against what you wrote down.');
  }

  private reg(register: IdRegister): IdRegisterPort {
    return register === 'driver' ? this.drivers : this.agents;
  }

  /** The company that answers for a country, as it wrote its own entry — where an appointment is kept. */
  private placeFor(country: string | undefined): DisputePlace | undefined {
    const sister = country ? this.entities?.forJurisdiction(country) : undefined;
    const card = sister ? this.contacts?.of(sister.entityId) : undefined;
    if (!sister || !card || (!card.phone && !card.email && !card.address && !card.visitDays?.length)) return undefined;
    return {
      company: sister.name,
      ...(card.contactName ? { contactName: card.contactName } : {}),
      ...(card.phone ? { phone: card.phone } : {}),
      ...(card.phoneAlt ? { phoneAlt: card.phoneAlt } : {}),
      ...(card.email ? { email: card.email } : {}),
      ...(card.address ? { address: card.address } : {}),
      ...(card.hours ? { hours: card.hours } : {}),
      ...(card.visitDays?.length ? { visitDays: [...card.visitDays] } : {}),
      ...(card.visitFrom ? { visitFrom: card.visitFrom } : {}),
      ...(card.visitTo ? { visitTo: card.visitTo } : {}),
      ...(card.visitHoursByDay && Object.keys(card.visitHoursByDay).length ? { visitHoursByDay: { ...card.visitHoursByDay } } : {}),
      ...(card.visitorsPerHour ? { visitorsPerHour: card.visitorsPerHour } : {}),
      ...(card.closedDates?.length ? { closedDates: card.closedDates.map((c) => ({ ...c })) } : {}),
    };
  }

  private newReference(): string {
    for (;;) {
      const pick = () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
      const reference = `ID-${pick()}-${pick()}`;
      if (![...this.disputes.values()].some((d) => d.claimant.reference === reference || d.holder.reference === reference)) return reference;
    }
  }
}

const DAY_NAME: Record<Weekday, string> = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
/** "Monday, Tuesday and Friday" — the days as somebody would say them. */
/** The phone a dispute was opened from, and the account that answers for it once one is named. See addressed-to.ts. */
function claimantOf(d: StoredDispute): Addressed {
  return { hash: d.claimant.phoneHash, owner: d.claimant.personDid };
}

function daysInWords(days: Weekday[]): string {
  const names = WEEKDAYS.filter((d) => days.includes(d)).map((d) => DAY_NAME[d]);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : (names[0] ?? '');
}
/** Has this company said which days it receives visitors — and is this date not one of them? A date it gave hours of
 *  its own is one it opens on, whatever day of the week it falls. */
function notVisitingDay(place: DisputePlace | undefined, date: string): boolean {
  const days = place?.visitDays;
  const day = weekdayOf(date);
  if (place?.closedDates?.some((c) => c.date === date && c.from && c.to)) return false;
  return Boolean(days?.length) && Boolean(day) && !days!.includes(day as string);
}
/** Is it closed on this date — a public holiday, a one-off closure — as it said itself? A date with hours is open,
 *  only shorter. */
function closedOn(place: DisputePlace | undefined, date: string): { date: string; note?: string } | undefined {
  return place?.closedDates?.find((c) => c.date === date && !(c.from && c.to));
}
/**
 * AN APPOINTMENT THAT NO LONGER FITS what the company says now: not one of its days, a date it has since closed,
 * or — once it counts visitors by the hour — no hour chosen, or an hour it no longer keeps.
 */
function offDay(place: DisputePlace | undefined, date: string, at?: string): boolean {
  if (notVisitingDay(place, date) || Boolean(closedOn(place, date))) return true;
  if (!place?.visitorsPerHour) return false;
  return !at || !visitingHours(place, date).includes(at);
}

/** What to bring, as the reminder says it — the same four things the ticket lists, in the same order. */
function bringWords(register: IdRegister, reference: string): string[] {
  return [
    'Your ID card itself — not a copy or a photograph',
    'The phone you use with SeeBuyGet',
    `Your reference: ${reference}`,
    `A second document in your name, if you have one: your ${register === 'driver' ? 'driving licence' : 'trading licence'}`,
  ];
}

const PHOTO_WORD: Record<DisputePhoto, string> = { face: 'you holding the card', front: 'the front of the card', back: 'the back of the card' };

/** As somebody types what they wrote down: any case, with or without the dashes and the letters in front. */
export function normalizeIdReference(reference: string): string {
  return (reference ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^ID/, '');
}

const iso = (ms: number): string => new Date(ms).toISOString();

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** A day as it is said in a notice: "15 Oct 2026". */
function dayOf(at: string): string {
  const d = new Date(at.length === 10 ? `${at}T00:00:00.000Z` : at);
  return Number.isNaN(d.getTime()) ? at : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
