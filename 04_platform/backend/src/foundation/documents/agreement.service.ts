import { Injectable } from '@nestjs/common';
import { GlosError } from '../http/glos-error';
import { PersistentMap } from '../store/persistent-map';
import type { IntrospectionResult } from '../auth/auth.types';
import { SHOP_STAFF_KEY_PREFIX } from '../auth/at-the-counter';
import { catalogueEntry } from '../countries/catalogue';
import { DocumentsService } from './documents.service';
import type { AgreementDocument, DocumentKind, MyAgreement } from './documents.types';

/** How each is named in a refusal: "Read and agree to … first". */
const AGREE_WORDS: Record<DocumentKind, string> = { terms: 'the terms of use', privacy: 'what happens to your data', cookies: 'the cookie statement' };
const wordsFor = (doc: AgreementDocument) => (doc.country ? `${AGREE_WORDS[doc.kind]} for ${catalogueEntry(doc.country)?.name ?? doc.country}` : AGREE_WORDS[doc.kind]);

/** The versions agreed to, by line key (`terms`, `terms@KE` …). */
export type AgreedNumbers = Record<string, number>;

/** One agreement: what was read and agreed to, when, from which door — and for which country's documents. */
export interface Agreement {
  at: string;
  numbers: AgreedNumbers;
  via: string;
  country?: string;
}

/** Everything one person or account agreed to, oldest first. Kept as long as the account: it is the record. */
export interface AgreementRecord {
  subject: string;
  agreements: Agreement[];
}

/**
 * WHO IS AGREEING, read off a sign-in — the first is where an agreement made under it is kept, every one is asked.
 *
 * A person (phone and PIN) agrees as themselves, whichever app or role they are in. An account with an email and a
 * password — a shop, a sort hub, a store — agrees as itself, and a person signed in to it is the same agreement read
 * from either side. A colleague at a counter agrees as themselves: the shop's agreement is not theirs. Staff and a
 * company's own administrators are SeeBuyGet's own, not people signing up to it: they are asked nothing here.
 */
export function agreementSubjects(actor: IntrospectionResult | undefined): string[] {
  if (!actor?.active || actor.role === 'operator' || actor.role === 'entity_admin') return [];
  const subjects: string[] = [];
  if (actor.personDid) subjects.push(`person:${actor.personDid}`);
  // A colleague at a counter carries the shop's DID, and their own name and key: their agreement is theirs, never the shop's.
  const counterColleague = actor.revocationKey?.startsWith(SHOP_STAFF_KEY_PREFIX);
  // The accounts with an email and a password: a shop (agent), a sort hub (mdp), a store (its console's role, genesis).
  if (!counterColleague && actor.did && ['agent', 'mdp', 'genesis'].includes(actor.role ?? '')) subjects.push(`account:${actor.did}`);
  return subjects;
}

/**
 * WHAT SOMEBODY AGREED TO (the user, 2026-10-25: "every sign up needs an agreement of terms of use, use of data,
 * storage of data, cookie statement, etc.").
 *
 * Checked at every sign-up before anything is made — the versions read must be the ones that count now, for the country
 * the sign-up is in — and kept against the person or account made. Asked again after signing in when a version published
 * since asks everybody to agree again, when their country publishes documents of its own, or when somebody else made the
 * account (a fleet's driver, a counter colleague) and nobody agreed yet. An agreement to a version counts for good: what
 * is asked is only what was published since, never what was agreed already.
 */
@Injectable()
export class AgreementService {
  private readonly records = new PersistentMap<string, AgreementRecord>('agreements');

  constructor(private readonly documents: DocumentsService) {}

  /**
   * REFUSE A SIGN-UP that did not agree to the versions that count now for its country — before anything is written. A
   * version newer than the one shown is fine (it asked nothing new); one older than a version that asks again is not:
   * what changed since must be read.
   */
  require(input: { versions?: Record<string, number> } | undefined, country?: string): AgreedNumbers {
    const set = this.documents.agreementSet(country);
    const versions = input?.versions;
    if (!versions || typeof versions !== 'object') throw new GlosError('AGREEMENT_REQUIRED', 'Read and agree to the terms of use, what happens to your data, and the cookie statement first', { field: 'agreement' });
    const numbers: AgreedNumbers = {};
    for (const doc of set) {
      const n = versions[doc.key];
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > doc.number) {
        throw new GlosError('AGREEMENT_REQUIRED', `Read and agree to ${wordsFor(doc)} first`, { field: 'agreement', key: doc.key });
      }
      if (n < doc.since) {
        throw new GlosError('AGREEMENT_REQUIRED', `A new version of ${wordsFor(doc)} was published while you were reading: read it and agree to it`, { field: 'agreement', key: doc.key, changed: true });
      }
      numbers[doc.key] = n;
    }
    return numbers;
  }

  /** Keep an agreement against who made it. `numbers` must have come through `require`. */
  record(subject: string, numbers: AgreedNumbers, via: string, country?: string, now = Date.now()): Agreement {
    const code = catalogueEntry(country)?.code;
    const agreement: Agreement = { at: new Date(now).toISOString(), numbers, via, ...(code ? { country: code } : {}) };
    const record = this.records.get(subject) ?? { subject, agreements: [] };
    this.records.set(subject, { ...record, agreements: [...record.agreements, agreement] });
    return agreement;
  }

  /** The same, unless everything in it was agreed already under these subjects: one agreement, kept once. */
  recordIfNew(subjects: string[], numbers: AgreedNumbers, via: string, country?: string, now = Date.now()): void {
    const had = this.agreed(subjects);
    if (Object.entries(numbers).every(([key, n]) => (had[key] ?? 0) >= n)) return;
    if (subjects[0]) this.record(subjects[0], numbers, via, country, now);
  }

  /** Every agreement under these subjects, oldest first. */
  private allOf(subjects: string[]): Agreement[] {
    return subjects.flatMap((s) => this.records.get(s)?.agreements ?? []).sort((a, b) => a.at.localeCompare(b.at));
  }

  /** The latest agreement under any of these subjects. */
  latest(subjects: string[]): Agreement | undefined {
    return this.allOf(subjects).pop();
  }

  /** The highest version of each line ever agreed to under these subjects. */
  agreed(subjects: string[]): AgreedNumbers {
    const out: AgreedNumbers = {};
    for (const a of this.allOf(subjects)) for (const [key, n] of Object.entries(a.numbers)) out[key] = Math.max(out[key] ?? 0, n);
    return out;
  }

  /** Must they agree before going on: a line in the set with nothing agreed since the version that counts. */
  needed(subjects: string[], set: AgreementDocument[]): boolean {
    if (!subjects.length) return false;
    const had = this.agreed(subjects);
    return set.some((doc) => (had[doc.key] ?? 0) < doc.since);
  }

  /**
   * Where this sign-in stands, for the country it works in — told by the caller, else the one its last agreement was for:
   * what to read, whether they must agree, and what they agreed to.
   */
  mine(actor: IntrospectionResult | undefined, country?: string): MyAgreement {
    const subjects = agreementSubjects(actor);
    const code = catalogueEntry(country)?.code ?? this.latest(subjects)?.country;
    const set = this.documents.agreementSet(code);
    const last = this.latest(subjects);
    return {
      needed: this.needed(subjects, set),
      ...(code ? { country: code } : {}),
      documents: set,
      ...(last ? { agreedAt: last.at, agreed: this.agreed(subjects) } : {}),
    };
  }

  /**
   * A SIGN-UP MADE UNDER SOMEBODY ALREADY SIGNED IN — a fleet, a courier, a business, in `country`. Their agreement counts
   * if it covers what counts there now; if it does not (nothing yet, a version since asks again, or that country has
   * documents of its own) the sign-up must carry one, and it is kept. Asked before anything of the sign-up is written.
   */
  assertFor(actor: IntrospectionResult | undefined, input: { versions?: Record<string, number> } | undefined, via: string, country?: string): void {
    const subjects = agreementSubjects(actor);
    if (!subjects.length) return;
    const set = this.documents.agreementSet(country);
    if (this.needed(subjects, set)) {
      this.recordIfNew(subjects, this.require(input, country), via, country);
      return;
    }
    // Nothing is asked of them: what they agreed to covers this country. One sent all the same is kept where it holds
    // here — and where it does not (it was shown for another country), what they agreed to already still counts.
    if (!input?.versions) return;
    try {
      this.recordIfNew(subjects, this.require(input, country), via, country);
    } catch {
      /* nothing was needed */
    }
  }

  /** How many people or accounts agreed to each version of a line: the highest version each of them agreed to. */
  countsFor(key: string): Record<number, number> {
    const counts: Record<number, number> = {};
    for (const record of this.records.values()) {
      const n = Math.max(0, ...record.agreements.map((a) => a.numbers[key] ?? 0));
      if (n) counts[n] = (counts[n] ?? 0) + 1;
    }
    return counts;
  }

  /** The people whose last agreement was for this country's documents — those a country's own update is told to. */
  personsIn(country: string): string[] {
    const code = catalogueEntry(country)?.code;
    const out: string[] = [];
    for (const record of this.records.values()) {
      if (!record.subject.startsWith('person:')) continue;
      if (record.agreements[record.agreements.length - 1]?.country === code) out.push(record.subject.slice('person:'.length));
    }
    return out;
  }
}
