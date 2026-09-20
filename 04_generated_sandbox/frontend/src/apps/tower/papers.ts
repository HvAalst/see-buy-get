import type { PaperView } from '../../shared/papers';

/**
 * FP4 — the papers only the network's staff can put right.
 *
 * A fleet's office records its own vehicles' and drivers' renewals in the Fleet app. A courier who rides
 * without a fleet, and a vehicle no fleet owns, have no such office: their papers lapse into a dead end
 * unless somebody here types the date. This screen is that somebody.
 */
export interface CourierPaperRow {
  did: string;
  displayName: string;
  badgeId?: string;
  status: string;
  registry: string;
  jurisdiction?: string;
  licence: { number?: string; expiresAt?: string };
  /** The licence and ID the driver submitted, so a new expiry is typed while LOOKING at the document. */
  documents?: { licenceCopyRef?: string; idCopyRef?: string; submittedAt?: string };
  papers: PaperView[];
  /** The lapsed papers, in the server's words. Non-empty means no shift can start. */
  offRoad: string[];
  onShift: boolean;
  /** The plates they have driven, newest first — where their vehicle's papers will be found. */
  drives: string[];
}

export interface LooseVehicleRow {
  vehicleId: string;
  plate: string;
  vehicleClass: string;
  status: string;
  documents: { insuranceRef?: string; insuranceExpiresAt?: string; inspectionRef?: string; inspectionExpiresAt?: string };
  papers: PaperView[];
  offRoad: string[];
  onShiftWith?: string;
}

export interface SweepRun {
  at: string;
  shiftsEnded: number;
  notified: number;
  mails: number;
}

/**
 * BL1 — one carrier's permission to move goods that have not been cleared.
 *
 * `state` is the same vocabulary as every other paper here, plus `withdrawn` — which is not a date
 * running out but somebody taking it away, and is kept rather than deleted because a leg already carried
 * under it is still a fact.
 */
export interface TransitAuthorityRow {
  authorityId: string;
  carrierDid: string;
  carrierName?: string;
  country: string;
  reference: string;
  expiresAt: string;
  state: 'ok' | 'due' | 'lapsed' | 'withdrawn';
  daysLeft: number;
  recordedBy: string;
  recordedAt: string;
  withdrawnAt?: string;
  withdrawnBy?: string;
  withdrawnReason?: string;
}

export interface CarrierOption {
  did: string;
  name: string;
  kind: 'fleet' | 'owner_driver';
}

export interface PapersNetworkView {
  couriers: CourierPaperRow[];
  vehicles: LooseVehicleRow[];
  fleets: { count: number; withLapsed: number; lapsed: number; due: number };
  sweep: SweepRun | null;
  sweepEveryHours: number;
  /** BL1 — absent from a server that predates the slice; a screen must read it as empty, not as broken. */
  transit?: TransitAuthorityRow[];
  carriers?: CarrierOption[];
}

/** The ones that need somebody: lapsed first, then running out. Withdrawn is a decision, not a job. */
export function transitNeedingAttention(rows: TransitAuthorityRow[] | undefined): TransitAuthorityRow[] {
  return (rows ?? []).filter((r) => r.state === 'lapsed' || r.state === 'due');
}

export function isStuck(row: { offRoad: string[] }): boolean {
  return row.offRoad.length > 0;
}

/**
 * How many cannot work until somebody here types a date — the number the badge carries. Null while unread,
 * like every other count in the console: a zero says "you are up to date", which is a different claim.
 */
export function stuckCount(report: PapersNetworkView | null): number | null {
  if (!report) return null;
  return report.couriers.filter(isStuck).length + report.vehicles.filter(isStuck).length;
}
