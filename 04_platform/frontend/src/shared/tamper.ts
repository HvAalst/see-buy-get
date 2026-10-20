import type { MessageKey, Translate } from './i18n';

/*
 * ROUND 35 — THE TAMPER PROTOCOL, as every app says it (backend tamper.types.ts). A seal not as written, the seals not
 * as the note says, a broken seal or a cut wrap holds the load or the parcel: it changes hands with nobody until
 * SeeBuyGet operations releases it, with a reason. The driver, the shop and the hub report; the shipper and the store are
 * told; staff read every exception and release the hold.
 */

export type TamperFinding = 'seal_not_as_written' | 'seal_not_as_on_the_note' | 'seal_broken' | 'wrap_cut';
export type TamperStage = 'pickup' | 'road' | 'delivery' | 'counter' | 'hub';

/** Kept on the load or the parcel while it is held. */
export interface UnitHold {
  since: string;
  finding: TamperFinding;
  stage: TamperStage;
  exceptionId: string;
  /** In words, from the server: "at pickup", "at Kisumu hub". */
  where: string;
}

/** One exception as a reader sees it. Staff read who found it (`byName`); anybody else reads the party. */
export interface TamperExceptionRow {
  exceptionId: string;
  ssccs: string[];
  finding: TamperFinding;
  stage: TamperStage;
  at: string;
  receivedAt?: string;
  byAs: 'driver' | 'shop' | 'hub';
  byName?: string;
  where: string;
  photoRefs: string[];
  note?: string;
  sealNo?: number;
  numberRead?: string;
  cause?: string;
  fingerprint: string;
  release?: { at: string; by: string; reason: string };
}

export interface TamperUnit {
  unitType: 'load' | 'parcel';
  unitId: string;
  ref: string;
  held?: UnitHold;
  exceptions: TamperExceptionRow[];
}

/** A release says what was found and what was done: no shorter than this (the server's MIN_RELEASE_REASON). */
export const MIN_RELEASE_REASON = 10;

const FINDING_KEY: Record<TamperFinding, MessageKey> = {
  seal_not_as_written: 'common.tamper.finding.seal_not_as_written',
  seal_not_as_on_the_note: 'common.tamper.finding.seal_not_as_on_the_note',
  seal_broken: 'common.tamper.finding.seal_broken',
  wrap_cut: 'common.tamper.finding.wrap_cut',
};

/** What was found, in words; a finding this build has never heard of is said as it came. */
export function findingWords(f: string, t: Translate): string {
  return f in FINDING_KEY ? t(FINDING_KEY[f as TamperFinding]) : f.replace(/_/g, ' ');
}

/** "20 Oct, 14:03" in the reader's own time: when it was found. */
export function heldWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** "Held at pickup, 20 Oct 14:03: a seal on the door is not the one written." */
export function heldLine(h: Pick<UnitHold, 'finding' | 'where' | 'since'>, t: Translate): string {
  return t('common.tamper.heldLine', { where: h.where, when: heldWhen(h.since), what: findingWords(h.finding, t) });
}

/** Why a release cannot be sent yet, or null when it can. */
export function releaseBlocker(reason: string, t: Translate): string | null {
  return reason.trim().length < MIN_RELEASE_REASON ? t('common.tamper.releaseTooShort', { n: MIN_RELEASE_REASON }) : null;
}
