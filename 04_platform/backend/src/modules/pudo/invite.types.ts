/**
 * The invite model (S24) — "invite for exposure". A COPY of the BondBridge invite PATTERN (a tokenized
 * link that onboards a new user + attribution of who joined), rebuilt independently inside SBG: no
 * circles, no BondBridge dependency.
 *
 * Deliberately NOT phone-keyed. An earlier design matched an invite to a contact by phoneHash and healed
 * the status on read — which turned invite-creation into a membership ORACLE (probe any number, read back
 * whether it belongs to a member) and let the join count be inflated without bound. This model holds NO
 * invitee number at all: a person has ONE reusable link, and attribution happens only when a NEW person
 * actually joins THROUGH that link (the token flows into enrol). No lookup, no probe, no inflation.
 */

export interface Invite {
  inviteId: string;
  /** The unique, shareable credential carried in the link (`/send/?invite=<token>`). Reusable. */
  token: string;
  inviterPersonDid: string;
  /** How it was shared (share-sheet / copy / …) — a growth signal, never PII. */
  channels?: string[];
  /** The DISTINCT people who joined through this link (deduped, the inviter themselves excluded). */
  joiners: string[];
  createdAt: string;
}

/** What the INVITER sees — their link + how many joined. PII-free: no invitee number, no joiner identity. */
export interface InviteView {
  inviteId: string;
  token: string;
  channels?: string[];
  joined: number;
  createdAt: string;
}

/** The inviter's roll-up: their link (0 or 1) + the total joins it drove (the growth "credit"). */
export interface InviteSummary {
  invites: InviteView[];
  joined: number;
}

export function toInviteView(i: Invite): InviteView {
  return { inviteId: i.inviteId, token: i.token, channels: i.channels, joined: i.joiners.length, createdAt: i.createdAt };
}
