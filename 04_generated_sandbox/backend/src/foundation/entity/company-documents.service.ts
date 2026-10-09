import { Injectable } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { createHash, randomBytes } from 'crypto';
import { GlosError } from '../http/glos-error';
import { PersistentMap } from '../store/persistent-map';
import { decodeDocument } from '../media/decode-document';
import { EntityService } from './entity.service';
import { samePerson } from './same-person';

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
 */
export const DOCUMENT_STATUSES = ['awaiting_verification', 'verified', 'rejected', 'superseded', 'declared'] as const;
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
}

@Injectable()
export class CompanyDocumentService {
  private readonly documents = new PersistentMap<string, CompanyDocument>('entity-documents');
  /** The bytes, apart from the metadata, so listing a company's papers never carries a file. */
  private readonly files = new PersistentMap<string, string>('entity-document-files');

  constructor(private readonly entities: EntityService) {}

  upload(
    input: { entityId: string; kind: string; title: string; dataUrl: string; relatesTo?: string; expiresAt?: string; by?: string; /** The company's own, and it keeps its own record: it counts at once. */ declared?: boolean },
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
    const document: CompanyDocument = {
      documentId: `doc_${randomBytes(8).toString('hex')}`,
      entityId: entity.entityId,
      kind: input.kind as DocumentKind,
      title,
      ...(relatesTo ? { relatesTo } : {}),
      version: (previous?.version ?? 0) + 1,
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
    if (previous) {
      // Kept, never replaced in place: "which certificate did we rely on in March" outlives the new one.
      Object.assign(previous, { status: 'superseded', supersededBy: document.documentId });
      this.documents.set(previous.documentId, previous);
    }
    return document;
  }

  /** A second person confirms the paper is what it says. Never the uploader; never a file that no longer matches. */
  verify(entityId: string, documentId: string, by?: string, now = Date.now()): CompanyDocument {
    const document = this.require(entityId, documentId);
    if (document.status !== 'awaiting_verification') throw new GlosError('INVALID_STATE', `This document is ${document.status.replace('_', ' ')}`);
    const who = by?.trim();
    if (!who) throw new GlosError('FIELD_REQUIRED', 'Say who is verifying this');
    if (samePerson(who, document.uploadedBy)) throw new GlosError('FORBIDDEN', 'You uploaded this document — a different person must verify it');
    if (!this.intact(document)) throw new GlosError('INVALID_STATE', 'The stored file no longer matches its fingerprint — it cannot be verified');
    Object.assign(document, { status: 'verified', verifiedBy: who, verifiedAt: new Date(now).toISOString() });
    this.documents.set(document.documentId, document);
    return document;
  }

  /** Say a paper is not good enough — including one verified earlier and found wanting — always with a reason. */
  reject(entityId: string, documentId: string, by?: string, reason?: string, now = Date.now()): CompanyDocument {
    const document = this.require(entityId, documentId);
    if (document.status === 'superseded' || document.status === 'rejected') throw new GlosError('INVALID_STATE', `This document is already ${document.status}`);
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
   * A paper is no longer the paper for anything: the licence it was for was renewed under a NEW number, and the new
   * paper says so. Kept, marked as replaced by that one — the same as a new version of the same paper.
   */
  retire(entityId: string, kind: string, relatesTo: string, replacedBy: string): void {
    const old = this.currentOf(entityId, kind, relatesTo);
    if (!old || old.documentId === replacedBy) return;
    Object.assign(old, { status: 'superseded', supersededBy: replacedBy });
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
      .filter((d) => d.entityId === entityId && d.kind === kind && (d.relatesTo ?? '').toUpperCase() === key && d.status !== 'superseded')
      .sort((a, b) => b.version - a.version)[0];
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
