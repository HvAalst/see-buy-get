import type { FleetDriver, Vehicle } from './fleet.types';

/**
 * FP4 — the papers that switch things off.
 *
 * A vehicle's insurance and inspection certificate and a driver's licence each carry an expiry date. Until now
 * the dates were typed and read by nobody: a vehicle whose insurance ran out in March was still offered loads in
 * September. Here the date does what a date is for. Everything is DERIVED from the date at the moment of asking —
 * never a status written into the record — so renewing a paper puts the vehicle back on the road with nothing to
 * unwind, and a record nobody touched cannot be quietly wrong.
 *
 * What a missing date means is decided here too: NOTHING. A paper never recorded switches nothing off, because
 * we cannot enforce what we never asked for; the fleet app shows the gap and asks. A date that has passed does.
 */
export type PaperKind = 'insurance' | 'inspection' | 'licence';
export type PaperState = 'ok' | 'due' | 'lapsed' | 'none';

/** How far ahead a fleet is told a paper is running out. */
export const PAPER_DUE_DAYS = 30;
const DAY_MS = 86_400_000;

export interface PaperStatus {
  kind: PaperKind;
  state: PaperState;
  expiresAt?: string;
  /** Whole days until it lapses — negative once it has. Absent when there is no date. */
  daysLeft?: number;
  reference?: string;
}

/** The instant a paper stops counting: the day AFTER its expiry date, at midnight UTC (a date-only expiry is valid all day). */
export function paperLapsesAt(expiresAt: string): number {
  const t = /^\d{4}-\d{2}-\d{2}$/.test(expiresAt) ? Date.parse(`${expiresAt}T00:00:00Z`) + DAY_MS : Date.parse(expiresAt);
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t; // an unreadable date cannot switch anything off — and cannot be relied on either
}

export function paperStatus(kind: PaperKind, expiresAt: string | undefined, reference: string | undefined, now: number = Date.now()): PaperStatus {
  if (!expiresAt) return { kind, state: 'none', ...(reference ? { reference } : {}) };
  const lapses = paperLapsesAt(expiresAt);
  if (!Number.isFinite(lapses)) return { kind, state: 'none', expiresAt, ...(reference ? { reference } : {}) };
  const daysLeft = Math.ceil((lapses - now) / DAY_MS);
  const state: PaperState = lapses <= now ? 'lapsed' : daysLeft <= PAPER_DUE_DAYS ? 'due' : 'ok';
  return { kind, state, expiresAt, daysLeft, ...(reference ? { reference } : {}) };
}

export function vehiclePapers(v: Pick<Vehicle, 'documents'>, now: number = Date.now()): PaperStatus[] {
  const d = v.documents ?? {};
  return [paperStatus('insurance', d.insuranceExpiresAt, d.insuranceRef, now), paperStatus('inspection', d.inspectionExpiresAt, d.inspectionRef, now)];
}

export function driverPapers(d: Pick<FleetDriver, 'licence'>, now: number = Date.now()): PaperStatus[] {
  return [paperStatus('licence', d.licence?.expiresAt, d.licence?.number, now)];
}

export function lapsedOf(papers: PaperStatus[]): PaperStatus[] {
  return papers.filter((p) => p.state === 'lapsed');
}

export function paperLabel(kind: PaperKind): string {
  return kind === 'insurance' ? 'Insurance' : kind === 'inspection' ? 'Inspection certificate' : 'Driving licence';
}

export function paperDay(expiresAt: string): string {
  const d = new Date(paperLapsesAt(expiresAt) - DAY_MS);
  if (Number.isNaN(d.getTime())) return expiresAt;
  return `${d.getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** One line the refusal, the note and the screen can all say: "Insurance lapsed 3 Sep 2026". */
export function offRoadLine(p: PaperStatus): string {
  return `${paperLabel(p.kind)} lapsed ${p.expiresAt ? paperDay(p.expiresAt) : ''}`.trim();
}
