import type { SbgClient } from '../client';

/**
 * Operator persona facade — the network's own staff, and the only role whose token carries the `*` scope.
 *
 * That makes this facade unlike every other one in this folder. The others are a HONEST SCOPE: a fleet
 * manager's token cannot reach a KYC decision, so naming those operations here would only produce a
 * button that 403s. An operator token can reach everything, so this list is not a boundary — it is an
 * inventory of what the console has actually built a screen for.
 *
 * Which is why it stays short and grows one screen at a time. A facade listing every operator route in
 * the contract would say the console does things nobody can do.
 */
export function createOperatorApi(sbg: SbgClient) {
  return {
    /**
     * The disputed-hazard queue: live constraints a driver says are not there any more.
     *
     * Longest-waiting first, measured from the DISPUTE rather than the report. Nothing else resolves
     * these — a refutation never clears a hazard, so anything in this list stays on every driver's map,
     * at full weight, until somebody here looks at it.
     */
    disputedConstraints: () => sbg.request((c) => c.GET('/v1/sbg/route-constraints/disputed', {})),

    /** The automatic flags as cases: the live ones (or the closed ones), the most pressing first. */
    flagCases: (which: 'live' | 'taken' | 'closed' = 'live', kind?: string) =>
      sbg.request((c) => c.GET('/v1/sbg/flag-cases' as never, { params: { query: { which, ...(kind ? { kind } : {}) } } } as never) as never),
    /** Take a case, let it go, note it, or close it with a reason. */
    caseAct: (caseId: string, act: 'take' | 'let-go' | 'note' | 'done', body: Record<string, unknown> = {}) =>
      sbg.request((c) => c.POST(`/v1/sbg/flag-cases/${encodeURIComponent(caseId)}/${act}` as never, { body } as never) as never),
    /** Evidence that lasts: the fingerprints kept and whether their chain is whole; which server writes the store. */
    evidence: () => sbg.request((c) => c.GET('/v1/sbg/evidence' as never, {} as never) as never),
    /** The pilot, week by week: the week so far, every frozen week, and the compendium's targets. */
    pilot: () => sbg.request((c) => c.GET('/v1/sbg/pilot' as never, {} as never) as never),
    /** A company's tax invoices (KRA eTIMS, Kenya only): the newest first, in one state or all, and where they go. */
    fiscalInvoices: (entityId: string, state?: string) =>
      sbg.request((c) => c.GET('/v1/sbg/fiscal-invoices' as never, { params: { query: { entityId, limit: 50, ...(state ? { state } : {}) } } } as never) as never),
    /** One as a page to print: KRA's block and QR, marked COPY — staff never hold the buyer's original. */
    fiscalInvoicePage: (invoiceId: string) => sbg.request((c) => c.GET(`/v1/sbg/fiscal-invoices/${encodeURIComponent(invoiceId)}/invoice.html` as never, { parseAs: 'text' } as never) as never),
    /** Send one again: refused by KRA (once what it refused is fixed), or one KRA said it already held. */
    retryFiscalInvoice: (invoiceId: string) => sbg.request((c) => c.POST(`/v1/sbg/fiscal-invoices/${encodeURIComponent(invoiceId)}/retry` as never, {} as never) as never),
    /** Parcels declared lost, and those found again in the last thirty days. */
    lostParcels: () => sbg.request((c) => c.GET('/v1/sbg/lost-parcels' as never, {} as never) as never),
    /** Declare one lost after a search — refused before a week without a scan — or mark it found. */
    declareLost: (parcelId: string, body: { reason: string; by?: string }) =>
      sbg.request((c) => c.POST('/v1/sbg/parcels/{id}/lost' as never, { params: { path: { id: parcelId } }, body } as never) as never),
    /** The trail: a load's or a bag's anchored steps, each checked now against the chain. */
    trail: (ref: string) => sbg.request((c) => c.GET('/v1/sbg/ops/trail/{ref}', { params: { path: { ref } } })),
    /** What staff opened: each record a member of staff read by its name or number, who, when, how many times. */
    staffReads: (query: { by?: string; record?: string }) => sbg.request((c) => c.GET('/v1/sbg/staff-reads', { params: { query } })),
    /**
     * 2026-10-25 — the terms of use, the data notice and the cookie statement every sign-up agrees to: every version,
     * written by one member of staff and published by a different one, or declined with a reason.
     */
    documents: () => sbg.request((c) => c.GET('/v1/sbg/documents', {})),
    proposeDocument: (kind: string, body: { title: string; body: string; changeNote: string; askAgain: boolean; country?: string; by?: string }) =>
      sbg.request((c) => c.POST('/v1/sbg/documents/{kind}/versions', { params: { path: { kind } }, body })),
    /** 2026-10-25 — a first text for a country's terms, naming its company of ours from the company's record ({} where none). */
    termsDraft: (country: string) => sbg.request((c) => c.GET('/v1/sbg/documents/terms/draft', { params: { query: { country } } })),
    publishDocument: (versionId: string, by?: string) =>
      sbg.request((c) => c.POST('/v1/sbg/documents/versions/{versionId}/publish', { params: { path: { versionId } }, body: { ...(by ? { by } : {}) } })),
    declineDocument: (versionId: string, reason: string, by?: string) =>
      sbg.request((c) => c.POST('/v1/sbg/documents/versions/{versionId}/decline', { params: { path: { versionId } }, body: { reason, ...(by ? { by } : {}) } })),
    /** Round 40 — the trail anchored outside our database: the auditor, a change waiting, the days kept; and an auditor's copy checked. */
    trailAnchors: () => sbg.request((c) => c.GET('/v1/sbg/ops/anchors', {})),
    /** What people wrote from the help's "Write to us": open (sorted), answered or closed; an answer by email; closing one. */
    supportInbox: (status: 'open' | 'answered' | 'closed') => sbg.request((c) => c.GET('/v1/sbg/ops/support', { params: { query: { status } } })),
    answerSupport: (reference: string, text: string) => sbg.request((c) => c.POST('/v1/sbg/ops/support/{reference}/answer', { params: { path: { reference } }, body: { text } })),
    closeSupport: (reference: string) => sbg.request((c) => c.POST('/v1/sbg/ops/support/{reference}/close', { params: { path: { reference } } })),
    proposeAuditor: (body: { address: string }) => sbg.request((c) => c.POST('/v1/sbg/ops/anchors/auditor', { body })),
    decideAuditor: (body: { approve: boolean; reason?: string }) => sbg.request((c) => c.POST('/v1/sbg/ops/anchors/auditor/decide', { body })),
    checkAnchorCopy: (body: { height: number; txId: string }) => sbg.request((c) => c.POST('/v1/sbg/ops/anchors/check', { body })),
    /** Round 35 — a unit held under the tamper protocol, by its code or number: every exception, who found it, the photographs. */
    tamperUnit: (ref: string) => sbg.request((c) => c.GET('/v1/sbg/ops/tamper/{ref}' as never, { params: { path: { ref } } } as never) as never),
    /** Release it, with what was found and done: the case closes under the same words. */
    releaseHold: (ref: string, body: { reason: string; by?: string }) =>
      sbg.request((c) => c.POST('/v1/sbg/ops/tamper/{ref}/release' as never, { params: { path: { ref } }, body } as never) as never),
    foundAgain: (parcelId: string, body: { note: string; by?: string }) =>
      sbg.request((c) => c.POST('/v1/sbg/parcels/{id}/found' as never, { params: { path: { id: parcelId } }, body } as never) as never),

    /**
     * Clear one — the ONLY way a reported hazard stops warning.
     *
     * `reason` is required by the server and kept forever: "either forgive or regret and we don't want
     * both". `by` names the human who made the call; the token only proves that somebody with the
     * operator credential did.
     */
    clearConstraint: (constraintId: string, reason: string, by?: string) =>
      sbg.request((c) =>
        c.POST('/v1/sbg/route-constraints/{id}/clear', {
          params: { path: { id: constraintId } },
          body: { reason, ...(by ? { by } : {}) },
        }),
      ),

    /** The group and its sisters — the shape of the business, not a public directory. */
    entities: () => sbg.request((c) => c.GET('/v1/sbg/entities', {})),

    /**
     * Everything one sister charges, on every lane, with the provenance of each number and the bounds the
     * next edit will be held to. One read, because the screen's job is comparing lanes with each other.
     */
    pricing: (entityId: string) => sbg.request((c) => c.GET('/v1/sbg/entities/{entityId}/pricing', { params: { path: { entityId } } })),

    /**
     * Turn the three rate layers, for one lane or for everything.
     *
     * `null` clears a layer back to its fallback and `undefined` leaves it alone — two different
     * intentions, and the reason every field here is optional AND nullable rather than merely optional.
     * Rates are FRACTIONS on the wire; the screen owns the percent conversion and does it in one place.
     */
    setRates: (entityId: string, body: { lane?: string; costOfRiskPct?: number | null; profitOnRiskPct?: number | null; marginPct?: number | null }) =>
      sbg.request((c) => c.POST('/v1/sbg/entities/{entityId}/rates', { params: { path: { entityId } }, body: body as never })),

    /** Set the tax a sister collects. A rate above zero is refused without a registration — by the server,
     *  and the screen says so before anybody presses save. */
    setTax: (entityId: string, body: { lane?: string; ratePct?: number | null; label?: string | null; registration?: string | null }) =>
      sbg.request((c) => c.POST('/v1/sbg/entities/{entityId}/tax', { params: { path: { entityId } }, body: body as never })),

    /** Set what a sister charges a shop or a store to put money in — flat below a threshold, free above.
     *  An EMPTY body removes the rule, which is how "we charge nothing to top up here" is said; a fee of
     *  zero is refused, because a charge of nothing still puts a fee on a shopkeeper's screen. */
    setTopUpFee: (entityId: string, body: { amount?: number; freeAbove?: number }) =>
      sbg.request((c) => c.POST('/v1/sbg/entities/{entityId}/top-up-fee', { params: { path: { entityId } }, body: body as never })),

    /** Set figures on a company's list of amounts — what a parcel costs and what each step pays, in its own money.
     *  A key left out is left alone; `null` puts one back to what every company starts from. */
    setAmounts: (entityId: string, body: Record<string, number | null>) =>
      sbg.request((c) => c.POST('/v1/sbg/entities/{entityId}/amounts', { params: { path: { entityId } }, body: body as never })),

    /** Set what a sister covers for free, and what it charges to cover more. */
    setInsurance: (entityId: string, body: { lane?: string; premiumPct?: number | null; freeLimit?: number | null }) =>
      sbg.request((c) => c.POST('/v1/sbg/entities/{entityId}/insurance', { params: { path: { entityId } }, body: body as never })),

    /**
     * Say which of a CARRIER's own papers this sister will not trade without. The whole list every time —
     * an empty one is how "enforce nothing" is said, and it is the default.
     */
    /** Round 38 — the custody cap for new shops and new independent riders here. A kind left out is not capped. */
    setCustodyCaps: (entityId: string, body: { shop?: { start: number; liftedAfter: number }; rider?: { start: number; liftedAfter: number } }) =>
      sbg.request((c) => c.POST('/v1/sbg/entities/{entityId}/custody-caps', { params: { path: { entityId } }, body })),
    /** Round 38 — where this company requires a seal on loads taken over in its country. */
    setSealRules: (entityId: string, body: { crossBorder: boolean; containers: boolean }) =>
      sbg.request((c) => c.POST('/v1/sbg/entities/{entityId}/seal-rules', { params: { path: { entityId } }, body })),
    setCarrierPapers: (entityId: string, enforce: Array<'operator_licence' | 'carrier_insurance'>) =>
      sbg.request((c) => c.POST('/v1/sbg/entities/{entityId}/carrier-papers', { params: { path: { entityId } }, body: { enforce } })),

    /**
     * Record the dates on a fleet operator's own papers. `null` clears one; leaving it out leaves it alone.
     * There is no field for the document a date was read from: that is whatever the fleet SENT for the paper,
     * carried across by the server — a copy reference is never typed by anybody.
     */
    recordCarrierPapers: (
      did: string,
      body: { licenceExpiresAt?: string | null; licenceNumber?: string | null; insurancePolicy?: string | null; insuranceExpiresAt?: string | null },
    ) => sbg.request((c) => c.POST('/v1/sbg/fleet/managers/{did}/papers', { params: { path: { did } }, body: body as never })),

    /** Turn down a document a fleet sent, with the reason the fleet is shown. */
    refuseCarrierPaper: (did: string, kind: 'operator_licence' | 'carrier_insurance', reason: string) =>
      sbg.request((c) => c.POST('/v1/sbg/fleet/managers/{did}/papers/refuse', { params: { path: { did } }, body: { kind, reason } })),

    /* ---- support: the screen that answers a phone call ---- */

    /** One parcel, whole — status, journey and the proofs attached to it. */
    parcel: (parcelId: string) => sbg.request((c) => c.GET('/v1/sbg/parcels/{id}', { params: { path: { id: parcelId } } })),

    /**
     * Rotate a burnt release code.
     *
     * The ONLY way back from one: a parcel never carries its own release key and the shop that hands it
     * over never learns it, so a code guessed to death can only be replaced from here. What comes back is
     * a NEW code sent to the buyer's app and the store — except a peer send, which has no app to send it
     * to, so its OTP is returned once for somebody to read down the phone.
     */
    reissueRelease: (parcelId: string, by?: string) =>
      sbg.request((c) => c.POST('/v1/sbg/parcels/{id}/reissue-release', { params: { path: { id: parcelId } }, body: (by ? { by } : {}) as never })),
    /** 2026-10-27 — what withdrawing a person's parcel would do now, and doing it with why: voided where it has not left its
     *  first shop, turned round at a hub to the shop it was handed in at, its sender paying the way back there. */
    withdrawPreview: (parcelId: string) => sbg.request((c) => c.GET('/v1/sbg/parcels/{id}/withdraw', { params: { path: { id: parcelId } } })),
    withdraw: (parcelId: string, body: { reason: string; by?: string }) => sbg.request((c) => c.POST('/v1/sbg/parcels/{id}/withdraw', { params: { path: { id: parcelId } }, body })),

    /* ---- the illustration library ---- */

    /** Every option of one vocabulary, with whatever picture it has and whose picture that is. */
    help: (topic: string) => sbg.request((c) => c.GET('/v1/sbg/help/{topic}', { params: { path: { topic } } })),

    /** Put this deployment's own drawing on an option. Overrides the network's; never deletes it. */
    setHelpImage: (topic: string, key: string, dataUrl: string) =>
      sbg.request((c) => c.PUT('/v1/sbg/help/{topic}/{key}/image', { params: { path: { topic, key } }, body: { dataUrl } as never })),

    /** Take this deployment's drawing back — which REVEALS the network's again rather than blanking it. */
    clearHelpImage: (topic: string, key: string) =>
      sbg.request((c) => c.DELETE('/v1/sbg/help/{topic}/{key}/image', { params: { path: { topic, key } } })),

    /* ---- money: what a company holds, owes, and pays out ---- */

    /** The network's own ledger — float per currency, today's fees, the last entries. Operator-only. */
    finance: () => sbg.request((c) => c.GET('/v1/sbg/finance', {})),

    /** What this company has raised for the people it owes. */
    payouts: (entityId: string) => sbg.request((c) => c.GET('/v1/sbg/entities/{entityId}/payouts', { params: { path: { entityId } } })),

    /**
     * Raise today's payouts for everybody this company owes.
     *
     * It RAISES, it does not pay: the rail carries them and only the rail's answer moves the books. The
     * response says who was SKIPPED and why, which is the half that matters — a run that quietly pays
     * four of six people is how somebody finds out on Friday.
     */
    runPayouts: (entityId: string, by?: string) =>
      sbg.request((c) => c.POST('/v1/sbg/entities/{entityId}/payouts/run', { params: { path: { entityId } }, body: (by ? { by } : {}) as never })),

    /** Move one payout along its rail: submit, settle, fail, reverse. One step, and only the honest one. */
    movePayout: (payoutId: string, action: string, extra: { reason?: string; providerRef?: string; by?: string } = {}) =>
      sbg.request((c) =>
        c.POST(`/v1/sbg/payouts/{payoutId}/${action}` as '/v1/sbg/payouts/{payoutId}/submit', {
          params: { path: { payoutId } },
          body: Object.fromEntries(Object.entries(extra).filter(([, v]) => v)) as never,
        }),
      ),

    /* ---- money coming IN: what shops and stores have asked to pay, and what has been confirmed ---- */

    /** Every funding request, plus the payments that arrived with nobody's name on them. */
    funding: (entityId?: string) => sbg.request((c) => c.GET('/v1/rails/funding', { params: { query: entityId ? { entityId } : {} } })),

    /**
     * Confirm a payment from a bank statement — a person, reading a statement line, naming it.
     *
     * The fallback, never the ordinary path: not every shop pays by mobile money and a transfer has no
     * webhook behind it. The reference is required and is the whole point — without something an auditor
     * can look up, this would be the shop's own word wearing a staff badge.
     */
    confirmFunding: (fundingId: string, providerRef: string, amount: number) =>
      sbg.request((c) => c.POST('/v1/rails/funding/{fundingId}/confirm', { params: { path: { fundingId } }, body: { providerRef, amount } })),

    /** SANDBOX: stand in for the payment provider — the callback is signed and verified as a real one is. */
    simulateFunding: (fundingId: string, providerRef: string, amount: number) =>
      sbg.request((c) => c.POST('/v1/rails/funding/{fundingId}/simulate', { params: { path: { fundingId } }, body: { providerRef, amount } })),

    /**
     * Say whose an unattributed payment was, and credit it.
     *
     * The only way out of the unmatched list, and a JUDGEMENT rather than a rule — somebody rang the shop.
     * The server records who made it, so this is one of the few actions that carries a name into the books.
     */
    applyFunding: (unmatchedId: string, payerKind: 'agent' | 'vendor', payerDid: string, by?: string) =>
      sbg.request((c) =>
        c.POST('/v1/rails/funding/unmatched/{id}/apply', {
          params: { path: { id: unmatchedId } },
          body: { payerKind, payerDid, ...(by ? { by } : {}) },
        }),
      ),

    /** Close a request nobody paid, or take back one that bounced. */
    moveFunding: (fundingId: string, action: 'fail' | 'expire' | 'reverse', reason: string) =>
      sbg.request((c) =>
        c.POST(`/v1/rails/funding/{fundingId}/${action}` as '/v1/rails/funding/{fundingId}/fail', {
          params: { path: { fundingId } },
          body: { reason },
        }),
      ),

    /* ---- the network at a glance: monitoring, not deciding ---- */

    /** The five numbers, where every parcel is, and every standing alert — in one read. */
    dashboard: () => sbg.request((c) => c.GET('/v1/sbg/dashboard', {})),
    /** Each lane against the plans kept when its parcels were taken in: on time, how late, which way they went. */
    planVsActual: (days?: number) => sbg.request((c) => c.GET('/v1/sbg/network/plan-vs-actual', { params: { query: days ? { days: String(days) } : {} } })),

    /** Every shop on the network, with its float, its shelf and when it last checked in. */
    agents: () => sbg.request((c) => c.GET('/v1/sbg/agents', {})),

    /** Every store, as a row made for staff: who it is, which company settles it, its float, how it signs in. */
    stores: () => sbg.request((c) => c.GET('/v1/sbg/vendors', {})),

    /**
     * One store, opened by staff: what somebody answering its call needs. Assembled for the purpose on the
     * server — no signing secret, no buyer, no whole phone number — and NOT the store's own routes, which
     * staff's sign-in also opens and which carry all three.
     */
    storeDesk: (vendorId: string) => sbg.request((c) => c.GET('/v1/sbg/vendors/{id}/desk', { params: { path: { id: vendorId } } })),

    /** The sort hubs. */
    hubs: () => sbg.request((c) => c.GET('/v1/sbg/mdps', {})),

    /** The bag pool — which hub each is at, what is in it, and which are on the road. */
    // The two filters are typed REQUIRED by the generated client and are optional at runtime — the S5a
    // contract quirk the library documents. Empty strings mean no filter; the backend reads a falsy
    // value as "all", which is what the whole pool is.
    totes: () => sbg.request((c) => c.GET('/v1/sbg/totes', { params: { query: { location: '', status: '' } } })),

    /** Where the shops ARE, and how many of them are actually open. */
    heatmap: () => sbg.request((c) => c.GET('/v1/sbg/heatmap', {})),

    /* ---- the decision queues: work that stops until a person decides ---- */

    /** Open damage claims, oldest first — the case somebody has waited longest for needs answering most. */
    disputes: () => sbg.request((c) => c.GET('/v1/sbg/disputes', {})),
    /** Every problem reported, newest first: the damage claim reports made. Staff read them and decide nothing. */
    damageReports: () => sbg.request((c) => c.GET('/v1/sbg/damage-reports', {})),
    damageReportFile: (parcelId: string) => sbg.request<Blob>((c) => c.GET('/v1/sbg/parcels/{id}/damage-report/file' as never, { params: { path: { id: parcelId } }, parseAs: 'blob' } as never)),

    /**
     * Decide one: upheld, partly upheld or rejected — and every one of them carries a note, because the
     * claimant is shown it and a person whose goods arrived broken is owed an explanation even when they
     * are not owed money.
     */
    resolveDispute: (parcelId: string, body: { decision: string; award?: number; note: string; by?: string }) =>
      sbg.request((c) => c.POST('/v1/sbg/disputes/{parcelId}/resolve', { params: { path: { parcelId } }, body: body as never })),

    /** FP3b — open freight claims, oldest first: damaged, short or not received, against a delivered load. */
    freightClaims: () => sbg.request((c) => c.GET('/v1/sbg/freight-claims', {})),
    /** FP3b — decide one. An award only where a sister billed the load; every ending carries the note the claimant is shown. */
    resolveFreightClaim: (freightId: string, body: { decision: string; award?: number; note: string; by?: string }) =>
      sbg.request((c) => c.POST('/v1/sbg/freight-claims/{id}/resolve', { params: { path: { id: freightId } }, body: body as never })),

    /** Parcels nobody claimed and nobody is paying to recover — a queue, because the RULE is local law. */
    disposalQueue: () => sbg.request((c) => c.GET('/v1/sbg/ops/disposal-queue', {})),

    /** Close one out, and settle what the shop is owed for having held it. */
    writeOff: (parcelId: string, body: { by?: string; reason?: string }) =>
      sbg.request((c) => c.POST('/v1/sbg/parcels/{id}/write-off', { params: { path: { id: parcelId } }, body: body as never })),

    /**
     * HOW ESTABLISHED THE NETWORK IS, COUNTRY BY COUNTRY.
     *
     * A privilege level per jurisdiction: what may be promised, charged, held and taken in where.
     * Read by anything that has to know what it may offer; only an operator may move one.
     */
    presence: () => sbg.request((c) => c.GET('/v1/sbg/presence', {})),

    /** Answers `{ applied }` for a change that gives the country nothing, `{ proposal }` for one a second person must approve. */
    setPresence: (jurisdiction: string, body: { level: string; overrides?: Record<string, boolean>; note?: string; by?: string }) =>
      sbg.request((c) => c.POST('/v1/sbg/presence/{jurisdiction}', { params: { path: { jurisdiction } }, body: body as never })),

    /** CA3/CA7 — create a company of ours or a partner, as a draft. */
    createCompany: (body: { kind: 'sister' | 'partner'; jurisdiction: string; name: string; by?: string }) =>
      sbg.request((c) => c.POST('/v1/sbg/entities', { body: body as never })),

    /** CA3 — one company's record, readiness, papers, lapses and changes. */
    companyRecord: (entityId: string) => sbg.request((c) => c.GET('/v1/sbg/entities/{entityId}/record', { params: { path: { entityId } } })),

    saveCompanyRecord: (entityId: string, body: Record<string, unknown>) =>
      sbg.request((c) => c.POST('/v1/sbg/entities/{entityId}/record', { params: { path: { entityId } }, body: body as never })),

    /** A company's own change to a licence, a policy, a bank account or who may sign — with its paper, in one act. */
    declareCompanyChange: (entityId: string, body: Record<string, unknown>) =>
      sbg.request((c) => c.POST('/v1/sbg/entities/{entityId}/record/declare', { params: { path: { entityId } }, body: body as never })),

    /**
     * A PAPER REPORTED AS NOT RIGHT. Anybody signed in and connected to the company reports, with what shows it; the
     * company answers; one member of staff dismisses, two strike. The paper keeps counting until it is struck.
     */
    reportCompanyPaper: (entityId: string, documentId: string, body: { category: string; note: string; evidenceDataUrl: string; by?: string }) =>
      sbg.request((c) => c.POST('/v1/sbg/entities/{entityId}/documents/{documentId}/report', { params: { path: { entityId, documentId } }, body: body as never })),
    answerPaperReport: (caseId: string, body: { note: string; evidenceDataUrl?: string }) =>
      sbg.request((c) => c.POST('/v1/sbg/paper-reports/{caseId}/answer', { params: { path: { caseId } }, body: body as never })),
    paperReports: () => sbg.request((c) => c.GET('/v1/sbg/paper-reports', {})),
    paperReport: (caseId: string) => sbg.request((c) => c.GET('/v1/sbg/paper-reports/{caseId}', { params: { path: { caseId } } })),
    paperReportEvidence: (caseId: string, evidenceId: string) =>
      sbg.request((c) => c.GET('/v1/sbg/paper-reports/{caseId}/evidence/{evidenceId}', { params: { path: { caseId, evidenceId } }, parseAs: 'blob' })),
    /** `reason` is read by the company. */
    dismissPaperReport: (caseId: string, reason: string, by?: string) =>
      sbg.request((c) => c.POST('/v1/sbg/paper-reports/{caseId}/dismiss', { params: { path: { caseId } }, body: { reason, ...(by ? { by } : {}) } })),
    /** The first member of staff: the reason the second approves on the strength of. It strikes nothing. */
    proposePaperStrike: (caseId: string, reason: string, by?: string) =>
      sbg.request((c) => c.POST('/v1/sbg/paper-reports/{caseId}/strike/propose', { params: { path: { caseId } }, body: { reason, ...(by ? { by } : {}) } })),
    approvePaperStrike: (caseId: string, by?: string) =>
      sbg.request((c) => c.POST('/v1/sbg/paper-reports/{caseId}/strike/approve', { params: { path: { caseId } }, body: { ...(by ? { by } : {}) } })),

    /** CA4 — papers: fingerprinted on arrival, verified by a second person. */
    uploadCompanyDocument: (entityId: string, body: { kind: string; title: string; dataUrl: string; relatesTo?: string; expiresAt?: string; by?: string }) =>
      sbg.request((c) => c.POST('/v1/sbg/entities/{entityId}/documents', { params: { path: { entityId } }, body: body as never })),

    companyDocumentFile: (entityId: string, documentId: string) =>
      sbg.request((c) => c.GET('/v1/sbg/entities/{entityId}/documents/{documentId}/file', { params: { path: { entityId, documentId } }, parseAs: 'blob' })),

    /**
     * The bytes of one media, for `AuthImage`. The console needs this to show CLAIM EVIDENCE.
     *
     * The route is owner-or-operator gated and sends `Cache-Control: private, no-store`, which is why a
     * bare `<img src>` cannot load it: the browser sends no bearer. The photographs belong to the claimant,
     * never to the operator — staff read them because deciding a claim on evidence they cannot see is not
     * deciding, and for no other reason.
     */
    mediaBlob: (mediaId: string, variant?: 'full' | 'thumb') =>
      sbg.request((c) => c.GET('/v1/sbg/media/{id}', { params: { path: { id: mediaId }, query: variant ? { variant } : {} }, parseAs: 'blob' } as never)),

    verifyCompanyDocument: (entityId: string, documentId: string, by?: string) =>
      sbg.request((c) =>
        c.POST('/v1/sbg/entities/{entityId}/documents/{documentId}/verify', { params: { path: { entityId, documentId } }, body: { ...(by ? { by } : {}) } }),
      ),

    rejectCompanyDocument: (entityId: string, documentId: string, reason: string, by?: string) =>
      sbg.request((c) =>
        c.POST('/v1/sbg/entities/{entityId}/documents/{documentId}/reject', { params: { path: { entityId, documentId } }, body: { reason, ...(by ? { by } : {}) } }),
      ),

    /** CA5 — licences and policies lapsing soon (or already), across every company. */
    expiringCompanyPapers: (withinDays = 60) => sbg.request((c) => c.GET('/v1/sbg/companies/expiring', { params: { query: { withinDays: String(withinDays) } } })),

    /* ---- CL2a: a container, its papers, and the agent appointed to clear it ----
     *
     * `entityId` says which company is acting, and it is only ever sent by NETWORK STAFF — a company
     * administrator's token already carries their company, and the server refuses a token that names a
     * different one. So every call here takes it optionally and the company screens simply omit it.
     */

    /** The importer records a container that is on its way. It exists before it arrives — that is the point. */
    registerImport: (body: {
      importerEntityId?: string;
      goodsDescription: string;
      originCountry: string;
      destCountry: string;
      /** Where it CLEARS. A screen sends `clearanceSiteId` and this follows from it. */
      destPort: string;
      clearanceSiteId?: string;
      /** Where the vessel put it down, when that is somewhere else. */
      dischargePort?: string;
      dischargeSiteId?: string;
      containerNo?: string;
      carrierRef?: string;
      etaAt?: string;
      by?: string;
    }) =>
      sbg.request((c) => c.POST('/v1/sbg/imports', { body: body as never })),

    /** The consignments this company is a party to. Staff naming no company see the network's. */
    imports: (entityId?: string) => sbg.request((c) => c.GET('/v1/sbg/imports', { params: { query: entityId ? { entityId } : {} } as never })),

    importDetail: (importId: string, entityId?: string) =>
      sbg.request((c) => c.GET('/v1/sbg/imports/{importId}', { params: { path: { importId }, query: entityId ? { entityId } : {} } as never })),

    /**
     * What agents have actually been asked for at a port — the foreknowledge that separated the user's two
     * imports. Counts and dates, never a requirement: we say who asked and when, and nothing about duty.
     */
    knownImportPapers: (country: string, port?: string) =>
      sbg.request((c) => c.GET('/v1/sbg/imports/known-papers', { params: { query: { country, ...(port ? { port } : {}) } } as never })),

    /** Appoint a clearing agent — the act that grants them the papers. The importer's decision alone. */
    appointClearingAgent: (importId: string, body: { agentEntityId: string; entityId?: string; by?: string }) =>
      sbg.request((c) => c.POST('/v1/sbg/imports/{importId}/appoint', { params: { path: { importId } }, body: body as never })),

    /** End it. Immediate, and visible to both sides — the grant is marked revoked, never deleted. */
    revokeClearingAgent: (importId: string, body: { reason?: string; entityId?: string; by?: string } = {}) =>
      sbg.request((c) => c.POST('/v1/sbg/imports/{importId}/revoke', { params: { path: { importId } }, body: body as never })),

    /** The agent publishes what they will need. We never assert this list. */
    publishRequiredPapers: (importId: string, body: { items: Array<{ key?: string; label: string; copies?: number; note?: string }>; entityId?: string; by?: string }) =>
      sbg.request((c) => c.POST('/v1/sbg/imports/{importId}/required', { params: { path: { importId } }, body: body as never })),

    /** The importer attaches one of their OWN papers. There is deliberately no upload on this route. */
    supplyRequiredPaper: (importId: string, body: { key: string; documentId: string; entityId?: string; by?: string }) =>
      sbg.request((c) => c.POST('/v1/sbg/imports/{importId}/supply', { params: { path: { importId } }, body: body as never })),

    /** The railway's note, where the box came inland by rail — the importer's or its agent's to keep; staff are refused. */
    holdImportRail: (importId: string, body: Record<string, unknown>) => sbg.request((c) => c.POST('/v1/sbg/imports/{importId}/rail', { params: { path: { importId } }, body: body as never })),
    /** A draft rail note checked against the law of its lane. Nothing is written. */
    railCheck: (body: Record<string, unknown>) => sbg.request((c) => c.POST('/v1/sbg/rail/check', { body: body as never })),
    railways: () => sbg.request((c) => c.GET('/v1/sbg/rail/railways')),
    /** The forwarder's FIATA bill on an import (2026-10-29): held by the importer or its agent; staff are refused. */
    holdImportFbl: (importId: string, body: Record<string, unknown>) => sbg.request((c) => c.POST('/v1/sbg/imports/{importId}/fbl', { params: { path: { importId } }, body: body as never })),
    importFblVerified: (importId: string, body: { registered: boolean; fiataId?: string; issuerShown?: string; proofDocumentId: string }) => sbg.request((c) => c.POST('/v1/sbg/imports/{importId}/fbl/verified', { params: { path: { importId } }, body: body as never })),
    /** Inland by rail (2026-10-29): the rail terminal, the railway's arrival notice, and the importer's word to go anyway. */
    importByRail: (importId: string, body: { terminalSiteId: string; expectedAt?: string; freeDays?: number }) => sbg.request((c) => c.POST('/v1/sbg/imports/{importId}/by-rail', { params: { path: { importId } }, body: body as never })),
    importRailArrived: (importId: string, body: { at: string; reference?: string }) => sbg.request((c) => c.POST('/v1/sbg/imports/{importId}/by-rail/arrived', { params: { path: { importId } }, body: body as never })),
    importRailCollectAnyway: (importId: string, body: { reason: string }) => sbg.request((c) => c.POST('/v1/sbg/imports/{importId}/by-rail/collect-anyway', { params: { path: { importId } }, body: body as never })),

    /**
     * BL1 — the appointed agent records that customs released the container.
     *
     * Theirs because they are the party at the counter. It is what lets a split chain mint its delivery
     * leg: before it, the box is still the state's business and a truck sent for it is a truck waiting.
     */
    recordImportRelease: (importId: string, body: { entityId?: string; by?: string } = {}) =>
      sbg.request((c) => c.POST('/v1/sbg/imports/{importId}/released', { params: { path: { importId } }, body: body as never })),

    /** CL5 — what people were asked for at a counter, every country, newest first by when it happened. */
    fieldObservations: (country?: string) =>
      sbg.request((c) => c.GET('/v1/sbg/field-observations', { params: { query: country ? { country } : {} } as never })),

    /**
     * CL5 — take a photograph back off an observation, keeping the words. Staff only, always with a reason,
     * which is kept on the observation: the day a country's answer changes, or somebody photographs a
     * number they meant to cover.
     */
    removeObservationEvidence: (observationId: string, body: { reason: string; by?: string }) =>
      sbg.request((c) => c.POST('/v1/sbg/field-observations/{observationId}/remove-evidence', { params: { path: { observationId } }, body: body as never })),

    /** BL1 — a carrier's permission to move uncleared goods, and the register of them. */
    transitAuthorities: (carrierDid: string) => sbg.request((c) => c.GET('/v1/sbg/carriers/{carrierDid}/transit-authorities', { params: { path: { carrierDid } } })),

    declareTransitAuthority: (carrierDid: string, body: { country: string; reference: string; expiresAt: string; by?: string }) =>
      sbg.request((c) => c.POST('/v1/sbg/carriers/{carrierDid}/transit-authorities', { params: { path: { carrierDid } }, body: { carrierDid, ...body } as never })),

    withdrawTransitAuthority: (carrierDid: string, authorityId: string, body: { reason: string; by?: string }) =>
      sbg.request((c) => c.POST('/v1/sbg/carriers/{carrierDid}/transit-authorities/{authorityId}/withdraw', { params: { path: { carrierDid, authorityId } }, body: body as never })),

    /** The agent ticks one off. An expired paper is refused here, not at the counter. */
    acceptRequiredPaper: (importId: string, key: string, body: { entityId?: string; by?: string } = {}) =>
      sbg.request((c) => c.POST('/v1/sbg/imports/{importId}/required/{key}/accept', { params: { path: { importId, key } }, body: body as never })),

    /** Send one back, always with a reason. */
    rejectRequiredPaper: (importId: string, key: string, body: { reason: string; entityId?: string; by?: string }) =>
      sbg.request((c) => c.POST('/v1/sbg/imports/{importId}/required/{key}/reject', { params: { path: { importId, key } }, body: body as never })),

    /**
     * THE CONSIGNMENT NOTE for a leg — the one document the load carries, as JSON.
     *
     * Fetched by the importer as well as the carrier because the importer is the SENDER on it (box 1),
     * and somebody who is named on a legal document is entitled to read it before it travels.
     */
    freightNote: (freightId: string) => sbg.request((c) => c.GET('/v1/sbg/dispatch/freight/{id}/consignment-note', { params: { path: { id: freightId } } })),

    /**
     * THE AGENT DIRECTORY — public, alphabetical, and what this console should have been reading all
     * along instead of asking an importer to type a company id.
     *
     * Every row carries the pair the finder exists to put side by side: what the agent CLAIMS to clear,
     * and what we have actually seen them clear. Never a score, never an ordering — this network is the
     * party an importer appoints through.
     */
    findAgents: (q: { specialism?: string; place?: string; country?: string } = {}) =>
      sbg.request((c) =>
        c.GET('/v1/sbg/agents/find', {
          params: { query: { ...(q.specialism ? { specialism: q.specialism } : {}), ...(q.place ? { place: q.place } : {}), ...(q.country ? { country: q.country } : {}) } },
        } as never),
      ),

    /* ---- the places a company keeps: the ports it collects from, the addresses it delivers to ---- */

    /** This company-s own saved places. Nobody else-s list is reachable through this. */
    sites: (entityId: string, kind?: string) =>
      sbg.request((c) => c.GET('/v1/sbg/entities/{entityId}/sites', { params: { path: { entityId }, query: kind ? { kind } : {} } } as never)),

    /** When goods are loaded at one of the company's own places, and how many trucks at once. Null clears either. */
    setSiteLoading: (entityId: string, siteId: string, body: { hours?: Record<string, { open: string; close: string } | null> | null; bays?: number | null }) =>
      sbg.request((c) => c.POST('/v1/sbg/entities/{entityId}/sites/{siteId}/loading', { params: { path: { entityId, siteId } }, body: body as never } as never)),

    /** Save one. A dropped pin or an address to resolve — never both, because the toggle is the answer. */
    declareSite: (entityId: string, body: Record<string, unknown>) =>
      sbg.request((c) => c.POST('/v1/sbg/entities/{entityId}/sites', { params: { path: { entityId } }, body: body as never })),

    /** Read a shared paper. The grant decides; a paper you may not read answers NOT FOUND, never FORBIDDEN. */
    importDocumentFile: (importId: string, documentId: string, entityId?: string) =>
      sbg.request((c) =>
        c.GET('/v1/sbg/imports/{importId}/documents/{documentId}/file', { params: { path: { importId, documentId }, query: entityId ? { entityId } : {} }, parseAs: 'blob' } as never),
      ),

    /* ---- CL2b: the agent's fee, and the road leg minted from the port ---- */

    /**
     * The agent names their price — a QUOTATION (2026-10-04: we do not manage the agent's fee). Nothing moves through
     * our books; the proforma is attached with `attachProforma`, and a party confirms it paid with `setClearanceFeeStatus`.
     */
    quoteClearanceFee: (importId: string, body: { amount: number; currency?: string; reference?: string; note?: string; entityId?: string; by?: string }) =>
      sbg.request((c) => c.POST('/v1/sbg/imports/{importId}/fee' as never, { params: { path: { importId } }, body: body as never } as never) as never),

    /** The importer agrees the figure. */
    acceptClearanceFee: (importId: string, body: { entityId?: string; by?: string } = {}) =>
      sbg.request((c) => c.POST('/v1/sbg/imports/{importId}/fee/accept' as never, { params: { path: { importId } }, body: body as never } as never) as never),

    /** The importer or the agent says the fee is paid, or back to open — by name, with their own reference. */
    setClearanceFeeStatus: (importId: string, body: { status: 'open' | 'paid'; reference?: string; entityId?: string; by?: string }) =>
      sbg.request((c) => c.POST('/v1/sbg/imports/{importId}/fee/status' as never, { params: { path: { importId } }, body: body as never } as never) as never),

    /** QUOTATIONS FOR ANYONE: attach the proforma, read it back, agree, confirm paid or open. The two parties alone. */
    attachProforma: (quoteId: string, body: { dataUrl: string; fileName?: string }) =>
      sbg.request((c) => c.POST(`/v1/sbg/quotes/${encodeURIComponent(quoteId)}/proforma` as never, { body } as never) as never),
    proformaFile: (quoteId: string) => sbg.request((c) => c.GET(`/v1/sbg/quotes/${encodeURIComponent(quoteId)}/proforma` as never, { parseAs: 'blob' } as never) as never),
    setQuoteStatus: (quoteId: string, body: { status: 'open' | 'paid'; reference?: string }) =>
      sbg.request((c) => c.POST(`/v1/sbg/quotes/${encodeURIComponent(quoteId)}/status` as never, { body } as never) as never),

    /** Mint the road leg from the port of destination, on the freight machinery that already exists. */
    mintImportRoadLeg: (
      importId: string,
      body: {
        /** A saved place, which carries its own name and point. What a screen sends. */
        pickupSiteId?: string;
        destSiteId?: string;
        /** The raw form, for staff acting through the API on a company with nothing saved yet. */
        pickupLocation?: { lat: number; lng: number };
        pickupLabel?: string;
        destLabel?: string;
        destLocation?: { lat: number; lng: number };
        weightKg: number;
        entityId?: string;
        by?: string;
      },
    ) =>
      sbg.request((c) => c.POST('/v1/sbg/imports/{importId}/road-leg', { params: { path: { importId } }, body: body as never })),

    /**
     * CL7 — SAY WHAT KIND OF BOX IT IS, AND WHAT IS IN IT.
     *
     * The box is SELECTED from the container catalogue, so its height, roof, bodies and lifting gear are
     * derived rather than typed. The goods are DECLARED, because no code distinguishes a tank of edible
     * oil from a tank of gas oil and deciding it from a description would be us classifying goods.
     */
    declareImportCargo: (
      importId: string,
      body: {
        /** Usually typed later than the booking: the number arrives with the bill of lading. */
        containerNo?: string;
        /** The CSC safety-approval plate date. Carried, and nothing stated about it. */
        cscPlateDate?: string;
        containerType?: string;
        natureCode?: string;
        cargoHeightM?: number;
        tank?: { lastCargoes: string[]; cleanedAt?: string; certificateDocumentId?: string };
        dangerous?: { unNumber: string; imdgClass: string; properShippingName?: string };
        entityId?: string;
        by?: string;
      },
    ) => sbg.request((c) => c.POST('/v1/sbg/imports/{importId}/cargo', { params: { path: { importId } }, body: body as never })),

    /** The boxes this network books, with their real measurements. A catalogue, sent rather than mirrored. */
    containerTypes: () => sbg.request((c) => c.GET('/v1/sbg/container-types', {})),


    /* ---- Y0 + Y1: the box is somebody else's, and a clock runs on it ---- */

    /**
     * WHEN THE BOX LANDED — the demurrage clock's start, and the one date a person has to state.
     *
     * Detention is derived from the road leg's pickup, so nobody types that one. An arrival is somebody
     * else's event and nothing here watches a vessel berth, so it is recorded with a name against it
     * rather than guessed from an ETA.
     */
    recordBoxArrival: (importId: string, body: { at: string; entityId?: string; by?: string }) =>
      sbg.request((c) => c.POST('/v1/sbg/imports/{importId}/box/arrived', { params: { path: { importId } }, body: body as never })),

    /**
     * HOW MANY FREE DAYS THE IMPORTER SAYS THEY WERE GIVEN — their claim, from their contract.
     *
     * Two kinds because there are two clocks: demurrage inside the terminal, detention outside it. No
     * rate and no amount anywhere: what being late costs is between the importer and the line.
     */
    claimBoxFreeDays: (importId: string, body: { kind: 'demurrage' | 'detention'; days: number; entityId?: string; by?: string }) =>
      sbg.request((c) => c.POST('/v1/sbg/imports/{importId}/box/free-days', { params: { path: { importId } }, body: body as never })),

    /**
     * HOW THE SPELL ENDED: returned, or BOUGHT.
     *
     * Containers are traded goods, sold and often never returned, so "returned" is one ending of three and
     * a box that was bought is never overdue. Either party may record it, and usually the agent will.
     */
    endBox: (importId: string, body: { kind: 'returned' | 'bought'; at?: string; where?: string; note?: string; entityId?: string; by?: string }) =>
      sbg.request((c) => c.POST('/v1/sbg/imports/{importId}/box/ending', { params: { path: { importId } }, body: body as never })),

    /**
     * Y2 — POST THE LEG HOME, laden or empty, to the same board as any other load.
     *
     * A laden leg inland implies a leg back, and nothing modelled it — so no driver was ever offered it.
     * It is usually NOT empty: a box is a dry lockable body and freight goes portward inside it. The
     * weight is what the truck will carry, which for an empty box is its own tare, painted on the door.
     */
    mintReturnLeg: (
      importId: string,
      body: { depotLabel: string; depotLocation?: { lat: number; lng: number }; fromLabel?: string; fromLocation?: { lat: number; lng: number }; weightKg: number; cargo?: string; entityId?: string; by?: string },
    ) => sbg.request((c) => c.POST('/v1/sbg/imports/{importId}/box/return-leg', { params: { path: { importId } }, body: body as never })),


    /**
     * Y3 — SAY WHAT THE BOX LOOKED LIKE AT A GATE, beside whatever is already recorded there.
     *
     * The driver's half is derived from their own photographs at pickup and delivery. This is the other
     * half: the importer who says the hole was there before, the agent who says it was not. Added beside,
     * never over, with nothing adjudicating the two.
     */
    recordInterchange: (importId: string, body: { side: 'out' | 'in'; stance: 'sound' | 'damaged'; note?: string; photoIds?: string[]; entityId?: string; by?: string }) =>
      sbg.request((c) => c.POST('/v1/sbg/imports/{importId}/box/interchange', { params: { path: { importId } }, body: body as never })),

    /**
     * One gate photograph of THIS box, as bytes.
     *
     * Not the media route: the driver owns those bytes and that route serves them to their owner and an
     * operator, which is useless when the point is for the other party to look. This one is gated by the
     * record that cites it — this box, this spell, these two parties.
     */
    boxPhoto: (importId: string, mediaId: string, variant?: 'full' | 'thumb', entityId?: string) =>
      sbg.request((c) =>
        c.GET('/v1/sbg/imports/{importId}/box/photos/{mediaId}', {
          params: { path: { importId, mediaId }, query: { ...(variant ? { variant } : {}), ...(entityId ? { entityId } : {}) } },
          parseAs: 'blob',
        } as never),
      ),

    /** Upload one prepared image (+ optional thumbnail). Returns { mediaId }. */
    uploadMedia: (kind: string, dataUrl: string, thumbDataUrl?: string) =>
      sbg.request((c) => c.POST('/v1/sbg/media', { body: { kind, dataUrl, ...(thumbDataUrl ? { thumbDataUrl } : {}) } as never })),


    /**
     * A COMPANY'S OWN ENTRY — how to reach them, written by them.
     *
     * One card per company, read by the yard finder, the agent directory and the public page. A merge:
     * what is absent stays, an empty string clears. Shapes are checked and choices never are.
     */
    setContactCard: (
      entityId: string,
      body: { contactName?: string; phone?: string; phoneAlt?: string; email?: string; website?: string; address?: string; hours?: string; visitDays?: string[]; visitFrom?: string; visitTo?: string; closedDates?: Array<{ date: string; note?: string }>; visitorsPerHour?: number; by?: string },
    ) => sbg.request((c) => c.POST('/v1/sbg/entities/{entityId}/contact', { params: { path: { entityId } }, body: body as never })),

    contactCard: (entityId: string) => sbg.request((c) => c.GET('/v1/sbg/entities/{entityId}/contact', { params: { path: { entityId } } })),

    /* ---- Y4: a yard that says it holds empties, and what is on its way to it ---- */

    /**
     * A yard opts in. A CLAIM, like an agent's advertisement — attributed, dated, never checked.
     *
     * No slot, row or tier anywhere in this shape: yard planning needs the yard's geometry and the rules
     * that bind a slot to a box, which is a model of a site we have never seen. What we bring instead is
     * what is arriving.
     */
    declareDepot: (body: { placeLabel: string; country: string; location?: { lat: number; lng: number }; note?: string; entityId?: string; by?: string }) =>
      sbg.request((c) => c.POST('/v1/sbg/depots', { body: body as never })),

    closeDepot: (entityId: string, by?: string) =>
      sbg.request((c) => c.POST('/v1/sbg/depots/{entityId}/close', { params: { path: { entityId } }, body: { ...(by ? { by } : {}) } as never })),

    /** Which yards exist, alphabetical and never ranked. Counts travel; the numbers do not. */
    findDepots: (country?: string, q?: string) =>
      sbg.request((c) => c.GET('/v1/sbg/depots', { params: { query: { ...(country ? { country } : {}), ...(q ? { q } : {}) } } } as never)),

    /** One yard's own register: what it says, what we derived, and what is on its way. */
    depotRegister: (entityId: string) => sbg.request((c) => c.GET('/v1/sbg/depots/{entityId}/register', { params: { path: { entityId } } })),

    /** The yard says a box is standing there — with the position in THEIR words, if they keep one. */
    depotBoxHere: (entityId: string, body: { containerNo: string; position?: string; note?: string; by?: string }) =>
      sbg.request((c) => c.POST('/v1/sbg/depots/{entityId}/boxes', { params: { path: { entityId } }, body: body as never })),

    /** It left. Removed from what the yard SAYS — never from what we derived, which is a movement record. */
    depotBoxGone: (entityId: string, containerNo: string) =>
      sbg.request((c) => c.DELETE('/v1/sbg/depots/{entityId}/boxes/{containerNo}', { params: { path: { entityId, containerNo } } })),

    /** Every box out, with its clock. Operator-only: it spans companies by construction. */
    boxesOut: () => sbg.request((c) => c.GET('/v1/sbg/boxes', {})),

    /* ---- CL4 item 1: what the state did to a container, and the agent's own record ---- */

    /**
     * Record that the state did something: selected it, examined it, queried the papers, or a queue.
     *
     * NO PHOTOGRAPH, and the omission is deliberate: a hold notice is a photograph of an official
     * document, and whether we may hold those is the open legal question blocking CL5.
     */
    recordCustomsHold: (importId: string, body: { kind: string; at?: string; note?: string; entityId?: string; by?: string }) =>
      sbg.request((c) => c.POST('/v1/sbg/imports/{importId}/customs-holds', { params: { path: { importId } }, body: body as never })),

    /** The other party's account of the same hold. Added beside, never instead — nothing is erased. */
    answerCustomsHold: (importId: string, holdId: string, body: { stance: 'happened' | 'disputed'; note?: string; entityId?: string; by?: string }) =>
      sbg.request((c) => c.POST('/v1/sbg/imports/{importId}/customs-holds/{holdId}/answer', { params: { path: { importId, holdId } }, body: body as never })),

    releaseCustomsHold: (importId: string, holdId: string, body: { at?: string; entityId?: string; by?: string }) =>
      sbg.request((c) => c.POST('/v1/sbg/imports/{importId}/customs-holds/{holdId}/release', { params: { path: { importId, holdId } }, body: body as never })),

    /**
     * ONE CLEARING AGENT'S RECORD — the same object the public page carries.
     *
     * An agent reads their own copy here and a shipper reads it at `/@handle`; if the two could differ,
     * the public one would stop being worth anything. A record handed down is a verdict; one both parties
     * hold is an account.
     */
    clearanceRecord: (entityId: string) =>
      sbg.request((c) => c.GET('/v1/sbg/entities/{entityId}/clearance-record', { params: { path: { entityId } } as never })),

    /**
     * CL6 — WHAT AN AGENT SAYS THEY CLEAR. Theirs to write, and the one asserted thing in this design.
     *
     * Identity and record stay derived, which is what stops squatting and stops a record that can only
     * flatter. What somebody OFFERS cannot be derived at all: nobody but the agent knows they clear
     * livestock at Mombasa, and waiting to observe it would leave them undiscoverable until after they
     * had already been hired for it.
     */
    setClearanceOffer: (entityId: string, body: { specialisms: string[]; places?: string[]; words?: string; by?: string }) =>
      sbg.request((c) => c.POST('/v1/sbg/entities/{entityId}/clearance-offer', { params: { path: { entityId } }, body: body as never })),
    /* ---- CL3: scarcity, derived. The same public series both the console and a fleet office read. ---- */

    /**
     * The market series: what was asked for against what moved, day by day, plus how long loads are waiting,
     * what negotiated prices cleared at, and which lanes went quiet.
     *
     * Every figure is derived from timestamps the loads already carry, so it keeps working in a market where
     * nobody reports anything — which is the only kind of market this has to work in.
     */
    /**
     * WHO CARRIED ON ONE LANE. Signed-in only, unlike the series it sits beside.
     *
     * The series is public because it identifies nobody; this names fleets, so it cannot ride on that
     * justification. It names FLEETS AND NEVER DRIVERS, and a load taken by an owner-driver is counted
     * with nobody named.
     */
    laneCarriers: (query: { from: string; to: string; since?: string; until?: string }) =>
      sbg.request((c) =>
        c.GET('/v1/sbg/market/lane-carriers', {
          params: { query: { from: query.from, to: query.to, ...(query.since ? { since: query.since } : {}), ...(query.until ? { until: query.until } : {}) } },
        } as never),
      ),

    marketSeries: (query: { lat?: number; lng?: number; radiusKm?: number; since?: string; until?: string } = {}) =>
      sbg.request((c) =>
        c.GET('/v1/sbg/market/series', {
          params: {
            query: {
              ...(query.lat != null && query.lng != null ? { lat: query.lat, lng: query.lng } : {}),
              ...(query.radiusKm != null ? { radiusKm: query.radiusKm } : {}),
              ...(query.since ? { since: query.since } : {}),
              ...(query.until ? { until: query.until } : {}),
            },
          },
        } as never),
      ),

    /** The fleets on the network — with their sign-in codes, which only network staff and the fleet itself see. */
    fleets: () => sbg.request((c) => c.GET('/v1/sbg/fleet/managers', {})),

    /** Issue a fleet a new code — for the fleet that has lost or leaked its own. */
    rotateFleetCode: (did: string) => sbg.request((c) => c.POST('/v1/sbg/fleet/managers/{did}/code/rotate', { params: { path: { did } } })),

    /** CA9 — what lowering or closing a country would leave behind, read before anybody presses it. */
    presenceImpact: (jurisdiction: string, level: string) =>
      sbg.request((c) => c.GET('/v1/sbg/presence/{jurisdiction}/impact', { params: { path: { jurisdiction }, query: { level } } as never })),

    /** CA6 — the rules of crossing a border, one direction at a time. */
    borderRules: () => sbg.request((c) => c.GET('/v1/sbg/border-rules', {})),
    /** Round 14 — every post's measured wait over the last ninety days, from the loads its drivers said cleared it. */
    borderWaits: () => sbg.request((c) => c.GET('/v1/sbg/border-waits', {})),

    setBorderRule: (body: Record<string, unknown>) => sbg.request((c) => c.POST('/v1/sbg/border-rules', { body: body as never })),

    /** CA1 — every country that exists, and whether the rate book can price in its money. */
    countryCatalogue: () => sbg.request((c) => c.GET('/v1/sbg/country-catalogue', {})),

    /** CA2 — changes waiting for a second person, and the ones already decided. */
    presenceProposals: () => sbg.request((c) => c.GET('/v1/sbg/presence/proposals', {})),

    /** Who is waiting for a country we do not reach, grouped by country — the evidence a switch-on needs. */
    interest: () => sbg.request((c) => c.GET('/v1/sbg/interest', {})),

    approvePresence: (proposalId: string, by?: string) =>
      sbg.request((c) => c.POST('/v1/sbg/presence/proposals/{proposalId}/approve', { params: { path: { proposalId } }, body: { ...(by ? { by } : {}) } })),

    declinePresence: (proposalId: string, reason: string, by?: string) =>
      sbg.request((c) =>
        c.POST('/v1/sbg/presence/proposals/{proposalId}/decline', { params: { path: { proposalId } }, body: { reason, ...(by ? { by } : {}) } }),
      ),

    /**
     * THE CORRIDORS — the routes the network runs, and only the network may draw them.
     *
     * A corridor is the promise that a bus runs between two zones, and a shop may only take in a
     * cross-zone parcel that one serves. A fleet manager chooses among them and cannot add one, so if
     * nobody here draws them, the fleet app's corridor picker is an empty list forever.
     */
    corridors: () => sbg.request((c) => c.GET('/v1/sbg/corridors', {})),

    addCorridor: (body: { name: string; originZone: string; destZone: string; vehicleType?: 'bus' | 'truck'; schedule?: string }) =>
      sbg.request((c) => c.POST('/v1/sbg/corridors', { body: body as never })),

    /** Close a corridor, or reopen it. Closing stops every cross-zone take-in it was serving. */
    setCorridorStatus: (corridorId: string, status: 'active' | 'blocked') =>
      sbg.request((c) => c.POST('/v1/sbg/corridors/{id}/status', { params: { path: { id: corridorId } }, body: { status } as never })),

    /** F2 — publish a fleet's proposed line. Nothing routes on it until this is pressed. */
    publishCorridor: (corridorId: string) => sbg.request((c) => c.POST('/v1/sbg/corridors/{id}/publish', { params: { path: { id: corridorId } } })),

    /** Every driver↔vehicle coupling running right now — which is to say, every shift. */
    couplings: () => sbg.request((c) => c.GET('/v1/sbg/fleet/assignments', { params: { query: { status: 'active' } } })),

    /** CV1 — messages a party reported in a conversation, newest first, each with a copy of what was said. */
    conversationReports: () => sbg.request((c) => c.GET('/v1/sbg/conversations/reports', {})),

    /** CV3 — reports of chosen messages a party shared about a dispute: fixed copies with a fingerprint. */
    disputeReports: () => sbg.request((c) => c.GET('/v1/sbg/conversations/dispute-reports', {})),

    /** CV4 — play a voice message a party put in a shared report. That one, and no other. */
    disputeVoice: (reportId: string, voiceId: string) =>
      sbg.request((c) => c.GET('/v1/sbg/conversations/dispute-reports/{reportId}/voice/{voiceId}', { params: { path: { reportId, voiceId } }, parseAs: 'blob' })),

    /** Shops waiting to be let onto the network. */
    kycQueue: () => sbg.request((c) => c.GET('/v1/sbg/agents/kyc-queue', {})),

    /**
     * B1 — customers' businesses: every one, those waiting on a check first. Checked by TWO members of staff from the
     * registration certificate and the representative's ID; the second approval verifies, never the first one twice.
     */
    businesses: () => sbg.request((c) => c.GET('/v1/sbg/businesses', {})),
    /**
     * ACCOUNT MOVES — somebody with no number, no PIN and no inbox they can read asked for their account to be moved,
     * and it takes two members of staff: one checks who is asking, a second approves. The list never carries whose
     * account it is; `accountMove` reads one request with what there is to check the asker against.
     */
    accountMoves: () => sbg.request((c) => c.GET('/v1/sbg/account-moves', {})),
    accountMove: (moveId: string) => sbg.request((c) => c.GET('/v1/sbg/account-moves/{moveId}', { params: { path: { moveId } } })),
    /** `what` is what was checked and how — kept, and what the second member of staff approves on the strength of. */
    checkAccountMove: (moveId: string, what: string, by?: string) =>
      sbg.request((c) => c.POST('/v1/sbg/account-moves/{moveId}/check', { params: { path: { moveId } }, body: { what, ...(by ? { by } : {}) } })),
    approveAccountMove: (moveId: string, by?: string) =>
      sbg.request((c) => c.POST('/v1/sbg/account-moves/{moveId}/approve', { params: { path: { moveId } }, body: { ...(by ? { by } : {}) } })),
    /** `reason` is read by whoever asked, with their reference. */
    refuseAccountMove: (moveId: string, reason: string, by?: string) =>
      sbg.request((c) => c.POST('/v1/sbg/account-moves/{moveId}/refuse', { params: { path: { moveId } }, body: { reason, ...(by ? { by } : {}) } })),
    /**
     * ID DISPUTES — two people say one national ID is theirs, and two members of staff say whose: one proposes, a
     * second approves. The list never carries the photographs; `idDispute` reads one dispute with both sets.
     */
    idDisputes: () => sbg.request((c) => c.GET('/v1/sbg/id-disputes', {})),
    idDispute: (disputeId: string) => sbg.request((c) => c.GET('/v1/sbg/id-disputes/{disputeId}', { params: { path: { disputeId } } })),
    /** The number as read off a card. Only whether it is the disputed one comes back. */
    readIdCard: (disputeId: string, side: 'claimant' | 'holder', number: string, by?: string) =>
      sbg.request((c) => c.POST('/v1/sbg/id-disputes/{disputeId}/card', { params: { path: { disputeId } }, body: { side, number, ...(by ? { by } : {}) } })),
    /** `reason` is read by the person who has to take them again. */
    retakeIdPhotos: (disputeId: string, side: 'claimant' | 'holder', reason: string, by?: string) =>
      sbg.request((c) => c.POST('/v1/sbg/id-disputes/{disputeId}/retake', { params: { path: { disputeId } }, body: { side, reason, ...(by ? { by } : {}) } })),
    /** Whose it is, what was checked, and the reason the other one reads. After an appointment: who came. */
    checkIdDispute: (disputeId: string, input: { to: 'claimant' | 'holder'; what: string; reason: string; claimantCame?: boolean; holderCame?: boolean }, by?: string) =>
      sbg.request((c) => c.POST('/v1/sbg/id-disputes/{disputeId}/check', { params: { path: { disputeId } }, body: { ...input, ...(by ? { by } : {}) } })),
    approveIdDispute: (disputeId: string, by?: string) =>
      sbg.request((c) => c.POST('/v1/sbg/id-disputes/{disputeId}/approve', { params: { path: { disputeId } }, body: { ...(by ? { by } : {}) } })),
    sendBackIdDispute: (disputeId: string, why: string, by?: string) =>
      sbg.request((c) => c.POST('/v1/sbg/id-disputes/{disputeId}/send-back', { params: { path: { disputeId } }, body: { why, ...(by ? { by } : {}) } })),
    /** Round 18 — two businesses say one GS1 company prefix is theirs: one member of staff proposes whose, another approves. */
    gs1Disputes: () => sbg.request((c) => c.GET('/v1/sbg/gs1-disputes', {})),
    /** Round 19 — the load a package's SSCC, our label's QR or a load's code names. */
    findLoad: (scanned: string) => sbg.request((c) => c.GET('/v1/sbg/dispatch/find-load', { params: { query: { scanned } } })),
    /** Round 32 — the store parcel a GS1 barcode (SSCC) belongs to. */
    findParcelBySscc: (scanned: string) => sbg.request((c) => c.GET('/v1/sbg/scan/parcel', { params: { query: { scanned } } })),
    proposeGs1: (disputeId: string, input: { to: 'claimant' | 'holders'; what: string; reason: string }, by?: string) =>
      sbg.request((c) => c.POST('/v1/sbg/gs1-disputes/{disputeId}/propose', { params: { path: { disputeId } }, body: { ...input, ...(by ? { by } : {}) } })),
    approveGs1: (disputeId: string, by?: string) => sbg.request((c) => c.POST('/v1/sbg/gs1-disputes/{disputeId}/approve', { params: { path: { disputeId } }, body: { ...(by ? { by } : {}) } })),
    sendBackGs1: (disputeId: string, why: string, by?: string) =>
      sbg.request((c) => c.POST('/v1/sbg/gs1-disputes/{disputeId}/send-back', { params: { path: { disputeId } }, body: { why, ...(by ? { by } : {}) } })),
    /**
     * What this server is connected to for the fleets' planning — the routing server and the adviser: set up or not,
     * and what the last ask met. Staff only. `checkRouter` asks the routing server one question now.
     */
    connections: () => sbg.request((c) => c.GET('/v1/sbg/connections', {})),
    checkRouter: () => sbg.request((c) => c.POST('/v1/sbg/connections/router/check', {})),
    approveBusiness: (entityId: string, by?: string) =>
      sbg.request((c) => c.POST('/v1/sbg/businesses/{entityId}/approve', { params: { path: { entityId } }, body: { ...(by ? { by } : {}) } })),
    /** `reason` is what the business reads, in the app and by email: it is how they know what to put right. */
    refuseBusiness: (entityId: string, reason: string, by?: string) =>
      sbg.request((c) => c.POST('/v1/sbg/businesses/{entityId}/refuse', { params: { path: { entityId } }, body: { reason, ...(by ? { by } : {}) } })),

    /**
     * Heavy-registry drivers waiting to be vetted, and the decision.
     *
     * Both routes have been live since the driver registry shipped and NOTHING read the queue: a driver
     * who uploaded an ID and a licence copy waited in KYC_PENDING with no screen able to look at either.
     * The refusal carries a reason, because the driver is shown it.
     */
    driverKycQueue: () => sbg.request((c) => c.GET('/v1/sbg/fleet/drivers/kyc-queue', {})),

    decideDriverKyc: (did: string, body: { approve: boolean; by?: string; reason?: string; criminalRecordClear?: boolean }) =>
      sbg.request((c) => c.POST('/v1/sbg/fleet/drivers/{did}/kyc-decision', { params: { path: { did } }, body: body as never })),

    /**
     * A FLEET IS SET UP BY STAFF: it does not sign itself up. Every fleet and where it stands; register one; put its
     * four papers on record (ids of pictures this member of staff uploaded); approve or send back — by somebody
     * OTHER than whoever put them on record; record its bond, which makes it active and gives it its code.
     */
    fleetsSettingUp: () => sbg.request((c) => c.GET('/v1/sbg/fleet/managers/setting-up', {})),
    registerFleet: (body: { companyName: string; jurisdiction: string; contactPhone: string; ownerFullName: string; ownerNationalId: string; depotAddress: string; requirements: { businessRegistrationNo: string; transportOperatorLicence: string; taxId: string } }) =>
      sbg.request((c) => c.POST('/v1/sbg/fleet/managers', { body: body as never })),
    submitFleetPapers: (did: string, body: { businessRegCertRef: string; operatorLicenceRef: string; ownerIdRef: string; proofOfAddressRef: string }) =>
      sbg.request((c) => c.POST('/v1/sbg/fleet/managers/{did}/submit-kyc', { params: { path: { did } }, body })),
    decideFleetKyc: (did: string, body: { approve: boolean; by?: string; reason?: string }) =>
      sbg.request((c) => c.POST('/v1/sbg/fleet/managers/{did}/kyc-decision', { params: { path: { did } }, body: body as never })),
    recordFleetBond: (did: string) => sbg.request((c) => c.POST('/v1/sbg/fleet/managers/{did}/bond', { params: { path: { did } } })),

    /**
     * HUBS THAT SIGNED THEMSELVES UP, waiting for somebody to look at their papers (the ISO 28000 check: "hubs are not
     * vetted"). Until approved a hub works for nobody. A refusal says why: the hub is shown it.
     */
    hubPapersQueue: () => sbg.request((c) => c.GET('/v1/sbg/hub-papers', {})),
    /** Round 39 — the risk register: every corridor and hub rated per threat, and what incidents proposed; a rating; a decision. */
    riskRegister: () => sbg.request((c) => c.GET('/v1/sbg/risk-register', {})),
    rateRisk: (body: { subject: 'corridor' | 'hub'; id: string; threat: 'pilferage' | 'hijacking' | 'unrest' | 'extortion'; level: 'low' | 'medium' | 'high'; why?: string; by?: string }) =>
      sbg.request((c) => c.POST('/v1/sbg/risk-register/rate', { body })),
    decideRisk: (proposalId: string, body: { accept: boolean; reason?: string; by?: string }) =>
      sbg.request((c) => c.POST('/v1/sbg/risk-register/proposals/{proposalId}/decide', { params: { path: { proposalId } }, body })),
    /** Round 39 — every partner's yearly security declaration, and where it stands. */
    declarations: () => sbg.request((c) => c.GET('/v1/sbg/declarations', {})),
    /** Round 39 — light couriers whose ID photo waits to be seen; and the decision: seen, or not, with the reason. */
    idPhotoQueue: () => sbg.request((c) => c.GET('/v1/sbg/fleet/drivers/id-photos', {})),
    decideIdPhoto: (did: string, body: { seen: boolean; reason?: string; by?: string }) =>
      sbg.request((c) => c.POST('/v1/sbg/fleet/drivers/{did}/id-photo-decision', { params: { path: { did } }, body })),
    decideHubPapers: (mdpId: string, body: { approve: boolean; reason?: string }) =>
      sbg.request((c) => c.POST('/v1/sbg/mdps/{id}/papers-decision', { params: { path: { id: mdpId } }, body })),

    /**
     * Shops that started joining and STOPPED — a chase list, not a queue.
     *
     * Nothing in it is waiting on a decision by us: a draft shop is waiting on the shopkeeper to send
     * their documents, and an approved one on their first top-up. That is exactly why it is a separate
     * read from the KYC queue rather than more rows in it — a count that means "somebody must act" must
     * not be padded with people who are waiting on themselves.
     */
    unfinishedSignups: () => sbg.request((c) => c.GET('/v1/sbg/agents/unfinished', {})),

    /** Let a shop in, or refuse it. */
    /** `reason` is REQUIRED by the server when refusing: the applicant is shown it, and a refusal they
     *  cannot act on leaves them exactly where saying nothing did. */
    decideKyc: (did: string, body: { approve: boolean; by?: string; reason?: string; licenceExpiresAt?: string }) =>
      sbg.request((c) => c.POST('/v1/sbg/agents/{did}/kyc-decision', { params: { path: { did } }, body: body as never })),

    /** Round 40 — the date a shop's trading licence runs to, read off it (the renewed one it sent, or the one on record). */
    recordShopLicence: (did: string, body: { expiresAt: string; by?: string }) =>
      sbg.request((c) => c.POST('/v1/sbg/agents/{did}/licence', { params: { path: { did } }, body })),
    /** Round 40 — the renewed licence a shop sent is not accepted: the reason is the shop's to read. */
    refuseShopLicence: (did: string, body: { reason: string; by?: string }) =>
      sbg.request((c) => c.POST('/v1/sbg/agents/{did}/licence-renewal/refuse', { params: { path: { did } }, body })),

    /** A company's books: the trial balance, whether it balances, and what it holds against what it owes. */
    books: (entityId: string) => sbg.request((c) => c.GET('/v1/sbg/entities/{entityId}/books', { params: { path: { entityId } } })),

    /** What was changed here, by whom, and what it was before. */
    changes: (entityId: string) => sbg.request((c) => c.GET('/v1/sbg/entities/{entityId}/changes', { params: { path: { entityId } } })),

    /** Who administers this company. */
    admins: (entityId: string) => sbg.request((c) => c.GET('/v1/sbg/entities/{entityId}/admins', { params: { path: { entityId } } })),

    /**
     * Give somebody a login for this company. The password comes back ONCE — the screen shows it in a
     * panel closed by hand, never a toast, because a toast takes the only copy away on a timer.
     */
    createAdmin: (entityId: string, body: { email: string; name: string }) =>
      sbg.request((c) => c.POST('/v1/sbg/entities/{entityId}/admins', { params: { path: { entityId } }, body })),

    /** Take a login away. The record is kept, so past changes still have a name on them. */
    revokeAdmin: (entityId: string, adminId: string) =>
      sbg.request((c) => c.DELETE('/v1/sbg/entities/{entityId}/admins/{adminId}', { params: { path: { entityId, adminId } } })),
    /** Network staff, one account each. */
    staff: () => sbg.request((c) => c.GET('/v1/sbg/operators')),
    /** The setup key's way: made at once. Refused to anybody with an account of their own — they ask. */
    createStaff: (body: { email: string; name: string }) => sbg.request((c) => c.POST('/v1/sbg/operators', { body })),
    /** A member of staff asks for an account, with the roles it holds; a second approves it or declines it. */
    askStaff: (body: { email: string; name: string; roles: Array<'support' | 'vetting' | 'money' | 'admin'> }) => sbg.request((c) => c.POST('/v1/sbg/operators/proposals', { body })),
    /** Round 38 — ask that a member of staff hold other roles; a second approves it, and they are signed out. */
    proposeStaffRoles: (operatorId: string, roles: Array<'support' | 'vetting' | 'money' | 'admin'>) =>
      sbg.request((c) => c.POST('/v1/sbg/operators/{operatorId}/roles', { params: { path: { operatorId } }, body: { roles } })),
    approveStaff: (proposalId: string) => sbg.request((c) => c.POST('/v1/sbg/operators/proposals/{proposalId}/approve', { params: { path: { proposalId } } })),
    declineStaff: (proposalId: string, reason?: string) =>
      sbg.request((c) => c.POST('/v1/sbg/operators/proposals/{proposalId}/decline', { params: { path: { proposalId } }, body: reason ? { reason } : {} })),
    revokeStaff: (operatorId: string) => sbg.request((c) => c.DELETE('/v1/sbg/operators/{operatorId}', { params: { path: { operatorId } } })),

    /**
     * FP4 — the papers only network staff can put right: couriers without a fleet, vehicles without an
     * owner, what the fleets are handling themselves, and when the six-hourly check last ran.
     */
    /** CL4 — every fleet's record, with the reasons and driver names the public page does not carry. */
    movers: () => sbg.request((c) => c.GET('/v1/sbg/fleet/movers', {})),

    papersReport: () => sbg.request((c) => c.GET('/v1/sbg/fleet/papers', {})),
    /** Run the papers check now rather than waiting for the clock. */
    papersSweep: () => sbg.request((c) => c.POST('/v1/sbg/fleet/papers/sweep', {})),
    /** Record a courier's renewed licence — the new date is the whole of the renewal. */
    renewLicence: (did: string, body: { number?: string; expiresAt: string }) =>
      sbg.request((c) => c.POST('/v1/sbg/fleet/drivers/{did}/licence', { params: { path: { did } }, body: body as never })),
    /** A courier's own insurance cover, read off the policy they sent (2026-10-28); or the policy refused, with the reason. */
    recordCourierCover: (did: string, body: { expiresAt: string; policy?: string; covers?: 'goods_in_transit' | 'carrier_liability' | 'both'; limit?: number; currency?: string }) =>
      sbg.request((c) => c.POST('/v1/sbg/fleet/drivers/{did}/cover/record', { params: { path: { did } }, body: body as never })),
    refuseCourierCover: (did: string, body: { reason: string }) =>
      sbg.request((c) => c.POST('/v1/sbg/fleet/drivers/{did}/cover/refuse', { params: { path: { did } }, body: body as never })),
    /** The renewed card a courier sent is not accepted — with the reason they are shown. */
    refuseLicenceRenewal: (did: string, body: { reason: string }) =>
      sbg.request((c) => c.POST('/v1/sbg/fleet/drivers/{did}/licence-renewal/refuse', { params: { path: { did } }, body: body as never })),
    /** How to reach ONE courier without a fleet — a receipted reveal from the identity vault, per look. */
    courierContact: (did: string) => sbg.request((c) => c.GET('/v1/sbg/fleet/papers/couriers/{did}/contact', { params: { path: { did } } })),
    /** Record a fleetless vehicle's papers (YYYY-MM-DD dates). */
    setVehicleDocuments: (vehicleId: string, documents: { insuranceRef?: string; insuranceExpiresAt?: string; inspectionRef?: string; inspectionExpiresAt?: string }) =>
      sbg.request((c) => c.POST('/v1/sbg/vehicles/{id}/documents', { params: { path: { id: vehicleId } }, body: documents as never })),

    /**
     * What a rate change actually DID — the shipments either side of it, as a timeline of spells.
     *
     * The half of "how are we doing" that is not arithmetic. What a rate earned per shipment anybody can
     * work out; what it did to the NUMBER of shipments can only be observed.
     */
    rateImpact: (entityId: string) => sbg.request((c) => c.GET('/v1/sbg/entities/{entityId}/rate-impact', { params: { path: { entityId } } })),
  };
}

export type OperatorApi = ReturnType<typeof createOperatorApi>;
