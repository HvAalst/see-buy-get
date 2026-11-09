import { Injectable, Logger } from '@nestjs/common';
import { cleanPrefix, glnCapacity, glnOf, glnProblem, graiOf } from '../../foundation/gs1/gs1';
import { PersistentMap } from '../../foundation/store/persistent-map';
import type { GeoPoint } from './pudo.types';

/**
 * 2026-11-09 — SEEBUYGET'S OWN GS1 PREFIX, AND THE LOCATION NUMBERS (GLN) IT GIVES OUR PLACES (the owner: "we should get our
 * own GS1 prefix"). The prefix is GS1's licence to SeeBuyGet, written on the server by the owner (`SBG_GS1_PREFIX` in .env) —
 * never typed by staff, never invented: without it nothing is numbered, and everything that would show a number shows none.
 *
 * Under it, every approved hub and every approved collection point gets one GLN, the next location reference each time
 * (reference 0 is kept for SeeBuyGet itself). GS1's rules (GLN Allocation Rules 3.0): a place's number is given by the one
 * that defines the place for its business — the collection point in a shop is a place within a place, ours to number, and
 * the shop is told; a GLN is never given to a second place (non-reuse, since July 2022); a place that moves is a new place,
 * and gets a new number while the old one is retired for good.
 */

/** A pin moved further than this is a different place: a new GLN. Nearer, the same place with its pin corrected. */
export const GLN_MOVED_KM = 0.5;

/** Location reference 0 is kept for SeeBuyGet itself, as a party. */
const FIRST_REFERENCE = 1;
/**
 * 2026-11-09 — the last number under the prefix is kept as the ASSET TYPE of our bags (GRAI, AI 8003): never given to a
 * place, so no number we give names two things. Its serial is the bag's own code.
 */
const RESERVED_AT_TOP = 1;

export type OurPlaceKind = 'shop' | 'hub';

export interface OurGln {
  gln: string;
  kind: OurPlaceKind;
  /** The shop's DID, or the hub's mdpId. */
  id: string;
  name: string;
  country?: string;
  /** Where the place stood when it was numbered: a move past GLN_MOVED_KM is a new place. */
  location: GeoPoint;
  issuedAt: string;
  retiredAt?: string;
  retiredWhy?: 'moved' | 'gone';
}

export interface OurGs1Status {
  /** SeeBuyGet's GS1 company prefix as the server has it; absent where it is not set (or is not a prefix). */
  prefix?: string;
  /** Location numbers given under it so far, retired ones included (they are never given again), and how many it holds. */
  used: number;
  capacity: number;
  /** Places numbered now. */
  live: number;
  /** Set but no numbers left: new places wait for a larger prefix. */
  full?: boolean;
}

/** The asset type of our bags under a prefix: its last number (all nines, or none for a 12-digit prefix). */
export function bagAssetType(prefix: string): number {
  return glnCapacity(prefix) - 1;
}

/** The book of GLNs given: no other service's dependencies, so a label can read it without a cycle. */
@Injectable()
export class OurGlnBook {
  private readonly logger = new Logger(OurGlnBook.name);
  /** Every GLN we gave, by number. Never deleted: a retired GLN is kept so it is never given twice. */
  private readonly glns = new PersistentMap<string, OurGln>('our-glns');
  /** The next location reference under each prefix. */
  private readonly next = new PersistentMap<string, { next: number }>('our-gln-references');

  /** SeeBuyGet's prefix from the server's settings — only when it is a prefix GLNs can be made under. */
  prefix(env: NodeJS.ProcessEnv = process.env): string | undefined {
    const raw = env.SBG_GS1_PREFIX?.trim();
    if (!raw) return undefined;
    const p = cleanPrefix(raw);
    if (!p || glnProblem(glnOf(p, 0))) {
      this.logger.warn('SBG_GS1_PREFIX is not a GS1 company prefix GLNs can be given under: no place is numbered');
      return undefined;
    }
    return p;
  }

  /** The live GLN of one of our places, if it has one. */
  of(kind: OurPlaceKind, id: string): string | undefined {
    return this.liveOf(kind, id)?.gln;
  }

  /** The record behind a GLN we gave — live or retired. */
  find(gln: string): OurGln | undefined {
    return this.glns.get(gln);
  }

  liveOf(kind: OurPlaceKind, id: string): OurGln | undefined {
    for (const g of this.glns.values()) if (g.kind === kind && g.id === id && !g.retiredAt) return g;
    return undefined;
  }

  all(): OurGln[] {
    return [...this.glns.values()];
  }

  status(env: NodeJS.ProcessEnv = process.env): OurGs1Status {
    const prefix = this.prefix(env);
    const all = this.all();
    if (!prefix) return { used: all.length, capacity: 0, live: all.filter((g) => !g.retiredAt).length };
    const used = all.filter((g) => g.gln.startsWith(prefix)).length;
    const capacity = Math.max(0, glnCapacity(prefix) - FIRST_REFERENCE - RESERVED_AT_TOP);
    return { prefix, used, capacity, live: all.filter((g) => !g.retiredAt).length, ...(used >= capacity ? { full: true } : {}) };
  }

  /** The next GLN under the prefix, given to this place — or nothing when none is left. */
  give(prefix: string, place: Omit<OurGln, 'gln' | 'issuedAt'>, now: number): OurGln | undefined {
    let ref = Math.max(FIRST_REFERENCE, this.next.get(prefix)?.next ?? FIRST_REFERENCE);
    // Never one already given — under this prefix by any route.
    const top = glnCapacity(prefix) - RESERVED_AT_TOP;
    while (ref < top && this.glns.get(glnOf(prefix, ref))) ref += 1;
    if (ref >= top) {
      this.logger.warn(`no GLNs left under SeeBuyGet's prefix ${prefix}: ${place.name} waits for a larger one`);
      return undefined;
    }
    const given: OurGln = { ...place, gln: glnOf(prefix, ref), issuedAt: new Date(now).toISOString() };
    this.glns.set(given.gln, given);
    this.next.set(prefix, { next: ref + 1 });
    return given;
  }

  /**
   * 2026-11-09 — the GRAI of one of our bags: SeeBuyGet's prefix, the asset type kept for bags (the last number under the
   * prefix), the bag's own code as its serial. Nothing without the prefix on the server.
   */
  graiForBag(code: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
    const prefix = this.prefix(env);
    if (!prefix) return undefined;
    // A code GS1 cannot take as a serial (not capitals, digits and dashes, or longer than 16) gets none: never a stand-in.
    return /^[A-Z0-9-]{1,16}$/.test(code) ? graiOf(prefix, bagAssetType(prefix), code) : undefined;
  }

  retire(gln: string, why: 'moved' | 'gone', now: number): void {
    const g = this.glns.get(gln);
    if (!g || g.retiredAt) return;
    g.retiredAt = new Date(now).toISOString();
    g.retiredWhy = why;
    this.glns.set(gln, g);
  }
}

