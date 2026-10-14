import type { FleetDriver, FleetManager, Vehicle } from './fleet.types';

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
/**
 * The last two belong to the COMPANY rather than to a thing it owns, and they are separate kinds rather
 * than a subject flag so that a label and a refusal stay pure functions of the kind. "Insurance lapsed"
 * on a lorry and on the operator running it are different sentences to the person reading them.
 */
export const PAPER_KINDS = ['insurance', 'inspection', 'licence', 'operator_licence', 'carrier_insurance'] as const;
export type PaperKind = (typeof PAPER_KINDS)[number];

/** The subset a SISTER can choose to enforce against a carrier. Read this; never restate it. */
export const CARRIER_PAPER_KINDS = ['operator_licence', 'carrier_insurance'] as const;
export type CarrierPaperKind = (typeof CARRIER_PAPER_KINDS)[number];

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

/**
 * The OPERATOR's own papers — the licence that lets the company run lorries at all, and the cover it
 * carries over other people's goods.
 *
 * Same clock and same rules as a vehicle's, deliberately: the network took a lorry off the road for a
 * lapsed inspection and would not have noticed the company running it losing its licence. What differs
 * is the CONSEQUENCE, which is a sister's to decide (Entity.carrierPapers) rather than the network's.
 * The licence NUMBER lives where it always did, on the eligibility requirements.
 */
export function fleetPapers(m: Pick<FleetManager, 'requirements' | 'papers'>, now: number = Date.now()): PaperStatus[] {
  const p = m.papers ?? {};
  return [
    paperStatus('operator_licence', p.licenceExpiresAt, m.requirements?.transportOperatorLicence, now),
    paperStatus('carrier_insurance', p.insuranceExpiresAt, p.insurancePolicy, now),
  ];
}

export function lapsedOf(papers: PaperStatus[]): PaperStatus[] {
  return papers.filter((p) => p.state === 'lapsed');
}

/**
 * A total map rather than a chain of ternaries, so a kind added above cannot silently inherit the last
 * branch. The old chain would have labelled an operator licence "Driving licence" — a refusal naming the
 * wrong document is worse than one naming none.
 */
const PAPER_LABELS: Record<PaperKind, string> = {
  insurance: 'Insurance',
  inspection: 'Inspection certificate',
  licence: 'Driving licence',
  operator_licence: 'Operator licence',
  carrier_insurance: 'Carrier insurance',
};

export function paperLabel(kind: PaperKind): string {
  return PAPER_LABELS[kind];
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
