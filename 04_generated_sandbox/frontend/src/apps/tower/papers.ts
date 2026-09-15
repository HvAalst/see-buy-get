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

export interface PapersNetworkView {
  couriers: CourierPaperRow[];
  vehicles: LooseVehicleRow[];
  fleets: { count: number; withLapsed: number; lapsed: number; due: number };
  sweep: SweepRun | null;
  sweepEveryHours: number;
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
