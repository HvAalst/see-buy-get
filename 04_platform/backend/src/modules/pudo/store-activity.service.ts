import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import type { IntrospectionResult } from '../../foundation/auth/auth.types';
import { isStoreDeveloper } from '../../foundation/auth/for-the-developer';
import { PersistentMap } from '../../foundation/store/persistent-map';
import type { StoreActivityEntry } from './store-activity.types';

interface StoredEntry extends StoreActivityEntry {
  id: string;
  vendorId: string;
}

/** How many entries one store keeps: the newest, enough to answer "who made that key". */
export const STORE_ACTIVITY_KEPT = 200;

/**
 * 2026-11-15 — THE HISTORY OF A STORE'S CONNECTION (the owner: "Is it a common thing to record which keys they made? If so,
 * build it"). What was done on "Connect your shop system", by whom — the owner, or a developer by name — and when: a key made
 * or revoked, where updates go, the code setting, a test message, a new signing secret, a developer invited or taken out.
 * Written by the doors that do those things, read by the owner and the store's developers. Never a key or a secret.
 */
@Injectable()
export class StoreActivityService {
  private readonly entries = new PersistentMap<string, StoredEntry>('store-activity');

  note(vendorId: string, actor: IntrospectionResult | undefined, entry: Omit<StoreActivityEntry, 'at' | 'developer'>, now: number = Date.now()): void {
    const developer = isStoreDeveloper(actor) ? (actor?.actorName ?? 'a developer').replace(/ \(developer\)$/, '') : undefined;
    const id = `sact_${now.toString(36)}_${randomBytes(4).toString('hex')}`;
    this.entries.set(id, { id, vendorId, at: new Date(now).toISOString(), ...(developer ? { developer } : {}), ...entry });
    // Only the newest are kept for a store.
    const mine = [...this.entries.values()].filter((e) => e.vendorId === vendorId).sort((a, b) => (a.at < b.at ? 1 : -1));
    for (const old of mine.slice(STORE_ACTIVITY_KEPT)) this.entries.delete(old.id);
  }

  list(vendorId: string, limit = 30): StoreActivityEntry[] {
    return [...this.entries.values()]
      .filter((e) => e.vendorId === vendorId)
      .sort((a, b) => (a.at < b.at ? 1 : -1))
      .slice(0, limit)
      .map(({ id: _id, vendorId: _vendorId, ...e }) => e);
  }
}
