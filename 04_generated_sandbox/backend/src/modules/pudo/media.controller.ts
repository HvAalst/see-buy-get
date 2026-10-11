import { Body, Controller, Delete, Get, Header, Param, Post, Query, StreamableFile } from '@nestjs/common';
import { Actor } from '../../foundation/auth/actor.decorator';
import { actingDid, auditActor } from '../../foundation/auth/acting';
import { IntrospectionResult } from '../../foundation/auth/auth.types';
import { SignedIn } from '../../foundation/auth/scopes.decorator';
import { GlosError } from '../../foundation/http/glos-error';
import { MediaService } from './media.service';
import { UploadMediaDto } from './pudo.dto';

/**
 * Media (S26) — real image upload, gated retrieval and a per-owner library. The bytes never touch the
 * JSON core; they live in a BlobStore keyed by a MediaRef. Access is owner-or-operator: every media a
 * counterparty is allowed to see (e.g. the receiver's own PoD) was uploaded by that same party, so the
 * owner check covers it without MediaService ever reaching into ParcelService. Cache-Control is private +
 * no-store because a delivery photo can hold faces, addresses and IDs.
 *
 * Ownership binds to the VERIFIED token DID (actingDid), never the self-asserted `sub` an audit label
 * would accept: a bare client_credentials token cannot claim to own — or read/delete — another user's
 * media. Operators (maximally trusted, client-secret gated) are the one exception, allowed through by role.
 */
@Controller('sbg/media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  private isOperator(actor: IntrospectionResult): boolean {
    return actor?.role === 'operator';
  }

  /** The verified owner principal. A non-operator is pinned to actor.did (actingDid throws on a bare token
   *  with no verified DID); an operator keeps its audit label (it acts on behalf, gated by client secret). */
  private owner(actor: IntrospectionResult): string {
    return this.isOperator(actor) ? auditActor(actor) : actingDid(actor);
  }

  /** Upload one downscaled image (+ optional thumbnail). The owner is the authenticated caller. */
  @SignedIn()
  @Post()
  upload(@Body() dto: UploadMediaDto, @Actor() actor: IntrospectionResult) {
    return this.media.upload({ ownerDid: this.owner(actor), kind: dto.kind, dataUrl: dto.dataUrl, thumbDataUrl: dto.thumbDataUrl });
  }

  /** The caller's own media — the source for the media library (S27). PII-free projection. */
  @SignedIn()
  @Get()
  mine(@Actor() actor: IntrospectionResult) {
    return this.media.listForOwner(this.owner(actor));
  }

  /** Stream one image's bytes (or its thumbnail via ?variant=thumb). Owner-or-operator only. */
  @SignedIn()
  @Get(':id')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  fetch(@Param('id') id: string, @Query('variant') variant: string | undefined, @Actor() actor: IntrospectionResult): StreamableFile {
    const ref = this.media.get(id);
    if (!ref) throw new GlosError('NOT_FOUND', 'No such media');
    // A non-operator caller must present a verified DID; actingDid throws (403) for a self-asserted token.
    if (!this.media.viewableBy(ref, this.isOperator(actor) ? ref.ownerDid : actingDid(actor), this.isOperator(actor))) {
      throw new GlosError('FORBIDDEN', 'This media is not yours to view');
    }
    const { bytes, contentType } = this.media.blob(id, variant === 'thumb' ? 'thumb' : 'full');
    return new StreamableFile(bytes, { type: contentType });
  }

  /** Remove one of your own asset images early (vehicle/trailer only — evidence bins stay locked). */
  @SignedIn()
  @Delete(':id')
  remove(@Param('id') id: string, @Actor() actor: IntrospectionResult) {
    this.media.removeByOwner(id, this.owner(actor));
    return { removed: true };
  }
}
