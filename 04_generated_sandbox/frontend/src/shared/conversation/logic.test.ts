import { describe, expect, it } from 'vitest';
import { canAgree, canDecide, canPropose, canShare, composeBlocker, formatDuration, lastSeqOf, mergeMessages, parseAmount, pickAudioMime, threadsFor, toggleSeq, totalUnread, type ChatMessage, type ChatThread } from './logic';

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

  it('CV2 — lets only the poster answer an OPEN offer, and only the other side agree to a settlement, once', () => {
    const offer = msg(1, { kind: 'proposal', proposal: { proposalId: 'prp_1', price: 4500, status: 'open' } });
    expect(canDecide(thread({ role: 'poster' }), offer)).toBe(true);
    expect(canDecide(thread({ role: 'asker' }), offer)).toBe(false);
    expect(canDecide(thread({ role: 'poster' }), { ...offer, proposal: { ...offer.proposal!, status: 'accepted' } })).toBe(false);
    expect(canDecide(thread({ role: 'poster', blocked: true }), offer)).toBe(false);

    const card = msg(2, { kind: 'settlement', settlement: { amount: 4500, method: 'cash', when: 'on_delivery', agreed: false } });
    expect(canAgree(thread(), card)).toBe(true);
    expect(canAgree(thread(), { ...card, mine: true })).toBe(false);
    expect(canAgree(thread(), { ...card, settlement: { ...card.settlement!, agreed: true } })).toBe(false);
  });

  it('CV2 — offers a price only to the driver who asked, on a negotiated load', () => {
    expect(canPropose(thread({ role: 'asker', negotiable: true }))).toBe(true);
    expect(canPropose(thread({ role: 'poster', negotiable: true }))).toBe(false);
    expect(canPropose(thread({ role: 'asker', negotiable: false }))).toBe(false);
  });

  it('CV2 — reads a typed amount, including a comma, and refuses nothing or less', () => {
    expect(parseAmount('4500')).toBe(4500);
    expect(parseAmount('12,5')).toBe(12.5);
    expect(parseAmount('0')).toBeNull();
    expect(parseAmount('abc')).toBeNull();
  });

  it('CV3 — builds a report selection in the thread’s order, and offers sharing only to a driver with a manager', () => {
    expect(toggleSeq([], 3)).toEqual([3]);
    expect(toggleSeq([3], 1)).toEqual([1, 3]);
    expect(toggleSeq([1, 3], 3)).toEqual([1]);
    expect(canShare(thread({ role: 'asker', shareable: true }))).toBe(true);
    expect(canShare(thread({ role: 'asker', shareable: false }))).toBe(false);
    expect(canShare(thread({ role: 'poster', shareable: true }))).toBe(false);
    expect(canShare(thread({ role: 'manager', shareable: true }))).toBe(false);
  });

  it('CV4 — records in the most compact format the browser supports, and reads a duration like a clock', () => {
    expect(pickAudioMime((t) => t === 'audio/webm' || t === 'audio/mp4')).toBe('audio/webm');
    expect(pickAudioMime((t) => t === 'audio/mp4')).toBe('audio/mp4'); // iOS Safari
    expect(pickAudioMime(() => false)).toBeNull();
    expect(
      pickAudioMime(() => {
        throw new Error('no');
      }),
    ).toBeNull();
    expect(formatDuration(7)).toBe('0:07');
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDuration(-3)).toBe('0:00');
  });

  it('adds up the badge and finds the threads about one load', () => {
    expect(totalUnread([thread({ unread: 2 }), thread({ unread: 0 }), thread({ unread: 3 })])).toBe(5);
    expect(threadsFor([thread(), thread({ conversationId: 'cv_2', freightId: 'fr_2' })], 'fr_2').map((t) => t.conversationId)).toEqual(['cv_2']);
  });
});
