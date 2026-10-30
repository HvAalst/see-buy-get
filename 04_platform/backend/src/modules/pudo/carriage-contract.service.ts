import { Injectable, Optional } from '@nestjs/common';
import { createHash, randomBytes, randomInt } from 'crypto';
import { GlosError } from '../../foundation/http/glos-error';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { CarriageContract, CarriageContractView, ContractInviteIssued, ContractRef } from './carriage-contract.types';
import { NotificationService } from './notification.service';

/** How long a link code stays good. Long enough for an email to be read on Monday; short enough not to linger. */
export const CONTRACT_INVITE_DAYS = 14;
/** Wrong codes a business may try in an hour before it is told to wait. */
export const CONTRACT_LINK_TRIES_PER_HOUR = 5;
/** No 0/O, 1/I/L: a code is read off a phone and typed into a laptop. 31^10 is far beyond guessing in 5 an hour. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 10;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * P1 — STANDING CONTRACTS OF CARRIAGE: a fleet's record of who it carries for under an agreement, and the link that
 * lets the shipper's business post orders straight into the fleet's queue.
 *
 * The link code is the lesson of the shared fleet code, applied before the fact: it is held by ONE business (issued
 * per contract, shown once), cannot be guessed (31^10, stored only as a hash), every wrong try is limited (five an
 * hour per business), and the fleet can undo it (end the contract). It ADDRESSES a contract; it is the fleet's act
 * of issuing it to that business that admits them.
 */
@Injectable()
export class CarriageContractService {
  private readonly contracts = new PersistentMap<string, CarriageContract>('carriage-contracts');
  /** Wrong link codes per business, per hour. In memory: a restart forgives, which costs an attacker nothing useful. */
  private readonly misses = new Map<string, { since: number; count: number }>();

  constructor(@Optional() private readonly notifications?: NotificationService) {}

  /* ------------------------------------------------------------- the fleet -- */

  create(fleet: { did: string; name: string }, input: { shipperName?: string; reference?: string; startsOn?: string; endsOn?: string; offeredTo?: string }, by: string, now = Date.now()): CarriageContract {
    const shipperName = input.shipperName?.trim();
    if (!shipperName) throw new GlosError('FIELD_REQUIRED', 'Name who you carry for — it goes on every order’s consignment note as the sender', { field: 'shipperName' });
    const { startsOn, endsOn } = this.period(input.startsOn, input.endsOn);
    const contract: CarriageContract = {
      contractId: `ctr_${randomBytes(8).toString('hex')}`,
      fleetDid: fleet.did,
      fleetName: fleet.name,
      shipper: { name: shipperName.slice(0, 120), ...(input.offeredTo ? { offeredTo: input.offeredTo } : {}) },
      ...(input.reference?.trim() ? { reference: input.reference.trim().slice(0, 60) } : {}),
      ...(startsOn ? { startsOn } : {}),
      ...(endsOn ? { endsOn } : {}),
      status: 'active',
      createdAt: new Date(now).toISOString(),
      createdBy: by,
    };
    this.contracts.set(contract.contractId, contract);
    return contract;
  }

  forFleet(fleetDid: string): CarriageContract[] {
    return [...this.contracts.values()].filter((c) => c.fleetDid === fleetDid).sort(newestFirst);
  }

  /** One of THIS fleet's contracts. Another fleet's id reads as no such contract — the same answer as none at all. */
  requireForFleet(fleetDid: string, contractId: string): CarriageContract {
    const c = this.contracts.get(contractId);
    if (!c || c.fleetDid !== fleetDid) throw new GlosError('NOT_FOUND', 'No such contract', { field: 'contractId' });
    return c;
  }

  /**
   * A code the shipper's business links the contract with. Issuing a new one cancels the last: there is only ever
   * one outstanding, and the fleet can always replace a code it sent to the wrong address.
   */
  issueInvite(fleetDid: string, contractId: string, now = Date.now()): ContractInviteIssued {
    const c = this.requireForFleet(fleetDid, contractId);
    if (c.status !== 'active') throw new GlosError('INVALID_STATE', 'This contract has ended — record a new one to carry for them again');
    if (c.shipper.entityId) throw new GlosError('INVALID_STATE', `${c.shipper.name} has already linked this contract`);
    const code = Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
    const expiresAt = new Date(now + CONTRACT_INVITE_DAYS * 86_400_000).toISOString();
    c.invite = { codeHash: hashCode(code), expiresAt, issuedAt: new Date(now).toISOString() };
    this.contracts.set(c.contractId, c);
    return { contract: viewOf(c), code: formatCode(code), expiresAt };
  }

  /* ----------------------------------------------------------- the shipper -- */

  /**
   * The shipper's business links a contract with the code its fleet sent. Single use; the business's registered
   * name becomes the sender's name from here on, because that is the name a consignment note must carry.
   */
  link(entity: { entityId: string; name: string }, rawCode: string, by: string, now = Date.now()): CarriageContract {
    const recent = this.misses.get(entity.entityId);
    if (recent && now - recent.since < 3_600_000 && recent.count >= CONTRACT_LINK_TRIES_PER_HOUR) {
      throw new GlosError('RATE_LIMITED', 'Too many codes that did not match — wait an hour, or ask the fleet to send a new one');
    }
    const hash = hashCode(normaliseCode(rawCode));
    const c = [...this.contracts.values()].find((x) => x.invite?.codeHash === hash);
    if (!c || c.status !== 'active' || new Date(c.invite!.expiresAt).getTime() <= now) {
      const fresh = !recent || now - recent.since >= 3_600_000;
      this.misses.set(entity.entityId, fresh ? { since: now, count: 1 } : { since: recent!.since, count: recent!.count + 1 });
      throw new GlosError('NOT_FOUND', 'That code does not match a contract — check it, or ask the fleet for a new one', { field: 'code' });
    }
    delete c.invite;
    c.shipper = { name: entity.name.slice(0, 120), entityId: entity.entityId, linkedAt: new Date(now).toISOString(), linkedBy: by };
    this.contracts.set(c.contractId, c);
    return c;
  }

  /** The contracts offered to a business that asked for them, standing and not yet linked. */
  offeredTo(entityId: string): CarriageContract[] {
    return [...this.contracts.values()].filter((c) => c.status === 'active' && c.shipper.offeredTo === entityId && !c.shipper.entityId).sort(newestFirst);
  }

  /** A contract offered to this business — the same answer for another business's as for none. */
  private requireOffered(entityId: string, contractId: string): CarriageContract {
    const c = this.contracts.get(contractId);
    if (!c || c.shipper.offeredTo !== entityId || c.shipper.entityId) throw new GlosError('NOT_FOUND', 'No such contract offered to you', { field: 'contractId' });
    if (c.status !== 'active') throw new GlosError('INVALID_STATE', `${c.fleetName} ended this contract before you answered`);
    return c;
  }

  /**
   * ACCEPTED in the business's app: linked as a code would link it, and the business's registered name becomes the sender
   * on its notes. The fleet is told in its bell.
   */
  async accept(entity: { entityId: string; name: string }, contractId: string, by: string, now = Date.now()): Promise<CarriageContract> {
    const c = this.requireOffered(entity.entityId, contractId);
    delete c.invite;
    c.shipper = { name: entity.name.slice(0, 120), entityId: entity.entityId, linkedAt: new Date(now).toISOString(), linkedBy: by };
    this.contracts.set(c.contractId, c);
    await this.notifications?.notify(c.fleetDid, {
      kind: 'contract_answered',
      title: `${entity.name} accepted your contract`,
      body: `${entity.name} accepted the carriage contract${c.reference ? ` ${c.reference}` : ''} you offered it. Its orders under it now come straight to you.`,
      link: '/',
      data: { contractId: c.contractId, entityId: entity.entityId },
    });
    return c;
  }

  /** DECLINED: the contract stays the fleet's, not linked — it may still send a code, or end it. The fleet is told. */
  async decline(entity: { entityId: string; name: string }, contractId: string, now = Date.now()): Promise<CarriageContract> {
    const c = this.requireOffered(entity.entityId, contractId);
    const { offeredTo: _offeredTo, ...shipper } = c.shipper;
    c.shipper = { ...shipper, declinedAt: new Date(now).toISOString() };
    this.contracts.set(c.contractId, c);
    await this.notifications?.notify(c.fleetDid, {
      kind: 'contract_answered',
      title: `${entity.name} declined your contract`,
      body: `${entity.name} declined the carriage contract${c.reference ? ` ${c.reference}` : ''} you offered it. It stays on your list, not linked: you can still send it a link code, or end it.`,
      link: '/',
      data: { contractId: c.contractId, entityId: entity.entityId },
    });
    return c;
  }

  /** The business that asked is told the contract is offered to it — in its bell, where it answers. */
  async tellOffered(business: { did: string; name: string }, c: CarriageContract): Promise<void> {
    const period = c.startsOn || c.endsOn ? `, ${c.startsOn ? `from ${c.startsOn}` : ''}${c.startsOn && c.endsOn ? ' ' : ''}${c.endsOn ? `until ${c.endsOn}` : ''}` : '';
    await this.notifications?.notify(business.did, {
      kind: 'contract_offered',
      title: `${c.fleetName} offers you a carriage contract`,
      body: `You asked ${c.fleetName} for a contract through the logistics directory, and it recorded one with you${c.reference ? `, reference ${c.reference}` : ''}${period}. Accept it under Carriers to send it loads straight away, or decline it. Nothing is linked until an owner accepts.`,
      link: '/',
      data: { contractId: c.contractId, fleetDid: c.fleetDid },
    });
  }

  forShipper(entityId: string): CarriageContract[] {
    return [...this.contracts.values()].filter((c) => c.shipper.entityId === entityId).sort(newestFirst);
  }

  requireForShipper(entityId: string, contractId: string): CarriageContract {
    const c = this.contracts.get(contractId);
    if (!c || c.shipper.entityId !== entityId) throw new GlosError('NOT_FOUND', 'No such contract', { field: 'contractId' });
    return c;
  }

  /* --------------------------------------------------------------- either -- */

  /**
   * Ended by either side. It stops NEW orders and nothing else: what was already ordered stays with the fleet to be
   * delivered — the commitment was made while the contract stood.
   */
  end(c: CarriageContract, side: 'fleet' | 'shipper', by: string, reason: string | undefined, now = Date.now()): CarriageContract {
    if (c.status === 'ended') throw new GlosError('INVALID_STATE', 'This contract has already ended');
    c.status = 'ended';
    delete c.invite;
    c.ended = { at: new Date(now).toISOString(), side, by, ...(reason?.trim() ? { reason: reason.trim().slice(0, 280) } : {}) };
    this.contracts.set(c.contractId, c);
    return c;
  }

  /**
   * May an order for this day be placed under it? Standing, and the day inside its period. The answer is the COPY an
   * order carries.
   */
  orderable(c: CarriageContract, deliverOn: string): ContractRef {
    if (c.status !== 'active') throw new GlosError('INVALID_STATE', `The contract with ${c.fleetName} has ended — orders under it cannot be placed`, { field: 'contractId' });
    if (c.startsOn && deliverOn < c.startsOn) throw new GlosError('INVALID_INPUT', `The contract starts on ${c.startsOn}`, { field: 'deliverOn' });
    if (c.endsOn && deliverOn > c.endsOn) throw new GlosError('INVALID_INPUT', `The contract ran until ${c.endsOn}`, { field: 'deliverOn' });
    return { contractId: c.contractId, fleetDid: c.fleetDid, fleetName: c.fleetName, shipperName: c.shipper.name, ...(c.reference ? { reference: c.reference } : {}) };
  }

  /** P1b — the collection point named for an upload, kept for the next one. */
  rememberPickup(c: CarriageContract, pickup: { label: string; location: { lat: number; lng: number } }): void {
    c.pickup = { label: pickup.label, location: { lat: pickup.location.lat, lng: pickup.location.lng } };
    this.contracts.set(c.contractId, c);
  }

  view(c: CarriageContract): CarriageContractView {
    return viewOf(c);
  }

  private period(startsOn?: string, endsOn?: string): { startsOn?: string; endsOn?: string } {
    const s = startsOn?.trim() || undefined;
    const e = endsOn?.trim() || undefined;
    if (s && !isDay(s)) throw new GlosError('INVALID_INPUT', 'A start date is a calendar day (YYYY-MM-DD)', { field: 'startsOn' });
    if (e && !isDay(e)) throw new GlosError('INVALID_INPUT', 'An end date is a calendar day (YYYY-MM-DD)', { field: 'endsOn' });
    if (s && e && e < s) throw new GlosError('INVALID_INPUT', 'The contract cannot end before it starts', { field: 'endsOn' });
    return { startsOn: s, endsOn: e };
  }
}

/** A calendar day that exists — 2026-02-30 is refused, not rolled into March. */
export function isDay(s: string): boolean {
  if (!DAY_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function viewOf(c: CarriageContract): CarriageContractView {
  const { invite, ...rest } = c;
  return { ...rest, ...(invite ? { inviteExpiresAt: invite.expiresAt } : {}) };
}

function newestFirst(a: CarriageContract, b: CarriageContract): number {
  return b.createdAt.localeCompare(a.createdAt);
}

function hashCode(code: string): string {
  return createHash('sha256').update(`glos-contract:${code}`).digest('hex');
}

/** Typed by a person: spaces, dashes and lower case are forgiven. */
function normaliseCode(raw: string): string {
  return (raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Shown in two halves so it can be read aloud: ABCDE-FGHJK. */
function formatCode(code: string): string {
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}
