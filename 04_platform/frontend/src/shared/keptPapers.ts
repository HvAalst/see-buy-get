/*
 * THE PAPERS KEPT ON THE PHONE (the ISO 28000 check: "the papers on the phone without signal"; built without asking).
 *
 * At a checkpoint the police or customs ask for the consignment note, and a checkpoint is where the signal is worst: the
 * note opened from the server, or not at all. Now the driver's app keeps a copy of the note of every load that is theirs —
 * claimed or on the road — fetched while there is signal and fetched again when it changes, and opens the copy when the
 * server cannot be reached, saying when it was kept. A load that is no longer theirs, and every copy at sign-out, is
 * forgotten: the note names the shipper and the receiver, and the phone is the driver's own.
 */

export interface KeptPaper {
  html: string;
  keptAt: string;
  /** The load's status when it was kept: a load picked up or delivered since has a new note. */
  status?: string;
}

/** Kept again after this long even if nothing about the load changed: the shipper may have added to box 13. */
export const KEEP_AGAIN_MS = 30 * 60_000;

const PREFIX = 'sbg-paper:';

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

function local(): Store | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

const keyOf = (owner: string, ref: string) => `${PREFIX}${owner}:${ref}`;

/**
 * Round 38 — the load's commercial invoice, kept beside its note under a name of its own: the driver carrying a load across
 * a border shows it there, from pickup on, where the signal is worst. Forgotten with the note.
 */
export function invoicePaperRef(freightId: string): string {
  return `${freightId}~invoice`;
}

export function keepPaper(owner: string, ref: string, html: string, status?: string, now: number = Date.now(), store: Store | null = local()): void {
  if (!store || !owner || !ref || !html) return;
  try {
    store.setItem(keyOf(owner, ref), JSON.stringify({ html, keptAt: new Date(now).toISOString(), ...(status ? { status } : {}) } satisfies KeptPaper));
  } catch {
    /* full, or blocked: the next time there is signal it is tried again */
  }
}

export function keptPaper(owner: string, ref: string, store: Store | null = local()): KeptPaper | null {
  if (!store || !owner || !ref) return null;
  try {
    const raw = store.getItem(keyOf(owner, ref));
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<KeptPaper>;
    return typeof p.html === 'string' && typeof p.keptAt === 'string' ? { html: p.html, keptAt: p.keptAt, ...(p.status ? { status: p.status } : {}) } : null;
  } catch {
    return null;
  }
}

/** Whether a load's note should be fetched and kept now: none kept, its status changed, or kept too long ago. */
export function needsKeeping(kept: KeptPaper | null, status: string | undefined, now: number = Date.now()): boolean {
  if (!kept) return true;
  if ((kept.status ?? '') !== (status ?? '')) return true;
  return now - Date.parse(kept.keptAt) > KEEP_AGAIN_MS;
}

/** Forget every note this owner keeps but those named: the loads that are still theirs. Returns how many went. */
export function forgetPapers(owner: string, keep: string[] = [], store: Store | null = local()): number {
  if (!store || !owner) return 0;
  const mine = `${PREFIX}${owner}:`;
  const stay = new Set(keep.map((ref) => keyOf(owner, ref)));
  const doomed: string[] = [];
  try {
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k && k.startsWith(mine) && !stay.has(k)) doomed.push(k);
    }
    // Collected first: removing during the walk renumbers the keys.
    for (const k of doomed) store.removeItem(k);
  } catch {
    return 0;
  }
  return doomed.length;
}
