# The consignment note — the CMR as the standard where there is no standard

**User, 2026-09-14:** "in the Netherlands a CMR freight document (vrachtbrief) is a standard shipping doc. That needs
to be implemented and let it be the standard when there is no standard."

## What it is
One document per load, for its whole life, in the layout and numbering of the CMR consignment note (boxes 1–24):
sender, consignee, place of delivery, place and date of taking over, documents attached, the goods (marks, packages,
packing, nature, gross weight, volume), sender's instructions, payment for carriage, carrier and vehicle, successive
carriers, carrier's reservations, special agreements, charges, established in/on, and the three confirmations —
sender, carrier, consignee. Number `CMR-<load code>`.

- **Across a border** (pickup and destination countries differ) it is titled *CMR — International consignment note*
  and carries the Convention clause: the CMR applies of its own force to international carriage by road.
- **Everywhere else** it is *Consignment note (CMR layout)*: same boxes, same numbering, said plainly to be the
  network's standard form where no national form applies — so a driver, a shop and an inspector read one page.

## Where the boxes come from
It is **derived, never typed.** Every box is filled from facts the network already holds and acts it already records:
posting (sender, goods, instructions, charges, established in/on, the sender's electronic confirmation), the
**load-safety gate at pickup** (taking over; the carrier's confirmation; the vehicle, fixed on the load as
`Freight.carriage` from the driver's shift at that moment — read live it would follow the driver's later shifts),
temperature logs (documents attached; a breach becomes a carrier's reservation), and the **unload report at delivery**
(delivery; box 24 — the **proof of delivery**: the receiver's name, the driver's photo of the goods as put
down, and the receiver's remarks in their words; box 18 — the carrier's reservations written at pickup). What the network does not know, the box says it does not know.

A store's buyer is named *as the buyer* (of order …, collects at …) — never by phone number.

## Who reads it
The sender (the shop that posted it, or the store), the carrier (the driver, or the driver's fleet) and network
staff. Anybody else is told the load does not exist. Routes: `GET dispatch/freight/:id/consignment-note` (data) and
`…/consignment-note.html` (a printable A4 page with the tracking QR). Shown in the Shop app (Freight → load), the
Driver app (Loads) and the Fleet app (Earnings) through the shared `DocumentButton`.

## The receipt
Delivery raises `FreightDelivered`; the shipper (a shop with an account email) is sent *Delivered: <code>* with the
carrier, the time, the carriage charges and the note number. A store's system hears through its callbacks.

## Reservations, proof of delivery, withdrawal (FP3a)
- **Box 18, at pickup.** The driver may write a reservation about the goods as handed over (`Freight.reservations`).
  Optional, at most 500 characters, only ever the driver's words. It is the carrier's protection under the CMR: a
  defect noted at taking over is not damage in transit.
- **Box 24, at delivery.** The unload gate requires the **receiver's name** (2+ characters) and a **photo of the goods
  as put down** (`podPhotoId`, adopted as media kind `pod` under the same S29 rule as the securement photo), and takes
  the receiver's remarks (`Freight.proofOfDelivery`). Refusals: `RECEIVER_REQUIRED`, `DELIVERY_PHOTO_REQUIRED`.
  Nobody signs on a screen; the name and the photo are the proof. The receipt to the sender names who received it.
- **Withdrawal.** `POST dispatch/freight/:id/cancel {reason}` by the poster, the shipper (a store under its store id)
  or staff, while the status is `scheduled | available | claimed` — never once the goods are taken over
  (`INVALID_STATE`). Effects: status `cancelled` (terminal, the record stays with `cancellation {by, role, reason,
  refunded?}`); a billed sender is rebated exactly the stamped charge (the no-show rule); open prices are
  `superseded`; pending offers lapse; `FreightCancelled` is raised and the claimed driver, if any, is notified
  (`load_cancelled`). The driver's and the fleet's registers keep the job with nothing earned. The note's boxes 23
  and 24 say the load was never taken over and why.

## The exceptions (FP3b)
- **Could not deliver.** `POST dispatch/freight/:id/delivery-failed {outcome: absent|refused|unreachable, note?}` by the
  claiming driver while `in_transit`. Appends to `Freight.deliveryAttempts`; the status does NOT change — the goods are
  still on the van and still the carrier's to answer for. Raises `FreightDeliveryFailed`; the sender (poster or
  shipper) is notified (`freight_problem`). Box 24 lists every attempt until delivery. Turning the load back to the
  sender is not modelled: it is a conversation with the driver today.
- **The claim.** `POST dispatch/freight/:id/claim {kind: damaged|short|not_received, description, photoRef?}` by the
  sender, against a `delivered` load, once, within `FREIGHT_CLAIM_WINDOW_DAYS` (7 — the CMR's window for non-apparent
  damage). `Freight.claim` is the freight analogue of the parcel's `DisputeCase`; the photo is adopted under the S29
  rule and all the load's proof goes onto the dispute-evidence clock (`MediaService.holdFreightForDispute`).
- **The decision.** Operators: `GET freight-claims` (oldest first, with `coverable`, `awardCap`, `capBasis`, the
  evidence and the receiver) and `POST freight-claims/:id/resolve {decision, award?, note, by?}`. Every ending needs a
  note. **An award is possible only where a sister billed the load** (`Freight.billed` + a store shipper): it is paid
  with `VendorService.payClaim` from the claims provision, capped by `MAX_CLAIM_AWARD` (a sanity bound, not a policy).
  Where carriage was settled between the parties, an award is refused (`INVALID_STATE`) and an upheld decision is
  recorded as `paidTo: between_parties` — who was right, without money that does not exist. The driver's pay is
  untouched by a claim: clawing it back is a policy nobody has decided. The claimant is notified (`claim_decided`).

## Not yet
A stated number of packages (the posting form does not ask); successive carriers; a signed PDF — the printable page
is the document today. Turning a load back to the sender after failed attempts (CMR art. 15 instructions); a carrier
clawback on an upheld claim; the consignee's own confirmation (today the driver records the name).
