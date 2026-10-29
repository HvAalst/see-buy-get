# The FIATA bill of lading (FBL) — held, checked and explained, never issued

**User, 2026-10-28:** "if we optimize for FBL, we must know and report for our users. Give me your honest view on it."
My view, given then: hold, check and explain the FBL a user's forwarder issued; never issue one ourselves. **2026-10-29:**
"After that it's indeed a good time to research the FBL." Research, with a source for every claim:
[research/fbl_2026-10-29.md](research/fbl_2026-10-29.md).

## What the research found
- **Not issuing stands.** Issuing makes the issuer "a carrier" for the whole journey (FBL cl. 2.1), sea included, with
  liability insurance; in India (Multimodal Transportation of Goods Act 1993 s.3) and Ethiopia (Proclamation 549/2007)
  also a state registration or licence. Kenya has no FIATA association, so the route would be FIATA Individual Member —
  open, and still against "never the sea" and "quotations, never payments".
- **The text in force** is the FBL Standard Conditions (1992), "subject to UNCTAD / ICC Rules … (ICC Publication 481)";
  the FWB (non-negotiable waybill) is on the 1997 conditions. The terms "cannot be altered".
- **Limits** (cl. 8): 666.67 SDR a package or 2 SDR a kg, whichever is higher; 8.33 SDR a kg with no sea or inland
  waterway leg; the limit of a mandatory convention or national law where the stage of loss is known (8.6(a)); delay
  only if declared and accepted (6.2), at most twice the freight (8.7); lost after 90 days (6.4); notice at delivery or
  within 6 days for hidden damage (16); suit within 9 months (17); only where the forwarder has its place of business
  (19). **For a road-and-sea FBL a loss on our truck is likely capped at 2 SDR a kg, not 8.33** — no East African state
  is in the CMR, so the stage rule finds no road convention (lawyer to confirm).
- **Negotiable:** "title to the goods" by endorsement (cl. 3.1); one original surrendered duly endorsed against the goods,
  the others void; only the blue original is an original. A scan we hold is never an original.
- **Genuine?** Paper: no public check — the serial number is in the register of the association whose emblem is
  printed. Electronic (eFBL, since May 2022): FIATA's verification page (upload, document ID or QR) says whether it is
  registered, who issued it, and a snapshot as issued. No public API: we link out, never call it. It proves nothing about
  the current holder, endorsements or surrender, and a "non-FIATA branded" bill passes it too.
- **East Africa:** no East African association offers the eFBL; Kenya (KICA s.83B, 2011 text) and Uganda (Electronic
  Transactions Act 2011) exclude documents of title from their electronic-writing rules; Tanzania, Rwanda, DR Congo,
  South Sudan and Djibouti signed the Accra Convention on Negotiable Cargo Documents on 26 Oct 2026 (not in force).
  Ethiopia's Proclamation 548/2007 sets other limits (835 SDR a package or 2.5 SDR a kg; 2 years).
- **Risks of holding one:** a tick reads as vouching; a forged FBL can copy our container number exactly. Never "valid";
  never a lookalike of the form or FIATA's logo; the image shows the freight amount (who may see it).

## Proposed: the same pattern as the rail note
An export or an import holds the FBL (or FWB) its forwarder issued: a copy from the company's papers and what is printed.
1. **Complete as printed** — the boxes of the 1992 form (consignor, consigned to order of, notify, place of receipt,
   vessel, ports, place of delivery, marks, packages, description, gross weight, measurement, declared value and
   interest, freight payable at, number of originals, place and date of issue, stamp and signature with its capacity).
2. **Agrees with our papers** — container and seals, packages, gross weight against the verified gross mass less tare,
   place of receipt (inside the FBL or not: our road leg's carrier answers to the forwarder), taking in charge not before
   our hand-over, ports and places, consignee (a bank "to order" with the buyer notified is normal).
3. **Genuine — where to look, and what was seen** — the eFBL: FIATA's page linked, and what it showed recorded with who
   and when; paper: the association to ask; the issuer in FIATA's directory for its country; India's DG Shipping register.
4. **What it means, in plain words** — negotiable or not, originals and surrender, the limits in SDR with an approximate
   dollar figure at a dated rate, delay, the deadlines, where to sue, and a country's own law where it overrides.

## Decided and built (2026-10-29)
The user's choices: the holder records FIATA's check of an electronic bill, with the result attached; no membership mark
in the agents' directory — "we do not check, but users can check, so we put a fiata link to their directory
https://fiata.org/directory/"; the limits in SDR with "about US$" at a rate kept as data with its date.
- `foundation/carriage-law/fbl.ts`: the two forms (FBL 1992, FWB 1997), the 18 boxes with their rule and kind (missing
  or only asked; the vessel and ports only with a sea leg; originals and the delivery agent only on the FBL), `SDR_RATE`
  (US$1.35178, IMF, 2026-10-28), the country notes (KE, UG, ET, IN, and the Accra signatories), `FIATA_VERIFY_URL`,
  `FIATA_DIRECTORY_URL`, `checkFbl` — meaning, limits, claims, country, where to check and what that proves.
- `modules/pudo/fbl-note.ts` + types: `holdFbl` (a paper bill needs its copy; an electronic one may go by number; a
  waybill has no originals; no day to come), `verifyFbl` (electronic only; the proof from the holder's own papers),
  `fblView` (box, seals, packages and weight against the packing list, the port).
- Routes: `POST exports/:id/fbl`, `…/fbl/verified` (the exporter; its agent gives an electronic bill by number);
  `POST imports/:id/fbl`, `…/fbl/verified` (importer or agent); staff refused. A replaced bill is kept in `formerFbl`.
- Screens: `FblPanel` on the export and the import; `FiataDirectoryHint` beside both clearing-agent pickers. Help:
  in-app `business-fbl`. Glossary: FBL, FWB, FIATA, UCP.
