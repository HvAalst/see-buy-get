import { Injectable, Optional } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { randomBytes } from 'crypto';
import { GlosError } from '../http/glos-error';
import { MailService } from '../mail/mail.service';
import { PersistentMap } from '../store/persistent-map';
import { CompanyDocument, CompanyDocumentService, type DocumentKind } from './company-documents.service';
import { normaliseRecordPatch, type CompanyRecord } from './company-record.types';
import { adminKey, EntityAdminService } from './entity-admin.service';
import { EntityService } from './entity.service';
import type { Entity } from './entity.types';

/**
 * A COMPANY THAT IS SWITCHED ON KEEPS ITS OWN RECORD (the user, 2026-10-09: "It would be good if the company
 * themselves could update their docs and not by staff. sbg should only interact at dispute").
 *
 * Until this, every line of a company's record was typed by network staff, including the one that matters on a
 * date: a renewed licence's new expiry. The company renewed its licence, put the paper on record, and then waited
 * for somebody at SeeBuyGet to type a date — and until they had, the old date counted and could switch a country
 * off. That put SeeBuyGet between a company and its own regulator, as a typist.
 *
 * So, once a company is switched on:
 *   · its administrators change its record themselves;
 *   · the parts that SWITCH something — a licence, an insurance policy, a bank account, who may sign — change one
 *     at a time, each WITH THE PAPER BEHIND IT, in one act. No paper, no change;
 *   · the change counts at once. Nobody checks it first;
 *   · what a paper PERMITS is not the company's to change, nor may a paper that permits something be taken off the
 *     record: either would be a way to keep charging after the licence behind it has run out;
 *   · every such change is kept whole — what it was, what it is, who, when, which paper — because the only check
 *     left is somebody saying "that is not right", and they have to be able to see what was said;
 *   · the company's other administrators, and those of the company above it, are told.
 *
 * Switching a company ON is unchanged: until then staff enter its record and a second person verifies each paper.
 */

/** The parts of a record that change only together with their paper. */
export const PAPER_BOUND_SECTIONS = ['licences', 'insurance', 'bankAccounts', 'representatives'] as const;
export type PaperBoundSection = (typeof PAPER_BOUND_SECTIONS)[number];

/** Which kinds of paper stand behind a change to each part. The first is what it is taken to be when nothing is said. */
export const PAPER_FOR: Record<PaperBoundSection, DocumentKind[]> = {
  licences: ['licence'],
  insurance: ['insurance_policy'],
  bankAccounts: ['bank_confirmation'],
  representatives: ['representative_id', 'memorandum_and_articles', 'other'],
};

/**
 * The papers a company keeps ABOUT ITSELF — as against the papers of one consignment (a packing list, a bill of
 * lading), which live in the same store, belong to an import, and are read by whoever clears it.
 */
export const COMPANY_PAPER_KINDS: readonly DocumentKind[] = [
  'certificate_of_incorporation',
  'memorandum_and_articles',
  'tax_registration_certificate',
  'bank_confirmation',
  'licence',
  'insurance_policy',
  'representative_id',
  'beneficial_ownership',
  'obligation_registration',
];

/** What each part calls one of its items: the thing a paper is "for". */
const REFERENCE_FIELD: Record<PaperBoundSection, string> = { licences: 'number', insurance: 'policyNumber', bankAccounts: 'accountNumber', representatives: 'name' };
const SECTION_WORDS: Record<PaperBoundSection, string> = { licences: 'licence', insurance: 'insurance policy', bankAccounts: 'bank account', representatives: 'person who may sign' };

/**
 * WHO KEEPS A COMPANY'S RECORD. Staff, until it is switched on — that is the readiness check, and it stays theirs.
 * The company itself from then on. A customer's business is checked by two of us from its papers and has its own
 * procedure; the group keeps no operating record at all.
 */
export function recordKeeper(entity: Pick<Entity, 'kind' | 'status'>): 'staff' | 'company' {
  if (entity.kind !== 'sister' && entity.kind !== 'partner') return 'staff';
  return entity.status === 'draft' ? 'staff' : 'company';
}

type Item = Record<string, unknown>;
const same = (a: unknown, b: unknown) => String(a ?? '').trim().toUpperCase() === String(b ?? '').trim().toUpperCase();

/** One item in a reader's words: "courier licence CA/CL/0042, good until 2026-12-10". */
export function itemWords(section: PaperBoundSection, item: Item | undefined): string {
  if (!item) return '—';
  if (section === 'licences') return `${String(item.kind).replace(/_/g, ' ')} licence ${item.number}, good until ${item.expiresAt}`;
  if (section === 'insurance') return `${String(item.kind).replace(/_/g, ' ')} policy ${item.policyNumber} with ${item.insurer}, good until ${item.expiresAt}`;
  if (section === 'bankAccounts') return `${item.bankName} account ${item.accountNumber} (${item.currency}, ${item.accountName})`;
  return `${item.name}, ${item.role} — signs ${item.signing === 'none' ? 'nothing' : item.signing}`;
}

export class CompanyDeclaration {
  @ApiProperty() declarationId: string;
  @ApiProperty() entityId: string;
  @ApiProperty({ enum: PAPER_BOUND_SECTIONS }) section: PaperBoundSection;
  @ApiProperty({ enum: ['added', 'changed', 'removed'] }) change: 'added' | 'changed' | 'removed';
  /** What the item was called before, and after: a licence or policy number, an account number, a person's name. */
  @ApiPropertyOptional() was?: string;
  @ApiPropertyOptional() now?: string;
  /** The item as it stood before and after, whole. What can be put back, and what somebody questioning it reads. */
  @ApiPropertyOptional() before?: Record<string, unknown>;
  @ApiPropertyOptional() after?: Record<string, unknown>;
  /** Before and after, in words. */
  @ApiProperty() wasWords: string;
  @ApiProperty() nowWords: string;
  /** The paper put on record in the same act. Absent only where something was taken OFF the record. */
  @ApiPropertyOptional() documentId?: string;
  @ApiProperty() by: string;
  @ApiProperty() at: string;
}

export interface DeclareInput {
  entityId: string;
  section: string;
  /** Which item is being changed or taken off: its number, or the person's name. Absent: something is being added. */
  was?: string;
  /** The item as it is to be. Absent: `was` is taken off the record. */
  item?: Record<string, unknown>;
  paper?: { kind?: string; title?: string; dataUrl?: string };
  /** The administrator acting — the name their sign-in carries — and the key their sessions answer to. */
  by?: string;
  byKey?: string;
}

@Injectable()
export class CompanyDeclarationService {
  private readonly declarations = new PersistentMap<string, CompanyDeclaration>('entity-declarations');

  constructor(
    private readonly entities: EntityService,
    private readonly documents: CompanyDocumentService,
    private readonly admins: EntityAdminService,
    // Optional so a hand-built module keeps compiling; without it the change is made and nobody is told.
    @Optional() private readonly mail?: MailService,
  ) {}

  /** A company's own changes to the paper-bound parts of its record, newest first. */
  list(entityId: string): CompanyDeclaration[] {
    return [...this.declarations.values()].filter((d) => d.entityId === entityId).sort((a, b) => b.at.localeCompare(a.at));
  }

  /** The change a paper was put on record WITH — what it claimed. */
  ofDocument(documentId: string): CompanyDeclaration | undefined {
    return [...this.declarations.values()].find((d) => d.documentId === documentId);
  }

  /**
   * ONE CHANGE, WITH ITS PAPER, IN ONE ACT. Everything is checked before anything is written: a paper that is
   * refused leaves the record as it was, and a record that is refused leaves no paper behind.
   */
  async declare(input: DeclareInput, now: number = Date.now()): Promise<{ declaration: CompanyDeclaration; document?: CompanyDocument; told: number }> {
    const entity = this.entities.get(input.entityId);
    if (recordKeeper(entity) !== 'company') {
      throw new GlosError(
        'INVALID_STATE',
        entity.kind === 'sister' || entity.kind === 'partner'
          ? `${entity.name} is not switched on yet: until it is, SeeBuyGet staff enter its record and verify its papers`
          : `${entity.name} does not keep a record of this kind`,
      );
    }
    const by = input.by?.trim();
    if (!by) throw new GlosError('FIELD_REQUIRED', 'A change to a company’s record names the person who made it');
    if (!PAPER_BOUND_SECTIONS.includes(input.section as PaperBoundSection)) {
      throw new GlosError('VALIDATION_FAILED', `This is for a licence, an insurance policy, a bank account or who may sign — not ${input.section}`);
    }
    const section = input.section as PaperBoundSection;
    const field = REFERENCE_FIELD[section];
    const record = this.entities.recordOf(entity.entityId);
    const items = record[section] as unknown as Item[];
    const was = input.was?.trim() || undefined;
    const at = was ? items.findIndex((i) => same(i[field], was)) : -1;
    if (was && at < 0) throw new GlosError('NOT_FOUND', `There is no ${SECTION_WORDS[section]} ${was} on ${entity.name}’s record`);
    const before = at >= 0 ? items[at] : undefined;

    /* ---- something is taken off the record ---- */
    if (!input.item) {
      if (!before) throw new GlosError('FIELD_REQUIRED', 'Say what is being changed, and how');
      const permits = (before.supports as unknown[] | undefined) ?? [];
      if (permits.length) {
        // The lapse rule reads what is ON the record: take a lapsing licence off it, and nothing lapses.
        throw new GlosError('FORBIDDEN', `This ${SECTION_WORDS[section]} is what lets ${entity.name} work: it is renewed with its paper, or it runs out on its date. It is not taken off the record`);
      }
      const next = items.filter((_, i) => i !== at);
      const declaration = this.keep({ entity, section, change: 'removed', before, by, now });
      this.entities.updateRecord(entity.entityId, { [section]: next }, by, { from: itemWords(section, before), to: 'taken off the record' });
      return { declaration, told: await this.tell(entity, declaration, input.byKey, now) };
    }

    /* ---- something is added, or changed: with its paper ---- */
    if (!input.paper?.dataUrl) {
      throw new GlosError('FIELD_REQUIRED', `A ${SECTION_WORDS[section]} changes together with the paper behind it: attach the paper`);
    }
    const paperKind = (input.paper.kind?.trim() || PAPER_FOR[section][0]) as DocumentKind;
    if (!PAPER_FOR[section].includes(paperKind)) throw new GlosError('VALIDATION_FAILED', `That kind of paper is not the paper behind a ${SECTION_WORDS[section]}`);

    const raw: Item = { ...input.item };
    if (section === 'licences' || section === 'insurance') {
      // WHAT A PAPER PERMITS IS NOT THE COMPANY'S TO SAY. Unticking "charge customers" on a licence about to lapse
      // would keep the company charging; so would calling a courier licence something else.
      if (before) {
        if (raw.kind != null && raw.kind !== before.kind) throw new GlosError('VALIDATION_FAILED', `This is a ${String(before.kind).replace(/_/g, ' ')} ${SECTION_WORDS[section]} and stays one: put a different one on record as a new one, with its own paper`);
        raw.kind = before.kind;
        raw.supports = before.supports;
      } else {
        delete raw.supports; // a new one permits what its kind permits
      }
    }
    const after = (normaliseRecordPatch({ [section]: [raw] }, { jurisdiction: entity.jurisdiction ?? '' })[section] as unknown as Item[])[0];
    const reference = String(after[field]);
    if (items.some((i, n) => n !== at && same(i[field], reference))) throw new GlosError('CONFLICT', `${reference} is already on ${entity.name}’s record`);
    const next = before ? items.map((i, n) => (n === at ? after : i)) : [...items, after];

    // The paper first: it is the half that can still be refused (not a document, too large, the very file already
    // on record). The record has been checked above and is written only once the paper is kept.
    const document = this.documents.upload(
      {
        entityId: entity.entityId,
        kind: paperKind,
        title: input.paper.title?.trim() || `${itemWords(section, after)}`,
        dataUrl: input.paper.dataUrl,
        relatesTo: reference,
        ...(typeof after.expiresAt === 'string' ? { expiresAt: after.expiresAt } : {}),
        by,
        declared: true,
      },
      now,
    );
    // A renewal under a new number: the paper for the old number is no longer the paper for anything.
    if (before && !same(before[field], reference)) this.documents.retire(entity.entityId, paperKind, String(before[field]), document.documentId);

    const declaration = this.keep({ entity, section, change: before ? 'changed' : 'added', before, after, documentId: document.documentId, by, now });
    this.entities.updateRecord(entity.entityId, { [section]: next } as Partial<CompanyRecord> as Record<string, unknown>, by, { from: itemWords(section, before), to: `${itemWords(section, after)} — with its paper` });
    return { declaration, document, told: await this.tell(entity, declaration, input.byKey, now) };
  }

  private keep(d: { entity: Entity; section: PaperBoundSection; change: CompanyDeclaration['change']; before?: Item; after?: Item; documentId?: string; by: string; now: number }): CompanyDeclaration {
    const field = REFERENCE_FIELD[d.section];
    const declaration: CompanyDeclaration = {
      declarationId: `dcl_${randomBytes(8).toString('hex')}`,
      entityId: d.entity.entityId,
      section: d.section,
      change: d.change,
      ...(d.before ? { was: String(d.before[field]), before: d.before } : {}),
      ...(d.after ? { now: String(d.after[field]), after: d.after } : {}),
      wasWords: itemWords(d.section, d.before),
      nowWords: d.after ? itemWords(d.section, d.after) : 'taken off the record',
      ...(d.documentId ? { documentId: d.documentId } : {}),
      by: d.by,
      at: new Date(d.now).toISOString(),
    };
    this.declarations.set(declaration.declarationId, declaration);
    return declaration;
  }

  /**
   * THE CHECK THAT IS LEFT: the people who would know. Every other administrator of the company, and those of the
   * company above it, are told what was changed and by whom — not the person who did it. Returns how many.
   */
  private async tell(entity: Entity, declaration: CompanyDeclaration, byKey: string | undefined, now: number): Promise<number> {
    if (!this.mail) return 0;
    const above = entity.parentEntityId ? this.admins.list(entity.parentEntityId) : [];
    const others = [...this.admins.list(entity.entityId), ...above].filter((a) => !byKey || adminKey(a.adminId) !== byKey);
    let told = 0;
    for (const admin of others) {
      const ok = await this.mail.send(
        'company-record-changed',
        { address: admin.email, name: admin.name },
        { company: entity.name, by: declaration.by, part: SECTION_WORDS[declaration.section], change: declaration.change, was: declaration.wasWords, now: declaration.nowWords, paper: Boolean(declaration.documentId) },
        now,
      );
      if (ok) told += 1;
    }
    return told;
  }
}
