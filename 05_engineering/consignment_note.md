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
(delivery; box 24, which today says the receiver's own confirmation is *not recorded* — FP3 gives it a photo and a
name). What the network does not know, the box says it does not know.

A store's buyer is named *as the buyer* (of order …, collects at …) — never by phone number.

## Who reads it
The sender (the shop that posted it, or the store), the carrier (the driver, or the driver's fleet) and network
staff. Anybody else is told the load does not exist. Routes: `GET dispatch/freight/:id/consignment-note` (data) and
`…/consignment-note.html` (a printable A4 page with the tracking QR). Shown in the Shop app (Freight → load), the
Driver app (Loads) and the Fleet app (Earnings) through the shared `DocumentButton`.

## The receipt
Delivery raises `FreightDelivered`; the shipper (a shop with an account email) is sent *Delivered: <code>* with the
carrier, the time, the carriage charges and the note number. A store's system hears through its callbacks.

## Not yet
Receiver's confirmation with photo and name (FP3); a stated number of packages (the posting form does not ask);
successive carriers; a signed PDF — the printable page is the document today.
