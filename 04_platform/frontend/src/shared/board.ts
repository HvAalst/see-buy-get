/**
 * FB1 — what kind of "no" a board row carries. The screen groups and colours by this, never by the message.
 *
 * 'unknown' is not a refusal: it is the system saying it could not check something (bridge clearances, axle
 * limits — no data exists) rather than pretending it did. A row whose only marks are 'unknown' is still
 * takeable, because deciding otherwise would be the platform overruling the operator who drives the road.
 *
 * Shared by the driver's board and the fleet's dispatch view (FP5): the office sees exactly what the driver
 * would, and one colour table is how the two cannot disagree about what a mark means.
 */
export type BlockerKind = 'legal' | 'physical' | 'resolvable' | 'preference' | 'unknown';

export interface BoardBlocker {
  kind: BlockerKind;
  code: string;
  message: string;
}

/**
 * The colour a blocker is shown in. Grouped by KIND, never by code, so a new reason from the server renders
 * sensibly on an app that has never heard of it. 'unknown' is deliberately not a danger tone: painting an
 * unchecked bridge red would train an operator to ignore the one warning that could actually hurt them.
 */
export function blockerTone(kind: BlockerKind): 'danger' | 'warn' | 'info' | 'idle' {
  switch (kind) {
    case 'legal':
      return 'danger';
    case 'physical':
      return 'danger';
    case 'resolvable':
      return 'warn';
    case 'preference':
      return 'info';
    default:
      return 'idle';
  }
}
