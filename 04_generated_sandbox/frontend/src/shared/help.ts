// The admin-curated illustrations behind the `i` on a picker.
//
// The pictures are fetched from the network (an SBG admin curates them per deployment — a flatbed does not
// look the same in Nakuru as in a European stock photo), while the WORDS stay in the i18n catalogs where
// every other string in this product lives. So this module knows about images and nothing about text.

import { publicRequest, type SbgConfig } from '../lib/sbg';

/** The four vocabularies where the right answer is RECOGNISED rather than known. Mirrors backend HELP_TOPICS. */
export type HelpTopic = 'packaging' | 'body' | 'equipment' | 'nature';

export interface HelpOption {
  key: string;
  /** A path on the API, absent until an admin curates one. Resolve with helpImageSrc(). */
  imageUrl?: string;
  updatedAt?: string;
}

export interface HelpTopicView {
  topic: HelpTopic;
  options: HelpOption[];
}

/**
 * One in-flight or settled fetch per topic, for the life of the page.
 *
 * The pictures change when an admin edits them, which is approximately never, and every booking opens the
 * same sheet. Re-fetching per open would spend a phone's data on an answer that did not change; caching the
 * PROMISE (not the result) also means two pickers opening at once share one request rather than racing.
 */
const cache = new Map<HelpTopic, Promise<HelpTopicView | null>>();

/**
 * The options of one topic with their pictures.
 *
 * Resolves to `null` rather than throwing when the network is unreachable — help is help. A clerk with no
 * signal still has to book the freight, and a sheet that shows its text without its pictures is a smaller
 * failure than a picker that will not open. The failed promise is dropped from the cache so the next open
 * tries again.
 */
export function fetchHelpTopic(config: SbgConfig, topic: HelpTopic): Promise<HelpTopicView | null> {
  const hit = cache.get(topic);
  if (hit) return hit;
  const p = publicRequest<HelpTopicView>(config, `/v1/sbg/help/${topic}`)
    .then((r) => (r.error ? null : (r.data ?? null)))
    .catch(() => null)
    .then((v) => {
      if (v === null) cache.delete(topic); // a failure must not be cached as "there are no pictures"
      return v;
    });
  cache.set(topic, p);
  return p;
}

/** The absolute URL for one option's picture. The server's path already carries the cache-busting `?v=`. */
export function helpImageSrc(config: SbgConfig, imageUrl: string): string {
  return `${config.baseUrl}${imageUrl}`;
}

/** Forget everything fetched — for tests, and for an admin previewing their own edit without a reload. */
export function clearHelpCache(): void {
  cache.clear();
}
