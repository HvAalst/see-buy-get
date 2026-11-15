import { Injectable, Optional } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { AuthService } from '../../foundation/auth/auth.service';
import { STORE_DEVELOPER_KEY_PREFIX } from '../../foundation/auth/for-the-developer';
import { GlosError } from '../../foundation/http/glos-error';
import { MailService } from '../../foundation/mail/mail.service';
import { appUrl } from '../../foundation/mail/mail.templates';
import { PersistentMap } from '../../foundation/store/persistent-map';
import type { StoreDeveloperSession, StoreDeveloperView } from './store-developer.types';
import { VendorService } from './vendor.service';

interface StoreDeveloper {
  devId: string;
  vendorId: string;
  name: string;
  email: string;
  invitedAt: string;
  invitedBy: string;
  lastSignInAt?: string;
  removedAt?: string;
}

/** A sign-in link: only its fingerprint is kept, used once, and only until it runs out. */
interface DeveloperLink {
  devId: string;
  expiresAt: string;
  usedAt?: string;
}

/** The most developers one store may have at once. */
export const MAX_STORE_DEVELOPERS = 3;
/** How long a link works: the invitation a week, one asked for later a day. */
export const INVITE_LINK_HOURS = 7 * 24;
export const SIGN_IN_LINK_HOURS = 24;

const fingerprint = (code: string) => createHash('sha256').update(code).digest('hex');

/**
 * 2026-11-15 — A STORE'S DEVELOPER, WITH A SIGN-IN OF THEIR OWN (the owner: "as recommended" — "a developer still needs the
 * owner beside them to make each key"). The owner invites them by name and email; they are emailed a one-time link that
 * opens the Store app as the store, named for them and revocable on its own — and the guard lets that sign-in through only
 * the doors marked for a developer (foundation/auth/for-the-developer.ts). No password is kept: a link asked for later is
 * emailed to the address the owner gave, and to nobody else. Taking a developer out ends every sign-in of theirs at once.
 */
@Injectable()
export class StoreDeveloperService {
  private readonly developers = new PersistentMap<string, StoreDeveloper>('store-developers');
  private readonly links = new PersistentMap<string, DeveloperLink>('store-developer-links');

  constructor(
    private readonly vendors: VendorService,
    private readonly auth: AuthService,
    @Optional() private readonly mail?: MailService,
  ) {}

  /** The store's developers, and those taken out, newest first. The owner's. */
  list(vendorId: string): StoreDeveloperView[] {
    return [...this.developers.values()]
      .filter((d) => d.vendorId === vendorId)
      .sort((a, b) => (a.invitedAt < b.invitedAt ? 1 : -1))
      .map(viewOf);
  }

  /** Invite a developer: their name and email, and a link to sign in with, emailed to them. */
  invite(vendorId: string, input: { name: string; email: string }, by: string, now: number = Date.now()): StoreDeveloperView {
    const store = this.vendors.get(vendorId);
    const name = (input.name ?? '').trim().slice(0, 60);
    if (name.length < 2) throw new GlosError('FIELD_REQUIRED', 'Say who your developer is: what they do is recorded under this name', { field: 'name' });
    const email = (input.email ?? '').trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new GlosError('VALIDATION_FAILED', 'Give the email address your developer reads', { field: 'email' });
    const live = [...this.developers.values()].filter((d) => d.vendorId === vendorId && !d.removedAt);
    if (live.some((d) => d.email === email)) throw new GlosError('CONFLICT', 'That developer is invited already: they can ask for a new link from the Store app’s sign-in', { field: 'email' });
    if (live.length >= MAX_STORE_DEVELOPERS) throw new GlosError('INVALID_STATE', `A store can have ${MAX_STORE_DEVELOPERS} developers at once: take one out first`);
    const dev: StoreDeveloper = { devId: `sdv_${randomBytes(8).toString('hex')}`, vendorId, name, email, invitedAt: new Date(now).toISOString(), invitedBy: by };
    this.developers.set(dev.devId, dev);
    this.sendLink(dev, store.name, INVITE_LINK_HOURS, true, now);
    return viewOf(dev);
  }

  /** Take a developer out: kept, so the owner sees who was, and every sign-in of theirs ends now. */
  remove(vendorId: string, devId: string, now: number = Date.now()): StoreDeveloperView {
    const dev = this.developers.get(devId);
    if (!dev || dev.vendorId !== vendorId) throw new GlosError('NOT_FOUND', 'No such developer at this store');
    if (!dev.removedAt) {
      dev.removedAt = new Date(now).toISOString();
      this.developers.set(dev.devId, dev);
      this.auth.revokeAll(`${STORE_DEVELOPER_KEY_PREFIX}${dev.devId}`);
    }
    return viewOf(dev);
  }

  /** A developer asks for a fresh link: emailed to them if they are a store's developer — the same answer either way. */
  requestLink(email: string, now: number = Date.now()): { sent: true } {
    const mail = (email ?? '').trim().toLowerCase();
    for (const dev of this.developers.values()) {
      if (dev.removedAt || dev.email !== mail) continue;
      let storeName = 'your store';
      try {
        storeName = this.vendors.get(dev.vendorId).name;
      } catch {
        continue;
      }
      this.sendLink(dev, storeName, SIGN_IN_LINK_HOURS, false, now);
    }
    return { sent: true };
  }

  /** A link's code, once: a session as the store, named for the developer, through the developer's doors only. */
  session(code: string, now: number = Date.now()): StoreDeveloperSession {
    const key = fingerprint((code ?? '').trim());
    const link = this.links.get(key);
    const dev = link ? this.developers.get(link.devId) : undefined;
    if (!link || !dev || link.usedAt || Date.parse(link.expiresAt) <= now || dev.removedAt) {
      throw new GlosError('FORBIDDEN', 'This sign-in link has been used, has run out, or was stopped. Ask for a new one from the Store app’s sign-in, with your email');
    }
    const store = this.vendors.get(dev.vendorId);
    link.usedAt = new Date(now).toISOString();
    this.links.set(key, link);
    dev.lastSignInAt = link.usedAt;
    this.developers.set(dev.devId, dev);
    const token = this.auth.mintActorToken({ role: 'genesis', did: store.did, actorName: `${dev.name} (developer)`, revocationKey: `${STORE_DEVELOPER_KEY_PREFIX}${dev.devId}` });
    return { vendorId: store.vendorId, storeName: store.name, name: dev.name, developer: true, token };
  }

  private sendLink(dev: StoreDeveloper, storeName: string, hours: number, invited: boolean, now: number): void {
    const code = randomBytes(24).toString('base64url');
    const expiresAt = new Date(now + hours * 3_600_000).toISOString();
    this.links.set(fingerprint(code), { devId: dev.devId, expiresAt });
    void this.mail?.send('store-developer-link', { address: dev.email, name: dev.name }, { store: storeName, name: dev.name, link: `${appUrl('vendor')}?dev=${encodeURIComponent(code)}`, until: expiresAt, invited }).catch(() => undefined);
  }
}

const viewOf = (d: StoreDeveloper): StoreDeveloperView => ({ devId: d.devId, name: d.name, email: d.email, invitedAt: d.invitedAt, ...(d.lastSignInAt ? { lastSignInAt: d.lastSignInAt } : {}), ...(d.removedAt ? { removedAt: d.removedAt } : {}) });
