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

    /** Report a message you received. */
    report: (id: string, seq: number, reason: 'spam' | 'abuse' | 'scam') =>
      sbg.request((c) =>
        c.POST('/v1/sbg/conversations/{id}/messages/{seq}/report', { params: { path: { id, seq: String(seq) } as never }, body: { reason } as never }),
      ),
  };
}

export type ConversationsApi = ReturnType<typeof createConversationsApi>;
