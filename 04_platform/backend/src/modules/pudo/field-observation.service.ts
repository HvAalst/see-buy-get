import { Injectable, Optional } from '@nestjs/common';
import { GlosError } from '../../foundation/http/glos-error';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { randomBytes } from 'node:crypto';
import { PresenceService } from '../../foundation/presence/presence.service';
import { MediaService } from './media.service';

/**
 * CL5 — WHAT SOMEBODY WAS ACTUALLY ASKED FOR, BY SOMEBODY WHO WAS STANDING THERE.
 *
 * The network already DERIVES the strongest version of this and nobody reports it: when an agent
 * publishes what a container needs, that publication is itself the observation (BorderPaperObservation).
 * This is the other kind — the driver at the counter, the shopkeeper at the border post — and it is the
 * kind that needs rules, because it is a person typing a sentence about an institution.
 *
 * THREE RULES, and each one refuses something at intake rather than storing it weakly.
 *
 * FIRST-HAND OR NOT AT ALL. "I was asked for X" is knowledge. "I heard they ask for X" is a rumour, and
 * a rumour stored at low confidence is still a rumour on a screen — worse, it is a rumour wearing a
 * date. So the form asks whether you were there, and a no is a refusal, not a lower tier.
 *
 * POSITIVE ONLY, BY THE SHAPE OF THE FORM. "They asked me for a phytosanitary certificate" is something
 * one person can witness. "A phytosanitary certificate is no longer required" is a claim about a rule,
 * which nobody at a counter can witness and which would be read as us asserting the law. There is no
 * field for it. The absence of recent observations is how a lapsed requirement shows — see
 * `knownNotAsked`, which reads exactly that way.
 *
 * A PHOTOGRAPH NEEDS TWO GATES, and this is what the slice was blocked on. The user: *"cl5 is by default
 * off because it's correct that we cant just hold photographs of official documents. It needs two gates,
 * one by the sister sbg operator and another one by the person who uploads his docs. we must state that
 * they should upload docs with sensitive numbers blacked out."*
 *
 *   1. THE COUNTRY'S — `fieldEvidence`, a presence capability no level grants, switched on for a named
 *      jurisdiction by a proposal and a different person's approval. It is the sister operating there
 *      answering a question about that country's law.
 *   2. THE PERSON'S — given on THIS upload, not once in a settings screen, and recorded with the exact
 *      words they were shown. A consent given last year to a notice that has since changed is not
 *      consent to the notice in front of them now.
 *
 * NEITHER SUBSTITUTES FOR THE OTHER. The country's permission is not the person's, and the person cannot
 * consent on behalf of a jurisdiction. Without both, the observation is still recorded — it is simply
 * TOLD rather than EVIDENCED, and the words are what we keep.
 */
export const OBSERVATION_TIERS = ['told', 'evidenced'] as const;
export type ObservationTier = (typeof OBSERVATION_TIERS)[number];

/**
 * WHAT THE PERSON IS TOLD BEFORE THE CAMERA OPENS, kept verbatim beside their agreement.
 *
 * Versioned because it will be rewritten, and a consent is only consent to the words that were actually
 * on the screen. Changing this text without changing the version would silently re-attribute everybody's
 * past agreement to a sentence they never read.
 */
export const REDACTION_NOTICE_VERSION = '2026-09-20';
export const REDACTION_NOTICE =
  'Black out the numbers before you photograph it. An entry or declaration number, a tax number, a passport ' +
  'or ID number, a phone number, a signature — cover them. What is useful here is WHICH paper was asked for, ' +
  'never whose it was or what it says. A photograph that still carries those numbers will be refused, and if ' +
  'one gets through, tell us and we will remove it.';

export interface ObservationConsent {
  /** The words on the screen when they agreed, kept so nobody has to reconstruct them later. */
  noticeVersion: string;
  notice: string;
  agreedAt: string;
  agreedBy: string;
}

export interface FieldObservation {
  observationId: string;
  /** ISO 3166-1 alpha-2. The jurisdiction whose counter this was — and whose law gates the photograph. */
  country: string;
  /** The port, border post or office, in the words the person used. */
  place: string;
  /** What they were asked for. */
  subject: string;
  /** Any detail they chose to add. Never required: a sentence nobody has time to type collects nothing. */
  note?: string;
  /** WHEN IT HAPPENED, which is not when it was typed — an evening's recollection is still first-hand. */
  happenedOn: string;
  byDid: string;
  byName: string;
  recordedAt: string;
  tier: ObservationTier;
  /** CL5 — the photograph, present only where BOTH gates were open at the moment it was recorded. */
  evidenceMediaId?: string;
  consent?: ObservationConsent;
}

export const OBSERVATION_BASIS =
  'What people were asked for, by people who were there, on the date they say it happened. Not a statement ' +
  'of what any border requires: a requirement that lapsed shows here as nobody having been asked since.';

@Injectable()
export class FieldObservationService {
  private readonly rows = new PersistentMap<string, FieldObservation>('field-observations');

  constructor(
    @Optional() private readonly presence?: PresenceService,
    // Optional for the specs that build this by hand; the app always provides it, and without it a
    // withdrawn photograph would still be sitting in the store — see removeEvidence.
    @Optional() private readonly media?: MediaService,
  ) {}

  /**
   * May a photograph be kept for this country today? Asked BEFORE the camera is offered, so that nobody
   * takes a picture of a customs document to be told afterwards that we cannot hold it.
   */
  mayHoldEvidence(country: string | undefined): boolean {
    if (!country) return false;
    return this.presence?.can(country.toUpperCase(), 'fieldEvidence') ?? false;
  }

  /** The notice a person must be shown before they may attach one, with the version they are agreeing to. */
  notice(): { version: string; text: string } {
    return { version: REDACTION_NOTICE_VERSION, text: REDACTION_NOTICE };
  }

  record(
    input: {
      country: string;
      place: string;
      subject: string;
      note?: string;
      happenedOn: string;
      /** Were you there? A no is refused — see the class comment. */
      firstHand: boolean;
      evidenceMediaId?: string;
      /** The person's gate. Must name the version of the notice they were shown. */
      consent?: { agreed: boolean; noticeVersion: string };
    },
    by: { did: string; name: string },
    now = Date.now(),
  ): FieldObservation {
    const country = input.country?.trim().toUpperCase();
    if (!country || !/^[A-Z]{2}$/.test(country)) throw new GlosError('VALIDATION_FAILED', 'Say which country this was, as its two-letter code');
    const place = input.place?.trim();
    if (!place) throw new GlosError('FIELD_REQUIRED', 'Say where this was — the port, the border post, the office');
    const subject = input.subject?.trim();
    if (!subject) throw new GlosError('FIELD_REQUIRED', 'Say what you were asked for');
    const happenedOn = input.happenedOn?.trim();
    if (!happenedOn || !/^\d{4}-\d{2}-\d{2}$/.test(happenedOn) || Number.isNaN(Date.parse(happenedOn))) {
      throw new GlosError('VALIDATION_FAILED', 'Say when it happened, written YYYY-MM-DD');
    }
    // A date in the future is a typo or a guess, and either way it is not something that happened.
    if (Date.parse(`${happenedOn}T00:00:00.000Z`) > now) throw new GlosError('VALIDATION_FAILED', 'That date has not happened yet');
    if (!by?.did || !by?.name?.trim()) throw new GlosError('FIELD_REQUIRED', 'An observation names the person who made it');

    /*
     * RUMOUR IS REFUSED, NOT DOWNGRADED. The doc's own words: first-hand, evidenced, or not at all. A
     * second-hand report kept at low confidence is still on the screen, still dated, and still read.
     */
    if (!input.firstHand) {
      throw new GlosError('VALIDATION_FAILED', 'Only record what you were asked for yourself. What somebody else was asked is theirs to record.');
    }

    let evidenceMediaId: string | undefined;
    let consent: ObservationConsent | undefined;

    if (input.evidenceMediaId) {
      // GATE ONE — the country's. Refused in the words of the law, not as the person's fault.
      if (!this.mayHoldEvidence(country)) {
        throw new GlosError(
          'FORBIDDEN',
          `We are not permitted to keep photographs of official documents in ${country}. Record what you were asked for — that part is useful on its own.`,
        );
      }
      // GATE TWO — the person's, on THIS upload, against the notice actually in front of them.
      if (!input.consent?.agreed) {
        throw new GlosError('FIELD_REQUIRED', 'A photograph of a document needs your agreement, on this upload, that the numbers are blacked out');
      }
      if (input.consent.noticeVersion !== REDACTION_NOTICE_VERSION) {
        throw new GlosError(
          'CONFLICT',
          'What you agreed to is not what is on the screen now — read it again and agree to the current wording',
        );
      }
      evidenceMediaId = input.evidenceMediaId;
      consent = { noticeVersion: REDACTION_NOTICE_VERSION, notice: REDACTION_NOTICE, agreedAt: new Date(now).toISOString(), agreedBy: by.name.trim() };
    }

    const observation: FieldObservation = {
      observationId: `fob_${randomBytes(8).toString('hex')}`,
      country,
      place,
      subject,
      ...(input.note?.trim() ? { note: input.note.trim() } : {}),
      happenedOn,
      byDid: by.did,
      byName: by.name.trim(),
      recordedAt: new Date(now).toISOString(),
      // DERIVED, never chosen. A tier somebody can pick is a tier somebody can claim.
      tier: evidenceMediaId ? 'evidenced' : 'told',
      ...(evidenceMediaId ? { evidenceMediaId } : {}),
      ...(consent ? { consent } : {}),
    };
    this.rows.set(observation.observationId, observation);
    return observation;
  }

  /**
   * What has been observed at a place, newest first.
   *
   * The date leads because it is the whole claim: an entry from last year reads as last year's without
   * anybody marking it stale, which is the only honest way to hold knowledge about a moving target.
   */
  at(country: string, place?: string): FieldObservation[] {
    const where = place?.trim().toLowerCase();
    return [...this.rows.values()]
      .filter((o) => o.country === country.toUpperCase() && (!where || o.place.toLowerCase().includes(where)))
      .sort((a, b) => b.happenedOn.localeCompare(a.happenedOn) || b.recordedAt.localeCompare(a.recordedAt));
  }

  /** Every observation, newest first — the console's review list. */
  list(): FieldObservation[] {
    return [...this.rows.values()].sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
  }

  /**
   * Take a photograph back off an observation, keeping the observation.
   *
   * Needed the day a country's answer changes, or the day somebody photographs a number they meant to
   * cover. The words stay — they were first-hand and they are still true — and the tier falls back to
   * told, because that is now what it is.
   */
  removeEvidence(observationId: string, by: string, reason: string, now = Date.now()): FieldObservation {
    const row = this.rows.get(observationId);
    if (!row) throw new GlosError('NOT_FOUND', 'No such observation');
    if (!reason?.trim()) throw new GlosError('FIELD_REQUIRED', 'Say why the photograph is being removed');
    /*
     * THE BYTES GO NOW, not in ninety days. Unlinking alone left the photograph on disk and still served,
     * which is holding it — and both reasons to take one back (a visible number, a country withdrawing
     * permission) mean we must stop holding it immediately. Found by driving: the observation read "told"
     * and the photograph was still answering 200.
     */
    this.media?.withdrawFieldEvidence(row.evidenceMediaId);
    const next: FieldObservation = {
      ...row,
      tier: 'told',
      evidenceMediaId: undefined,
      note: [row.note, `Photograph removed ${new Date(now).toISOString().slice(0, 10)} by ${by.trim()}: ${reason.trim()}`].filter(Boolean).join(' · '),
    };
    delete next.evidenceMediaId;
    this.rows.set(observationId, next);
    return next;
  }
}
