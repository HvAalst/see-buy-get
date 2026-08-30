import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { GlosError } from '../../foundation/http/glos-error';
import { BlobStore, FsBlobStore } from '../../foundation/media/blob-store';
import { decodeImage } from '../../foundation/media/decode-image';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { HELP_IMAGE_MAX_BYTES, HELP_TOPIC_KEYS, HelpImage, HelpTopic, HelpTopicView, isHelpKey } from './help.types';

/**
 * The registry of admin-curated illustrations, one per option of the four choosable vocabularies.
 *
 * Its own service (and its own blob namespace) rather than a MediaKind, because a help picture inverts all
 * three rules MediaService exists to enforce: it is PUBLIC where media is owner-gated, PERMANENT where media
 * is swept, and it belongs to the NETWORK where media belongs to whoever uploaded it. Bolting three
 * exemptions onto the private-photo rail is how a private-photo rail stops being private.
 */
@Injectable()
export class HelpMediaService {
  // Durable: which option has which picture. The bytes live in the blob store beside it.
  private readonly images = new PersistentMap<string, HelpImage>('pudo-help-images');
  private readonly blobs: BlobStore = new FsBlobStore();

  private static id(topic: HelpTopic, key: string): string {
    return `${topic}:${key}`;
  }

  /**
   * Every option of a topic, each with its picture if one has been curated.
   *
   * Returns the FULL vocabulary, not just the illustrated part — an option with no picture is a normal
   * state (nobody has drawn it yet), and the caller needs to know it exists in order to offer it. It is also
   * exactly what the admin grid renders: the empty slots ARE the to-do list.
   */
  topic(topic: HelpTopic): HelpTopicView {
    return {
      topic,
      options: HELP_TOPIC_KEYS[topic].map((key) => {
        const img = this.images.get(HelpMediaService.id(topic, key));
        return {
          key,
          // Cache-busted by the blob id, which is rotated on every replace: an admin who fixes a wrong
          // picture must not have the old one served back from a phone's cache for the next month.
          imageUrl: img ? `/v1/sbg/help/${topic}/${key}/image?v=${img.blobId}` : undefined,
          updatedAt: img?.updatedAt,
        };
      }),
    };
  }

  /** The bytes behind one option's picture. Throws NOT_FOUND when nothing has been curated for it. */
  image(topic: HelpTopic, key: string): { bytes: Buffer; contentType: string } {
    const img = this.images.get(HelpMediaService.id(topic, key));
    if (!img) throw new GlosError('NOT_FOUND', 'No illustration has been set for this option');
    const bytes = this.blobs.get(img.blobId);
    if (!bytes) throw new GlosError('NOT_FOUND', 'The illustration bytes are unavailable');
    return { bytes, contentType: img.contentType };
  }

  /**
   * Set or replace one option's illustration.
   *
   * The old blob is deleted only AFTER the new one is written and the record is switched, so a failed
   * upload leaves the previous picture intact rather than leaving the option blank. Losing a curated image
   * because a replacement was malformed would be a bad trade for the admin who made one typo.
   */
  put(input: { topic: HelpTopic; key: string; dataUrl: string; actor: string }): HelpImage {
    if (!isHelpKey(input.topic, input.key)) {
      throw new GlosError('INVALID_INPUT', `${input.key} is not an option of ${input.topic}`);
    }
    const { contentType, bytes } = decodeImage(input.dataUrl, HELP_IMAGE_MAX_BYTES);

    const id = HelpMediaService.id(input.topic, input.key);
    const previous = this.images.get(id);
    const blobId = `help_${randomBytes(12).toString('hex')}`;
    this.blobs.put(blobId, bytes);

    const next: HelpImage = {
      topic: input.topic,
      key: input.key,
      blobId,
      contentType,
      size: bytes.length,
      updatedBy: input.actor,
      updatedAt: new Date().toISOString(),
    };
    this.images.set(id, next);
    if (previous) this.blobs.delete(previous.blobId); // only now — the switch has already succeeded
    return next;
  }

  /** Remove an option's illustration. The option itself remains; its sheet falls back to text alone. */
  remove(topic: HelpTopic, key: string): { removed: boolean } {
    const id = HelpMediaService.id(topic, key);
    const img = this.images.get(id);
    if (!img) return { removed: false }; // idempotent: deleting nothing is not an error
    this.images.delete(id);
    this.blobs.delete(img.blobId);
    return { removed: true };
  }
}
