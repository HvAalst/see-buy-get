# PUDO parcel-flow review (2026-06-29)

Critical review of the end-to-end parcel flow, grounded in the code. Build plan = the **Gaps** below.

## Works end-to-end
- **Direct PUDO→PUDO (outbound):** accept → handover (per-parcel scan) → arrive (OTP + shelf slot) → pickup. Wallet gate + fees + ledger anchoring; graduates onto M4 timeline + M7 twin.
- **Inbound e-commerce:** createInbound → intake → handover → shelve → collect/collect-confirm or dispute; vendor HMAC callbacks fire.
- **MDP tote flow (inbound):** fill → release → dispatch claim → loadBag (On_Bus) → dropBag (empties, At_MDP) → sortParcel (next-hop bag) → loadBag onward. Vehicle capacity/fragile enforced. Multi-MDP hops compute.

## Gaps (the build list)

### P1 — flow-breaking / leaks
1. **No "deliver bag at the destination PUDO."** `dropBag` only exists for an MDP. At a dest PUDO parcels can still be shelved one-by-one (arrive/shelve accept On_Bus) but **the tote stays `in_transit` forever and the claiming driver's reserved capacity never releases**; bag-level unload is missing. → `deliverBag(agentDid, code)`: shelve each → empty/free tote → release capacity.
2. **Outbound can't traverse MDPs.** `sortParcel` needs `destAgentDid`; outbound `accept` only sets `destZone`. MDP multi-hop is inbound-only. → Let outbound nominate a destination PUDO at accept (optional `destPudoDid`) so it can be MDP-sorted; un-nominated stays direct/flexible.

### P2 — visibility / consistency
3. **Monitoring blind to `At_MDP`.** Flags cover At_PUDO (Stagnant) + On_Bus (Ghost Bus) only. → Add a `Stuck_At_MDP` flag (config dwell hours).
4. **Tote-flow parcels miss the M4 HANDOVER milestone.** `loadBag` moves via `setTransit` (no event); graduation only hears `ParcelHandedToBus` from the direct `handover`. → Emit handover from `loadBag`.
5. **MDP "to sort" overstates.** A sorted-but-not-loaded parcel stays `At_MDP`. → Distinguish unsorted (At_MDP && !toteId) vs sorted-awaiting-load (At_MDP && toteId) in the dashboard.
6. **`planJourney` advisory only** — not attached to the parcel. → Expose a per-parcel planned route (`GET /parcels/:id/route`, controller-level to avoid the ParcelService↔Routing↔Mdp DI cycle).

### P3 — economics / lifecycle completeness
7. **No fees on the tote/MDP/dispatch path.** Direct path pays accept/handover/pickup; MDP sorter + claiming driver earn nothing. → Driver transport payout on `loadBag` + MDP sort labour ledger on `sortParcel` (float-funded ledger, like `driverPayout`).
8. **Freight dead-ends:** registerFreight → claim, no pickup/deliver/settle. → `pickup` + `deliver` (claimed → in_transit → delivered) + capacity release.
9. **Thin reverse logistics:** `void` only for At_PUDO outbound within 5 min. → `cancel` for not-yet-delivered parcels (Created / At_PUDO / At_MDP).

## ✅ Built (2026-06-29) — all gaps closed
- **P1#1 deliver-bag:** `MdpService.deliverBag(agentDid, code)` → shelve (inbound) / arrive+OTP (outbound) each → empty tote (freed + driver capacity released). `POST /pudo/agents/:did/receive-bag`; agent app "Receive a bag" screen.
- **P1#2 outbound→MDP:** optional `destPudoDid` on `accept` sets `destAgentDid` → outbound is MDP-sortable.
- **P2#3** `Stuck_At_MDP` flag (`MDP_DWELL_H` = 12). **P2#4** `loadBag` emits `ParcelHandedToBus` → M4 HANDOVER. **P2#5** MDP dashboard splits unsorted (At_MDP && !toteId) vs sorted-awaiting-load. **P2#6** `GET /pudo/parcels/:id/route`.
- **P3#7** tote-path fees: `driverPayout` on `loadBag` (fleet drivers) + `sortLabour` on `sortParcel` (`TOTE_LOAD_FEE` 0.5 / `MDP_SORT_FEE` 0.2). **P3#8** freight `pickup`/`deliver` (+ capacity release). **P3#9** `ParcelService.cancel` (Created/At_PUDO/At_MDP → Voided, refunds cash).

**191 unit + 27 e2e green, lint clean.** Live-verified: route pudo→mdp→pudo; outbound sorted at MDP; deliver-bag → Ready_For_Pickup + tote freed; cancel → Voided; freight registered.

Known smaller follow-ups (not blocking): cancelling an At_MDP parcel leaves it in its tote (no remove-from-tote); planned route is exposed but still not enforced on movement; bag-level deliver shelves per-parcel internally. Next: the vendor-feature clarification.
