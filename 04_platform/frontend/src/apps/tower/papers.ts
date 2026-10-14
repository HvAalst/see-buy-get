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
  /** What they are cleared to ride or drive. Absent from a server that predates it; read as unknown. */
  classes?: string[];
  /** Their badge portrait — the face on the row, when they have one. */
  portraitRef?: string;
  /**
   * The licence on record and, when somebody recorded it from one, the photograph it was READ from and
   * who read it. No copyRef means the date was typed on somebody's word, and the screen says so.
   */
  licence: { number?: string; expiresAt?: string; copyRef?: string; recordedBy?: string; recordedAt?: string };
  /** A renewed card they sent from the driver app, waiting to be read. Its date is THEIR reading. */
  renewal?: { copyRef: string; expiresAt: string; number?: string; sentAt: string };
  /** Why the last card they sent was not accepted. */
  renewalRefusal?: { reason: string; at: string; by?: string };
  /** The licence and ID the driver submitted AT VETTING — heavy registry only, and showing the old date. */
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

/**
 * A fleet OPERATOR's own two papers — its transport licence and its goods-in-transit cover.
 *
 * Listed whether or not the sister behind it enforces them. `enforced` says what that sister acts on
 * (usually nothing) and `notOffered` whether a lapse is costing the fleet work right now: the screen has
 * to tell "lapsed and refused" from "lapsed and nobody is checking" from "in date".
 */
export interface CarrierPaperRow {
  did: string;
  companyName: string;
  jurisdiction?: string;
  status: string;
  entityId?: string;
  papers: PaperView[];
  enforced: string[];
  notOffered: string[];
  recordedBy?: string;
  recordedAt?: string;
  /** What each recorded date was read from, when it came off a document the fleet sent. */
  copies?: Partial<Record<CarrierKind, string>>;
  /** A renewed document the fleet SENT and nobody has read — the work. Its date is the fleet's reading. */
  sent?: Partial<Record<CarrierKind, SentPaper>>;
  /** Why the last document sent for a paper was turned down. */
  refused?: Partial<Record<CarrierKind, { reason: string; at: string; by?: string }>>;
}

export type CarrierKind = 'operator_licence' | 'carrier_insurance';

export interface SentPaper {
  copyRef: string;
  expiresAt: string;
  reference?: string;
  sentAt: string;
  sentBy?: string;
}

/** Whether a fleet has sent a document nobody here has read — done its part, and waiting on us. */
export function operatorWaiting(row: CarrierPaperRow): boolean {
  return Object.keys(row.sent ?? {}).length > 0;
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
  /** The operators' own papers. Absent from a server that predates it — read as empty. */
  carrierPapers?: CarrierPaperRow[];
}

/** The ones that need somebody: lapsed first, then running out. Withdrawn is a decision, not a job. */
export function transitNeedingAttention(rows: TransitAuthorityRow[] | undefined): TransitAuthorityRow[] {
  return (rows ?? []).filter((r) => r.state === 'lapsed' || r.state === 'due');
}

export function isStuck(row: { offRoad: string[] }): boolean {
  return row.offRoad.length > 0;
}

/** A courier waiting on somebody HERE: off the road, or with a card sent that nobody has read yet. */
export function isWaiting(row: CourierPaperRow): boolean {
  return isStuck(row) || Boolean(row.renewal);
}

/**
 * How many are waiting on somebody here — the number the badge carries. Off the road, or a card sent and
 * unread: a courier whose licence is merely running out waits on nobody, but one who has sent the new
 * card has done their part and is waiting on us. Each counted once. Null while unread, like every other
 * count in the console: a zero says "you are up to date", which is a different claim.
 */
export function waitingCount(report: PapersNetworkView | null): number | null {
  if (!report) return null;
  // A fleet that SENT its renewed licence or policy has done its part exactly as a courier with a card has,
  // and is counted once however many papers it sent — the badge counts who is waiting, not pages.
  return report.couriers.filter(isWaiting).length + report.vehicles.filter(isStuck).length + (report.carrierPapers ?? []).filter(operatorWaiting).length;
}

/** How to reach one courier, as the vault answered. `held: false` is an answer the screen says, not an error. */
export interface CourierContact {
  held: boolean;
  fullName?: string;
  phone?: string;
}
