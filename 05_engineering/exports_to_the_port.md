# Exports to the port — the road leg and its papers, never the sea

**The user, 2026-10-27:** Freightos "seem to match ocean freight … I want to stay away from their role in logistics, but
when goods move to a port, we need to have the documentation and foundation for ocean shipments ready." Then: "we keep
our side open to forwarders and shipping lines, but not anything is a job for now. The missing for goods going to a port
should be build."

## The line we hold

- **Never ours:** ocean rates, vessel space, bookings with a line, a bill of lading issued, a forwarder's or an NVOCC's
  role, customs entries, submitting a verified gross mass to a line. We hold **references** to all of them, typed by the
  exporter from what its forwarder or the line gave it.
- **Ours:** the road — an empty box from a depot to where it is stuffed, the laden box from there to the terminal before
  the gate closes — and the papers and facts the forwarder needs at the port, in one file.
- **Open to any forwarder or line:** nothing is keyed to one company; no integration is built (not a job for now).

## The pieces (EX1–EX5), all on one record: the export consignment `EXP-nnn`

`ExportService` (`export.service.ts`, `export.types.ts`), its own store, the exporter's (a business: shipper or
expeditor) — staff read, never act in its name.

1. **EX1 — the forwarder's booking and the gate cut-off.** Booking reference, booked with (forwarder or line) and its
   name, vessel and voyage, the **gate-in cut-off** (required), the VGM and documents cut-offs, the empty release
   reference. Places: where the box is stuffed (the business's saved place, new site kind `loading`), the terminal
   (saved place, kind `port`), the empty depot (saved place, kind `port`, optional — the line or forwarder may bring the
   box). **Timing, derived on read:** the latest the laden truck may leave = cut-off − (road km ÷ truck speed + a 4 h
   gate buffer); state on time / at risk / missed / gated in. A sweep warns the exporter, once each: six hours before the
   latest departure while no truck has collected it; at the cut-off when it has not gated in; twelve hours before the VGM
   cut-off with no VGM.
2. **EX2 — empty out, stuffed, to the port.** The empty leg (depot → loading place, an empty run carrying the release
   reference). Stuffing records the container number (ISO 6346 check digit). The laden leg (loading place → terminal):
   the box's type facts as the import leg passes them, the cut-off in its delivery window, the booking and the release
   in its instructions, the VGM as its weight when declared. **The seal is written on the laden load with the existing
   seal panel and its three photographs** — one way to seal a load, not two. Delivered at the terminal = gated in.
3. **EX3 — verified gross mass.** Method 1 (the packed box weighed) or 2 (contents + tare), the kilograms, the
   weighbridge and ticket, who signs for it, when. Recorded and handed over; never sent to the line.
4. **EX4 — export papers.** Commercial invoice, packing list, certificate of origin (not every destination asks), each
   attached from the business's own documents; the export entry as a **reference** its clearing agent gave.
5. **EX5 — one handover file.** A printable page for the forwarder at the port: booking, cut-offs, box and type, seal
   (from the laden load), VGM, papers with their references, the road consignment note's number, when it gated in; and
   the **bill of lading number** once the forwarder issues it, recorded back so the receiving end can match it.

## Not built (said, not hidden)
The box's clocks for an export (detention from the empty's release) — the import side's clocks are not reused yet; a
clearing agent appointed on an export (the import's grants); air exports; the barge leg (Y5).
