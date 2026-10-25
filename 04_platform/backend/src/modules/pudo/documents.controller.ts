import { Body, Controller, Get, Param, ParseIntPipe, Post } from '@nestjs/common';
import { Actor } from '../../foundation/auth/actor.decorator';
import { AtTheCounter } from '../../foundation/auth/at-the-counter';
import type { IntrospectionResult } from '../../foundation/auth/auth.types';
import { Public } from '../../foundation/auth/public.decorator';
import { Roles } from '../../foundation/auth/scopes.decorator';
import { GlosError } from '../../foundation/http/glos-error';
import { AgreementService, agreementSubjects } from '../../foundation/documents/agreement.service';
import { DocumentsService } from '../../foundation/documents/documents.service';
import {
  AgreementDto,
  AgreementSet,
  DecideDocumentDto,
  DOCUMENT_KINDS,
  DOCUMENT_PATHS,
  DocumentVersion,
  MyAgreement,
  ProposeDocumentDto,
  PublishedDocument,
  PublishedVersionLine,
} from '../../foundation/documents/documents.types';
import { staffOf } from './staff-of';

/** Every role a person or an account signs in as. Staff and a company's administrators agree to nothing here. */
const SIGNED_IN = ['consumer', 'agent', 'driver', 'mdp', 'genesis', 'fleet_manager', 'business'] as const;

/**
 * THE TERMS OF USE, WHAT HAPPENS TO PEOPLE'S DATA, AND COOKIES — read by anybody, written by staff, agreed to at every
 * sign-up (the user, 2026-10-25). See foundation/documents for how a version is written and published.
 */
@Controller('sbg')
export class DocumentsController {
  constructor(
    private readonly documents: DocumentsService,
    private readonly agreements: AgreementService,
  ) {}

  /* ------------------------------------------------------------------- anybody -- */

  /** What a sign-up agrees to now: each document's current version, and the oldest version that still counts. */
  @Public()
  @Get('agreement')
  agreementSet(): AgreementSet {
    return { documents: this.documents.agreementSet() };
  }

  /** A document as it reads now. */
  @Public()
  @Get('documents/:kind')
  document(@Param('kind') kind: string): PublishedDocument {
    return this.documents.publicView(this.documents.current(this.documents.requireKind(kind)));
  }

  /** Every published version of a document, newest first: its number, date and what changed. */
  @Public()
  @Get('documents/:kind/history')
  documentHistory(@Param('kind') kind: string): { items: PublishedVersionLine[] } {
    return { items: this.documents.publicHistory(this.documents.requireKind(kind)) };
  }

  /** One published version, word for word — what somebody agreed to, read back. */
  @Public()
  @Get('documents/:kind/versions/:number')
  documentVersion(@Param('kind') kind: string, @Param('number', ParseIntPipe) number: number): PublishedDocument {
    return this.documents.publicView(this.documents.published(this.documents.requireKind(kind), number));
  }

  /* ---------------------------------------------------------- the person signed in -- */

  /** Where this sign-in stands: whether they must agree before going on, and to what. */
  @Roles(...SIGNED_IN)
  @AtTheCounter()
  @Get('agreement/mine')
  myAgreement(@Actor() actor: IntrospectionResult): MyAgreement {
    return this.agreements.mine(actor);
  }

  /**
   * AGREE, after signing in — asked of somebody another person signed up (a fleet's driver, a counter colleague), and
   * of everybody when a version published since asks them to agree again.
   */
  @Roles(...SIGNED_IN)
  @AtTheCounter()
  @Post('agreement/mine')
  agree(@Body() dto: AgreementDto, @Actor() actor: IntrospectionResult): MyAgreement {
    const [subject] = agreementSubjects(actor);
    if (!subject) throw new GlosError('FORBIDDEN', 'Nothing to agree to from this sign-in');
    this.agreements.record(subject, this.agreements.require(dto), `app:${actor.role}`);
    return this.agreements.mine(actor);
  }

  /* --------------------------------------------------------------------- staff -- */

  /** Every document, with what is published, what is waiting, and every version written — as the console reads them. */
  @Roles('operator')
  @Get('documents')
  staffDocuments(@Actor() actor: IntrospectionResult): { items: Array<{ kind: string; path: string; current: DocumentVersion; pending?: DocumentVersion; versions: DocumentVersion[] }> } {
    const reader = actor?.actorName && actor.revocationKey ? { name: actor.actorName, key: actor.revocationKey } : undefined;
    return {
      items: DOCUMENT_KINDS.map((kind) => {
        const counts = this.agreements.countsFor(kind);
        const versions = this.documents.history(kind, reader).map((v) => (v.number ? { ...v, agreed: counts[v.number] ?? 0 } : v));
        const current = this.documents.current(kind);
        const pending = versions.find((v) => v.status === 'proposed');
        return { kind, path: DOCUMENT_PATHS[kind], current: { ...current, agreed: counts[current.number!] ?? 0 }, ...(pending ? { pending } : {}), versions };
      }),
    };
  }

  /** Write a new version. It changes nothing until a different member of staff publishes it. */
  @Roles('operator')
  @Post('documents/:kind/versions')
  propose(@Param('kind') kind: string, @Body() dto: ProposeDocumentDto, @Actor() actor: IntrospectionResult): DocumentVersion {
    const who = staffOf(actor, dto.by);
    return this.documents.propose(this.documents.requireKind(kind), { title: dto.title, body: dto.body, changeNote: dto.changeNote, askAgain: dto.askAgain }, who);
  }

  /** The second person publishes it: from now on it is what everybody reads, and agrees to. */
  @Roles('operator')
  @Post('documents/versions/:versionId/publish')
  publish(@Param('versionId') versionId: string, @Body() dto: DecideDocumentDto, @Actor() actor: IntrospectionResult): DocumentVersion {
    return this.documents.publish(versionId, staffOf(actor, dto.by));
  }

  /** Decline it — or, by its writer, withdraw it — with a reason that is kept. */
  @Roles('operator')
  @Post('documents/versions/:versionId/decline')
  decline(@Param('versionId') versionId: string, @Body() dto: DecideDocumentDto, @Actor() actor: IntrospectionResult): DocumentVersion {
    return this.documents.decline(versionId, staffOf(actor, dto.by), dto.reason);
  }
}
