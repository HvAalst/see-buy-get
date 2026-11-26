import { Injectable, Optional } from '@nestjs/common';
import { randomBytes } from 'crypto';
import type { IntrospectionResult } from '../../foundation/auth/auth.types';
import { isStoreDeveloper } from '../../foundation/auth/for-the-developer';
import { MailService } from '../../foundation/mail/mail.service';
import { appUrl } from '../../foundation/mail/mail.templates';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { AccountService } from './account.service';
import { NotificationService } from './notification.service';
import { noticeOf, said } from './notice-words/say';
import { VendorService } from './vendor.service';
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
/** A key in words — its kind, last characters and label; never its value. */
function keyWords(e: NewEntry): string {
  return [e.kind === 'secret' ? 'secret' : 'publishable', 'key', e.hint ? `…${e.hint}` : '', e.label ? `“${e.label}”` : ''].filter(Boolean).join(' ');
}

/**
 * 2026-11-16 — WHAT THE OWNER IS EMAILED (the owner: "take it easy on the notifications … implement the common procedures as
 * PSPs and code hosts do"): one thing only — their developer made a LIVE SECRET key, the credential that can book real
 * shipments, as a code host emails "a personal access token has been added". Not a publishable key (public by design), not
 * the update address, not what the owner does themselves: those are in the History and, some, the bell.
 */
export function ownerEmailed(developer: string | undefined, e: NewEntry): boolean {
  return Boolean(developer) && e.act === 'key_made' && e.mode === 'live' && e.kind === 'secret';
}

export function ownerNotice(developer: string, e: NewEntry): ReturnType<typeof noticeOf> | null {
  if (e.act === 'key_made' && e.mode === 'live') {
    const which = said('storeActivity.keyWords', { kind: said(e.kind === 'secret' ? 'storeActivity.kind.secret' : 'storeActivity.kind.publishable'), hint: e.hint ? ` …${e.hint}` : '', label: e.label ? ` “${e.label}”` : '' });
    return noticeOf(said('storeActivity.keyMade.title', { developer }), said('storeActivity.keyMade.body', { which }));
  }
  if (e.act === 'address_set') {
    return noticeOf(said('storeActivity.addressSet.title', { developer }), said('storeActivity.addressSet.body', { url: e.url ?? '' }));
  }
  if (e.act === 'address_cleared') {
    return noticeOf(said('storeActivity.addressCleared.title', { developer }), said('storeActivity.addressCleared.body'));
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

  // Optional so a hand-built service keeps compiling: without them the history is still written, and nobody is told.
  constructor(
    @Optional() private readonly notifications?: NotificationService,
    @Optional() private readonly mail?: MailService,
    @Optional() private readonly accounts?: AccountService,
    @Optional() private readonly vendors?: VendorService,
  ) {}

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
    // A live secret key made by a developer: also an email to the owner's sign-in address, with a link to Connect.
    if (ownerEmailed(developer, entry) && actor?.did) {
      const address = this.accounts?.emailForDid(actor.did);
      if (address && this.mail) {
        let store = 'your store';
        try {
          store = this.vendors?.get(vendorId).name || store;
        } catch {
          /* the store's name is a courtesy; the email goes without it */
        }
        void this.mail
          .send('store-live-key', { address }, { store, developer: developer!, key: keyWords(entry), at: new Date(now).toISOString(), link: `${appUrl('vendor')}?go=connect` })
          .catch(() => undefined);
      }
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
