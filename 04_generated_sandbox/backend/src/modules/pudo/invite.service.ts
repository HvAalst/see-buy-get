import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { Invite, InviteSummary, toInviteView } from './invite.types';

/**
 * InviteService (S24) — the SBG copy of BondBridge's invite pattern, for APP EXPOSURE / growth only.
 *
 * A signed-in consumer gets ONE reusable `/send/?invite=<token>` link to share. Anyone who follows it and
 * enrols as a NEW person is credited back to them (the token flows into enrol → `accept`). Deduped by
 * person, self-credit excluded, and — crucially — there is no phone lookup and nothing an inviter can do
 * by merely READING their invites, so it is neither a membership oracle nor inflatable. No circles, no
 * reward beyond the count.
 */
@Injectable()
export class InviteService {
  // Durable: an invite is a growth credential + the ledger of who a person brought in.
  private readonly invites = new PersistentMap<string, Invite>('sbg-invites'); // keyed by token
  // One link per person → O(1) idempotent create, and the guarantee that a person cannot spam the store.
  private readonly byInviter = new Map<string, string>();

  constructor() {
    for (const i of this.invites.values()) this.byInviter.set(i.inviterPersonDid, i.token);
  }

  /** The person's personal invite link — idempotent: one per person, the SAME token every time (re-share
   *  across channels just merges the channel tags). This is also the spam guard — no second record. */
  create(inviterPersonDid: string, channels?: string[]): Invite {
    const existing = this.mine(inviterPersonDid);
    if (existing) {
      if (channels?.length) existing.channels = [...new Set([...(existing.channels ?? []), ...channels])];
      this.invites.set(existing.token, existing);
      return existing;
    }
    const token = randomBytes(8).toString('hex');
    const invite: Invite = { inviteId: `inv_${randomBytes(6).toString('hex')}`, token, inviterPersonDid, channels, joiners: [], createdAt: new Date().toISOString() };
    this.invites.set(token, invite);
    this.byInviter.set(inviterPersonDid, token);
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

  /** The inviter's link + total joins it drove. A pure read — it performs no lookup and mutates nothing,
   *  so an inviter can learn nothing about any phone number by calling it. */
  forInviter(inviterPersonDid: string): InviteSummary {
    const invite = this.mine(inviterPersonDid);
    const views = invite ? [toInviteView(invite)] : [];
    return { invites: views, joined: invite ? invite.joiners.length : 0 };
  }

  /** The @Public landing check — validates the token, nothing more (no inviter, no invitee, no count). */
  preview(token: string): { valid: boolean } {
    return { valid: this.invites.has(token) };
  }

  private mine(inviterPersonDid: string): Invite | undefined {
    const token = this.byInviter.get(inviterPersonDid);
    return token ? this.invites.get(token) : undefined;
  }

  /** Used by tests to confirm an invite exists. */
  byToken(token: string): Invite | undefined {
    return this.invites.get(token);
  }
}
