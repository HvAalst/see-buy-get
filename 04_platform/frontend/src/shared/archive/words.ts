import type { MessageKey, Translate } from '../i18n';
import type { ArchivedNoteRow, NotePath, NoteStage, RetentionStatement } from '../../lib/sbg/personas/archive';

/** What a copy was stamped for, in words. */
export function stageWord(stage: NoteStage, t: Translate): string {
  const keys: Record<NoteStage, MessageKey> = {
    taken_over: 'archive.stage.takenOver',
    delivered: 'archive.stage.delivered',
    not_delivered: 'archive.stage.notDelivered',
    claimed: 'archive.stage.claimed',
    answered: 'archive.stage.answered',
    cancelled: 'archive.stage.cancelled',
  };
  return t(keys[stage]);
}

/** Which door the carriage came through. */
export function pathWord(path: NotePath, t: Translate): string {
  return t(path === 'board' ? 'archive.path.board' : 'archive.path.run');
}

/** A date somebody reads, not an ISO string. Empty for nothing, so a caller can fall back. */
export function day(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString();
}

/** The first eight characters of a fingerprint — enough to compare two printouts across a table. */
export function shortPrint(sha256: string): string {
  return sha256.slice(0, 8);
}

/** The line under a row: where it went, on what, and how heavy. */
export function routeLine(row: ArchivedNoteRow): string {
  return [`${row.from} → ${row.to}`, row.plate, `${row.grossKg} kg`].filter(Boolean).join(' · ');
}

/**
 * HOW LONG WE KEEP IT, as the two or three sentences somebody should actually read.
 *
 * Silence on a screen that shows a document reads as "for ever", and the truth here has two halves that
 * disagree: the note is kept and the photographs are not. Saying only the first would be worse than
 * saying nothing, because it is the half that sounds reassuring.
 */
export function retentionLines(r: RetentionStatement, t: Translate): string[] {
  const months = Math.round(r.documentDays / 30);
  if (!r.documentUntil) {
    // Nothing has started counting, and saying a date for a load still in the world would be a promise
    // about a clock nobody has started.
    return [t('archive.retention.open', { months, days: r.evidenceDays }), t('archive.retention.proof')];
  }
  const lines = [t('archive.retention.until', { doc: day(r.documentUntil), photos: day(r.evidenceUntil) })];
  if (r.exportBefore) {
    // The sentence that changes what somebody does, and the reason the export button is beside it.
    lines.push(t('archive.retention.claimGap', { claim: day(r.claimWindowUntil), date: day(r.exportBefore) }));
  }
  // Always last, and never omitted: it is the difference between "gone" and "unverifiable".
  lines.push(t('archive.retention.proof'));
  return lines;
}

/** True once the DOCUMENT itself is close enough to going that a reader should be pushed to export. */
export function documentGoingSoon(r: RetentionStatement, now = Date.now()): boolean {
  if (!r.documentUntil) return false;
  const until = Date.parse(r.documentUntil);
  return Number.isFinite(until) && until - now < 30 * 86_400_000;
}

/** True while the photographs are close enough to going that a reader should be told plainly. */
export function retentionIsUrgent(r: RetentionStatement, now = Date.now()): boolean {
  if (!r.evidenceUntil) return false;
  const until = Date.parse(r.evidenceUntil);
  if (!Number.isFinite(until)) return false;
  // Gone already, or inside the last thirty days of the window.
  return until - now < 30 * 86_400_000;
}
