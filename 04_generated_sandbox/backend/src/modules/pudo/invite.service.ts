import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { GlosError } from '../../foundation/http/glos-error';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { Invite, InviteSummary, toInviteView } from './invite.types';

/** A generous per-person ceiling — enough to invite a real address book, bounded so no one can spam the store. */
const MAX_INVITES_PER_PERSON = 100;

/**
 * InviteService (S24 → S28) — invite for app exposure / growth, contact-picker driven.
 *
 * S28 mints ONE token PER invited contact (not one reusable link), so the sender can see "Jane joined"
 * once Jane's specific link brings in a NEW person. The privacy guarantee from S24 is UNCHANGED and is
 * exactly why this is still safe: the server holds NO invitee number or name — only the opaque token and
 * the set of NEW persons who joined through it. Status flips only on a genuine new-enrol event (never
 * "healed" from existing membership on read), so it is neither a membership oracle nor inflatable, and
 * the invitee↔token map that renders the friend's NAME lives only on the sender's device.
 */
@Injectable()
export class InviteService {
  // Durable: each token is a growth credential + the ledger of who joined through it. Keyed by token.
  private readonly invites = new PersistentMap<string, Invite>('sbg-invites');
  // personDid → their tokens. Bounds per-person growth and answers forInviter in O(their invites).
  private readonly byInviter = new Map<string, string[]>();

  constructor() {
    for (const i of this.invites.values()) this.index(i);
  }

  /**
   * Mint a fresh per-contact invite token for this person (the sender maps it to a contact on-device).
   * Not idempotent by design — one link per contact — but capped per person so the store can't be spammed.
   */
  create(inviterPersonDid: string, channels?: string[]): Invite {
    const mine = this.byInviter.get(inviterPersonDid) ?? [];
    if (mine.length >= MAX_INVITES_PER_PERSON) {
      throw new GlosError('INVITE_LIMIT', `You can have at most ${MAX_INVITES_PER_PERSON} open invites`);
    }
    const token = randomBytes(8).toString('hex');
    const invite: Invite = { inviteId: `inv_${randomBytes(6).toString('hex')}`, token, inviterPersonDid, channels, joiners: [], createdAt: new Date().toISOString() };
    this.invites.set(token, invite);
    this.index(invite);
    return invite;
  }

  /**
   * Credit a NEW person who joined through this link. Called from enrol ONLY for a first-time join, so a
   * pre-existing member re-verifying is never credited. Best-effort + idempotent: an unknown token, a
   * self-join, or an already-credited person is a silent no-op — a bad token must never block a sign-up.
   */
  accept(token: string, newPersonDid: string): void {
    const invite = this.invites.get(token);
    if (!invite) return;
    if (invite.inviterPersonDid === newPersonDid) return; // you cannot invite yourself
    if (invite.joiners.includes(newPersonDid)) return; // one join credited at most once
    invite.joiners.push(newPersonDid);
    this.invites.set(token, invite);
  }

  /**
   * The inviter's tokens + the total joins they drove. A pure read — no phone lookup, no mutation — so an
   * inviter learns nothing about any number by calling it; each token's `joined` count is the on-device
   * "pending → joined" signal (joined > 0 ⇒ that contact came in through their link).
   */
  forInviter(inviterPersonDid: string): InviteSummary {
    const tokens = this.byInviter.get(inviterPersonDid) ?? [];
    const invites = tokens.map((t) => this.invites.get(t)).filter((i): i is Invite => Boolean(i));
    return { invites: invites.map(toInviteView), joined: invites.reduce((sum, i) => sum + i.joiners.length, 0) };
  }

  /** The @Public landing check — validates the token, nothing more (no inviter, no invitee, no count). */
  preview(token: string): { valid: boolean } {
    return { valid: this.invites.has(token) };
  }

  private index(invite: Invite): void {
    const list = this.byInviter.get(invite.inviterPersonDid) ?? [];
    if (!list.includes(invite.token)) list.push(invite.token);
    this.byInviter.set(invite.inviterPersonDid, list);
  }

  /** Used by tests to confirm an invite exists. */
  byToken(token: string): Invite | undefined {
    return this.invites.get(token);
  }
}
