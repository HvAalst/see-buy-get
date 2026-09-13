import type { SbgClient } from '../client';

/**
 * Conversations persona facade (CV1) — persona-agnostic like notifications: a driver asking about a load and
 * the shop or store that posted it use the same routes, bound server-side to the token's own DID. Only the two
 * parties to a thread can read it; a stranger is told it does not exist.
 *
 * Responses are plain objects in the generated schema, so callers narrow `data` — see shared/conversation.
 */
export function createConversationsApi(sbg: SbgClient) {
  return {
    /** Every thread the signed-in person is a party to, most recently active first. */
    mine: () => sbg.request((c) => c.GET('/v1/sbg/conversations', {})),

    /** Ask about a load — or return to the thread already asked about it. */
    open: (freightId: string) => sbg.request((c) => c.POST('/v1/sbg/conversations', { body: { freightId } as never })),

    /** Messages after a sequence number (0 = the whole thread). Catch-up is by seq, never by the phone's clock. */
    messages: (id: string, after: number) =>
      sbg.request((c) => c.GET('/v1/sbg/conversations/{id}/messages', { params: { path: { id }, query: { after: String(after) } as never } })),

    /** Send text, or a quick reply by its key. */
    send: (id: string, message: { body?: string; quick?: string }) =>
      sbg.request((c) => c.POST('/v1/sbg/conversations/{id}/messages', { params: { path: { id } }, body: message as never })),

    /** Move this person's read marker up to `seq`. */
    read: (id: string, seq: number) => sbg.request((c) => c.POST('/v1/sbg/conversations/{id}/read', { params: { path: { id } }, body: { seq } as never })),

    /** Close the thread for writing both ways. The messages stay. */
    block: (id: string) => sbg.request((c) => c.POST('/v1/sbg/conversations/{id}/block', { params: { path: { id } } })),

    /** Open it again — only the person who closed it may. */
    unblock: (id: string) => sbg.request((c) => c.POST('/v1/sbg/conversations/{id}/unblock', { params: { path: { id } } })),

    /** CV2 — the driver names a price, through the load's own negotiation. `from` records the real empty run. */
    propose: (id: string, offer: { price: number; note?: string; from: { lat: number; lng: number } }) =>
      sbg.request((c) => c.POST('/v1/sbg/conversations/{id}/proposals', { params: { path: { id } }, body: offer as never })),

    /** CV2 — the poster accepts (claiming the load for that driver) or declines a price. */
    decide: (id: string, proposalId: string, decision: 'accept' | 'decline') =>
      decision === 'accept'
        ? sbg.request((c) => c.POST('/v1/sbg/conversations/{id}/proposals/{proposalId}/accept', { params: { path: { id, proposalId } } }))
        : sbg.request((c) => c.POST('/v1/sbg/conversations/{id}/proposals/{proposalId}/decline', { params: { path: { id, proposalId } } })),

    /** CV2 — write down how a load the network does not pay will be settled. A record, never a payment. */
    settle: (id: string, settlement: { amount: number; method: string; when: string; note?: string }) =>
      sbg.request((c) => c.POST('/v1/sbg/conversations/{id}/settlements', { params: { path: { id } }, body: settlement as never })),

    /** CV2 — agree to the other side's written-down settlement. */
    agree: (id: string, seq: number) =>
      sbg.request((c) => c.POST('/v1/sbg/conversations/{id}/messages/{seq}/agree', { params: { path: { id, seq: String(seq) } as never } })),

    /** CV4 — send a voice message: the recording as a data URL, and how long it runs. */
    sendVoice: (id: string, voice: { dataUrl: string; durationSec: number }) =>
      sbg.request((c) => c.POST('/v1/sbg/conversations/{id}/voice', { params: { path: { id } }, body: voice as never })),

    /** CV4 — the recording's bytes, for the thread's readers only. Played from an object URL: an <audio src> carries no token. */
    voiceBlob: (id: string, voiceId: string) =>
      sbg.request((c) => c.GET('/v1/sbg/conversations/{id}/voice/{voiceId}', { params: { path: { id, voiceId } }, parseAs: 'blob' })),

    /** CV3 — a fleet manager's view: the conversations their drivers chose to share. Read-only. */
    shared: () => sbg.request((c) => c.GET('/v1/sbg/conversations/shared', {})),

    /** CV3 — the driver shares this conversation with their fleet manager, or stops. */
    share: (id: string, on: boolean) => sbg.request((c) => c.POST('/v1/sbg/conversations/{id}/share', { params: { path: { id } }, body: { on } as never })),

    /** CV3 — share a report of the chosen messages with SeeBuyGet. The other side is told in the thread. */
    disputeReport: (id: string, seqs: number[], note?: string) =>
      sbg.request((c) => c.POST('/v1/sbg/conversations/{id}/dispute-reports', { params: { path: { id } }, body: { seqs, ...(note ? { note } : {}) } as never })),

    /** Report a message you received. */
    report: (id: string, seq: number, reason: 'spam' | 'abuse' | 'scam') =>
      sbg.request((c) =>
        c.POST('/v1/sbg/conversations/{id}/messages/{seq}/report', { params: { path: { id, seq: String(seq) } as never }, body: { reason } as never }),
      ),
  };
}

export type ConversationsApi = ReturnType<typeof createConversationsApi>;
