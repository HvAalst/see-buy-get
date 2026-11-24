/*
 * 2026-11-24 — A BAG HANDED OVER AT A HUB ACROSS A BORDER (corridor compliance, slice 4; the owner's brief, feature 5; the owner:
 * "Cross-border only"). A bag that left a shop or hub in another country is taken over at the hub by name on both sides: the
 * driver who brought it shows their pass, the person receiving it is signed in, its seal is read and photographed as it arrived
 * (BagClosureService.checkReceipt), and whatever is wrong with it is written down there and then, with photographs. What leaves
 * the hub with its parcels goes on a coded seal, photographed, and the pass of the driver taking it closes the record.
 */

/** At most this many things wrong said at one handover: more is a bag to report (the tamper protocol), not to list. */
export const MAX_TRANSFER_EXCEPTIONS = 5;
/** The words of one thing wrong: long enough to say what, short enough to read on a phone. */
export const TRANSFER_NOTE_MIN = 3;
export const TRANSFER_NOTE_MAX = 500;

/** Something wrong with a bag as it was handed over, said by the person receiving it, with a photograph where one was taken. */
export interface HubTransferException {
  note: string;
  photoRef?: string;
  at: string;
  by: string;
}

/**
 * How parcels from a handover went on: in a bag on its coded seal, the photograph of it closed, and who took it; or, at a hub
 * that hands parcels out too, onto its own counter's shelf by hand (2026-11-24), where the receiver collects with their code.
 */
export interface HubTransferOnward {
  kind?: 'bag' | 'counter';
  /** The bag's code; empty for the counter. */
  bagCode: string;
  /** The counter's shelf slot. */
  slot?: string;
  parcels: string[];
  sealNumber?: string;
  closureId?: string;
  photoRef?: string;
  closedAt?: string;
  driverDid?: string;
  driverName?: string;
  badgeId: string;
  loadedAt: string;
}

/** One handover of a bag from another country at a hub: both parties, the seal as it arrived, what was wrong, what went on. */
export interface HubTransfer {
  transferId: string;
  mdpId: string;
  hubName: string;
  /** The hub's country, where the bag arrived. */
  country: string;
  bagCode: string;
  /** The country the bag left, and the shop or hub it was loaded at. */
  fromCountry: string;
  fromPlace?: string;
  parcels: string[];
  /** The driver who brought it, by the pass on their phone. */
  released: { driverDid: string; driverName?: string; badgeId: string; fleetDid?: string; at: string };
  /** The person who took it over, signed in, and the seal as they found it. */
  received: { by: string; at: string; sealKind?: 'seal' | 'photo'; sealNumber?: string; numberRead?: string; photoRef?: string; asClosed?: boolean };
  exceptions: HubTransferException[];
  /** Passed on unopened to a hub further on: resealed here before it goes. */
  passedOnWhole: boolean;
  onward: HubTransferOnward[];
}

/** What the person receiving a bag from another country gives besides its seal reading: the driver's pass, and what is wrong. */
export interface HubTransferInput {
  driverBadgeId?: string;
  exceptions?: Array<{ note: string; photoRef?: string }>;
}
