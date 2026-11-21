import type { SbgClient, SbgError } from '../lib/sbg';

/**
 * 2026-11-21 — A PLATE CLAIMED BY WHOEVER BOUGHT THE VEHICLE (the owner: "add the check and consider that a vehicle may be sold and
 * no longer belongs to a driver as well"; backend plate-claim.service.ts). A plate names one vehicle in use; whoever bought one
 * its seller never took off asks the seller, who answers with one tap. The Driver app and the Fleet app ask and answer alike.
 */
export type PlateClaimState = 'asked' | 'sold' | 'kept' | 'lapsed' | 'released' | 'left' | 'freed';

export interface PlateClaimView {
  claimId: string;
  plate: string;
  vehicleClass: string;
  state: PlateClaimState;
  askedAt: string;
  closedAt?: string;
  reason?: string;
  /** To the owner only: who says they bought it. */
  askedBy?: string;
}

export interface PlateClaimsView {
  forMe: PlateClaimView[];
  asked: PlateClaimView[];
}

/** How long the owner has to answer (backend ANSWER_DAYS). */
export const ANSWER_DAYS = 14;

/** The plate a refusal is about, where it is "on another vehicle in the network already" — or null. */
export function plateTakenOf(error: SbgError | null | undefined): string | null {
  if (!error || error.code !== 'DUPLICATE' || error.params?.field !== 'plate') return null;
  const plate = error.params?.plate;
  return typeof plate === 'string' && plate ? plate : null;
}

/** The free plates: the asker may add it now. */
export const isFree = (s: PlateClaimState): boolean => s === 'sold' || s === 'released' || s === 'freed';

type Answer<T = unknown> = Promise<{ data?: T; error?: SbgError | null }>;

export function plateClaimApi(sbg: SbgClient) {
  const send = (method: 'GET' | 'POST', path: string, params: Record<string, string> = {}, body?: unknown): Answer =>
    sbg.request((c) => (c as unknown as Record<string, (p: string, o: unknown) => Promise<unknown>>)[method](path as never, { params: { path: params }, ...(body !== undefined ? { body } : {}) }) as never) as Answer;
  return {
    mine: () => send('GET', '/v1/sbg/plate-claims') as Answer<PlateClaimsView>,
    ask: (plate: string) => send('POST', '/v1/sbg/plate-claims', {}, { plate }) as Answer<PlateClaimView>,
    answer: (claimId: string, sold: boolean) => send('POST', '/v1/sbg/plate-claims/{id}/answer', { id: claimId }, { sold }) as Answer<PlateClaimView>,
  };
}
