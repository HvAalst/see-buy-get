import type { BorderWaitView, PassageKind, PassageView } from '../../shared/passages';

/**
 * A LOAD AT A BORDER OR A HUB, from the cab (round 14: "The driver, by a tap"). On a load on the road the driver says it
 * is at a border post, has cleared it, or is at a hub. What the server says the driver may say next comes with the load;
 * a step said with no signal waits on this phone (the outbox) and is shown here as said — the next one can follow it
 * straight away, rather than the screen going on offering the step already taken until the signal returns.
 */
export interface PassageForDriver {
  /** Only a load that crosses a border may be said to be at one. */
  crosses: boolean;
  from?: string;
  to?: string;
  /** The crossing's posts on record, to choose from. Empty: none recorded — the driver names it. */
  posts: string[];
  /** At a post now: which, since when, and how long it is allowed there. */
  atPost?: { post: string; since: string; wait?: BorderWaitView };
  last?: PassageView;
}

/** A step said on this phone, per load: shown at once, whether it reached SeeBuyGet yet or waits for a signal. */
export interface SaidPassage {
  kind: PassageKind;
  post?: string;
  hub?: string;
  at: string;
}

/**
 * What the screen shows: the server's word, or this phone's where it said something since. A step said here that the
 * server already has (its last step is as new) changes nothing.
 */
export function passageNow(server: PassageForDriver | undefined, said: SaidPassage | undefined): PassageForDriver | undefined {
  if (!server) return undefined;
  if (!said || (server.last && server.last.at >= said.at)) return server;
  const last: PassageView = { kind: said.kind, ...(said.post ? { post: said.post } : {}), ...(said.hub ? { hub: said.hub } : {}), at: said.at };
  if (said.kind === 'at_border') return { ...server, atPost: { post: said.post ?? '', since: said.at }, last };
  if (said.kind === 'cleared_border') {
    const across: PassageForDriver = { ...server, last };
    delete across.atPost;
    return across;
  }
  return { ...server, last };
}

/** The steps the driver may say now. */
export function nextSteps(p: PassageForDriver | undefined): PassageKind[] {
  if (!p) return [];
  if (p.atPost) return ['cleared_border', 'at_hub'];
  return [...(p.crosses ? (['at_border'] as const) : []), 'at_hub'];
}

/** A name for a post or a hub, as it is sent: trimmed, single spaces, two characters at least. */
export function placeOk(name: string): boolean {
  return name.trim().replace(/\s+/g, ' ').length >= 2;
}
