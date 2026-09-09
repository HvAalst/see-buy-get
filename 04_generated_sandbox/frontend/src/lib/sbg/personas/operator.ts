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
  };
}

export type OperatorApi = ReturnType<typeof createOperatorApi>;
