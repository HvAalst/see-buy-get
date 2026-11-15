import { Injectable, Optional } from '@nestjs/common';
import { randomBytes } from 'crypto';
import type { IntrospectionResult } from '../../foundation/auth/auth.types';
import { isStoreDeveloper } from '../../foundation/auth/for-the-developer';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { NotificationService } from './notification.service';
import type { StoreActivityEntry } from './store-activity.types';

interface StoredEntry extends StoreActivityEntry {
  id: string;
  vendorId: string;
}

/** How many entries one store keeps: the newest, enough to answer "who made that key". */
export const STORE_ACTIVITY_KEPT = 200;

type NewEntry = Omit<StoreActivityEntry, 'at' | 'developer'>;

/**
 * 2026-11-15 — WHAT THE OWNER IS TOLD AT ONCE (the owner: "good one, build the notice"): a developer made a LIVE key, or
 * changed or removed where order updates go. Those two touch real orders; a test key, a test message or the code setting
 * do not, and the owner reads them in the history. What the owner does themselves they are not told about.
 */
export function ownerNotice(developer: string, e: NewEntry): { title: string; body: string } | null {
  if (e.act === 'key_made' && e.mode === 'live') {
    const which = [e.kind === 'secret' ? 'secret' : 'publishable', 'key', e.hint ? `…${e.hint}` : '', e.label ? `“${e.label}”` : ''].filter(Boolean).join(' ');
    return {
      title: `${developer} made a live key`,
      body: `A live ${which} was made on Connect your shop system. With it, your shop system books real shipments. If you did not expect this, revoke it there and take out the developer.`,
    };
  }
  if (e.act === 'address_set') {
    return {
      title: `${developer} changed where order updates go`,
      body: `Order updates now go to ${e.url}. If you did not expect this, change it back on Connect your shop system and take out the developer.`,
    };
  }
  if (e.act === 'address_cleared') {
    return {
      title: `${developer} stopped your order updates`,
      body: 'Order updates no longer go to your shop system. If you did not expect this, set the address again on Connect your shop system and take out the developer.',
    };
  }
  return null;
}

/**
 * 2026-11-15 — THE HISTORY OF A STORE'S CONNECTION (the owner: "Is it a common thing to record which keys they made? If so,
 * build it"). What was done on "Connect your shop system", by whom — the owner, or a developer by name — and when: a key made
 * or revoked, where updates go, the code setting, a test message, a new signing secret, a developer invited or taken out.
 * Written by the doors that do those things, read by the owner and the store's developers. Never a key or a secret.
 * A developer's live key or new update address also reaches the owner's bell at once (ownerNotice).
 */
@Injectable()
export class StoreActivityService {
  private readonly entries = new PersistentMap<string, StoredEntry>('store-activity');

  // Optional so a hand-built service keeps compiling: without it the history is still written, and nobody is told.
  constructor(@Optional() private readonly notifications?: NotificationService) {}

  note(vendorId: string, actor: IntrospectionResult | undefined, entry: NewEntry, now: number = Date.now()): void {
    const developer = isStoreDeveloper(actor) ? (actor?.actorName ?? 'a developer').replace(/ \(developer\)$/, '') : undefined;
    const id = `sact_${now.toString(36)}_${randomBytes(4).toString('hex')}`;
    this.entries.set(id, { id, vendorId, at: new Date(now).toISOString(), ...(developer ? { developer } : {}), ...entry });
    // Only the newest are kept for a store.
    const mine = [...this.entries.values()].filter((e) => e.vendorId === vendorId).sort((a, b) => (a.at < b.at ? 1 : -1));
    for (const old of mine.slice(STORE_ACTIVITY_KEPT)) this.entries.delete(old.id);
    // A developer signs in on the store's own DID: its bell is the owner's, and a developer's sign-in cannot open it.
    const told = developer && actor?.did ? ownerNotice(developer, entry) : null;
    if (told && this.notifications) {
      void this.notifications
        .notify(actor!.did!, { kind: 'store_connection', ...told, link: '/?go=connect', tag: `store-connection:${id}`, data: { vendorId, act: entry.act } })
        .catch(() => undefined);
    }
  }

  list(vendorId: string, limit = 30): StoreActivityEntry[] {
    return [...this.entries.values()]
      .filter((e) => e.vendorId === vendorId)
      .sort((a, b) => (a.at < b.at ? 1 : -1))
      .slice(0, limit)
      .map(({ id: _id, vendorId: _vendorId, ...e }) => e);
  }
}
