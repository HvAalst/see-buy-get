import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { GlosError } from '../http/glos-error';
import { PersistentMap } from '../store/persistent-map';
import { catalogueEntry } from '../countries/catalogue';

/**
 * WHO IS WAITING FOR A COUNTRY THE NETWORK HAS NOT REACHED.
 *
 * Every country is on the join form now, and most of them answer "we do not reach here yet". That is an
 * honest answer and a dead end, and the dead end is the part worth fixing: somebody in Chad who wants to
 * carry freight is EVIDENCE, and switching a country on is a decision that had none.
 *
 * So this is not a mailing list. It is the input to a decision that already exists — two members of staff
 * switch a country on (CA2) — and the thing it supplies is the one thing that decision was missing: how
 * many people are waiting there, what they would be, and why they say so. The motivation is the point;
 * a count alone would tell staff that ten people tapped a button.
 *
 * WHAT IT PROMISES, AND WHY THAT AND NOTHING MORE. "We will get back to you" is a promise a person has to
 * keep, and the first country with three interested people and no plan is where it breaks — leaving a
 * broken promise in place of an honest "not yet", which is worse. So the only thing said here is the one
 * the system can always keep: when the country is switched on, everybody waiting is told, and told WHICH
 * of the two it became. That is fired by the approval itself, not by anybody remembering.
 *
 * It holds an email and a sentence, from somebody with no account, in a country we do not operate in. So
 * it holds as little as it can: no name, no address, no identity document, and no phone unless a future
 * slice needs one. Withdrawing removes the note outright rather than flagging it.
 */

/** What somebody would be, if the network reached them. The four the front door can make, plus a catch-all. */
export const INTEREST_KINDS = ['carrier', 'shop', 'hub', 'store', 'other'] as const;
export type InterestKind = (typeof INTEREST_KINDS)[number];

export const MAX_INTEREST_MESSAGE = 600;
/** One address may ask about several countries, but not the same one twice. */
export const MAX_NOTES_PER_EMAIL = 10;

export interface InterestNote {
  noteId: string;
  /** ISO-3166 alpha-2, and it must be a country that exists. */
  country: string;
  kind: InterestKind;
  email: string;
  /** Why they are asking — the half a count cannot give. */
  message: string;
  at: string;
  /** When the country was switched on and this person was told, and what it became. */
  toldAt?: string;
  toldLevel?: string;
}

/** One country's waiting list, shaped for the decision rather than for reading messages one by one. */
export interface InterestByCountry {
  country: string;
  name: string;
  /** What the country speaks — the translation this would imply, which is otherwise worked out by hand. */
  languages: string[];
  currency: string;
  waiting: number;
  /** How many of each kind, so "who is waiting" is answerable without counting rows. */
  kinds: Record<string, number>;
  /** Newest first. The motivation is the evidence; it is not a preview. */
  notes: InterestNote[];
}

@Injectable()
export class InterestService {
  private readonly notes = new PersistentMap<string, InterestNote>('country-interest');

  /**
   * Record that somebody wants the network where they are.
   *
   * Refuses a country that does not exist (a typed code is a mistake, not a new country) and one that is
   * ALREADY open — there is nothing to wait for there, and the honest answer is "you can register now",
   * which the caller turns into a link rather than a thank-you for waiting.
   */
  add(input: { country: string; kind: string; email: string; message: string }, alreadyOpen: boolean): InterestNote {
    const country = String(input.country || '').trim().toUpperCase();
    const entry = catalogueEntry(country);
    if (!entry) throw new GlosError('INVALID_INPUT', `No such country: ${input.country}`);
    if (alreadyOpen) throw new GlosError('ALREADY_OPEN', `The network already reaches ${entry.name} — you can register there now`);

    const kind = String(input.kind || '').trim() as InterestKind;
    if (!INTEREST_KINDS.includes(kind)) throw new GlosError('INVALID_INPUT', 'Say what you would be: a carrier, a shop, a hub or a store');

    const email = String(input.email || '').trim().toLowerCase();
    if (!email.includes('@') || email.length < 5) throw new GlosError('EMAIL_INVALID', 'A valid email is required — it is the only way we can tell you when this changes');

    const message = String(input.message || '').trim();
    if (!message) throw new GlosError('FIELD_REQUIRED', 'Tell us what you would do here — it is what the decision is made on');
    if (message.length > MAX_INTEREST_MESSAGE) throw new GlosError('INVALID_INPUT', `Keep it under ${MAX_INTEREST_MESSAGE} characters`);

    const mine = this.list().filter((n) => n.email === email);
    // Asking twice about one country is not more interest, and it would double that country's count —
    // which is the number a decision gets made on. The second ask REPLACES the first rather than erroring:
    // somebody rewriting their reason is doing the useful thing, not the wrong one.
    const existing = mine.find((n) => n.country === country);
    if (!existing && mine.length >= MAX_NOTES_PER_EMAIL) {
      throw new GlosError('RATE_LIMITED', 'That is a lot of countries from one address. Write to us instead.');
    }

    const note: InterestNote = {
      noteId: existing?.noteId ?? `int_${randomBytes(6).toString('hex')}`,
      country,
      kind,
      email,
      message,
      at: new Date().toISOString(),
    };
    this.notes.set(note.noteId, note);
    return note;
  }

  list(): InterestNote[] {
    return [...this.notes.values()];
  }

  /** Everyone still waiting on this country — the ones a switch-on has not yet reached. */
  waitingFor(country: string): InterestNote[] {
    const code = country.trim().toUpperCase();
    return this.list().filter((n) => n.country === code && !n.toldAt);
  }

  /** Mark that a switch-on reached these people, so a later change does not tell them the same thing twice. */
  told(noteIds: string[], level: string): void {
    const at = new Date().toISOString();
    for (const id of noteIds) {
      const note = this.notes.get(id);
      if (note) this.notes.set(id, { ...note, toldAt: at, toldLevel: level });
    }
  }

  /**
   * The waiting list as a DECISION reads it: by country, biggest first.
   *
   * Grouped rather than listed because the question is "should we switch on the Netherlands", not "should
   * I reply to this person". A flat list of messages makes staff do the counting, and counting is the
   * part a computer should have done.
   */
  byCountry(): InterestByCountry[] {
    const groups = new Map<string, InterestNote[]>();
    for (const note of this.list()) {
      groups.set(note.country, [...(groups.get(note.country) ?? []), note]);
    }
    return [...groups.entries()]
      .map(([country, notes]) => {
        const entry = catalogueEntry(country);
        const kinds: Record<string, number> = {};
        for (const n of notes) kinds[n.kind] = (kinds[n.kind] ?? 0) + 1;
        return {
          country,
          name: entry?.name ?? country,
          languages: entry?.languages ?? [],
          currency: entry?.currency ?? '',
          waiting: notes.filter((n) => !n.toldAt).length,
          kinds,
          notes: [...notes].sort((a, b) => b.at.localeCompare(a.at)),
        };
      })
      .sort((a, b) => b.waiting - a.waiting || b.notes.length - a.notes.length || a.name.localeCompare(b.name));
  }

  /** Take a note back. Removed rather than flagged: somebody withdrawing has withdrawn. */
  withdraw(noteId: string): void {
    this.notes.delete(noteId);
  }
}
