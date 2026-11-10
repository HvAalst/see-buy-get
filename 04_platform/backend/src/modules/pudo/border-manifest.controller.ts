import { Body, Controller, Get, Header, Param, Post, UseGuards } from '@nestjs/common';
import { Actor } from '../../foundation/auth/actor.decorator';
import { IntrospectionResult } from '../../foundation/auth/auth.types';
import { Roles, SignedIn } from '../../foundation/auth/scopes.decorator';
import { GlosError } from '../../foundation/http/glos-error';
import { BorderManifestService } from './border-manifest.service';
import { BorderManifestStatus, ManifestReferences, ManifestReferencesDto, ManifestVersionRow } from './border-manifest.types';
import { BusinessMemberGuard } from './business-member.guard';
import { BusinessService } from './business.service';
import { carrierReadsInvoice } from './commercial-invoice.service';
import { ConsignmentNoteService } from './consignment-note.service';
import type { Freight } from './dispatch.types';

/** What anybody but the shipper is told at the door that gives the customs numbers. */
const SHIPPER_ONLY = 'The customs numbers on a border manifest are given by the business that sent the goods, or its clearing agent: staff and carriers read them';
const NOT_YOURS_TO_READ = 'The border manifest names the goods and their value: the sender reads it, and on the carrier’s side the driver carrying the load from pickup on.';

/**
 * 2026-11-10 — THE BORDER MANIFEST OF A LOAD BETWEEN KENYA AND ETHIOPIA (border-manifest.types.ts). Read as the commercial
 * invoice is — it carries the invoice's lines and values: the sender and staff always, on the carrier's side the driver
 * carrying the load, from pickup on; anybody else on the load is told whether it is complete, and no more. Its customs
 * numbers are written by the business that posted the load, and by nobody else.
 */
@Controller('sbg')
@UseGuards(BusinessMemberGuard)
export class BorderManifestController {
  constructor(
    private readonly manifests: BorderManifestService,
    private readonly notes: ConsignmentNoteService,
    private readonly businesses: BusinessService,
  ) {}

  /** Whether the load needs one, what it still lacks and whose that is, its customs numbers and its frozen copies. */
  @SignedIn()
  @Get('dispatch/freight/:id/border-manifest')
  status(@Param('id') id: string, @Actor() actor: IntrospectionResult): BorderManifestStatus {
    const f = this.notes.requireReader(id, actor);
    return this.manifests.status(f, { mayWrite: this.mayWrite(f, actor), withheld: !this.reads(f, actor) });
  }

  /** The copies frozen so far, each with its fingerprint. */
  @SignedIn()
  @Get('dispatch/freight/:id/border-manifest/versions')
  versions(@Param('id') id: string, @Actor() actor: IntrospectionResult): ManifestVersionRow[] {
    const f = this.notes.requireReader(id, actor);
    if (!this.reads(f, actor)) throw new GlosError('FORBIDDEN', NOT_YOURS_TO_READ);
    return this.manifests.versionRows(f.freightId);
  }

  /** The manifest as a printable page: the latest frozen copy, or before pickup a preview that says it is one. */
  @SignedIn()
  @Get('dispatch/freight/:id/border-manifest.html')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'private, no-store')
  page(@Param('id') id: string, @Actor() actor: IntrospectionResult): string {
    const f = this.notes.requireReader(id, actor);
    if (!this.reads(f, actor)) throw new GlosError('FORBIDDEN', NOT_YOURS_TO_READ);
    const current = this.manifests.current(f.freightId);
    if (!current) throw new GlosError('NOT_FOUND', 'Only a load between Kenya and Ethiopia has a border manifest');
    return this.manifests.htmlFor(current.doc, current.fingerprint);
  }

  /**
   * The customs numbers the sender or its clearing agent was given: the export side's before pickup, the import side's
   * before the post. The business that posted the load, by a member who may act; staff are refused by name, because a
   * staff sign-in passes every role check.
   */
  @Roles('business')
  @Post('dispatch/freight/:id/border-manifest/references')
  references(@Param('id') id: string, @Body() dto: ManifestReferencesDto, @Actor() actor: IntrospectionResult): ManifestReferences {
    if (actor?.role !== 'business') throw new GlosError('FORBIDDEN', SHIPPER_ONLY);
    const f = this.notes.requireReader(id, actor);
    const acting = this.businesses.requireMember(actor);
    if (!this.notes.isShipper(f, acting.entity.did) || !this.businesses.mayAct(acting)) throw new GlosError('FORBIDDEN', SHIPPER_ONLY);
    return this.manifests.setReferences(f, `${acting.member.name}, for ${acting.entity.name}`, dto);
  }

  private reads(f: Freight, actor: IntrospectionResult | undefined): boolean {
    if (actor?.role === 'operator') return true;
    if (actor?.did && this.notes.isShipper(f, actor.did)) return true;
    return carrierReadsInvoice(f, actor?.did);
  }

  private mayWrite(f: Freight, actor: IntrospectionResult | undefined): boolean {
    if (actor?.role !== 'business') return false;
    try {
      const acting = this.businesses.requireMember(actor);
      return this.businesses.mayAct(acting) && this.notes.isShipper(f, acting.entity.did) && f.status !== 'delivered' && f.status !== 'cancelled';
    } catch {
      return false;
    }
  }
}
