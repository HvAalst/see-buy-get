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

export interface LinkedLoadSteps<L extends { freightId: string }> {
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

export async function openLinkedLoad<L extends { freightId: string }>(id: string, steps: LinkedLoadSteps<L>): Promise<LinkedLoadOutcome> {
  if (!steps.mayRead) {
    steps.say('not_read');
    return 'not_read';
  }
  const loads = await steps.fetch();
  if (!loads) return 'failed';
  steps.keep(loads);
  const load = loads.find((l) => l.freightId === id);
  if (!load) {
    steps.say('not_yours');
    return 'not_yours';
  }
  await steps.open(load);
  return 'opened';
}
