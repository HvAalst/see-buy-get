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
