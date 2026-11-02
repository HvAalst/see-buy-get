/**
 * 2026-11-02 — OPENING THE LOAD A NOTICE NAMES (the owner: "wire it in").
 *
 * A notice to whoever posted a load carries `?load=<freightId>` (backend notification.types.ts, loadLink); the poster may
 * be a shop, a store or a business, and each opens that load where it reads its loads. The steps are the same in all
 * three, so they are written once: the account's loads read afresh — a load posted a minute ago is in them — then that
 * load opened, or, when it is not among them, said so in words, never a list with nothing open. Somebody who does not
 * read the account's loads (one of a shop's people at its counter: the freight is the owner's) is told that instead,
 * and nothing is fetched for them.
 */
export type LinkedLoadOutcome = 'opened' | 'not_yours' | 'not_read' | 'failed';

export interface LinkedLoadSteps<L> {
  /** Whether this person reads the account's loads at all. */
  mayRead: boolean;
  /** The account's loads, or null when they could not be read (the app says why, as it does for any failed read). */
  fetch: () => Promise<L[] | null>;
  /** Keep what was read: the list is shown with or without the load asked for. */
  keep: (loads: L[]) => void;
  /** Open that load where the app reads it. */
  open: (load: L) => void | Promise<void>;
  /** Say, in words, why nothing opened. */
  say: (why: 'not_yours' | 'not_read') => void;
}

export function openLinkedLoad<L extends { freightId: string }>(id: string, steps: LinkedLoadSteps<L>): Promise<LinkedLoadOutcome> {
  return openLinked((l: L) => l.freightId === id, steps);
}

/**
 * 2026-11-02 — the same steps for any record a notice names (the owner: "that's why it should open"): a booking on a run,
 * an export — read afresh, the one the notice names opened, or said in words that it is not the account's.
 */
export async function openLinked<L>(named: (record: L) => boolean, steps: LinkedLoadSteps<L>): Promise<LinkedLoadOutcome> {
  if (!steps.mayRead) {
    steps.say('not_read');
    return 'not_read';
  }
  const records = await steps.fetch();
  if (!records) return 'failed';
  steps.keep(records);
  const record = records.find(named);
  if (!record) {
    steps.say('not_yours');
    return 'not_yours';
  }
  await steps.open(record);
  return 'opened';
}

/** A booking a run's notice names: that booking, or — told to every shipper on a run — this account's on that run. */
export function bookingNamed(asked: { run: string; booking?: string }): (b: { departureId: string; bookingId: string }) => boolean {
  return (b) => b.departureId === asked.run && (!asked.booking || b.bookingId === asked.booking);
}
