import { Body, Controller, Get, HttpCode, Param, Post, Res, StreamableFile, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { Actor } from '../../foundation/auth/actor.decorator';
import { IntrospectionResult } from '../../foundation/auth/auth.types';
import { Public } from '../../foundation/auth/public.decorator';
import { RateLimit, RateLimitGuard } from '../../foundation/http/rate-limit.guard';
import { DocumentLinkService } from './document-link.service';
import { DocumentLinkList, DocumentLinkRow, DocumentLinkTokenDto, DocumentLinkView } from './document-link.types';

/**
 * A LINK TO A DOCUMENT, from both ends.
 *
 * Whoever holds the email opens it with nobody signed in: two public routes, and the key travels in the request's
 * BODY — a key in an address is a key in every log that address passes through. Both are limited per caller, like
 * everything else here a stranger can ask for; guessing a key is hopeless long before the limit matters, and the
 * limit is there for the one thing a real key can be used for a thousand times: making this server build a file.
 *
 * The party the link was made for sees it on the document, signed in, and can cancel it.
 */
@Controller('sbg')
export class DocumentLinkController {
  constructor(private readonly links: DocumentLinkService) {}

  /** What this link is, before the file is taken: what it opens and until when — or which way it stopped. */
  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit(60, 15 * 60)
  @Post('document-links/look')
  @HttpCode(200)
  look(@Body() dto: DocumentLinkTokenDto): DocumentLinkView {
    return this.links.look(dto.token);
  }

  /** The file: the note, every copy of it and its photographs, as the party the link was made for may read them. */
  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit(20, 15 * 60)
  @Post('document-links/fetch')
  @HttpCode(200)
  fetch(@Body() dto: DocumentLinkTokenDto, @Res({ passthrough: true }) res: Response): StreamableFile {
    const file = this.links.fetch(dto.token);
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    return new StreamableFile(file.bytes, { type: 'application/zip' });
  }

  /** The links made for the caller on one of their documents. */
  @Get('consignment-notes/:docId/links')
  list(@Param('docId') docId: string, @Actor() actor: IntrospectionResult): DocumentLinkList {
    return { items: this.links.listFor(docId, actor) };
  }

  /** Cancel one: it opens nothing from now on. */
  @Post('consignment-notes/:docId/links/:linkId/cancel')
  @HttpCode(200)
  cancel(@Param('docId') docId: string, @Param('linkId') linkId: string, @Actor() actor: IntrospectionResult): DocumentLinkRow {
    return this.links.cancel(docId, linkId, actor);
  }
}
