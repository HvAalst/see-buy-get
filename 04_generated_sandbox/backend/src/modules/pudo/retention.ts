import { RETENTION_DAYS } from './media.types';

/**
 * HOW LONG WE KEEP IT, SAID OUT LOUD.
 *
 * A retention policy nobody is told is worse than a short one: silence on a screen that shows a document
 * reads as "for ever", and this network's silence was hiding an actual contradiction — the note kept
 * indefinitely, the photographs behind it swept at ninety days. Somebody exporting a note in month four
 * would have got a document referring to proof that no longer existed.
 *
 * THREE LIFETIMES, AND THE DIFFERENCE BETWEEN THEM IS THE WHOLE DESIGN.
 *
 *   THE PHOTOGRAPHS go first, on the clock the media bins already run (90 days, or 180 once a claim makes
 *   them a case file). They are the storage cost and the real privacy exposure.
 *
 *   THE DOCUMENT goes at a year. Not for space — a frozen copy measures about 1.5 KB, so a million of
 *   them is a gigabyte and a half — but for MINIMISATION. Holding other companies' commercial records
 *   indefinitely is breach surface, discovery exposure, and a standing answer to a question we would
 *   rather not be the answer to. Every party is told the date, warned before it, and given the export.
 *
 *   THE PROOF NEVER GOES. See NoteProof: the fingerprint of each copy, and nothing about the parties,
 *   the route, the goods or the money. It is what lets us still answer "is this the document you issued"
 *   years after we deleted the document, which is the neutral-third-party function a consignment note
 *   depends on and the only part worth keeping for ever.
 *
 * WHY A YEAR, EXACTLY. Under the CMR (Art. 32) a claim arising out of a carriage can be brought for one
 * year — three where wilful misconduct is alleged. So the document's life is set to the ordinary
 * limitation period on purpose: WE NEVER DELETE INSIDE THE WINDOW IN WHICH SOMEBODY CAN STILL SUE ON IT.
 * A shorter clock would be defensible only once delivery to the party's own storage is automatic, because
 * a policy that depends on a human remembering to download a ZIP is a policy that destroys evidence.
 *
 * The photographs still go long before that, and the gap between the two IS the thing to tell people:
 * ninety days of evidence against a year of liability. Stated on the document, with the export beside it.
 *
 * What a country requires of the PARTIES is theirs, not ours — fiscal retention runs to five, seven or ten
 * years depending on where they file, and inventing a table of other people's tax law would be a worse
 * answer than pointing plainly at the export.
 */

/** CMR Art. 32 — the ordinary limitation period on a claim arising out of a carriage. */
export const CLAIM_WINDOW_DAYS = 365;
/** The long one, where wilful misconduct (or its local equivalent) is alleged. */
export const WILFUL_MISCONDUCT_DAYS = 3 * 365;

/**
 * How long the document itself is kept after the load finishes. Decided 2026-09-28: twelve months.
 *
 * Deliberately EQUAL to the claim window rather than merely near it — the two numbers are the same fact,
 * and a future edit that shortens one should have to look at the other. The override exists for a
 * jurisdiction or a customer that needs longer; nothing in the product shortens it at runtime.
 */
export const DOCUMENT_RETENTION_DAYS = Math.max(CLAIM_WINDOW_DAYS, Number(process.env.GLOS_DOC_RETENTION_DAYS ?? CLAIM_WINDOW_DAYS));

/** How long before the document goes we start saying so out loud. */
export const WARN_BEFORE_DAYS = 30;

const DAY_MS = 86_400_000;

export interface RetentionStatement {
  /** Days the document is kept after the load finished. */
  documentDays: number;
  /** When the document goes. Absent while the load is still open — the clock has not started. */
  documentUntil?: string;
  /** Days the photographs behind it are kept, counted from the same moment. */
  evidenceDays: number;
  /** When the photographs go. Absent for the same reason. */
  evidenceUntil?: string;
  /** When the CMR's ordinary limitation period runs out on this carriage. */
  claimWindowUntil?: string;
  /**
   * Set when the photographs go BEFORE a claim could still be brought, which is the ordinary case. The
   * date a party should have their own copy by — and the whole reason the export exists.
   */
  exportBefore?: string;
  /** The fingerprint of every copy outlives all of it. Never a date, because there is never one. */
  proof: 'permanent';
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
  const documentDays = DOCUMENT_RETENTION_DAYS;
  const finished = input.finishedAt ? Date.parse(input.finishedAt) : NaN;
  if (!Number.isFinite(finished)) return { documentDays, evidenceDays, proof: 'permanent' };

  const evidenceUntil = new Date(finished + evidenceDays * DAY_MS).toISOString();
  const documentUntil = new Date(finished + documentDays * DAY_MS).toISOString();
  const claimWindowUntil = new Date(finished + CLAIM_WINDOW_DAYS * DAY_MS).toISOString();
  return {
    documentDays,
    documentUntil,
    evidenceDays,
    evidenceUntil,
    claimWindowUntil,
    ...(Date.parse(evidenceUntil) < Date.parse(claimWindowUntil) ? { exportBefore: evidenceUntil } : {}),
    proof: 'permanent',
  };
}

/** True once the document is close enough to going that somebody should be told plainly. */
export function documentExpiringSoon(s: RetentionStatement, now = Date.now()): boolean {
  if (!s.documentUntil) return false;
  const until = Date.parse(s.documentUntil);
  return Number.isFinite(until) && until - now < WARN_BEFORE_DAYS * DAY_MS;
}

/** The same statement as the sentences the printed note carries in its footer. */
export function retentionWords(s: RetentionStatement): string {
  const day = (iso: string): string => iso.slice(0, 10);
  const months = Math.round(s.documentDays / 30);
  if (!s.documentUntil) {
    return (
      `This note is kept for ${months} months after the load is finished, and the photographs behind it for ` +
      `${s.evidenceDays} days. This load is not finished, so nothing has started counting. ` +
      `The fingerprint below is kept for good: we can always confirm a copy you hold is the one we issued.`
    );
  }
  const base =
    `This note is kept until ${day(s.documentUntil)} and the photographs behind it until ` +
    `${day(s.evidenceUntil as string)}. Keep your own copy: after those dates we can confirm that a copy ` +
    `you hold is genuine, from the fingerprint below, but we cannot give you another one.`;
  if (!s.exportBefore) return base;
  return (
    `${base} A claim under the CMR can be brought until ${day(s.claimWindowUntil as string)}, which is ` +
    `after the photographs go — so download this note and its photographs before ${day(s.exportBefore)}.`
  );
}
