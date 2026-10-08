import { Injectable, Optional } from '@nestjs/common';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { GlosError } from '../../foundation/http/glos-error';
import { CompanyReadinessService } from '../../foundation/entity/company-readiness.service';
import { EntityService } from '../../foundation/entity/entity.service';

/**
 * HOW TO REACH A COMPANY — their own entry, written by them, changed by them.
 *
 * The gap this closes was one I made: the yard finder told a haulier that the next step was a telephone
 * call and then printed no telephone number. The clearing-agent directory has exactly the same hole. So
 * this is ONE card per company rather than a field set copied into each directory, because two copies of
 * a telephone number drift and the one on the screen drifts silently.
 *
 * IT IS THEIRS, AND IT IS A CLAIM. We do not ring the number, send to the address or fetch the site: what
 * is checked is the SHAPE, never the choice — the same discipline as a UN number, an ISO container code
 * and an agent's advertisement. A reader is told, in words, that nobody verified any of it.
 *
 * AND IT IS PUBLISHED. The card rides on the public profile page and in the directories, which is the
 * whole point of writing one — so the screens say plainly that it is the gate's number and not somebody's
 * private one, and nothing here ever reads a person's identity out of the vault to fill it in.
 */
/** The days of a week, as a company ticks them. */
export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The weekday a calendar date falls on. A date is the same date wherever it is read, so no time zone enters into it. */
export function weekdayOf(date: string): Weekday | undefined {
  const at = Date.parse(`${date}T00:00:00.000Z`);
  return Number.isNaN(at) ? undefined : WEEKDAYS[(new Date(at).getUTCDay() + 6) % 7];
}

/** A day the company is closed: a public holiday, a one-off closure — and what the day is, in its own words. */
export interface ClosedDate {
  date: string;
  note?: string;
}
export const MAX_CLOSED_DATES = 120;
export const MAX_VISITORS_PER_HOUR = 200;

const minutesOf = (clock: string | undefined): number | undefined => (clock && CLOCK.test(clock) ? Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3)) : undefined);
const clockOf = (minutes: number): string => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/**
 * THE HOURS A COMPANY RECEIVES VISITORS IN, as the time each starts: from when it opens to visitors, an hour each,
 * for as long as a whole hour still fits before it closes to them. "09:00 to 16:00" is seven: 09:00 … 15:00.
 */
export function visitingHours(card: { visitFrom?: string; visitTo?: string } | undefined): string[] {
  const from = minutesOf(card?.visitFrom);
  const to = minutesOf(card?.visitTo);
  if (from === undefined || to === undefined) return [];
  const out: string[] = [];
  for (let m = from; m + 60 <= to; m += 60) out.push(clockOf(m));
  return out;
}

/** An hour later — when the hour that starts at `at` ends. */
export function hourAfter(at: string): string {
  return clockOf(((minutesOf(at) ?? 0) + 60) % (24 * 60));
}

export interface ContactCard {
  entityId: string;
  /** Who to ask for — "ask for Grace at the gate". A role or a name, whichever they prefer. */
  contactName?: string;
  phone?: string;
  /** A second number, because in most of these markets the gate and the office are different telephones. */
  phoneAlt?: string;
  email?: string;
  website?: string;
  /** Where the gate is, in the words a driver needs. Not the registered address, which is a legal fact. */
  address?: string;
  /** When somebody is there. The second question a haulier asks, after "where". */
  hours?: string;
  /**
   * WHEN VISITORS ARE RECEIVED — which days, and from when until when. The user, 2026-10-08: "it's up to the
   * countries to set visiting days and visiting hours." Not the gate's hours above, which are for a haulier: these
   * are for somebody who has to come in person, and an appointment is offered on these days and no other.
   */
  visitDays?: Weekday[];
  /** `HH:MM`, on the clock of wherever the company is. */
  visitFrom?: string;
  visitTo?: string;
  /**
   * THE DATES IT IS CLOSED — public holidays, one-off closures. The user, 2026-10-08: "the country should set it's
   * own public holidays and/or one off closure." No appointment is offered or taken on one.
   */
  closedDates?: ClosedDate[];
  /**
   * HOW MANY VISITORS IT SEES IN AN HOUR — its own number: "They themselves can decide how many desk workers they
   * will dedicate for these visitation hours." With it, an appointment is for an hour and an hour fills up.
   */
  visitorsPerHour?: number;
  saidAt: string;
  saidBy: string;
}

export const CONTACT_BASIS =
  'Written by the company itself and never verified by us — we do not ring the number, write to the address or open the site. The shape is checked; the choice is theirs.';

/** Digits, spaces, brackets and dashes, with an optional +. We check the shape and never dial it. */
const PHONE = /^\+?[\d\s()\-.]{6,24}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

@Injectable()
export class ContactCardService {
  private readonly cards = new PersistentMap<string, ContactCard>('contact-cards');

  constructor(
    private readonly entities: EntityService,
    @Optional() readiness?: CompanyReadinessService,
  ) {
    /*
     * PART OF THE TURN-ON PROCESS. A company of ours is not switched on until it has said, in this entry of its
     * own, where people are sent and when it receives them: from that day somebody in its country can be handed a
     * ticket to come in, and a ticket with no address on it is a promise the company has not made yet.
     */
    readiness?.also((entity) => {
      if (entity.kind !== 'sister') return [];
      const card = this.cards.get(entity.entityId);
      return [
        { key: 'visitors_address', met: Boolean(card?.address), label: 'Where people are sent when they have to come in person: its address, written by the company in its own Settings' },
        { key: 'visiting_days', met: Boolean(card?.visitDays?.length && card.visitFrom && card.visitTo), label: 'The days and hours it receives visitors, set by the company in its own Settings' },
      ];
    });
  }

  /**
   * Write or change the card. A MERGE, deliberately: a company correcting its telephone number should not
   * have to resend its website to keep it, and a form that silently drops what it did not carry is how an
   * entry quietly loses half of itself.
   *
   * An EMPTY STRING clears a field, which is the one thing a merge cannot express otherwise.
   */
  set(
    entityId: string,
    patch: { contactName?: string; phone?: string; phoneAlt?: string; email?: string; website?: string; address?: string; hours?: string; visitDays?: string[]; visitFrom?: string; visitTo?: string; closedDates?: ClosedDate[]; visitorsPerHour?: number | null },
    by: string,
    now = Date.now(),
  ): ContactCard {
    const company = this.entities.get(entityId);
    const current = this.cards.get(company.entityId);
    const card: ContactCard = {
      entityId: company.entityId,
      ...(current ?? {}),
      saidAt: new Date(now).toISOString(),
      saidBy: by,
    };

    const put = (key: 'contactName' | 'phone' | 'phoneAlt' | 'email' | 'website' | 'address' | 'hours', raw: string | undefined, max: number, check?: (v: string) => boolean, why?: string) => {
      if (raw === undefined) return; // absent means UNCHANGED, which is what makes this a merge
      const value = raw.trim();
      if (!value) {
        delete card[key];
        return;
      }
      if (check && !check(value)) throw new GlosError('VALIDATION_FAILED', why!);
      card[key] = value.slice(0, max);
    };

    put('contactName', patch.contactName, 80);
    put('phone', patch.phone, 24, (v) => PHONE.test(v), 'A telephone number is digits, with an optional + in front — we check the shape and never dial it');
    put('phoneAlt', patch.phoneAlt, 24, (v) => PHONE.test(v), 'A telephone number is digits, with an optional + in front — we check the shape and never dial it');
    put('email', patch.email, 120, (v) => EMAIL.test(v), 'That is not the shape of an email address');
    put(
      'website',
      patch.website,
      160,
      // http or https only. Anything else on a page a stranger will click is a link we should not print,
      // and we never fetch it to find out what it is.
      (v) => /^https?:\/\/[^\s]+\.[^\s]{2,}$/i.test(v),
      'A website starts with http:// or https:// — and we never open it to check',
    );
    put('address', patch.address, 300);
    put('hours', patch.hours, 120);

    // Visiting days: absent is unchanged, an empty list clears them — the same merge, for a list.
    if (patch.visitDays !== undefined) {
      if (patch.visitDays.some((d) => !(WEEKDAYS as readonly string[]).includes(d))) throw new GlosError('VALIDATION_FAILED', 'A visiting day is a day of the week');
      const days = WEEKDAYS.filter((d) => patch.visitDays!.includes(d));
      if (days.length) card.visitDays = days;
      else delete card.visitDays;
    }
    const clock = (key: 'visitFrom' | 'visitTo', raw: string | undefined) => {
      if (raw === undefined) return;
      const value = raw.trim();
      if (!value) {
        delete card[key];
        return;
      }
      if (!CLOCK.test(value)) throw new GlosError('VALIDATION_FAILED', 'Visiting hours are a time of day, such as 09:00');
      card[key] = value;
    };
    clock('visitFrom', patch.visitFrom);
    clock('visitTo', patch.visitTo);
    if (card.visitFrom && card.visitTo && card.visitFrom >= card.visitTo) throw new GlosError('VALIDATION_FAILED', 'Visiting hours end after they begin');

    // Closed dates: absent is unchanged; a list REPLACES the list (an empty one clears it). Sorted, one of each,
    // and what is already behind us is let go — a closure last spring is nobody's appointment.
    if (patch.closedDates !== undefined) {
      if (!Array.isArray(patch.closedDates)) throw new GlosError('VALIDATION_FAILED', 'Closed dates are a list of dates');
      const since = new Date(now - 86_400_000).toISOString().slice(0, 10);
      const byDate = new Map<string, ClosedDate>();
      for (const raw of patch.closedDates) {
        const date = String(raw?.date ?? '').trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !weekdayOf(date) || new Date(`${date}T00:00:00.000Z`).toISOString().slice(0, 10) !== date) {
          throw new GlosError('VALIDATION_FAILED', 'A closed date is a date, such as 2026-12-25');
        }
        const note = String(raw?.note ?? '').trim().slice(0, 60);
        if (date >= since) byDate.set(date, { date, ...(note ? { note } : {}) });
      }
      if (byDate.size > MAX_CLOSED_DATES) throw new GlosError('VALIDATION_FAILED', `That is more closed dates than can be kept (${MAX_CLOSED_DATES})`);
      const dates = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
      if (dates.length) card.closedDates = dates;
      else delete card.closedDates;
    }

    // Visitors an hour: absent is unchanged; nothing, or zero, clears it — and then no hour ever fills.
    if (patch.visitorsPerHour !== undefined) {
      const n = patch.visitorsPerHour;
      if (n === null || n === 0) delete card.visitorsPerHour;
      else if (!Number.isInteger(n) || n < 0 || n > MAX_VISITORS_PER_HOUR) throw new GlosError('VALIDATION_FAILED', `Visitors an hour is a whole number, up to ${MAX_VISITORS_PER_HOUR}`);
      else card.visitorsPerHour = n;
    }
    // A number of visitors AN HOUR needs hours to count in: at least one whole one.
    if (card.visitorsPerHour && !visitingHours(card).length) {
      throw new GlosError('VALIDATION_FAILED', 'Say from when until when you receive visitors — at least an hour — before saying how many an hour');
    }

    this.cards.set(company.entityId, card);
    return card;
  }

  of(entityId: string): ContactCard | undefined {
    return this.cards.get(entityId);
  }

  /** Nothing to reach them by is a fact worth knowing, so an empty card is not the same as a full one. */
  reachable(entityId: string): boolean {
    const card = this.cards.get(entityId);
    return Boolean(card?.phone || card?.phoneAlt || card?.email || card?.website || card?.address);
  }
}
