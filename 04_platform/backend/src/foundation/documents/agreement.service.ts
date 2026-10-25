import { Injectable } from '@nestjs/common';
import { GlosError } from '../http/glos-error';
import { PersistentMap } from '../store/persistent-map';
import type { IntrospectionResult } from '../auth/auth.types';
import { SHOP_STAFF_KEY_PREFIX } from '../auth/at-the-counter';
import { DocumentsService } from './documents.service';
import { DOCUMENT_KINDS, type AgreementDocument, type DocumentKind, type MyAgreement } from './documents.types';

/** How each is named in a refusal: "Read and agree to … first". */
const AGREE_WORDS: Record<DocumentKind, string> = { terms: 'the terms of use', privacy: 'what happens to your data', cookies: 'the cookie statement' };

/** The versions agreed to, by document. */
export type AgreedNumbers = Record<DocumentKind, number>;

/** One agreement: what was read and agreed to, when, and from which app or door. */
export interface Agreement {
  at: string;
  numbers: AgreedNumbers;
  via: string;
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
 * Checked at every sign-up before anything is made — the versions read must be the ones that count now — and kept
 * against the person or account made. Asked again after signing in when a version published since asks everybody to
 * agree again, or when somebody else made the account (a fleet's driver, a counter colleague) and nobody agreed yet.
 */
@Injectable()
export class AgreementService {
  private readonly records = new PersistentMap<string, AgreementRecord>('agreements');

  constructor(private readonly documents: DocumentsService) {}

  /**
   * REFUSE A SIGN-UP that did not agree to the versions that count now — before anything is written. A version newer
   * than the one shown is fine (it asked nothing new); one older than a version that asks again is not: what changed
   * since must be read.
   */
  require(numbers: Partial<AgreedNumbers> | undefined): AgreedNumbers {
    const set = this.documents.agreementSet();
    if (!numbers) throw new GlosError('AGREEMENT_REQUIRED', 'Read and agree to the terms of use, what happens to your data, and the cookie statement first', { field: 'agreement' });
    for (const doc of set) {
      const n = numbers[doc.kind];
      if (typeof n !== 'number' || !Number.isInteger(n) || n > doc.number) {
        throw new GlosError('AGREEMENT_REQUIRED', `Read and agree to ${AGREE_WORDS[doc.kind]} first`, { field: 'agreement', kind: doc.kind });
      }
      if (n < doc.since) {
        throw new GlosError('AGREEMENT_REQUIRED', `A new version of ${AGREE_WORDS[doc.kind]} was published while you were reading: read it and agree to it`, { field: 'agreement', kind: doc.kind, changed: true });
      }
    }
    return Object.fromEntries(DOCUMENT_KINDS.map((k) => [k, numbers[k] as number])) as AgreedNumbers;
  }

  /** Keep an agreement against who made it. `numbers` must have come through `require`. */
  record(subject: string, numbers: AgreedNumbers, via: string, now = Date.now()): Agreement {
    const agreement: Agreement = { at: new Date(now).toISOString(), numbers, via };
    const record = this.records.get(subject) ?? { subject, agreements: [] };
    this.records.set(subject, { ...record, agreements: [...record.agreements, agreement] });
    return agreement;
  }

  /** The same, unless the latest agreement under these subjects already says exactly that: one agreement, kept once. */
  recordIfNew(subjects: string[], numbers: AgreedNumbers, via: string, now = Date.now()): void {
    const last = this.latest(subjects);
    if (last && DOCUMENT_KINDS.every((k) => last.numbers[k] === numbers[k])) return;
    if (subjects[0]) this.record(subjects[0], numbers, via, now);
  }

  /**
   * A SIGN-UP MADE UNDER SOMEBODY ALREADY SIGNED IN — a fleet, a courier, a business. Their agreement counts if it is
   * current; if it is not (nothing yet, or a version since asks again) the sign-up must carry one, and it is kept.
   * Asked before anything of the sign-up is written.
   */
  assertFor(actor: IntrospectionResult | undefined, numbers: Partial<AgreedNumbers> | undefined, via: string): void {
    const subjects = agreementSubjects(actor);
    if (!subjects.length) return;
    if (!this.needed(subjects)) {
      if (numbers) this.recordIfNew(subjects, this.require(numbers), via);
      return;
    }
    this.recordIfNew(subjects, this.require(numbers), via);
  }

  /** The latest agreement under any of these subjects. */
  latest(subjects: string[]): Agreement | undefined {
    return subjects
      .flatMap((s) => this.records.get(s)?.agreements ?? [])
      .sort((a, b) => a.at.localeCompare(b.at))
      .pop();
  }

  /** Must they agree before going on: nothing agreed yet, or a version that asks again since. */
  needed(subjects: string[], set: AgreementDocument[] = this.documents.agreementSet()): boolean {
    if (!subjects.length) return false;
    const last = this.latest(subjects);
    if (!last) return true;
    return set.some((doc) => (last.numbers[doc.kind] ?? 0) < doc.since);
  }

  /** Where this sign-in stands: what to read, whether they must agree, and what they agreed to last. */
  mine(actor: IntrospectionResult | undefined): MyAgreement {
    const subjects = agreementSubjects(actor);
    const set = this.documents.agreementSet();
    const last = this.latest(subjects);
    return { needed: this.needed(subjects, set), documents: set, ...(last ? { agreedAt: last.at, agreed: last.numbers } : {}) };
  }

  /** How many people or accounts agreed to each version of a document — their latest agreement only. */
  countsFor(kind: DocumentKind): Record<number, number> {
    const counts: Record<number, number> = {};
    for (const record of this.records.values()) {
      const last = record.agreements[record.agreements.length - 1];
      const n = last?.numbers[kind];
      if (n) counts[n] = (counts[n] ?? 0) + 1;
    }
    return counts;
  }
}
