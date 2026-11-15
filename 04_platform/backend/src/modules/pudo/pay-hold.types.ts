import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * 2026-11-15 — THE 24-HOUR HOLD AND ITS PROTOCOL (the owner: "staff actually needs a decision tree rather than individual
 * judgement. A protocol can be explained to all parties, seller, buyer and everyone who made it move" — "as recommended").
 *
 * Money a person paid SeeBuyGet first (a load they posted, a load to their own door) is not paid on to the driver at delivery:
 * it waits 24 hours. Nothing reported, it is released by itself. A problem reported in that time keeps it until staff apply the
 * protocol — three steps, each reading a fact the record already holds, so the record decides and staff only confirm it:
 *   1. handed over with the delivery code, or the sender said it arrived (a load to a door: the driver's proof at the door)?
 *      No → not delivered: the carriage price goes back to the person, the driver is not paid.
 *   2. the same problem noted at the door, on the note, with the receiver there?
 *      No → the driver is paid; the person has the damage claim report for their own insurer.
 *   3. the same problem noted when the driver took it over?
 *      Yes → it was so before: the driver is paid. No → it happened while the driver had it: the carriage price goes back.
 * Never more than the carriage price: goods are paid for only where a company states cover (rule: damage is reported).
 */
export const HOLD_HOURS = 24;
/** 2026-11-15 — a reported problem: staff are reminded after a day, and after three the protocol's own answer applies. */
export const HOLD_REMIND_HOURS = 24;
export const HOLD_DECIDE_HOURS = 72;
/** The public page that explains the protocol to everybody — every decision notice links to it (H6). */
export const HOLD_HELP_PATH = '/help/when-something-goes-wrong/';
/** A door further than this from where the phone was at the handover is not shown to have been reached. */
export const DOOR_REACHED_M = 1000;

export const PROTOCOL_STEPS = ['not_handed_over', 'not_noted_at_door', 'noted_at_pickup', 'arose_in_carriage'] as const;
export type ProtocolStep = (typeof PROTOCOL_STEPS)[number];
export const HOLD_OUTCOMES = ['release', 'refund'] as const;
export type HoldOutcome = (typeof HOLD_OUTCOMES)[number];

/** What each step says — the same three sentences everywhere, so everybody reads one rule. */
export const STEP_WORDS: Record<ProtocolStep, string> = {
  not_handed_over: 'Step 1: it was not handed over with the delivery code, so it was not delivered. The carriage price goes back to the person who paid, and the driver is not paid.',
  not_noted_at_door: 'Step 2: the problem was not noted at the door, where the receiver took it with their code. The driver is paid; the damage claim report is for the person’s own insurer.',
  noted_at_pickup: 'Step 3: the same problem was noted when the driver took it over, so it was so before. The driver is paid.',
  arose_in_carriage: 'Step 3: the problem was noted at the door and not when the driver took it over, so it happened while the driver had it. The carriage price goes back to the person who paid, and the driver is not paid for this load.',
};

/** The facts the protocol reads, as the record holds them. */
export class ProtocolFacts {
  /** Handed over with the delivery code, or the sender said it arrived — or, on a load to a door, the driver's proof there. */
  handedOver: boolean;
  /** The same problem noted at the door, with the receiver there. */
  notedAtDoor: boolean;
  /** The same problem noted when the driver took it over. */
  notedAtPickup: boolean;
}

export class ProtocolReading {
  @ApiProperty({ enum: PROTOCOL_STEPS }) step: ProtocolStep;
  @ApiProperty({ enum: HOLD_OUTCOMES }) outcome: HoldOutcome;
  @ApiProperty({ type: ProtocolFacts }) facts: ProtocolFacts;
  /** The step's sentence, as everybody is told it. */
  words: string;
}

/** The driver's one answer, shown beside the report. */
export class HoldAnswer {
  words: string;
  @ApiProperty({ type: [String] }) photoRefs: string[];
  at: string;
  by: string;
}

export class HoldDecision {
  /** 2026-11-15 — nobody decided within HOLD_DECIDE_HOURS: the protocol's answer applied by itself. */
  @ApiPropertyOptional() automatic?: boolean;
  @ApiProperty({ enum: PROTOCOL_STEPS }) step: ProtocolStep;
  @ApiProperty({ enum: HOLD_OUTCOMES }) outcome: HoldOutcome;
  by: string;
  at: string;
  /** Gone against the record: who asked, who seconded, and why. */
  @ApiPropertyOptional() overridden?: boolean;
  @ApiPropertyOptional() reason?: string;
  @ApiPropertyOptional() secondBy?: string;
}

export class HoldOverride {
  @ApiProperty({ enum: HOLD_OUTCOMES }) outcome: HoldOutcome;
  reason: string;
  by: string;
  @ApiPropertyOptional() byKey?: string;
  at: string;
}

/** On the load: the driver's pay held after delivery, until when, and what became of it. */
export class HeldPay {
  until: string;
  @ApiPropertyOptional({ type: HoldAnswer }) answer?: HoldAnswer;
  @ApiPropertyOptional({ type: HoldDecision }) decision?: HoldDecision;
  @ApiPropertyOptional({ type: HoldOverride }) pendingOverride?: HoldOverride;
  @ApiPropertyOptional() releasedAt?: string;
}

/** The kinds a report says, matched against what was noted at the door. */
const DOOR_KIND: Record<string, string> = { damaged: 'damaged', short: 'short', wrong: 'wrong' };

/**
 * The protocol, read from the load as recorded. `problem` is what was reported: its kind. Pure, so the queue, the notices and
 * the help page say the same thing the decision does.
 */
export function readProtocol(f: {
  deliveryCode?: string;
  deliveredWithCode?: boolean;
  posterConfirmedAt?: string;
  proofOfDelivery?: { receiverName?: string; photoRef?: string; exceptions?: ReadonlyArray<{ kind: string; count: number }>; position?: { none?: boolean; metresFromPlace?: number } };
  reservations?: { note?: string };
}, problem: { kind: string }): ProtocolReading {
  const pod = f.proofOfDelivery;
  const atDoor = pod?.position && !pod.position.none && pod.position.metresFromPlace != null ? pod.position.metresFromPlace <= DOOR_REACHED_M : true;
  const handedOver = f.deliveryCode ? Boolean(f.deliveredWithCode || f.posterConfirmedAt) : Boolean(pod?.receiverName && pod.photoRef && atDoor);
  const doorKind = DOOR_KIND[problem.kind];
  const notedAtDoor = Boolean(doorKind && pod?.exceptions?.some((x) => x.kind === doorKind && x.count > 0));
  const notedAtPickup = Boolean(f.reservations?.note?.trim());
  const facts = { handedOver, notedAtDoor, notedAtPickup };
  const step: ProtocolStep = !handedOver ? 'not_handed_over' : !notedAtDoor ? 'not_noted_at_door' : notedAtPickup ? 'noted_at_pickup' : 'arose_in_carriage';
  const outcome: HoldOutcome = step === 'not_handed_over' || step === 'arose_in_carriage' ? 'refund' : 'release';
  return { step, outcome, facts, words: STEP_WORDS[step] };
}
