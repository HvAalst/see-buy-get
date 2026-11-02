/**
 * 2026-11-02 — SHARED WITH SEEBUYGET: the pure half. No DOM, no fetch.
 *
 * The owner, about the apps in the phone's share list: "it should show up in the share list especially when we will
 * start sharing in in-chat if that becomes necessary". What people share in practice is a WhatsApp message with an
 * address in it, a Google Maps link to a pickup point, a phone number, a tracking link — words and a link. Here they
 * become ONE text message, sent into a chat the person already has; nothing is fetched, nothing is attached.
 *
 * Something shared while signed out is not lost: it waits on this phone for an hour (this tab's session storage, so it
 * leaves with the window) and opens the moment the person has signed in.
 */

import type { ConversationsApi } from '../../lib/sbg';
import type { SharedIn } from '../launch';
import type { InstallApp } from '../ui/InstallBar';
import { composeBlocker, wasQueued, type ChatThread } from './logic';

/**
 * The apps that receive a share — the five with chats. The hub has none: a share to it would open a sheet with
 * nowhere to send anything, so it is not in the phone's share list at all, and not here.
 */
export const SHARE_APPS: readonly InstallApp[] = ['agent', 'driver', 'fleet', 'vendor', 'send'];

export function receivesShares(app: InstallApp): boolean {
  return SHARE_APPS.includes(app);
}

/* --------------------------------------------------------------- the words -- */

/** A link a person may open: the web's, and nothing else — never `javascript:`, a file or an app's own scheme. */
export function isWebLink(s: string | undefined): boolean {
  if (!s) return false;
  try {
    const u = new URL(s.trim());
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

/** The first web link in some words, without the full stop or bracket a sentence ends it with. */
function firstLinkIn(text: string | undefined): string | undefined {
  const m = text?.match(/https?:\/\/[^\s<>"']+/i);
  const found = m?.[0].replace(/[).,;:!?\]]+$/, '');
  return found && isWebLink(found) ? found : undefined;
}

/**
 * The link in what was shared, to show as a link. Chrome hands it over as `url`; Android's share sheet and WhatsApp
 * mostly put it inside the text ("Gikomba Market https://maps.app.goo.gl/…"), so the text is looked in too.
 */
export function linkOf(shared: SharedIn): string | undefined {
  if (isWebLink(shared.url)) return shared.url!.trim();
  return firstLinkIn(shared.text) ?? firstLinkIn(shared.title);
}

/**
 * What was shared, as the one message it is sent as: the title when it says something the text does not, the text,
 * and the link when the text does not already carry it. Each once — Chrome often repeats the link as the text.
 */
export function messageOf(shared: SharedIn): string {
  const title = shared.title?.trim();
  const text = shared.text?.trim();
  const url = shared.url?.trim();
  const parts: string[] = [];
  const titled = Boolean(title && title !== url && !text?.includes(title));
  if (titled) parts.push(title!);
  if (text) parts.push(text);
  if (url && !text?.includes(url) && !(titled && title!.includes(url))) parts.push(url);
  return parts.join('\n');
}

/** Why this message cannot go as it is — too long for a chat — or null. Said before anything is tapped. */
export function messageBlocker(message: string): 'common.chat.tooLong' | null {
  return composeBlocker(message, null) === 'common.chat.tooLong' ? 'common.chat.tooLong' : null;
}

/** The chats newest first: the one last spoken in is the one most likely meant. */
export function newestFirst(threads: readonly ChatThread[]): ChatThread[] {
  const when = (x: ChatThread) => x.lastAt ?? x.createdAt ?? '';
  return [...threads].sort((a, b) => when(b).localeCompare(when(a)));
}

/** The person's own chats — never a thread a fleet manager only reads, which nobody but its driver writes in. */
export function writable(threads: readonly ChatThread[]): ChatThread[] {
  return threads.filter((x) => x.role === 'poster' || x.role === 'asker');
}

/* ---------------------------------------------------------------- sending -- */

/** What became of sending it into one chat: there, waiting on this phone for a signal, or refused — in words. */
export type SendOutcome = { state: 'sent' } | { state: 'queued' } | { state: 'refused'; why: string };

/**
 * Send what was shared into one chat, as a text message, through the chat's own route — and so through its own
 * outbox: with no signal the write waits on the phone and goes by itself (outbox.ts answers `{ queued: true }`).
 * `say` turns a refusal into the sentence the person reads: the server's own for a closed thread or too many
 * messages, the shared wording for no signal.
 */
export async function sendShared(
  api: Pick<ConversationsApi, 'send'>,
  conversationId: string,
  message: string,
  say: (error: NonNullable<Awaited<ReturnType<ConversationsApi['send']>>['error']>) => string,
  now: Date = new Date(),
): Promise<SendOutcome> {
  const r = await api.send(conversationId, { body: message, writtenAt: now.toISOString() });
  if (r.error) return { state: 'refused', why: say(r.error) };
  return wasQueued(r.data) ? { state: 'queued' } : { state: 'sent' };
}

/* --------------------------------------------- waiting for the sign-in -- */

/** How long something shared while signed out waits for the sign-in. */
export const HOLD_MS = 60 * 60 * 1000;
/** A phone's clock put back a little is not a share from the future. */
const CLOCK_SLACK_MS = 5 * 60 * 1000;

export const holdKey = (app: InstallApp) => `sbg.sharedIn.${app}`;

/** What is kept: what was shared, and when. */
export function toHeld(shared: SharedIn, now: number): string {
  return JSON.stringify({ at: now, shared });
}

const field = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.slice(0, 4000) : undefined);

/** What is still waiting, or null — nothing kept, kept in a shape not ours, or older than an hour. */
export function fromHeld(raw: string | null | undefined, now: number): SharedIn | null {
  if (!raw) return null;
  let kept: { at?: unknown; shared?: Record<string, unknown> };
  try {
    kept = JSON.parse(raw);
  } catch {
    return null;
  }
  const at = typeof kept?.at === 'number' && Number.isFinite(kept.at) ? kept.at : NaN;
  const age = now - at;
  if (!(age <= HOLD_MS && age >= -CLOCK_SLACK_MS)) return null;
  const s = kept.shared ?? {};
  const shared: SharedIn = { title: field(s.title), text: field(s.text), url: field(s.url) };
  if (!shared.title && !shared.text && !shared.url) return null;
  return Object.fromEntries(Object.entries(shared).filter(([, v]) => v !== undefined)) as SharedIn;
}

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function session(): Store | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

/** Keep what was shared until the sheet is closed, or an hour has gone. */
export function hold(app: InstallApp, shared: SharedIn, now = Date.now(), store: Store | null = session()): void {
  try {
    store?.setItem(holdKey(app), toHeld(shared, now));
  } catch {
    /* storage full or refused: it is still shown now, it just will not outlive the window */
  }
}

/** What waits for this app, if anything — and what is too old is let go on the way. */
export function held(app: InstallApp, now = Date.now(), store: Store | null = session()): SharedIn | null {
  try {
    const raw = store?.getItem(holdKey(app));
    const shared = fromHeld(raw, now);
    if (raw && !shared) store?.removeItem(holdKey(app));
    return shared;
  } catch {
    return null;
  }
}

/** Let it go: sent, copied, or closed. */
export function letGo(app: InstallApp, store: Store | null = session()): void {
  try {
    store?.removeItem(holdKey(app));
  } catch {
    /* nothing to let go of */
  }
}
