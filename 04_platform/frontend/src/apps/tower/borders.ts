import type { MessageKey } from '../../shared/i18n';
import type { CatalogueCountry } from './presence';

/**
 * CA6 — THE RULES OF CROSSING A BORDER, as the console reads and edits them.
 *
 * One direction at a time, and the absence of a rule is not permission: dispatch never offers a foreign vehicle a
 * load inside a country unless a rule here says it may. The screen's job is to make recording that rule quick and
 * its consequence impossible to miss.
 */

export interface BorderCrossingPoint {
  name: string;
  hours?: string;
  note?: string;
}

export interface BorderRuleRow {
  from: string;
  to: string;
  crossings: BorderCrossingPoint[];
  permits: string[];
  regionalInsurance: string[];
  maxWeightKg?: number;
  maxLengthM?: number;
  maxHeightM?: number;
  cabotage: 'allowed' | 'forbidden';
  note?: string;
  setBy: string;
  setAt: string;
}

export interface BorderForm {
  from: string;
  to: string;
  /** One crossing per line: `name | hours`. */
  crossings: string;
  permits: string;
  regionalInsurance: string;
  maxWeightKg: string;
  cabotage: 'allowed' | 'forbidden';
  note: string;
}

export const EMPTY_BORDER_FORM: BorderForm = { from: '', to: '', crossings: '', permits: '', regionalInsurance: '', maxWeightKg: '', cabotage: 'forbidden', note: '' };

/** `Namanga | 06:00–22:00` per line → crossings. A line with no name is dropped rather than sent as nothing. */
export function parseCrossings(text: string): BorderCrossingPoint[] {
  return text
    .split('\n')
    .map((line) => line.split('|').map((part) => part.trim()))
    .filter(([name]) => Boolean(name))
    .map(([name, hours, note]) => ({ name, ...(hours ? { hours } : {}), ...(note ? { note } : {}) }));
}

/** A comma- or line-separated list, trimmed, without repeats. */
export function listOf(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[,\n]/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
}

/** What stops a rule being saved — said before the server has to. */
export function borderFormBlocker(form: BorderForm, catalogue: CatalogueCountry[]): MessageKey | null {
  const known = (code: string) => catalogue.some((c) => c.code === code);
  if (!form.from || !known(form.from)) return 'tower.borders.needFrom';
  if (!form.to || !known(form.to)) return 'tower.borders.needTo';
  if (form.from === form.to) return 'tower.borders.sameCountry';
  if (form.maxWeightKg.trim()) {
    const kg = Number(form.maxWeightKg);
    if (!Number.isFinite(kg) || kg <= 0) return 'tower.borders.badWeight';
  }
  return null;
}

/** The form as the server reads it. */
export function toBorderBody(form: BorderForm): Record<string, unknown> {
  return {
    from: form.from,
    to: form.to,
    crossings: parseCrossings(form.crossings),
    permits: listOf(form.permits),
    regionalInsurance: listOf(form.regionalInsurance),
    ...(form.maxWeightKg.trim() ? { maxWeightKg: Number(form.maxWeightKg) } : {}),
    cabotage: form.cabotage,
    ...(form.note.trim() ? { note: form.note.trim() } : {}),
  };
}

/** A recorded rule back into the form, so "Change" edits what is there rather than starting again. */
export function formFromRule(rule: BorderRuleRow): BorderForm {
  return {
    from: rule.from,
    to: rule.to,
    crossings: rule.crossings.map((c) => [c.name, c.hours ?? ''].filter(Boolean).join(' | ')).join('\n'),
    permits: rule.permits.join(', '),
    regionalInsurance: rule.regionalInsurance.join(', '),
    maxWeightKg: rule.maxWeightKg != null ? String(rule.maxWeightKg) : '',
    cabotage: rule.cabotage,
    note: rule.note ?? '',
  };
}

/** A crossing as one short line: `Namanga · 06:00–22:00`. */
export function crossingLine(crossing: BorderCrossingPoint): string {
  return [crossing.name, crossing.hours].filter(Boolean).join(' · ');
}

/** Round 14 — one post's measured wait, from the loads its drivers said cleared it in the last ninety days. */
export interface BorderWaitRow {
  from: string;
  to: string;
  post: string;
  hours: number;
  crossings: number;
  /** Enough crossings for the post's own promise; else loads through it are promised the standard figure. */
  measured: boolean;
  longestHours: number;
  lastClearedAt: string;
}

/** The waits in the order staff read them: a crossing's posts together, the busiest first. */
export function waitsInOrder(rows: BorderWaitRow[]): BorderWaitRow[] {
  return [...rows].sort((a, b) => `${a.from}${a.to}`.localeCompare(`${b.from}${b.to}`) || b.crossings - a.crossings || a.post.localeCompare(b.post));
}
