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

    /** Set what a sister covers for free, and what it charges to cover more. */
    setInsurance: (entityId: string, body: { lane?: string; premiumPct?: number | null; freeLimit?: number | null }) =>
      sbg.request((c) => c.POST('/v1/sbg/entities/{entityId}/insurance', { params: { path: { entityId } }, body: body as never })),

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
    runPayouts: (entityId: string) =>
      sbg.request((c) => c.POST('/v1/sbg/entities/{entityId}/payouts/run', { params: { path: { entityId } }, body: {} as never })),

    /** Move one payout along its rail: submit, settle, fail, reverse. One step, and only the honest one. */
    movePayout: (payoutId: string, action: string, reason?: string) =>
      sbg.request((c) =>
        c.POST(`/v1/sbg/payouts/{payoutId}/${action}` as '/v1/sbg/payouts/{payoutId}/submit', {
          params: { path: { payoutId } },
          body: (reason ? { reason } : {}) as never,
        }),
      ),

    /* ---- the network at a glance: monitoring, not deciding ---- */

    /** The five numbers, where every parcel is, and every standing alert — in one read. */
    dashboard: () => sbg.request((c) => c.GET('/v1/sbg/dashboard', {})),

    /** Every shop on the network, with its float, its shelf and when it last checked in. */
    agents: () => sbg.request((c) => c.GET('/v1/sbg/agents', {})),

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

    /**
     * Decide one: upheld, partly upheld or rejected — and every one of them carries a note, because the
     * claimant is shown it and a person whose goods arrived broken is owed an explanation even when they
     * are not owed money.
     */
    resolveDispute: (parcelId: string, body: { decision: string; award?: number; note: string; by?: string }) =>
      sbg.request((c) => c.POST('/v1/sbg/disputes/{parcelId}/resolve', { params: { path: { parcelId } }, body: body as never })),

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

    setPresence: (jurisdiction: string, body: { level: string; overrides?: Record<string, boolean>; note?: string; by?: string }) =>
      sbg.request((c) => c.POST('/v1/sbg/presence/{jurisdiction}', { params: { path: { jurisdiction } }, body: body as never })),

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

    /** Shops waiting to be let onto the network. */
    kycQueue: () => sbg.request((c) => c.GET('/v1/sbg/agents/kyc-queue', {})),

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
    decideKyc: (did: string, body: { approve: boolean; by?: string }) =>
      sbg.request((c) => c.POST('/v1/sbg/agents/{did}/kyc-decision', { params: { path: { did } }, body: body as never })),

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
