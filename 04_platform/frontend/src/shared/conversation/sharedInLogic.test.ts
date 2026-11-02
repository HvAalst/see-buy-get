import { describe, expect, it } from 'vitest';
import type { ConversationsApi, SbgError } from '../../lib/sbg';
import type { ChatThread } from './logic';
import {
  HOLD_MS,
  SHARE_APPS,
  fromHeld,
  hold,
  held,
  holdKey,
  isWebLink,
  letGo,
  linkOf,
  messageBlocker,
  messageOf,
  newestFirst,
  receivesShares,
  sendShared,
  toHeld,
  writable,
} from './sharedInLogic';

/*
 * 2026-11-02 — SHARED WITH SEEBUYGET, the pure half (the owner: "it should show up in the share list especially when we
 * will start sharing in in-chat"). What people share in practice: a WhatsApp message with an address, a Google Maps link
 * to a pickup point, a phone number, a tracking link.
 */

const thread = (over: Partial<ChatThread> = {}): ChatThread => ({
  conversationId: 'c-1',
  freightCode: 'FRT-101',
  freightLabel: 'Gikomba to Nakuru, 2 pallets',
  role: 'asker',
  lastSeq: 3,
  unread: 0,
  createdAt: '2026-11-01T08:00:00.000Z',
  blocked: false,
  blockedByMe: false,
  ...over,
});

describe('what was shared, as one message', () => {
  it('a WhatsApp message is sent as it was written, its lines kept', () => {
    const text = 'Pick up at Gikomba gate 3\nAsk for Wanjiru 0712 345 678';
    expect(messageOf({ text })).toBe(text);
  });

  it('a page from Chrome: its title, then its link', () => {
    expect(messageOf({ title: 'Track your parcel', url: 'https://track.example.com/p/123' })).toBe('Track your parcel\nhttps://track.example.com/p/123');
  });

  it('says each thing once: a link already in the words, or a title the words begin with, is not repeated', () => {
    expect(messageOf({ title: 'Gikomba Market', text: 'Gikomba Market\nhttps://maps.app.goo.gl/AbC123', url: 'https://maps.app.goo.gl/AbC123' })).toBe(
      'Gikomba Market\nhttps://maps.app.goo.gl/AbC123',
    );
    // Chrome on Android often hands the link over as the text, and as the link.
    expect(messageOf({ text: 'https://maps.app.goo.gl/AbC123', url: 'https://maps.app.goo.gl/AbC123' })).toBe('https://maps.app.goo.gl/AbC123');
    expect(messageOf({ title: 'https://x.example', url: 'https://x.example' })).toBe('https://x.example');
  });

  it('too long for one chat message is said before anything is tapped', () => {
    expect(messageBlocker('a'.repeat(1000))).toBeNull();
    expect(messageBlocker('a'.repeat(1001))).toBe('common.chat.tooLong');
  });
});

describe('the link in it — shown as a link, never fetched', () => {
  it('a web link only: never a script, a file or another app’s address', () => {
    expect(isWebLink('https://maps.app.goo.gl/AbC123')).toBe(true);
    expect(isWebLink('http://track.example.com')).toBe(true);
    expect(isWebLink('javascript:alert(1)')).toBe(false);
    expect(isWebLink('file:///etc/passwd')).toBe(false);
    expect(isWebLink('intent://scan/#Intent;scheme=zxing;end')).toBe(false);
    expect(isWebLink('not a link')).toBe(false);
    expect(isWebLink(undefined)).toBe(false);
  });

  it('from the link field, or found in the words without the full stop that ends the sentence', () => {
    expect(linkOf({ url: 'https://track.example.com/p/1' })).toBe('https://track.example.com/p/1');
    expect(linkOf({ text: 'The shop is here: https://maps.app.goo.gl/AbC123. Call first.' })).toBe('https://maps.app.goo.gl/AbC123');
    expect(linkOf({ text: '(see https://track.example.com/p/9)' })).toBe('https://track.example.com/p/9');
    expect(linkOf({ text: 'Call 0712 345 678 at the gate' })).toBeUndefined();
    // A script handed over as "the link" is words, not a link — and no link in the words either.
    expect(linkOf({ url: 'javascript:alert(1)', text: 'hello' })).toBeUndefined();
  });
});

describe('the chats it can go into', () => {
  it('newest first, by the last message, else by when the chat began', () => {
    const a = thread({ conversationId: 'a', lastAt: '2026-11-01T09:00:00.000Z' });
    const b = thread({ conversationId: 'b', lastAt: '2026-11-02T07:00:00.000Z' });
    const c = thread({ conversationId: 'c', createdAt: '2026-11-01T12:00:00.000Z' });
    expect(newestFirst([a, b, c]).map((x) => x.conversationId)).toEqual(['b', 'c', 'a']);
  });

  it('only the person’s own: never a thread a manager only reads', () => {
    expect(writable([thread({ conversationId: 'p', role: 'poster' }), thread({ conversationId: 'm', role: 'manager' }), thread({ conversationId: 'a' })]).map((x) => x.conversationId)).toEqual(['p', 'a']);
  });
});

describe('sending it into one chat', () => {
  const fake = (answer: { data?: unknown; error?: SbgError | null }) => {
    const calls: Array<{ id: string; message: { body?: string; quick?: string; writtenAt?: string } }> = [];
    const api = {
      send: async (id: string, message: { body?: string; quick?: string; writtenAt?: string }) => {
        calls.push({ id, message });
        return answer.error ? { data: null, error: answer.error, status: answer.error.status } : { data: answer.data ?? {}, error: null, status: 201 };
      },
    } as unknown as Pick<ConversationsApi, 'send'>;
    return { api, calls };
  };
  const now = new Date('2026-11-02T10:00:00.000Z');
  const say = (e: SbgError) => e.detail;

  it('goes as a text message into the chat that was tapped, stamped with when Send was pressed', async () => {
    const { api, calls } = fake({ data: { seq: 4 } });
    expect(await sendShared(api, 'c-7', 'Pick up at Gikomba gate 3\nhttps://maps.app.goo.gl/AbC123', say, now)).toEqual({ state: 'sent' });
    expect(calls).toEqual([{ id: 'c-7', message: { body: 'Pick up at Gikomba gate 3\nhttps://maps.app.goo.gl/AbC123', writtenAt: '2026-11-02T10:00:00.000Z' } }]);
  });

  it('with no signal it waits on the phone, in the chat’s own outbox, and says so', async () => {
    const { api } = fake({ data: { queued: true } });
    expect(await sendShared(api, 'c-7', 'hello', say, now)).toEqual({ state: 'queued' });
  });

  it('a refusal comes back in the words it came with', async () => {
    const { api } = fake({ error: { code: 'FORBIDDEN', status: 403, title: 'Forbidden', detail: 'This conversation is closed', retryable: false } });
    expect(await sendShared(api, 'c-7', 'hello', say, now)).toEqual({ state: 'refused', why: 'This conversation is closed' });
  });
});

describe('shared while signed out: kept for the sign-in, for an hour', () => {
  const at = Date.parse('2026-11-02T10:00:00.000Z');
  const shared = { text: 'Gikomba gate 3', url: 'https://maps.app.goo.gl/AbC123' };

  it('kept, and given back within the hour', () => {
    expect(fromHeld(toHeld(shared, at), at)).toEqual(shared);
    expect(fromHeld(toHeld(shared, at), at + HOLD_MS)).toEqual(shared);
  });

  it('let go after an hour', () => {
    expect(fromHeld(toHeld(shared, at), at + HOLD_MS + 1)).toBeNull();
  });

  it('nothing kept, a shape not ours, nothing in it, or from the future, is nothing', () => {
    expect(fromHeld(null, at)).toBeNull();
    expect(fromHeld('not json', at)).toBeNull();
    expect(fromHeld(JSON.stringify({ shared }), at)).toBeNull();
    expect(fromHeld(JSON.stringify({ at, shared: { text: '  ' } }), at)).toBeNull();
    expect(fromHeld(JSON.stringify({ at: at + 60 * 60 * 1000, shared }), at)).toBeNull();
    // A phone clock put back a minute is not the future.
    expect(fromHeld(JSON.stringify({ at: at + 60 * 1000, shared }), at)).toEqual(shared);
  });

  it('by app, in this window’s session: held, read back, and let go — the stale one on the way', () => {
    const map = new Map<string, string>();
    const store = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) };
    hold('driver', shared, at, store);
    expect(map.has(holdKey('driver'))).toBe(true);
    expect(held('driver', at + 1000, store)).toEqual(shared);
    expect(held('vendor', at + 1000, store)).toBeNull();
    letGo('driver', store);
    expect(held('driver', at + 1000, store)).toBeNull();
    hold('agent', shared, at, store);
    expect(held('agent', at + HOLD_MS + 1, store)).toBeNull();
    expect(map.has(holdKey('agent'))).toBe(false);
  });

  it('with no storage at all, nothing breaks', () => {
    expect(() => hold('driver', shared, at, null)).not.toThrow();
    expect(held('driver', at, null)).toBeNull();
  });
});

describe('the apps that receive a share', () => {
  it('are exactly the five with chats — never the hub', () => {
    expect([...SHARE_APPS].sort()).toEqual(['agent', 'driver', 'fleet', 'send', 'vendor']);
    expect(receivesShares('mdp')).toBe(false);
    for (const app of SHARE_APPS) expect(receivesShares(app)).toBe(true);
  });
});
