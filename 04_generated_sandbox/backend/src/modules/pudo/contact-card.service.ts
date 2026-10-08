import { Injectable } from '@nestjs/common';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { GlosError } from '../../foundation/http/glos-error';
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

  constructor(private readonly entities: EntityService) {}

  /**
   * Write or change the card. A MERGE, deliberately: a company correcting its telephone number should not
   * have to resend its website to keep it, and a form that silently drops what it did not carry is how an
   * entry quietly loses half of itself.
   *
   * An EMPTY STRING clears a field, which is the one thing a merge cannot express otherwise.
   */
  set(
    entityId: string,
    patch: { contactName?: string; phone?: string; phoneAlt?: string; email?: string; website?: string; address?: string; hours?: string; visitDays?: string[]; visitFrom?: string; visitTo?: string },
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
