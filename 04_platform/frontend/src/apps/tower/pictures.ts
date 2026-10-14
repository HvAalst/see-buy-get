import type { MessageKey } from '../../shared/i18n';

/**
 * The illustration library, as the console reasons about it.
 *
 * A drawing of "a flatbed" is a claim about what trucks look like HERE, and the deployment is what
 * knows: the vehicle that means flatbed in Nakuru is not the one a European catalogue shows. The network
 * ships the vocabulary and a house drawing for each option; the operator supplies the local truth.
 *
 * Everything in this file exists to keep THREE states apart, because two would make the buttons lie.
 */

export interface HelpOption {
  key: string;
  /** Path on the API (not a full URL) — the console prefixes it with the API origin. */
  imageUrl?: string;
  /** 'builtin' is the drawing that ships with the network; 'deployment' is this operator's own. */
  source?: 'builtin' | 'deployment' | string;
  updatedAt?: string;
}

export interface HelpTopic {
  key: string;
  labelKey: MessageKey;
  hintKey: MessageKey;
}

/**
 * The four vocabularies a person has to CHOOSE from — the ones whose options are recognised rather than
 * known. The labels are the operator's own words for the topic; the option KEYS come from the server,
 * which reads them off the canonical lists, so this console can never offer to illustrate an option that
 * no longer exists.
 */
export const HELP_TOPICS: HelpTopic[] = [
  { key: 'packaging', labelKey: 'tower.pictures.topic.packaging', hintKey: 'tower.pictures.topic.packagingHint' },
  { key: 'body', labelKey: 'tower.pictures.topic.body', hintKey: 'tower.pictures.topic.bodyHint' },
  { key: 'equipment', labelKey: 'tower.pictures.topic.equipment', hintKey: 'tower.pictures.topic.equipmentHint' },
  { key: 'nature', labelKey: 'tower.pictures.topic.nature', hintKey: 'tower.pictures.topic.natureHint' },
];

/**
 * THREE states, not two, and the difference decides what a button may honestly promise.
 *
 *  - OWNED     this operator uploaded it. It can be replaced, and it can be taken back — and taking it
 *              back reveals the network's drawing again rather than blanking the option.
 *  - NETWORK   the house drawing that shipped with the build. It can be overridden, never deleted from
 *              here: it is not this deployment's to remove.
 *  - MISSING   nobody has drawn this one. A NORMAL state, not a fault — the picker falls back to the
 *              words — and the empty slots are the to-do list.
 */
export function pictureState(option: HelpOption): {
  owned: boolean;
  provenanceKey: MessageKey;
  params?: Record<string, string | number>;
  uploadKey: MessageKey;
} {
  if (option.source === 'deployment') {
    return {
      owned: true,
      provenanceKey: 'tower.pictures.yours',
      params: { when: option.updatedAt ? new Date(option.updatedAt).toLocaleDateString() : '—' },
      uploadKey: 'tower.pictures.replace',
    };
  }
  if (option.imageUrl) return { owned: false, provenanceKey: 'tower.pictures.networks', uploadKey: 'tower.pictures.useOwn' };
  return { owned: false, provenanceKey: 'tower.pictures.none', uploadKey: 'tower.pictures.upload' };
}

/**
 * How much of this vocabulary is illustrated, and how much of it is the operator's own work.
 *
 * Two numbers rather than a percentage: "17 of 24" is a to-do list, and "71%" is a score. This screen is
 * a list of things somebody might still draw, not a mark out of ten.
 */
export function illustrationStat(options: HelpOption[]): { total: number; illustrated: number; mine: number } {
  return {
    total: options.length,
    illustrated: options.filter((o) => Boolean(o.imageUrl)).length,
    mine: options.filter((o) => o.source === 'deployment').length,
  };
}
