import { RETENTION_DAYS } from './media.types';

/**
 * HOW LONG WE KEEP IT, SAID OUT LOUD.
 *
 * A retention policy nobody is told is worse than a short one: silence on a screen that shows a document
 * reads as "for ever", and this network's silence was hiding an actual contradiction — the note kept
 * indefinitely, the photographs behind it swept at ninety days. Somebody exporting a note in month four
 * would have got a document referring to proof that no longer existed.
 *
 * THE SPLIT WE KEEP, AND WHY. The words are a couple of kilobytes and carry almost no privacy load, so the
 * document is kept and not timed out. The photographs are the storage cost and the real exposure, so they
 * go on the clock the media bins already run. That resolves the contradiction honestly rather than by
 * shortening the record.
 *
 * AND THE NUMBER THAT MATTERS ISN'T OURS. Under the CMR (Art. 32) a claim arising out of a carriage can be
 * brought for a year — three where wilful misconduct is alleged. Our shipment-proof bin is ninety days. So
 * for most of the period in which somebody can still sue, the photographs will already be gone. That is
 * not a bug to be fixed by keeping everything for ever; it is a fact to TELL the parties, with the export
 * in the same sentence, because the copy they keep is the one that will still exist.
 *
 * What a country requires of the PARTIES is theirs, not ours — fiscal retention runs to five, seven or ten
 * years depending on where they file, and inventing a table of other people's tax law would be a worse
 * answer than pointing plainly at the export.
 */

/** CMR Art. 32 — the ordinary limitation period on a claim arising out of a carriage. */
export const CLAIM_WINDOW_DAYS = 365;
/** The long one, where wilful misconduct (or its local equivalent) is alleged. */
export const WILFUL_MISCONDUCT_DAYS = 3 * 365;

const DAY_MS = 86_400_000;

export interface RetentionStatement {
  /** The note itself. Kept — the words are cheap and the record is the product. */
  document: 'indefinite';
  /** Days the photographs behind it are kept, counted from the moment the load finished. */
  evidenceDays: number;
  /** When the photographs go. Absent while the load is still open — the clock has not started. */
  evidenceUntil?: string;
  /** When the CMR's ordinary limitation period runs out on this carriage. */
  claimWindowUntil?: string;
  /**
   * Set when the photographs go BEFORE a claim could still be brought, which is the ordinary case. The
   * date a party should have their own copy by — and the whole reason the export exists.
   */
  exportBefore?: string;
}

/**
 * The statement for one load.
 *
 * `finishedAt` is the moment the load became terminal — delivered, or given back. A claim moves the
 * photographs onto the longer case clock, exactly as the media service does, so the statement and the
 * sweeper never disagree about the same date.
 */
export function retentionFor(input: { finishedAt?: string; hasClaim?: boolean }): RetentionStatement {
  const evidenceDays = RETENTION_DAYS[input.hasClaim ? 'dispute-evidence' : 'shipment-proof'];
  const finished = input.finishedAt ? Date.parse(input.finishedAt) : NaN;
  if (!Number.isFinite(finished)) return { document: 'indefinite', evidenceDays };

  const evidenceUntil = new Date(finished + evidenceDays * DAY_MS).toISOString();
  const claimWindowUntil = new Date(finished + CLAIM_WINDOW_DAYS * DAY_MS).toISOString();
  return {
    document: 'indefinite',
    evidenceDays,
    evidenceUntil,
    claimWindowUntil,
    ...(Date.parse(evidenceUntil) < Date.parse(claimWindowUntil) ? { exportBefore: evidenceUntil } : {}),
  };
}

/** The same statement as the sentence the printed note carries in its footer. */
export function retentionWords(s: RetentionStatement): string {
  const base = `This note is kept for as long as the network runs. The photographs behind it are kept ${s.evidenceDays} days after the load is finished`;
  if (!s.evidenceUntil) return `${base}.`;
  const day = (iso: string): string => iso.slice(0, 10);
  if (!s.exportBefore) return `${base} — until ${day(s.evidenceUntil)}.`;
  return `${base} — until ${day(s.evidenceUntil)}. A claim under the CMR can be brought until ${day(s.claimWindowUntil as string)}, so keep your own copy of this note and its photographs before ${day(s.exportBefore)}.`;
}
