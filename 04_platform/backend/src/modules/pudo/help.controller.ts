import { Body, Controller, Delete, Get, Header, Param, Put, StreamableFile } from '@nestjs/common';
import { Actor } from '../../foundation/auth/actor.decorator';
import { auditActor } from '../../foundation/auth/acting';
import { IntrospectionResult } from '../../foundation/auth/auth.types';
import { Public } from '../../foundation/auth/public.decorator';
import { Roles } from '../../foundation/auth/scopes.decorator';
import { GlosError } from '../../foundation/http/glos-error';
import { HelpMediaService } from './help-media.service';
import { HelpTopic, HelpTopicView, isHelpTopic } from './help.types';
import { PutHelpImageDto } from './pudo.dto';

/**
 * Help illustrations — the pictures behind the `i` on a picker.
 *
 * READS ARE @Public AND CACHEABLE, which is the opposite of every other image endpoint here. A help picture
 * is published reference material, not somebody's evidence: it names no person, belongs to no shipment, and
 * a shop clerk mid-booking must not be blocked on a token refresh to find out what "palletised" looks like.
 * The public market page (FB3b) serves strangers on the same principle.
 *
 * WRITES ARE OPERATOR-ONLY. An illustration is the network telling everybody what a word means, so it is
 * exactly as trusted as the network — a shop that could replace "flatbed" with a picture of something else
 * could quietly redefine what every other shop is booking.
 */
@Controller('sbg/help')
export class HelpController {
  constructor(private readonly help: HelpMediaService) {}

  /** Reject an unknown topic HERE rather than letting it reach a lookup that would answer with an empty
   *  list — "no options" and "no such vocabulary" are different answers and a client must be able to tell. */
  private topicOf(raw: string): HelpTopic {
    if (!isHelpTopic(raw)) throw new GlosError('NOT_FOUND', `No such help topic: ${raw}`);
    return raw;
  }

  /**
   * Every option of one vocabulary, with the picture where one is curated.
   *
   * The whole topic in one request, deliberately: a picker needs all of it to render, and the "not sure"
   * sheet shows every option side by side. One request per option would make that sheet a waterfall on the
   * exact connection least able to afford it.
   */
  @Public()
  @Get(':topic')
  topic(@Param('topic') topic: string): HelpTopicView {
    return this.help.topic(this.topicOf(topic));
  }

  /**
   * One option's illustration bytes.
   *
   * PUBLIC and immutable-cacheable: the URL carries the blob id as `?v=`, so a replaced picture is a new URL
   * and the old one can be cached hard without ever going stale. nosniff because these bytes are served to
   * a browser — the upload path already refuses anything whose magic number is not a real raster image.
   */
  @Public()
  @Get(':topic/:key/image')
  @Header('Cache-Control', 'public, max-age=31536000, immutable')
  @Header('X-Content-Type-Options', 'nosniff')
  image(@Param('topic') topic: string, @Param('key') key: string): StreamableFile {
    const { bytes, contentType } = this.help.image(this.topicOf(topic), key);
    return new StreamableFile(bytes, { type: contentType });
  }

  /** Set or replace one option's illustration. Operator-only — see the class note. */
  @Roles('operator')
  @Put(':topic/:key/image')
  put(@Param('topic') topic: string, @Param('key') key: string, @Body() dto: PutHelpImageDto, @Actor() actor: IntrospectionResult) {
    const img = this.help.put({ topic: this.topicOf(topic), key, dataUrl: dto.dataUrl, actor: auditActor(actor) });
    return { topic: img.topic, key: img.key, updatedAt: img.updatedAt, size: img.size };
  }

  /** Remove one option's illustration. The option stays; its sheet falls back to text alone. */
  @Roles('operator')
  @Delete(':topic/:key/image')
  remove(@Param('topic') topic: string, @Param('key') key: string) {
    return this.help.remove(this.topicOf(topic), key);
  }
}
