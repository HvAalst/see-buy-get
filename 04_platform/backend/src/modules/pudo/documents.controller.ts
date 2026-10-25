import { Body, Controller, Get, Optional, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiQuery } from '@nestjs/swagger';
import { Actor } from '../../foundation/auth/actor.decorator';
import { AtTheCounter } from '../../foundation/auth/at-the-counter';
import type { IntrospectionResult } from '../../foundation/auth/auth.types';
import { Public } from '../../foundation/auth/public.decorator';
import { Roles } from '../../foundation/auth/scopes.decorator';
import { catalogueEntry } from '../../foundation/countries/catalogue';
import { GlosError } from '../../foundation/http/glos-error';
import { AgreementService, agreementSubjects } from '../../foundation/documents/agreement.service';
import { DocumentsService } from '../../foundation/documents/documents.service';
import {
  AgreementDto,
  AgreementSet,
  DecideDocumentDto,
  DOCUMENT_KINDS,
  documentKey,
  documentPath,
  DocumentVersion,
  MyAgreement,
  ProposeDocumentDto,
  PublishedDocument,
  PublishedVersionLine,
  type DocumentKind,
} from '../../foundation/documents/documents.types';
import { EntityService } from '../../foundation/entity/entity.service';
import { AgentService } from './agent.service';
import { DriverService } from './driver.service';
import { FleetManagerService } from './fleet-manager.service';
import { MdpService } from './mdp.service';
import { staffOf } from './staff-of';
import { VendorService } from './vendor.service';

/** Every role a person or an account signs in as. Staff and a company's administrators agree to nothing here. */
const SIGNED_IN = ['consumer', 'agent', 'driver', 'mdp', 'genesis', 'fleet_manager', 'business'] as const;

/** One line of a document as the console reads it: what is published, what waits, everything written. */
interface StaffLine {
  key: string;
  kind: DocumentKind;
  country?: string;
  path: string;
  current?: DocumentVersion;
  pending?: DocumentVersion;
  versions: DocumentVersion[];
}

/**
 * THE TERMS OF USE, WHAT HAPPENS TO PEOPLE'S DATA, AND COOKIES — read by anybody, written by staff, agreed to at every
 * sign-up (the user, 2026-10-25) — the general text, and each country's own (see foundation/documents).
 */
@Controller('sbg')
export class DocumentsController {
  constructor(
    private readonly documents: DocumentsService,
    private readonly agreements: AgreementService,
    @Optional() private readonly agents?: AgentService,
    @Optional() private readonly mdps?: MdpService,
    @Optional() private readonly vendors?: VendorService,
    @Optional() private readonly drivers?: DriverService,
    @Optional() private readonly managers?: FleetManagerService,
    @Optional() private readonly entities?: EntityService,
  ) {}

  /* ------------------------------------------------------------------- anybody -- */

  /** What a sign-up agrees to now — the general documents, and the country's own where it has any. */
  @Public()
  @Get('agreement')
  @ApiQuery({ name: 'country', required: false })
  agreementSet(@Query('country') country?: string): AgreementSet {
    const code = catalogueEntry(country)?.code;
    return { ...(code ? { country: code } : {}), documents: this.documents.agreementSet(code) };
  }

  /** A document as it reads now: the general text, or `?country=` a country's own. */
  @Public()
  @Get('documents/:kind')
  @ApiQuery({ name: 'country', required: false })
  document(@Param('kind') kind: string, @Query('country') country?: string): PublishedDocument {
    return this.documents.publicView(this.documents.current(this.documents.requireKind(kind), this.documents.requireCountry(country)));
  }

  /** The countries with a version of their own of this document, published: where the general page sends a reader on. */
  @Public()
  @Get('documents/:kind/countries')
  documentCountries(@Param('kind') kind: string): { items: Array<{ country: string; name: string; number: number; publishedAt: string; path: string }> } {
    const k = this.documents.requireKind(kind);
    const items = this.documents
      .countries()
      .map((country) => ({ country, current: this.documents.currentOrNone(k, country) }))
      .filter((c): c is { country: string; current: DocumentVersion } => Boolean(c.current))
      .map(({ country, current }) => ({ country, name: catalogueEntry(country)?.name ?? country, number: current.number!, publishedAt: current.publishedAt!, path: documentPath(k, country) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { items };
  }

  /** Every published version of a line, newest first: its number, date and what changed. */
  @Public()
  @Get('documents/:kind/history')
  @ApiQuery({ name: 'country', required: false })
  documentHistory(@Param('kind') kind: string, @Query('country') country?: string): { items: PublishedVersionLine[] } {
    return { items: this.documents.publicHistory(this.documents.requireKind(kind), this.documents.requireCountry(country)) };
  }

  /** One published version, word for word — what somebody agreed to, read back. */
  @Public()
  @Get('documents/:kind/versions/:number')
  @ApiQuery({ name: 'country', required: false })
  documentVersion(@Param('kind') kind: string, @Param('number', ParseIntPipe) number: number, @Query('country') country?: string): PublishedDocument {
    return this.documents.publicView(this.documents.published(this.documents.requireKind(kind), number, this.documents.requireCountry(country)));
  }

  /* ---------------------------------------------------------- the person signed in -- */

  /**
   * Where this sign-in stands: whether they must agree before going on, and to what — for the country they work in, or
   * `?country=` one they are about to sign something up in.
   */
  @Roles(...SIGNED_IN)
  @AtTheCounter()
  @Get('agreement/mine')
  @ApiQuery({ name: 'country', required: false })
  myAgreement(@Actor() actor: IntrospectionResult, @Query('country') country?: string): MyAgreement {
    return this.agreements.mine(actor, catalogueEntry(country)?.code ?? this.countryOf(actor));
  }

  /**
   * AGREE, after signing in — asked of somebody another person signed up (a fleet's driver, a counter colleague), of
   * everybody when a version published since asks them to agree again, and of everybody in a country that publishes
   * documents of its own.
   */
  @Roles(...SIGNED_IN)
  @AtTheCounter()
  @Post('agreement/mine')
  agree(@Body() dto: AgreementDto, @Actor() actor: IntrospectionResult): MyAgreement {
    const subjects = agreementSubjects(actor);
    if (!subjects.length) throw new GlosError('FORBIDDEN', 'Nothing to agree to from this sign-in');
    // The country they work in decides what they agree to; a person with no such record keeps the one they agreed for.
    const country = this.countryOf(actor) ?? this.agreements.latest(subjects)?.country ?? catalogueEntry(dto.country)?.code;
    this.agreements.recordIfNew(subjects, this.agreements.require(dto, country), `app:${actor.role}`, country);
    return this.agreements.mine(actor, country);
  }

  /* --------------------------------------------------------------------- staff -- */

  /**
   * Every line, with what is published, what is waiting, and every version written — the general documents first, then
   * each country with documents of its own — as the console reads them.
   */
  @Roles('operator')
  @Get('documents')
  staffDocuments(@Actor() actor: IntrospectionResult): { items: StaffLine[] } {
    const reader = actor?.actorName && actor.revocationKey ? { name: actor.actorName, key: actor.revocationKey } : undefined;
    const line = (kind: DocumentKind, country?: string): StaffLine | null => {
      const key = documentKey(kind, country);
      const counts = this.agreements.countsFor(key);
      const versions = this.documents.history(kind, country, reader).map((v) => (v.number ? { ...v, agreed: counts[v.number] ?? 0 } : v));
      if (!versions.length && country) return null;
      const current = this.documents.currentOrNone(kind, country);
      const pending = versions.find((v) => v.status === 'proposed');
      return {
        key,
        kind,
        ...(country ? { country } : {}),
        path: documentPath(kind, country),
        ...(current ? { current: { ...current, agreed: counts[current.number!] ?? 0 } } : {}),
        ...(pending ? { pending } : {}),
        versions,
      };
    };
    const general = DOCUMENT_KINDS.map((kind) => line(kind)!);
    const own = this.documents.countries().flatMap((country) => DOCUMENT_KINDS.map((kind) => line(kind, country)).filter((l): l is StaffLine => Boolean(l)));
    return { items: [...general, ...own] };
  }

  /** Write a new version — of the general text, or (`country`) of a country's own. It changes nothing until a different member of staff publishes it. */
  @Roles('operator')
  @Post('documents/:kind/versions')
  propose(@Param('kind') kind: string, @Body() dto: ProposeDocumentDto, @Actor() actor: IntrospectionResult): DocumentVersion {
    const who = staffOf(actor, dto.by);
    return this.documents.propose(this.documents.requireKind(kind), { title: dto.title, body: dto.body, changeNote: dto.changeNote, askAgain: dto.askAgain, country: dto.country }, who);
  }

  /** The second person publishes it: from now on it is what everybody it concerns reads, and agrees to — and they are told. */
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

  /**
   * THE COUNTRY A SIGN-IN WORKS IN — read off the record it signed in as: a shop's, a hub's, a store's, a courier's (or
   * their fleet's), a fleet's, a business's. A person in the Send app has no such record: their last agreement's country.
   */
  private countryOf(actor: IntrospectionResult | undefined): string | undefined {
    const did = actor?.did;
    if (!did) return undefined;
    try {
      switch (actor?.role) {
        case 'agent':
          return this.agents?.countryOf(this.agents.get(did));
        case 'mdp': {
          const hub = this.mdps?.list().find((m) => m.did === did);
          return hub ? this.mdps?.countryOf(hub) : undefined;
        }
        case 'genesis':
          return this.vendors?.byDid(did)?.country;
        case 'driver': {
          const driver = this.drivers?.get(did);
          return driver?.managerDid ? this.managers?.get(driver.managerDid).jurisdiction : driver?.jurisdiction;
        }
        case 'fleet_manager':
          return this.managers?.get(did).jurisdiction;
        case 'business':
          return actor?.tenant ? this.entities?.get(actor.tenant).jurisdiction : undefined;
        default:
          return undefined;
      }
    } catch {
      return undefined;
    }
  }
}
