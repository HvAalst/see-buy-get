import { describe, expect, it } from 'vitest';
import { composeBlocker, lastSeqOf, mergeMessages, threadsFor, totalUnread, type ChatMessage, type ChatThread } from './logic';

const msg = (seq: number, over: Partial<ChatMessage> = {}): ChatMessage => ({ seq, mine: false, kind: 'text', body: `m${seq}`, at: '2026-09-13T08:00:00Z', ...over });
const thread = (over: Partial<ChatThread> = {}): ChatThread => ({
  conversationId: 'cv_1',
  freightId: 'fr_1',
  freightCode: 'FR-001',
  freightLabel: 'Maize · Nakuru → Nairobi',
  role: 'asker',
  lastSeq: 0,
  unread: 0,
  createdAt: '2026-09-13T08:00:00Z',
  blocked: false,
  blockedByMe: false,
  ...over,
});

describe('CV1 — a conversation, client side', () => {
  it('merges a catch-up and a send once each, in the server’s order, however they interleave', () => {
    const merged = mergeMessages([msg(1), msg(3, { mine: true })], [msg(2), msg(3, { mine: true }), msg(4)]);
    expect(merged.map((m) => m.seq)).toEqual([1, 2, 3, 4]);
    expect(lastSeqOf(merged)).toBe(4);
    expect(lastSeqOf([])).toBe(0);
  });

  it('says why nothing can be sent — closed by me, closed by them, or too long', () => {
    expect(composeBlocker('hi', thread({ blocked: true, blockedByMe: true }))).toBe('common.chat.blockedByMe');
    expect(composeBlocker('hi', thread({ blocked: true }))).toBe('common.chat.blocked');
    expect(composeBlocker('x'.repeat(1001), thread())).toBe('common.chat.tooLong');
    expect(composeBlocker('hi', thread())).toBeNull();
  });

  it('adds up the badge and finds the threads about one load', () => {
    expect(totalUnread([thread({ unread: 2 }), thread({ unread: 0 }), thread({ unread: 3 })])).toBe(5);
    expect(threadsFor([thread(), thread({ conversationId: 'cv_2', freightId: 'fr_2' })], 'fr_2').map((t) => t.conversationId)).toEqual(['cv_2']);
  });
});
