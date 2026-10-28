/**
 * THE CONSIGNMENT NOTE — the one document every load carries (FP2).
 *
 * In the Netherlands and across Europe a road consignment is documented on a CMR note (the vrachtbrief): sender,
 * consignee, carrier, places and dates of taking over and delivery, the goods, and the three parties' confirmations.
 * The user's rule: **implement it, and let it be the standard where there is no standard.** So every freight on the
 * network — international or not, in a country with a form of its own or none — is documented on this note, in the
 * CMR's layout and numbering, so that a driver, a shop and a customs officer all read the same page.
 *
 * It is DERIVED, never typed: every box is filled from facts the network already holds and the acts it already
 * records (posting, pickup with its safety gate, delivery with its unload report). What the network does not know
 * it says it does not know, rather than leaving a box that looks filled.
 */

export interface NoteParty {
  name: string;
  address?: string;
  country?: string;
  /** The network identity behind the name, for the parties' own systems. Never a phone or an email. */
  did?: string;
}

export interface NoteConfirmation {
  by: string;
  at: string;
  /** How the confirmation was made — always electronic here; the wording the printed box carries. */
  how: string;
  /** What the confirming party said about the goods, in their words as the driver recorded them (box 24). */
  remarks?: string;
  /** D9 — what the receiver found not as the note says, at the handover: their reservations, beside their name (box 24). */
  reservations?: string;
}

export interface ConsignmentNote {
  /** CMR-<load code>: one note per load, for its whole life. */
  number: string;
  /**
   * THE LAW THE CARRIAGE IS UNDER, from where it is taken over and where it is delivered (the user, 2026-10-28: "Per lane,
   * from membership"; foundation/carriage-law): `cmr` when either country is a party to the CMR; `northern_corridor`
   * between member states of the Northern Corridor agreement; `contract` between two countries no convention joins;
   * `national` in one country — the same layout everywhere, the law said plainly.
   */
  kind: 'cmr' | 'northern_corridor' | 'contract' | 'national';
  /** A CMR note between two parties to the e-CMR Protocol (2008): the electronic note stands as the CMR note there. */
  electronic?: boolean;
  title: string;
  freightId: string;
  code: string;
  trackingKey?: string;
  status: string;
  /** Box 1 */
  sender: NoteParty;
  /**
   * B4 — WHO BOOKED IT FOR THE SENDER, when an expeditor did, as their agent. The sender stays the sender: claims and
   * liability follow the note, and the note says who the goods belong to.
   */
  agent?: NoteParty;
  /** Box 2 */
  consignee: NoteParty;
  /** Box 3 — place of delivery. */
  delivery: { place: string; country?: string; at?: string };
  /** Box 4 — place and date of taking over. */
  takingOver: { place: string; country?: string; at?: string };
  /** Box 5 — documents attached. */
  documents: string[];
  /** Boxes 6–12 — the goods. */
  goods: {
    description: string;
    nature: string;
    /** The kind of goods in words, as the note prints it (Art. 6(1)(f): "the description in common use"). */
    natureWords?: string;
    cargoClass: string;
    packaging?: string;
    /** Number of packages, when the network knows it (an indivisible load is one). Null = not stated. */
    packages: number | null;
    /** Box 6, marks and numbers: each package's SSCC, when the shipper's GS1 prefix gave them. */
    marks?: string[];
    grossKg: number;
    volumeM3?: number;
    dangerous: boolean;
    /** Box 9 — the dangerous goods by their generally recognised description, as the sender declared them. */
    dangerousGoods?: { unNumber: string; properShippingName: string; hazardClass: string; packingGroup?: string };
    temperatureBand?: string;
    fragile: boolean;
  };
  /** Box 13 — sender's instructions. */
  instructions: string[];
  /** Box 19 — special agreements: a declared value, a special interest in delivery, an agreed time-limit (CMR Art. 6(2)(d), (f)). */
  agreements?: string[];
  /** Box 14/20 — payment for carriage. */
  carriage: { amount?: number; currency?: string; paidBy: 'sender' | 'between-parties' | 'not-priced'; note: string };
  /** Box 16 — carrier, and the vehicle that took the goods over. */
  carrier?: NoteParty & { driverName?: string; plate?: string; vehicleClass?: string; cover?: string };
  /**
   * Box 17 — THE CARRIER WHO CARRIED IT, where that is not the one the sender contracted with (the user, 2026-10-28:
   * "Contracted in 16, carrier in 17"): an order placed with a fleet under contract and carried by a partner it was handed
   * to, or by a driver from the board it was released to. Box 16 then names the contracted fleet; this one, the driver and
   * the vehicle, and when it took the goods over — and `via`, a partner that passed it on without carrying it.
   */
  successive?: Array<NoteParty & { driverName?: string; plate?: string; vehicleClass?: string; takenOverAt?: string; via?: string; cover?: string }>;
  /** Box 18 — carrier's reservations and observations. */
  reservations: string[];
  /** Round 15 — the seals on the load, one line each: number, ISO 17712 class, maker, who closed it, what became of it. */
  seals?: string[];
  /** Box 21 — established in / on. */
  established: { place: string; at: string };
  /** Boxes 22–24 — the three confirmations, in the order the goods travel. */
  confirmations: { sender: NoteConfirmation; carrier?: NoteConfirmation; consignee?: NoteConfirmation };
  /** Where the network's own record of this load can be followed. */
  trackingUrl?: string;
  /** FP3b — every door the driver stood at and could not hand over at, in words. Listed in box 24 until delivered. */
  attempts: string[];
  /** FP3b — the sender's claim against the delivered goods, and its decision when there is one. */
  claim?: { line: string; decision?: string };
  /**
   * THE RECEIVER'S COPY (the user, 2026-10-26: "Its copy, no carriage price"). A business that receives goods at its own
   * places reads the note of a load sent to it, as a CMR consignee holds its copy — without the carriage price, which is
   * between the sender and the carrier; except where the agreed term makes the carriage payable by the consignee, whose
   * price it then is. Frozen beside the full note at every signature, with a fingerprint of its own.
   */
  copy?: 'consignee';
  /** FP3 — the load was withdrawn before taking over. Boxes 23 and 24 then say so instead of "not yet". */
  cancelled?: { at: string; reason: string; by: 'sender' | 'network' };
  /** Refused by the consignee, and what the sender decided (the user, 2026-10-27). Box 24 then says so instead of "not yet". */
  refused?: { line: string };
}
