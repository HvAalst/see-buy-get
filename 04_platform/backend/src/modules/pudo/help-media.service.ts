import { Inject, Injectable, Optional } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { GlosError } from '../../foundation/http/glos-error';
import { BlobStore, FsBlobStore } from '../../foundation/media/blob-store';
import { decodeImage } from '../../foundation/media/decode-image';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { loadBuiltins, readBuiltin } from './help-builtins';

/** Where the house set is read from. Nothing registers this token in the app — it exists so the directory
 *  can be OVERRIDDEN (a test, a deployment shipping no drawings) without the container being asked to
 *  resolve a `String`, which is what an optional primitive constructor parameter quietly demands. */
export const HELP_BUILTIN_DIR = 'HELP_BUILTIN_DIR';
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
  // Durable: which option this DEPLOYMENT has its own picture for. The bytes live in the blob store beside it.
  private readonly images = new PersistentMap<string, HelpImage>('pudo-help-images');
  private readonly blobs: BlobStore = new FsBlobStore();

  /**
   * The house set, scanned once at construction.
   *
   * Read from disk at startup rather than per request: these files ship with the build and cannot change
   * under a running process, and a picker sheet should not pay a filesystem walk to open.
   */
  private readonly builtins: ReturnType<typeof loadBuiltins>;

  /**
   * `builtinDir` is for tests and for a deployment that ships no house set at all — a state the design
   * explicitly supports (the sheets fall back to their words). It exists as a parameter because the shipped
   * set is now COMPLETE: with every option drawn there is no longer a real key left over to exercise the
   * un-illustrated path with, and a behaviour nothing can reach is a behaviour nobody notices breaking.
   *
   * `@Optional() @Inject` rather than a bare optional parameter, and the difference is not cosmetic: a bare
   * `builtinDir?: string` makes the DI container read the emitted design:paramtypes metadata, find `String`,
   * and try to resolve a provider for it — which fails at BOOT, in a service every picker depends on. A
   * spec that constructs the class by hand never touches the container and so never sees it.
   */
  constructor(@Optional() @Inject(HELP_BUILTIN_DIR) builtinDir?: string) {
    this.builtins = loadBuiltins(builtinDir);
  }

  private static id(topic: HelpTopic, key: string): string {
    return `${topic}:${key}`;
  }

  /**
   * Every option of a topic, each with its picture and where that picture came from.
   *
   * Two layers resolve here, and this is the only place that knows there are two: the deployment's own
   * upload wins, the house set fills in behind it, and an option with neither is still returned so the
   * caller can offer it. The apps render `imageUrl` and never learn which layer answered.
   *
   * Returns the FULL vocabulary rather than only the illustrated part — the admin grid renders exactly
   * this, and the un-illustrated slots ARE its to-do list.
   */
  topic(topic: HelpTopic): HelpTopicView {
    return {
      topic,
      options: HELP_TOPIC_KEYS[topic].map((key) => {
        const own = this.images.get(HelpMediaService.id(topic, key));
        const house = this.builtins.get(HelpMediaService.id(topic, key));
        // Cache-busted either way — by the blob id, which rotates on every replace, or by the house
        // drawing's content hash. An admin who fixes a wrong picture must not be overruled for a month by
        // every phone that already cached the old one under the same URL.
        const version = own?.blobId ?? house?.version;
        if (!version) return { key };
        return {
          key,
          imageUrl: `/v1/sbg/help/${topic}/${key}/image?v=${version}`,
          source: own ? ('deployment' as const) : ('builtin' as const),
          updatedAt: own?.updatedAt, // a house drawing has no local history to report
        };
      }),
    };
  }

  /** The bytes behind one option's picture — the deployment's if it has one, otherwise the house set's. */
  image(topic: HelpTopic, key: string): { bytes: Buffer; contentType: string } {
    const own = this.images.get(HelpMediaService.id(topic, key));
    if (own) {
      const bytes = this.blobs.get(own.blobId);
      if (bytes) return { bytes, contentType: own.contentType };
      // The record survived but its bytes did not. Fall through to the house drawing rather than 404 —
      // a picture that exists is better than the right error.
    }
    const house = this.builtins.get(HelpMediaService.id(topic, key));
    const bytes = house ? readBuiltin(house) : undefined;
    if (!house || !bytes) throw new GlosError('NOT_FOUND', 'No illustration has been set for this option');
    return { bytes, contentType: house.contentType };
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

  /**
   * Remove THIS DEPLOYMENT's illustration for an option.
   *
   * It reverts to the house drawing where there is one, and to text alone where there is not — it never
   * deletes the option, and it cannot touch the house set, which is shipped read-only with the build.
   */
  remove(topic: HelpTopic, key: string): { removed: boolean } {
    const id = HelpMediaService.id(topic, key);
    const img = this.images.get(id);
    if (!img) return { removed: false }; // idempotent: deleting nothing is not an error
    this.images.delete(id);
    this.blobs.delete(img.blobId);
    return { removed: true };
  }
}
