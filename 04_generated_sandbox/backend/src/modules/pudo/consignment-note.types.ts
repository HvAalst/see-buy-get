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
}

export interface ConsignmentNote {
  /** CMR-<load code>: one note per load, for its whole life. */
  number: string;
  /** `cmr` when the load crosses a border (the Convention applies); `national` otherwise — same layout, said plainly. */
  kind: 'cmr' | 'national';
  title: string;
  freightId: string;
  code: string;
  trackingKey?: string;
  status: string;
  /** Box 1 */
  sender: NoteParty;
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
    cargoClass: string;
    packaging?: string;
    /** Number of packages, when the network knows it (an indivisible load is one). Null = not stated. */
    packages: number | null;
    grossKg: number;
    volumeM3?: number;
    dangerous: boolean;
    temperatureBand?: string;
    fragile: boolean;
  };
  /** Box 13 — sender's instructions. */
  instructions: string[];
  /** Box 14/20 — payment for carriage. */
  carriage: { amount?: number; currency?: string; paidBy: 'sender' | 'between-parties' | 'not-priced'; note: string };
  /** Box 16 — carrier, and the vehicle that took the goods over. */
  carrier?: NoteParty & { driverName?: string; plate?: string; vehicleClass?: string };
  /** Box 18 — carrier's reservations and observations. */
  reservations: string[];
  /** Box 21 — established in / on. */
  established: { place: string; at: string };
  /** Boxes 22–24 — the three confirmations, in the order the goods travel. */
  confirmations: { sender: NoteConfirmation; carrier?: NoteConfirmation; consignee?: NoteConfirmation };
  /** Where the network's own record of this load can be followed. */
  trackingUrl?: string;
}
