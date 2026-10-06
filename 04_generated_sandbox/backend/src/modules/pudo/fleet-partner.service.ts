import { Injectable } from '@nestjs/common';
import { createHash, randomBytes, randomInt } from 'crypto';
import { GlosError } from '../../foundation/http/glos-error';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { FleetPartnerLists, FleetPartnership, FleetPartnershipView, HandOnFleet, PartnerInviteIssued } from './fleet-partner.types';

/** The same terms as a contract's link code: a fortnight, five wrong tries an hour, ten characters nobody guesses. */
export const PARTNER_INVITE_DAYS = 14;
export const PARTNER_LINK_TRIES_PER_HOUR = 5;
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 10;
/** Enough for any real fleet's circle; a ceiling, not a target. */
export const MAX_PARTNERS = 50;

/**
 * P4 — A FLEET'S PARTNERS. See fleet-partner.types for what a partnership is and is not.
 *
 * The code is held by one fleet (issued per arrangement, shown once), cannot be guessed (31^10, kept only as a hash),
 * every wrong try is limited (five an hour per fleet), and either side can undo what it made (end it).
 */
@Injectable()
export class FleetPartnerService {
  private readonly partnerships = new PersistentMap<string, FleetPartnership>('fleet-partnerships');
  private readonly misses = new Map<string, { since: number; count: number }>();

  /** The offering fleet names a partner, and gets the code to pass on. */
  invite(from: HandOnFleet, input: { partnerName?: string }, by: string, now = Date.now()): PartnerInviteIssued {
    const partnerName = input.partnerName?.trim();
    if (!partnerName) throw new GlosError('FIELD_REQUIRED', 'Name the fleet you want to hand work to', { field: 'partnerName' });
    if (this.offeringTo(from.fleetDid).filter((p) => p.status !== 'ended').length >= MAX_PARTNERS) throw new GlosError('INVALID_STATE', `A fleet names ${MAX_PARTNERS} partners at most`);
    const p: FleetPartnership = {
      partnershipId: `prt_${randomBytes(8).toString('hex')}`,
      fromFleetDid: from.fleetDid,
      fromFleetName: from.fleetName,
      partnerName: partnerName.slice(0, 120),
      status: 'invited',
      createdAt: new Date(now).toISOString(),
      createdBy: by,
    };
    return this.issue(p, now);
  }

  /** A new code for an arrangement not yet linked. The last one stops working. */
  reissue(fromFleetDid: string, partnershipId: string, now = Date.now()): PartnerInviteIssued {
    const p = this.requireFrom(fromFleetDid, partnershipId);
    if (p.status !== 'invited') throw new GlosError('INVALID_STATE', p.status === 'active' ? `${p.partnerName} has already linked this` : 'This arrangement has ended');
    return this.issue(p, now);
  }

  private issue(p: FleetPartnership, now: number): PartnerInviteIssued {
    const code = Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
    const expiresAt = new Date(now + PARTNER_INVITE_DAYS * 86_400_000).toISOString();
    p.invite = { codeHash: hashCode(code), expiresAt };
    this.partnerships.set(p.partnershipId, p);
    return { partnership: viewOf(p), code: `${code.slice(0, 5)}-${code.slice(5)}`, expiresAt };
  }

  /** The partner's office enters the code: from now on the other fleet may offer it orders. */
  link(to: HandOnFleet, rawCode: string, by: string, now = Date.now()): FleetPartnership {
    const recent = this.misses.get(to.fleetDid);
    if (recent && now - recent.since < 3_600_000 && recent.count >= PARTNER_LINK_TRIES_PER_HOUR) throw new GlosError('RATE_LIMITED', 'Too many codes that did not match — wait an hour, or ask the other fleet for a new one');
    const hash = hashCode((rawCode ?? '').toUpperCase().replace(/[^A-Z0-9]/g, ''));
    const p = [...this.partnerships.values()].find((x) => x.invite?.codeHash === hash);
    if (!p || p.status !== 'invited' || new Date(p.invite!.expiresAt).getTime() <= now) {
      const fresh = !recent || now - recent.since >= 3_600_000;
      this.misses.set(to.fleetDid, fresh ? { since: now, count: 1 } : { since: recent!.since, count: recent!.count + 1 });
      throw new GlosError('NOT_FOUND', 'That code does not match — check it, or ask the other fleet for a new one', { field: 'code' });
    }
    if (p.fromFleetDid === to.fleetDid) throw new GlosError('INVALID_INPUT', 'That is your own code — it is for the fleet you hand work to', { field: 'code' });
    if (this.activePartners(p.fromFleetDid).some((x) => x.fleetDid === to.fleetDid)) throw new GlosError('CONFLICT', `${p.fromFleetName} already has you as a partner`, { field: 'code' });
    delete p.invite;
    p.toFleetDid = to.fleetDid;
    p.partnerName = to.fleetName.slice(0, 120);
    p.status = 'active';
    p.linkedAt = new Date(now).toISOString();
    p.linkedBy = by;
    this.partnerships.set(p.partnershipId, p);
    return p;
  }

  /** Ended by either side. No new offers; an order a partner already took is still theirs to carry. */
  end(fleetDid: string, partnershipId: string, by: string, now = Date.now()): FleetPartnership {
    const p = this.partnerships.get(partnershipId);
    if (!p || (p.fromFleetDid !== fleetDid && p.toFleetDid !== fleetDid)) throw new GlosError('NOT_FOUND', 'No such partner');
    if (p.status === 'ended') throw new GlosError('INVALID_STATE', 'This arrangement has already ended');
    p.status = 'ended';
    delete p.invite;
    p.ended = { at: new Date(now).toISOString(), side: p.fromFleetDid === fleetDid ? 'from' : 'to', by };
    this.partnerships.set(p.partnershipId, p);
    return p;
  }

  /**
   * The offering fleet says whether this partner may pass its orders on to a fleet of its own. Its switch alone: the
   * partner cannot turn it on for itself.
   */
  setPassOn(fromFleetDid: string, partnershipId: string, allowed: boolean): FleetPartnership {
    const p = this.requireFrom(fromFleetDid, partnershipId);
    if (p.status === 'ended') throw new GlosError('INVALID_STATE', 'This arrangement has ended');
    p.mayPassOn = allowed === true;
    this.partnerships.set(p.partnershipId, p);
    return p;
  }

  /**
   * May `toFleetDid` pass on an order it took from `fromFleetDid`? Only under an arrangement between exactly those
   * two, standing now, on which the offering fleet said so. Asked when an order is offered on AND when it is taken.
   */
  mayPassOn(fromFleetDid: string, toFleetDid: string): boolean {
    return [...this.partnerships.values()].some((p) => p.fromFleetDid === fromFleetDid && p.toFleetDid === toFleetDid && p.status === 'active' && p.mayPassOn === true);
  }

  lists(fleetDid: string): FleetPartnerLists {
    return { offeringTo: this.offeringTo(fleetDid).map(viewOf), offeredBy: this.offeredBy(fleetDid).map(viewOf) };
  }

  /** The partners a fleet may offer to now: linked, and standing. */
  activePartners(fromFleetDid: string): HandOnFleet[] {
    return this.offeringTo(fromFleetDid)
      .filter((p) => p.status === 'active' && p.toFleetDid)
      .map((p) => ({ fleetDid: p.toFleetDid!, fleetName: p.partnerName }));
  }

  view(p: FleetPartnership): FleetPartnershipView {
    return viewOf(p);
  }

  private offeringTo(fleetDid: string): FleetPartnership[] {
    return [...this.partnerships.values()].filter((p) => p.fromFleetDid === fleetDid).sort(newestFirst);
  }

  private offeredBy(fleetDid: string): FleetPartnership[] {
    return [...this.partnerships.values()].filter((p) => p.toFleetDid === fleetDid).sort(newestFirst);
  }

  private requireFrom(fromFleetDid: string, partnershipId: string): FleetPartnership {
    const p = this.partnerships.get(partnershipId);
    if (!p || p.fromFleetDid !== fromFleetDid) throw new GlosError('NOT_FOUND', 'No such partner');
    return p;
  }
}

function viewOf(p: FleetPartnership): FleetPartnershipView {
  const { invite, ...rest } = p;
  return { ...rest, ...(invite ? { inviteExpiresAt: invite.expiresAt } : {}) };
}
const newestFirst = (a: FleetPartnership, b: FleetPartnership) => b.createdAt.localeCompare(a.createdAt);
const hashCode = (code: string) => createHash('sha256').update(`glos-partner:${code}`).digest('hex');
