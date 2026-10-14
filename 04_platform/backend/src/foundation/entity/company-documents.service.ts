import { Injectable } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { createHash, randomBytes } from 'crypto';
import { GlosError } from '../http/glos-error';
import { PersistentMap } from '../store/persistent-map';
import { decodeDocument } from '../media/decode-document';
import { EntityService } from './entity.service';
import { sameSigner, type Signer } from './same-person';

/**
 * CA4 — THE PAPERS BEHIND A COMPANY, PROVABLE (user, 2026-09-13: "documents are fingerprinted").
 *
 * Every document is kept exactly as uploaded, with the sha256 of its bytes — the fingerprint is what a later
 * reader checks the file against, and what an auditor compares with the copy the registry holds. Nothing is
 * overwritten: a replacement is a new version and the old one stays, marked as superseded. And a document counts
 * only once somebody OTHER than the person who uploaded it has verified it — the same two-person rule that
 * switches a country on.
 */
export const DOCUMENT_KINDS = [
  'certificate_of_incorporation',
  'memorandum_and_articles',
  'tax_registration_certificate',
  'bank_confirmation',
  'licence',
  'insurance_policy',
  'representative_id',
  'beneficial_ownership',
  'obligation_registration',
  // CL2a — the papers an IMPORT needs. They are kinds of company paper like any other: fingerprinted,
  // versioned, and verified by a second person. What sets them apart is that most belong to ONE container
  // rather than to the company, which they say by carrying that consignment's code as `relatesTo` — the
  // same field a licence uses to say which licence it is the paper for.
  'packing_list',
  'commercial_invoice',
  'bill_of_lading',
  'certificate_of_origin',
  'import_permit',
  'other',
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

/**
 * `declared` — put on record by a company that keeps its own record (one that is switched on). It counts from that
 * moment, with nobody checking it first; what is left is that anybody who can see it may say it is not right. The
 * two-person verification is how a company is switched ON, and stays that.
 *
 * `struck` — two members of staff decided, on a report, that a paper which counted does not. Kept, with who and why;
 * what it had replaced is the current paper again.
 */
export const DOCUMENT_STATUSES = ['awaiting_verification', 'verified', 'rejected', 'superseded', 'declared', 'struck'] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

/** A certificate scan is a few hundred kilobytes; eight megabytes is a generous ceiling, not a target. */
export const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;

export class CompanyDocument {
  @ApiProperty() documentId: string;
  @ApiProperty() entityId: string;
  @ApiProperty({ enum: DOCUMENT_KINDS }) kind: DocumentKind;
  @ApiProperty() title: string;
  /** Which licence, policy or obligation this is the paper for — its number or key. Absent for company-wide papers. */
  @ApiPropertyOptional() relatesTo?: string;
  @ApiProperty() version: number;
  /** sha256 of the bytes, hex. Never called `hash`: the response mask strips that name at every depth. */
  @ApiProperty() fingerprint: string;
  @ApiProperty() contentType: string;
  @ApiProperty() size: number;
  @ApiProperty() uploadedBy: string;
  @ApiProperty() uploadedAt: string;
  @ApiPropertyOptional() expiresAt?: string;
  @ApiProperty({ enum: DOCUMENT_STATUSES }) status: DocumentStatus;
  @ApiPropertyOptional() verifiedBy?: string;
  @ApiPropertyOptional() verifiedAt?: string;
  @ApiPropertyOptional() rejectedBy?: string;
  @ApiPropertyOptional() rejectedAt?: string;
  @ApiPropertyOptional() rejectionReason?: string;
  @ApiPropertyOptional() supersededBy?: string;
  /** What it was when it was replaced — so that if the paper that replaced it is struck, it is that again. */
  @ApiPropertyOptional({ enum: DOCUMENT_STATUSES }) supersededFrom?: DocumentStatus;
  @ApiPropertyOptional() struckBy?: string;
  @ApiPropertyOptional() struckAt?: string;
  @ApiPropertyOptional() strikeReason?: string;
  /** On a company's record, for whoever reads it: THEY put this one on record, so they are not the one to verify it. Never stored. */
  @ApiPropertyOptional() mine?: boolean;
}

@Injectable()
export class CompanyDocumentService {
  private readonly documents = new PersistentMap<string, CompanyDocument>('entity-documents');
  /** The bytes, apart from the metadata, so listing a company's papers never carries a file. */
  private readonly files = new PersistentMap<string, string>('entity-document-files');
  /** Which ACCOUNT put each on record. Beside the paper, not on it: a paper is read whole by the company and by staff. */
  private readonly uploaderKeys = new PersistentMap<string, string>('entity-document-uploader-keys');

  constructor(private readonly entities: EntityService) {}

  upload(
    input: { entityId: string; kind: string; title: string; dataUrl: string; relatesTo?: string; expiresAt?: string; by?: string; /** The uploader's account, where they have one. */ byKey?: string; /** The company's own, and it keeps its own record: it counts at once. */ declared?: boolean },
    now = Date.now(),
  ): CompanyDocument {
    const entity = this.entities.get(input.entityId);
    const by = input.by?.trim();
    if (!by) throw new GlosError('FIELD_REQUIRED', 'Say who is uploading this — every document names the person who put it on record');
    if (!DOCUMENT_KINDS.includes(input.kind as DocumentKind)) throw new GlosError('VALIDATION_FAILED', `Unknown kind of document: ${input.kind}`);
    const title = input.title?.trim();
    if (!title) throw new GlosError('FIELD_REQUIRED', 'Give the document a title a reader will recognise');
    const expiresAt = input.expiresAt?.trim() || undefined;
    if (expiresAt && (!/^\d{4}-\d{2}-\d{2}$/.test(expiresAt) || Number.isNaN(Date.parse(expiresAt)))) {
      throw new GlosError('VALIDATION_FAILED', 'An expiry must be a date written YYYY-MM-DD');
    }
    const { contentType, bytes } = decodeDocument(input.dataUrl, MAX_DOCUMENT_BYTES);
    const fingerprint = createHash('sha256').update(bytes).digest('hex');
    const relatesTo = input.relatesTo?.trim() || undefined;

    const previous = this.currentOf(entity.entityId, input.kind, relatesTo);
    if (previous?.fingerprint === fingerprint) {
      throw new GlosError('CONFLICT', `That exact file is already on record as version ${previous.version}`);
    }
    // The very file two of us struck is not put back on record as though nothing had been decided.
    const versions = this.versionsOf(entity.entityId, input.kind, relatesTo);
    if (versions.some((d) => d.status === 'struck' && d.fingerprint === fingerprint)) {
      throw new GlosError('CONFLICT', 'That exact file was struck from the record. Put the right paper on record');
    }
    const document: CompanyDocument = {
      documentId: `doc_${randomBytes(8).toString('hex')}`,
      entityId: entity.entityId,
      kind: input.kind as DocumentKind,
      title,
      ...(relatesTo ? { relatesTo } : {}),
      // Counted over every version there has been, a struck one included: no two papers share a number.
      version: Math.max(0, ...versions.map((d) => d.version)) + 1,
      fingerprint,
      contentType,
      size: bytes.length,
      uploadedBy: by,
      uploadedAt: new Date(now).toISOString(),
      ...(expiresAt ? { expiresAt } : {}),
      status: input.declared ? 'declared' : 'awaiting_verification',
    };
    this.files.set(document.documentId, bytes.toString('base64'));
    this.documents.set(document.documentId, document);
    if (input.byKey) this.uploaderKeys.set(document.documentId, input.byKey);
    if (previous) {
      // Kept, never replaced in place: "which certificate did we rely on in March" outlives the new one.
      Object.assign(previous, { supersededFrom: previous.status, status: 'superseded', supersededBy: document.documentId });
      this.documents.set(previous.documentId, previous);
    }
    return document;
  }

  /** A second person confirms the paper is what it says. Never the uploader; never a file that no longer matches. */
  verify(entityId: string, documentId: string, by?: string, now = Date.now(), byKey?: string): CompanyDocument {
    const document = this.require(entityId, documentId);
    if (document.status !== 'awaiting_verification') throw new GlosError('INVALID_STATE', `This document is ${document.status.replace('_', ' ')}`);
    const who = by?.trim();
    if (!who) throw new GlosError('FIELD_REQUIRED', 'Say who is verifying this');
    if (this.uploadedByReader(document, { name: who, key: byKey })) throw new GlosError('FORBIDDEN', 'You uploaded this document — a different person must verify it');
    if (!this.intact(document)) throw new GlosError('INVALID_STATE', 'The stored file no longer matches its fingerprint — it cannot be verified');
    Object.assign(document, { status: 'verified', verifiedBy: who, verifiedAt: new Date(now).toISOString() });
    this.documents.set(document.documentId, document);
    return document;
  }

  /** Did this reader put it on record? What a screen asks before it offers them "Verify". */
  uploadedByReader(document: Pick<CompanyDocument, 'documentId' | 'uploadedBy'>, reader: Signer): boolean {
    return sameSigner(reader, { name: document.uploadedBy, key: this.uploaderKeys.get(document.documentId) });
  }

  /** Say a paper is not good enough — including one verified earlier and found wanting — always with a reason. */
  reject(entityId: string, documentId: string, by?: string, reason?: string, now = Date.now()): CompanyDocument {
    const document = this.require(entityId, documentId);
    if (document.status === 'superseded' || document.status === 'rejected' || document.status === 'struck') throw new GlosError('INVALID_STATE', `This document is already ${document.status}`);
    // One person turning down a paper that COUNTS would be one person switching a company's licence off.
    if (document.status === 'declared') throw new GlosError('INVALID_STATE', 'The company put this paper on record itself, and it counts. It is not rejected by one person');
    const who = by?.trim();
    if (!who) throw new GlosError('FIELD_REQUIRED', 'Say who is rejecting this');
    if (!reason?.trim()) throw new GlosError('FIELD_REQUIRED', 'Say why — a rejected document is kept with its reason');
    Object.assign(document, { status: 'rejected', rejectedBy: who, rejectedAt: new Date(now).toISOString(), rejectionReason: reason.trim() });
    this.documents.set(document.documentId, document);
    return document;
  }

  /**
   * A paper is no longer the paper for anything. Either the licence it was for was renewed under a NEW number, and
   * the new paper (`replacedBy`) says so; or what it was for was taken off the record, and nothing replaces it.
   * Kept either way, and no longer counting.
   */
  retire(entityId: string, kind: string, relatesTo: string, replacedBy?: string): void {
    const old = this.currentOf(entityId, kind, relatesTo);
    if (!old || old.documentId === replacedBy) return;
    Object.assign(old, { supersededFrom: old.status, status: 'superseded', ...(replacedBy ? { supersededBy: replacedBy } : {}) });
    this.documents.set(old.documentId, old);
  }

  /** Every version of every paper a company has, current ones first. */
  list(entityId: string): CompanyDocument[] {
    this.entities.get(entityId);
    return [...this.documents.values()]
      .filter((d) => d.entityId === entityId)
      .sort((a, b) => Number(a.status === 'superseded') - Number(b.status === 'superseded') || a.kind.localeCompare(b.kind) || b.version - a.version);
  }

  /** The latest version of one paper — a kind, and for licences, policies and obligations, which one. */
  currentOf(entityId: string, kind: string, relatesTo?: string): CompanyDocument | undefined {
    const key = (relatesTo ?? '').trim().toUpperCase();
    return [...this.documents.values()]
      .filter((d) => d.entityId === entityId && d.kind === kind && (d.relatesTo ?? '').toUpperCase() === key && d.status !== 'superseded' && d.status !== 'struck')
      .sort((a, b) => b.version - a.version)[0];
  }

  /** Every version there has been of one paper, whatever became of it. */
  private versionsOf(entityId: string, kind: string, relatesTo?: string): CompanyDocument[] {
    const key = (relatesTo ?? '').trim().toUpperCase();
    return [...this.documents.values()].filter((d) => d.entityId === entityId && d.kind === kind && (d.relatesTo ?? '').toUpperCase() === key);
  }

  /** One paper of a company's. */
  get(entityId: string, documentId: string): CompanyDocument {
    return this.require(entityId, documentId);
  }

  /** DOES THIS PAPER COUNT: verified by a second person before the company was switched on, or put on record by the company since. */
  counts(document: Pick<CompanyDocument, 'status'>): boolean {
    return document.status === 'verified' || document.status === 'declared';
  }

  /**
   * STRUCK: two members of staff decided, on a report, that this paper does not count. It is kept — who, when, why —
   * and every paper it had replaced is the current one again, exactly as it stood. What it changed on the RECORD is
   * put back by whoever calls this (CompanyDeclarationService.strike): this is the paper only.
   */
  strike(entityId: string, documentId: string, by: string, reason: string, now = Date.now()): { document: CompanyDocument; reinstated: CompanyDocument[] } {
    const document = this.require(entityId, documentId);
    if (!this.counts(document)) throw new GlosError('INVALID_STATE', `This paper is ${document.status.replace(/_/g, ' ')}: there is nothing to strike`);
    if (!by?.trim() || !reason?.trim()) throw new GlosError('FIELD_REQUIRED', 'A struck paper is kept with who struck it and why');
    Object.assign(document, { status: 'struck', struckBy: by.trim(), struckAt: new Date(now).toISOString(), strikeReason: reason.trim() });
    this.documents.set(document.documentId, document);
    const reinstated = [...this.documents.values()].filter((d) => d.entityId === entityId && d.supersededBy === documentId);
    for (const prior of reinstated) {
      prior.status = prior.supersededFrom ?? (prior.verifiedBy ? 'verified' : 'awaiting_verification');
      delete prior.supersededBy;
      delete prior.supersededFrom;
      this.documents.set(prior.documentId, prior);
    }
    return { document, reinstated };
  }

  /** Whether the current version of a paper has been verified by a second person. */
  isVerified(entityId: string, kind: string, relatesTo?: string): boolean {
    return this.currentOf(entityId, kind, relatesTo)?.status === 'verified';
  }

  /** The bytes, with whether they still match the fingerprint they were kept under. */
  file(entityId: string, documentId: string): { contentType: string; bytes: Buffer; fingerprint: string; intact: boolean; title: string } {
    const document = this.require(entityId, documentId);
    const bytes = Buffer.from(this.files.get(document.documentId) ?? '', 'base64');
    return { contentType: document.contentType, bytes, fingerprint: document.fingerprint, intact: this.intact(document), title: document.title };
  }

  private intact(document: CompanyDocument): boolean {
    const stored = this.files.get(document.documentId);
    return Boolean(stored) && createHash('sha256').update(Buffer.from(stored!, 'base64')).digest('hex') === document.fingerprint;
  }

  private require(entityId: string, documentId: string): CompanyDocument {
    const document = this.documents.get(documentId);
    if (!document || document.entityId !== entityId) throw new GlosError('NOT_FOUND', 'No such document for this company');
    return document;
  }
}
