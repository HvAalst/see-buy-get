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

## The pieces (EX1–EX8), all on one record: the export consignment `EXP-nnn`

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
4. **EX4 — export papers** (widened 2026-10-28, the user: "we don't book but we hold documents as a report"). The
   catalogue in `export.types.ts`, general names, never one country's agency, in three groups: **needed** on every
   export, counted missing until given (commercial invoice, packing list, export entry); **kept** when there is one,
   never counted missing (booking confirmation, shipping instructions, weighbridge ticket, bill of lading copy — the BL
   number stands on its line until the copy is attached); **asked** for these goods by the exporter or its agent,
   attributed, counted missing once on the list (certificate of origin, phytosanitary, fumigation, export permit or
   licence, inspection or conformity, analysis or quality, health or veterinary, insurance, dangerous goods declaration —
   on the list from the start for `HAZ-*` goods — letter of credit, or `other-N` by name). Only whoever asked takes a
   line off, and only while nothing was given. Each is the exporter's own document — uploaded on its line, filed under
   `relatesTo` `EXP-nnn:<key>` so two papers of one kind never version over each other — or a reference.
5. **EX5 — one handover file.** A printable page for the forwarder at the port: booking, cut-offs, box and type, seal
   (from the laden load), VGM, papers with their references, the road consignment note's number, when it gated in; and
   the **bill of lading number** once the forwarder issues it, recorded back so the receiving end can match it.
6. **EX6 — the box's clock** (the user, 2026-10-28: "1 and 2 are clear addition to what you built here"). The import's
   clock the other way round (`exportBoxClock` in `container-box.ts`): **detention** from the empty out of the depot — the
   empty load's pickup, or, where no load of ours fetched it, the time the exporter records — until the laden box is
   inside the gate; **demurrage** from the gate until it is **loaded on board**, recorded by the exporter from its
   forwarder's or the line's word (never before the gate, never ahead of now). Dates and whole days, never money. The
   free days are the exporter's claim, attributed and dated, every claim kept and the latest in force; no claim, no
   date. The sweep tells the exporter once three days before each date and once when it passed, keyed by the date (a
   corrected figure is a new date, warned afresh). The handover file carries the clock in words.
7. **EX7 — a clearing agent on the export.** The exporter appoints one from the agents' directory (never itself, never
   a silent swap — the first is ended before a second is appointed; staff appoint nobody in its name) and ends it with a
   reason; both are told. **The appointment is the grant**, derived, never a second list: the agent finds the export in
   its own Exports, reads the papers attached on it (`GET exports/:id/papers/:key/file`) and nothing else of the
   exporter's, gives the export entry by its number (its own word, so it stands as accepted), and accepts each paper or
   sends it back with a reason. A paper sent back is missing until supplied again, which clears the word and tells the
   agent. Ended, the reading ends on the same call; the former appointment stays on the record.
8. **EX6b — a box the exporter owns** (the user, 2026-10-28: "ok, great, implement it"). A shipper-owned container,
   said when the export is recorded or later on the export (and taken back: the line's after all). No line lent it, so
   the clock is `owned`: no free days are taken, nobody is warned, and the handover file says whose box it is.
9. **EX8 — the clearing agent's fee.** The import's bargain as a quotation (`quote.types.ts`, subject `export`), never
   a payment through us: the appointed agent quotes (currency of the origin country unless it says), the exporter is
   told and agrees (the agent is told), a re-quote drops the agreement, paid or open is said by either on the
   quotation. **One quotation per appointment** (subject id `exportId@agentEntityId@appointedAt`): when the appointment ends its
   quotation stays on that former appointment (`feeQuoteId`), and the next agent quotes its own from nothing.
10. **EX9 — the shipper's letter of instruction** (the user, 2026-10-28: "not just take the reference, but rather the
    form fields"; then as recommended: a form, needed, frozen on signing). `export-sli.ts` (the rules and the page) and
    `export-sli.types.ts` (the shapes — the swagger plugin reads `*.types.ts` only). What the export already knows is
    read at signing (shipper with its registration and tax numbers, forwarder, booking, vessel, port, terminal, box,
    seal, verified gross mass, documents cut-off, papers enclosed); the form asks the consignee (named / to order / to
    the order of a bank), notify party, port of discharge, place of delivery, Incoterm and place, freight prepaid or
    collect, the bill's release (originals — three unless said — sea waybill, telex release) and copies, goods lines
    (marks, packages and kind, description, the exporter's own HS code, gross, net, volume), dangerous goods particulars
    where hazardous, letter of credit, special instructions. Needed on every export; a typed reference is refused.
    Signing is refused until complete (`sliGaps`); the page is drawn once and kept in `export-sli-copies` exactly as
    signed with its sha256; a change is a new version. **Out of date** (`sliStale`) only when a fact it carried changed
    — booking, vessel, box, port, or a weight or seal on it now different — never because one came in after signing.
11. **EX10 — the packing list, imported** (the user, 2026-10-28: "a matter of moving data and eliminating steps … a
    shipper doesn't want to import by hand … that should be dynamic and adaptable"; then as recommended: import it, the
    letter summarises it). `export-packing.ts` + `export-packing.types.ts`. In: a workbook (`readWorkbook`), CSV text
    or pasted cells (`cellsWithRows` keeps the sheet's own row numbers; the separator read off the first twenty lines),
    or rows from the business's own system (`POST sbg/api/business/exports/:id/packing-list`, test key checks only, a
    key never signs). Headings recognised by their common words, or as the business matched them before
    (`export-packing-templates`, per business), or as chosen now; an unknown heading is KEPT and printed. Units in
    headings converted; the heading block and a total row passed by. Check, then import — refused while any line has a
    problem. Signed and frozen like the letter (`export-packing-copies`); the packing paper line is given by it or by
    the shipper's own document. The letter's goods are `summarisePacking` (per description, HS code, package kind;
    past thirty lines, per HS code), and the list's fingerprint is in the letter's basis — a new list outdates it.
12. **EX11 — the commercial invoice, from the same lines** (the user, 2026-10-28: "a flexible document since it is
    virtually different in every nation"). `export-invoice.ts` + `export-invoice.types.ts`. Its lines ARE the packing
    list's; the reader also takes `unitPrice`, `lineValue`, `originCountry` (and a currency named in a price heading) —
    never printed on the packing list. A **fixed core** (seller with its numbers, buyer with a tax or import number as
    its own country knows it, consignee, number, date, currency, Incoterm, payment terms, reason, the export's
    references, lines with HS code, origin, quantity, unit price, value; charges by name, a discount below zero; our
    truth declaration; signed) — refused only without a number, a currency, a buyer, or a value on every line. A
    **flexible rest** in the exporter's words: particulars by their own names (kept while empty, printed when filled),
    declarations in the destination's words, which list columns to print. **No nation's rules are written in:** what
    a business's last signed invoice to a country carried is kept in `export-invoice-templates` (`entityId:country`)
    and offered on its next — never imposed, never shared between businesses. Missing HS codes and origins are said,
    not refused. Frozen on signing (`export-invoice-copies`); a changed list outdates it.
    **Chosen, never typed** (the user, 2026-10-28: "currency should be an selector with country behind it to avoid
    errors"; "payment terms should be selected too with an 'other' option"): the currency is picked from the country
    catalogue's currencies, each shown with its name and the countries that settle in it, the likeliest first (the
    export's two countries, a currency the shipper's file named) — on the invoice and on both agent fees. The server
    refuses a code no country settles in (`isKnownCurrency`), so "KSH" cannot be stored. Payment terms are one of
    nine usual terms (advance, letters of credit, cash against documents, documents against acceptance, open account
    30/60/90, consignment) or "Other" with the exporter's own words; the stored value is the words, so a saved
    invoice reads back either way. **Every choice on an export is the console's picker** (the user, 2026-10-28: "move
    them to the same picker"): the letter's consignee kind, trade term (said in full on the button, "FOB — Free On
    Board"), freight and release; each packing-list column's use; the booking party, a paper from the business's
    documents, how the box was weighed, and the paper these goods need. Then the rest of the Business app (the user:
    "You can do those"): a load's packaging and kind of goods (each with what it means for the truck), its seals, its
    commercial invoice (the currency chosen with its countries; the server refuses a code no country settles in), a
    damage claim, a run, a member's role, the GS1 digit, who a load is sent for. `business/selects.test.ts` refuses a
    native `<select>` or `<datalist>`, or a typed currency box, anywhere in the Business app.

## Not built (said, not hidden)
Air exports — new ground, to get its own help section once the user has read into it (the user, 2026-10-28); the barge
leg (Y5).
