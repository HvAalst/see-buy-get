import type { Translate } from '../i18n';
import { day } from './words';

/*
 * A LINK TO A DOCUMENT, as the two people who meet one are told about it: whoever opened it from an email, signed
 * out, on the front door — and the party it was made for, on the document in their own app.
 *
 * The user, 2026-10-07: "keep the files on our own server, and put a link in the email." The link is a key: it opens
 * one note with nobody signed in. So every state it can be in is said in words, with what to do next — a page that
 * only says "error" to somebody who was sent a document is a page that makes them ring the sender.
 */

export type LinkState = 'ready' | 'expired' | 'cancelled' | 'used_up' | 'gone';

export interface DocumentLinkView {
  state: LinkState;
  expiresAt: string;
  number?: string;
  from?: string;
  to?: string;
  deliveredAt?: string;
  opensLeft?: number;
  documentUntil?: string;
}

export interface DocumentLinkRow {
  linkId: string;
  state: LinkState;
  sentTo?: string;
  madeBy?: string;
  createdAt: string;
  expiresAt: string;
  opened: number;
  lastOpenedAt?: string;
  cancelledAt?: string;
  /** Who cancelled it, where a person did and their sign-in names them. */
  cancelledBy?: string;
  /**
   * Stopped by nobody's hand: `left` — the person it was emailed to is no longer in the business · `address` — they
   * replaced the email address it was sent to.
   */
  cancelledWhy?: 'left' | 'address';
}

/** What became of asking about a link: the server's answer, or why there is none. */
export type LinkAnswer = { view: DocumentLinkView } | { failed: 'not_ours' | 'busy' | 'unreachable' };

/**
 * THE KEY, out of the part of an address a browser sends to no server: `#doc=<key>`.
 *
 * Whatever follows `doc=` is handed back as it is, even when it cannot be a key — a mail program that cut the
 * address short has still sent somebody here for a document, and they should land on a page that says so rather
 * than on a front door that says nothing. `undefined` only when the address is not about a document at all.
 */
export function readLinkKey(hash: string | undefined): string | undefined {
  const m = /(?:^#|&)doc=([^&]*)/.exec(hash ?? '');
  if (!m) return undefined;
  try {
    return decodeURIComponent(m[1]).trim().slice(0, 200);
  } catch {
    return m[1].trim().slice(0, 200);
  }
}

/** Could this be a key at all? One that could not is not asked of the server: there is nothing to ask. */
export function looksLikeAKey(key: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(key);
}

export interface LinkSays {
  tone: 'ok' | 'info' | 'warn' | 'danger';
  icon: 'check' | 'clock' | 'warning' | 'offline' | 'info';
  title: string;
  /** Each a sentence of its own. */
  lines: string[];
  /** The file can be taken. */
  canTake: boolean;
  /** Asking again may give another answer. */
  canRetry: boolean;
  /** There is nothing left to open, but a copy somebody holds can still be checked. */
  canVerify: boolean;
}

/** How few openings are left before it is worth saying so. */
export const FEW_LEFT = 5;

/**
 * What the page says. A link that opens says what it opens, until when, and that the file is the copy to keep. One
 * that does not says which way it stopped — and who to turn to, which is never us: the note is the sender's to give.
 */
export function linkSays(answer: LinkAnswer, t: Translate): LinkSays {
  const stopped = (title: string, lines: string[], over: Partial<LinkSays> = {}): LinkSays => ({ tone: 'warn', icon: 'clock', title, lines, canTake: false, canRetry: false, canVerify: false, ...over });
  if ('failed' in answer) {
    if (answer.failed === 'not_ours') return stopped(t('doclink.notOurs.title'), [t('doclink.notOurs.detail'), t('doclink.askSender')], { tone: 'danger', icon: 'warning' });
    if (answer.failed === 'busy') return stopped(t('doclink.busy.title'), [t('doclink.busy.detail')], { canRetry: true });
    return stopped(t('doclink.unreachable.title'), [t('doclink.unreachable.detail')], { icon: 'offline', canRetry: true });
  }
  const v = answer.view;
  if (v.state === 'expired') return stopped(t('doclink.expired.title'), [t('doclink.expired.detail', { date: day(v.expiresAt) }), t('doclink.askSender')]);
  if (v.state === 'cancelled') return stopped(t('doclink.cancelled.title'), [t('doclink.cancelled.detail'), t('doclink.askSender')], { icon: 'warning' });
  if (v.state === 'used_up') return stopped(t('doclink.usedUp.title'), [t('doclink.usedUp.detail'), t('doclink.askSender')]);
  if (v.state === 'gone') return stopped(t('doclink.gone.title'), [t('doclink.gone.detail')], { icon: 'info', tone: 'info', canVerify: true });
  const left = v.opensLeft ?? FEW_LEFT + 1;
  return {
    tone: 'ok',
    icon: 'check',
    title: t('doclink.ready.title', { number: v.number ?? '' }),
    lines: [
      ...(v.from && v.to ? [t(v.deliveredAt ? 'doclink.ready.delivered' : 'doclink.ready.route', { from: v.from, to: v.to, date: day(v.deliveredAt) })] : []),
      t('doclink.ready.what'),
      t('doclink.ready.until', { date: day(v.expiresAt) }),
      ...(left <= FEW_LEFT ? [left === 1 ? t('doclink.ready.leftOne') : t('doclink.ready.leftMany', { n: left })] : []),
      ...(v.documentUntil ? [t('doclink.ready.keep', { date: day(v.documentUntil) })] : []),
    ],
    canTake: true,
    canRetry: false,
    canVerify: false,
  };
}

/**
 * The links that still open, and the ones that have stopped — each in the order it came. A note is opened to see
 * what is still a way in to it; what used to be one is its history, kept and shown on asking.
 */
export function splitLinks(rows: DocumentLinkRow[]): { live: DocumentLinkRow[]; stopped: DocumentLinkRow[] } {
  return { live: rows.filter((r) => r.state === 'ready'), stopped: rows.filter((r) => r.state !== 'ready') };
}

/** A link just made: the address, shown once, and until when it works. */
export interface MadeLink {
  url: string;
  expiresAt: string;
}

/** A link on the party's own document: who it went to, and whether it still opens. */
export function linkRowSays(row: DocumentLinkRow, t: Translate): { title: string; state: string; used: string; canCancel: boolean } {
  const state =
    row.state === 'cancelled'
      ? // Who or why, where it is known: in an office of five, "cancelled" alone sends somebody round asking.
        row.cancelledWhy === 'left'
        ? t('archive.links.cancelledLeft', { date: day(row.cancelledAt) })
        : row.cancelledWhy === 'address'
          ? t('archive.links.cancelledAddress', { date: day(row.cancelledAt) })
          : row.cancelledBy
            ? t('archive.links.cancelledBy', { name: row.cancelledBy, date: day(row.cancelledAt) })
            : t('archive.links.cancelled', { date: day(row.cancelledAt) })
      : row.state === 'expired'
        ? t('archive.links.expired', { date: day(row.expiresAt) })
        : row.state === 'used_up'
          ? t('archive.links.usedUp')
          : row.state === 'gone'
            ? t('archive.links.gone')
            : t('archive.links.until', { date: day(row.expiresAt) });
  const used = row.opened === 0 ? t('archive.links.neverOpened') : row.opened === 1 ? t('archive.links.openedOne', { date: day(row.lastOpenedAt) }) : t('archive.links.openedMany', { n: row.opened, date: day(row.lastOpenedAt) });
  // Where it came from: an email we sent, one of the company's own people, or simply this party.
  const title = row.sentTo
    ? t('archive.links.sentTo', { to: row.sentTo, date: day(row.createdAt) })
    : row.madeBy
      ? t('archive.links.madeBy', { name: row.madeBy, date: day(row.createdAt) })
      : t('archive.links.made', { date: day(row.createdAt) });
  return { title, state, used, canCancel: row.state === 'ready' };
}
