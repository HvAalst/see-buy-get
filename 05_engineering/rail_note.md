# The rail note — held, checked, and where road meets rail

**User, 2026-10-28** (after the CMR check): "the CIM check. Not just the african nations, europe deals with eCIM so we
should be fit and flexible". Then: "also investigate other BRICS nations for rail cargo regulations". Then, the
decision: "for now we hold the note but we should be able to see whether it is valid, so far we are not optimizing sbg
for rail but we might have to for those nations that have not optimized yet. I want to reduce mistakes and delays
(south africa is struggling) for road where road and rail comes together."

Research (sources for every claim): [research/rail_cim_and_east_africa_2026-10-28.md](research/rail_cim_and_east_africa_2026-10-28.md)
and [research/rail_brics_2026-10-28.md](research/rail_brics_2026-10-28.md).

## What we found
- **No East African state is in OTIF (CIM) or SMGS.** CIM's 51 members include only Algeria, Morocco and Tunisia in
  Africa. East African rail is national law plus each railway's own conditions (Kenya Railways' Tariff Book, Appendix
  II; URC Act Cap. 331; Tanzania's Railways Act 2017; the TAZARA Acts; Ethiopia's Proclamation 547/2007, which covers
  rail wagons). The Northern and Central Corridor agreements only commit states to accept each other's rail waybill.
- **CIM allows the electronic note directly (Art. 6 §9)** — no protocol, unlike the e-CMR. The railway holds it: "the
  right to process the electronic consignment note belongs to the carrier who has custody of the goods" (GLV-CIM
  Appendix 1); a printout must say "Printout of the electronic consignment note – date – produced by … (carrier)".
- **Everywhere, the railway (or a state system) issues the note**: the e-CIM in the railway's system, Russia's rail
  waybill electronic by statute since 1 September 2026 (filed to the state system), Brazil's CT-e (model 57) since
  2012, India's eT-RR, China's waybill "or electronic data". The consignor declares; the railway issues.
- **BRICS**: Russia and Iran are in both CIM and SMGS (Russia applies CIM only on listed lines); China is SMGS; Brazil
  is ATIT (South America); India, South Africa, Egypt, Ethiopia, the UAE and Indonesia are in neither. Particulars are
  set by law in Russia, China, Indonesia, Ethiopia and (by the railway's board) Iran; by contract in South Africa and
  the UAE. Egypt's rail law and Transnet's current conditions were NOT verified.
- **EU eFTI (Regulation 2020/1056)** concerns regulatory information shown to authorities, not the contract
  document; full application 9 July 2027. It does not make an e-CIM valid — CIM Art. 6 §9 does.

## The decision: hold the railway's note, and check it
SeeBuyGet issues no rail note. It HOLDS the one the railway issued — a copy, and the particulars as printed on it,
entered by whoever holds it — and says whether it is complete for the law of its lane, and what a gap costs.

1. **BUILT — the law of a rail lane, from membership** (`foundation/carriage-law/rail.ts`), as the road note's is:
   - `cim` both ends in CIM states (Art. 1 §1);
   - `cim_lines` both in CIM, one applying it only on listed lines (Art. 1 §6: AZ EE GE RU UA);
   - `smgs` both ends in SMGS states;
   - `cim_smgs` one end CIM, the other SMGS — two successive contracts, on the common CIM/SMGS note where the
     railways agree, else re-consigned at the changeover;
   - `cim_if_agreed` one end in a CIM state, the other in none (Art. 1 §2: only if the parties agree);
   - `atit` both ends in ATIT states;
   - `contract` two countries no instrument joins — the railway's own conditions and the law they name;
   - `national` one country — its law and its railway's conditions.
   Suspended members (Iraq, Syria) count as not parties. Every instrument and railway carries its source and the day
   it was checked; a railway not checked says so, never a guess.
2. **BUILT — the check of a held note**: the particulars the lane's law asks for, against what is printed; what a gap costs
   (no CIM statement — Art. 8 §3; no declared value on a Kenya Railways note — KSh 20,000 at most, cl. 9); the claim
   windows; and for an electronic note, its form (Brazil's CT-e key and its check digit, the CIM printout line,
   Russia's electronic-only rule) and where the issuer lets it be looked up. We never say "valid" on our own word:
   "complete for …, as printed", with the day the law was checked.
3. **BUILT 2026-10-29 — where road meets rail**: the road note and the rail note agree before the truck leaves
   (container number with its check digit, seals, gross mass against the verified gross mass, consignee, stations);
   the road leg to a rail terminal is timed to the train's cut-off; the pickup at the far end waits for the
   railway's arrival notice; the free days at the terminal run on the box clock.

## FBL — the same pattern, not ours to issue
Issuing a FIATA FBL makes the issuer the multimodal transport operator for the whole journey, sea included, through a
FIATA national association, with liability insurance and negotiable originals (release only against an original).
That contradicts "never the sea" and "quotations, never payments". What we can do: hold the FBL a user's forwarder
issued, check it is genuine and agrees with our papers, and say what it means. To be researched before building.

## Built (2026-10-28)
- `foundation/carriage-law/rail.ts`: `RAIL_INSTRUMENTS` (CIM 49 counted + IQ SY suspended, AZ EE GE RU UA on listed lines;
  SMGS 26; ATIT 7), `railRegimeOf`, `RAIL_PARTICULARS` (27), CIM Art. 7 §1 and SMGS Art. 15 §1 as requirement lists,
  `RAILWAYS` (13: krc urc trc tazara edr rzd china_railway indian_railways brazil kai transnet etihad_rail rai) with limits,
  claims, electronic rules and a caveat where the note's rules were not read, `cteKeyProblem` (Brazil's 44-digit key,
  model 57, modulo-11 check digit), `checkRailNote` (findings missing/ask, asked, complete, notChecked, electronic,
  limits, claims, caveats incl. the Northern and Central Corridor waybill acceptance).
- `modules/pudo/rail-note.ts` + `rail-note.types.ts`: `holdRailNote` (refused before writing: unknown railway,
  no station, a day to come, nothing to find it by), `railNoteView` (the check, and the box number — ISO 6346 check
  digit — and seals against ours).
- Routes: `POST exports/:id/rail` (exporter with a copy or number; its agent by number only), `POST imports/:id/rail`
  (importer or agent; staff refused by name), `GET rail/railways`, `POST rail/check` (writes nothing). A replaced note
  is kept in `formerRail`.
- Screens: `apps/tower/screens/RailNotePanel.tsx` on the Business app's export and on the import screen (console and
  Business app); asks only what the lane's rules ask. Help: business-exports note 4. Glossary: CIM, SMGS, ATIT, SDR, RID.
- Tests: rail.spec.ts (22), test/export-rail.e2e-spec.ts, business.e2e-spec.ts (Djibouti–Modjo), rail-note.test.tsx.

## Built (2026-10-29) — where road meets rail
The user: "build the clock with the blocker as you said. and in help page an explanation as to why and what."
- `rail-leg.types.ts`: `ExportByRail` (rail terminal, train cut-off, reference, `atPort`), `ImportByRail` (terminal,
  expected, free days, `arrival`, `collectAnyway`, warned), `FreightRailGate` on `Freight.waitsForRail`,
  `railRefusal` (the board's and the take's words), `railTerminalClock` (not_started / running / due_soon / over /
  stopped / no_free_days).
- Export: `handoverOf` — the port gate, or by rail the rail terminal — drives `timingOf`, the laden leg (destination,
  delivery window, instructions, the refusal after the cut-off) and the bell. The train's cut-off must fall before the
  gate's and after now; set or cleared only before the load is posted. By rail the line's clock counts the box inside
  only from `atPort` (recorded), not from our truck's delivery.
- Import: `setByRail` / `recordRailArrival` (importer or agent) / `collectAnyway` (importer alone, with a reason).
  By rail the train is the run from the quay (no bonded road leg) and the road leg is collected at the rail terminal
  (the controller falls back to it when no port is chosen). `gateRoadLeg` sets the gate on an untaken leg and lifts it
  on the arrival or the importer's word; `DispatchService.setRailGate` never closes a gate on a taken load.
  `RailTerminalSweeper` → `sweepRail`: the importer and agent told on the last free day and once when over.
- The gate is asked at the board (`RAIL_NOT_ARRIVED`, resolvable), all three offer paths and the take.
- Screens: `ExportByRail` (Business app export), `ImportByRail` (import screen, console + Business app); the import's
  road-leg form names the rail terminal instead of asking for a port. Help: in-app article `road-meets-rail` (business,
  driver, fleet, console), the why and the what.
- Known limit: by rail on an import, the line's own clock (demurrage/detention) still keys to our truck's pickup; the
  train's departure from the port is not recorded yet.
