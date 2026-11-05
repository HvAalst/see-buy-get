/**
 * 2026-11-05 — A STORE'S ONE ANSWER to what its receivers said (the owner: "short and snappy. a few standard replies to
 * choose like 'contact our customer service' and an optional other that opens a text input field").
 *
 * The same list and limit as the server's (merchant-rating.service STORE_REPLIES, STORE_REPLY_MAX), which refuses anything
 * else: a standard answer is a word of ours, said in each reader's language; OTHER is the store's own line, said as written.
 */
export const STORE_REPLIES = ['CONTACT_US', 'PACKING_IMPROVED', 'FASTER_NOW', 'THANK_YOU', 'OTHER'] as const;
export type StoreReplyKind = (typeof STORE_REPLIES)[number];
export const STORE_REPLY_MAX = 100;

/** The answer as a store's record carries it. */
export interface StoreReply {
  kind: StoreReplyKind;
  text?: string;
  at: string;
}

/** A link, an email address or the digits of a phone number — what the server refuses in a store's own words, said here first. */
export const WAY_OUT = /https?:\/\/|www\.|\b[a-z0-9-]+\.(?:com|co|ke|tz|ug|rw|et|org|net|io|shop|store|africa)\b|@|\d(?:[\s.-]?\d){6,}/i;

/** What the store typed, as it will be kept: one line, a run of spaces one space. */
export const replyLine = (text: string): string => text.replace(/\s+/g, ' ').trim();
