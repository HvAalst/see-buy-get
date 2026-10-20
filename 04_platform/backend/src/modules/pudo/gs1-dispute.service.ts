import { Injectable, Optional } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { EntityService } from '../../foundation/entity/entity.service';
import { cleanPrefix } from '../../foundation/gs1/gs1';
import { GlosError } from '../../foundation/http/glos-error';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { BusinessClientService } from './business-client.service';
import { MediaService } from './media.service';
import { NotificationService } from './notification.service';
import { ShipperCodesService, clientCoder, clientOfCoder } from './shipper-codes.service';
import { GS1_ANSWER_DAYS, type Gs1Dispute, type Gs1DisputeRow, type Gs1DisputeSide, type Gs1DisputeView, type Gs1Party, type Gs1PartyRow } from './gs1-dispute.types';

const DAY_MS = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();
const dayOf = (at: string) => new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/** The business acting, as the routes hand it over: which business, and the person by name. */
export interface Gs1Business {
  entityId: string;
  did: string;
  name: string;
  by: string;
}

/** A member of staff: by name for the record, by key to tell two apart (staff-of.ts). */
export interface Gs1Staff {
  name: string;
  key: string;
}

/**
 * TWO BUSINESSES SAY ONE GS1 COMPANY PREFIX IS THEIRS (gs1-dispute.types.ts says what the user decided).
 *
 *  - A business refused a prefix another uses opens a dispute with its GS1 licence. The businesses using it are told at
 *    once and send theirs; nothing changes for them meanwhile.
 *  - Staff decide once every business using it has sent its licence, or a week after it opened: one says whose it is,
 *    what was checked and why; a different one approves. Then it is done, and both sides read the reason.
 *  - Decided for the claimant, the others stop printing under the prefix (their loads keep the codes they were given)
 *    and the claimant prints under the digit it asked for, past every number already printed there. Decided for those
 *    using it, nothing they print changes. Either way, nobody else may take the prefix up after (shipper-codes.service).
 */
@Injectable()
export class Gs1DisputeService {
  private readonly disputes = new PersistentMap<string, Gs1Dispute>('gs1-prefix-disputes');

  constructor(
    private readonly codes: ShipperCodesService,
    private readonly entities: EntityService,
    @Optional() private readonly media?: MediaService,
    @Optional() private readonly notifications?: NotificationService,
    @Optional() private readonly clients?: BusinessClientService,
  ) {}

  /* ------------------------------------------------------------------------- the businesses -- */

  /** A business says a prefix another uses is its own — or, round 20, its client's — with its GS1 licence. */
  open(business: Gs1Business, input: { companyPrefix: string; extensionDigit: number; licenceRef: string; note?: string; forClientId?: string }, now: number = Date.now()): Gs1DisputeView {
    const companyPrefix = cleanPrefix(input.companyPrefix);
    if (!companyPrefix) throw new GlosError('VALIDATION_FAILED', 'A GS1 company prefix is 6 to 12 digits, as GS1 gave it to you', { field: 'companyPrefix' });
    if (!Number.isInteger(input.extensionDigit) || input.extensionDigit < 0 || input.extensionDigit > 9) throw new GlosError('VALIDATION_FAILED', 'An extension digit is one digit, 0 to 9', { field: 'extensionDigit' });
    // For a client: the client's own record, which this forwarder keeps (404 for another's).
    const claimantKey = input.forClientId ? clientCoder(business.entityId, this.requireClient(business.entityId, input.forClientId).clientId) : business.entityId;
    const holderIds = this.codes.holdersOf(companyPrefix, claimantKey);
    if (!holderIds.length) throw new GlosError('INVALID_STATE', 'No other business uses this prefix: set it in Business details.', { field: 'companyPrefix' });
    if ([...this.disputes.values()].some((d) => d.companyPrefix === companyPrefix && alive(d))) {
      throw new GlosError('CONFLICT', 'A dispute about this prefix is already open: SeeBuyGet staff decide it first.', { field: 'companyPrefix' });
    }
    const disputeId = `gs1d_${randomBytes(6).toString('hex')}`;
    // The licence is adopted before anything is written: an image that is not the business's own is refused, not kept.
    if (!this.media?.adopt(input.licenceRef, business.did, { type: 'gs1-dispute', id: disputeId }, 'gs1_licence')) {
      throw new GlosError('VALIDATION_FAILED', 'Add a photograph or a screenshot of your GS1 licence: the certificate GS1 gave you for this prefix', { field: 'licenceRef' });
    }
    const at = iso(now);
    const note = input.note?.trim().slice(0, 500);
    const holders = holderIds.map((id) => this.partyOf(id));
    const dispute: Gs1Dispute = {
      disputeId,
      companyPrefix,
      extensionDigit: input.extensionDigit,
      claimant: { ...this.partyOf(claimantKey), did: business.did, licenceRef: input.licenceRef, ...(note ? { note } : {}), sentAt: at },
      holders,
      openedAt: at,
      openedBy: business.by,
      state: 'open',
    };
    this.disputes.set(disputeId, dispute);
    const by = dayOf(iso(now + GS1_ANSWER_DAYS * DAY_MS));
    for (const h of holders) {
      const whose = h.actsFor ? ` — the one you entered for your client ${h.name}` : '';
      this.tell(h.did, disputeId, `Another business says the GS1 prefix ${companyPrefix} is its own`, `${dispute.claimant.name} has sent SeeBuyGet staff a GS1 licence for prefix ${companyPrefix}${whose}. Send yours in Business details by ${by}: two members of staff decide whose it is. Until then nothing changes, and your labels carry on.`);
    }
    return this.viewFor(dispute, business.entityId);
  }

  /** A business using the prefix sends its own licence — or a better one — while nothing is decided. */
  sendLicence(business: Gs1Business, disputeId: string, input: { licenceRef: string; note?: string }, now: number = Date.now()): Gs1DisputeView {
    const dispute = this.disputes.get(disputeId);
    // Its own party, and every client's it answers for: the same prefix is the same licence.
    const parties = dispute?.holders.filter((h) => answeredBy(h) === business.entityId) ?? [];
    if (!dispute || !parties.length) throw new GlosError('NOT_FOUND', 'No such dispute for this business');
    if (!alive(dispute)) throw new GlosError('INVALID_STATE', 'This dispute is over: there is nothing more to send.');
    if (!this.media?.adopt(input.licenceRef, business.did, { type: 'gs1-dispute', id: disputeId }, 'gs1_licence')) {
      throw new GlosError('VALIDATION_FAILED', 'Add a photograph or a screenshot of your GS1 licence: the certificate GS1 gave you for this prefix', { field: 'licenceRef' });
    }
    const note = input.note?.trim().slice(0, 500);
    for (const party of parties) {
      // A better one replaces it as the one to read — and the one it replaces stays: evidence is never deleted mid-case.
      if (party.licenceRef && party.licenceRef !== input.licenceRef) party.earlier = [...(party.earlier ?? []), party.licenceRef];
      Object.assign(party, { licenceRef: input.licenceRef, sentAt: iso(now), ...(note ? { note } : {}) });
    }
    this.disputes.set(disputeId, dispute);
    return this.viewFor(dispute, business.entityId);
  }

  /** The claimant takes it back while nothing is decided. Nothing changes for anybody. */
  withdraw(business: Gs1Business, disputeId: string, now: number = Date.now()): Gs1DisputeView {
    const dispute = this.disputes.get(disputeId);
    if (!dispute || answeredBy(dispute.claimant) !== business.entityId) throw new GlosError('NOT_FOUND', 'No such dispute for this business');
    if (!alive(dispute)) throw new GlosError('INVALID_STATE', 'This dispute is over already.');
    dispute.state = 'withdrawn';
    dispute.withdrawnAt = iso(now);
    delete dispute.proposal;
    this.disputes.set(disputeId, dispute);
    this.media?.anchorGs1Dispute(disputeId, new Date(now));
    for (const h of dispute.holders) this.tell(h.did, disputeId, `The dispute about GS1 prefix ${dispute.companyPrefix} was withdrawn`, `${dispute.claimant.name} took it back. Nothing has changed.`);
    return this.viewFor(dispute, business.entityId);
  }

  /** The disputes a business is in, as it reads them: newest first. */
  forBusiness(entityId: string): Gs1DisputeView[] {
    return [...this.disputes.values()]
      .filter((d) => answeredBy(d.claimant) === entityId || d.holders.some((h) => answeredBy(h) === entityId))
      .sort((a, b) => b.openedAt.localeCompare(a.openedAt))
      .map((d) => this.viewFor(d, entityId));
  }

  /* ------------------------------------------------------------------------------- staff -- */

  /** Every dispute: those waiting first. */
  list(now: number = Date.now()): Gs1DisputeRow[] {
    return [...this.disputes.values()].sort((a, b) => Number(!alive(a)) - Number(!alive(b)) || b.openedAt.localeCompare(a.openedAt)).map((d) => this.row(d, now));
  }

  /** The first member of staff says whose it is, what was checked and why. Changes nothing yet. */
  propose(disputeId: string, staff: Gs1Staff, input: { to: Gs1DisputeSide; what: string; reason: string }, now: number = Date.now()): Gs1DisputeRow {
    const dispute = this.require(disputeId);
    if (dispute.state !== 'open') throw new GlosError('INVALID_STATE', dispute.state === 'proposed' ? 'A proposal is already waiting for a second member of staff.' : 'This dispute is not waiting to be decided.');
    if (!mayDecide(dispute, now)) throw new GlosError('INVALID_STATE', `The businesses using the prefix have until ${dayOf(answerBy(dispute))} to send their licence. Decide when every one has, or from then.`);
    const what = input.what?.trim();
    const reason = input.reason?.trim();
    if (!what) throw new GlosError('FIELD_REQUIRED', 'Say what you checked and how — the second member of staff approves on the strength of it', { field: 'what' });
    if (!reason) throw new GlosError('FIELD_REQUIRED', 'Say why — both businesses read it', { field: 'reason' });
    dispute.proposal = { to: input.to, what: what.slice(0, 500), reason: reason.slice(0, 500), by: staff.name, byKey: staff.key, at: iso(now) };
    dispute.state = 'proposed';
    delete dispute.sentBack;
    this.disputes.set(disputeId, dispute);
    return this.row(dispute, now);
  }

  /** The second member of staff does not approve it as it stands: it goes back to be looked at again. */
  sendBack(disputeId: string, staff: Gs1Staff, why: string, now: number = Date.now()): Gs1DisputeRow {
    const dispute = this.require(disputeId);
    if (dispute.state !== 'proposed') throw new GlosError('INVALID_STATE', 'There is no proposal here to send back.');
    const said = why?.trim();
    if (!said) throw new GlosError('FIELD_REQUIRED', 'Say why — the next member of staff to look at it reads this', { field: 'why' });
    dispute.sentBack = { by: staff.name, at: iso(now), why: said.slice(0, 300) };
    delete dispute.proposal;
    dispute.state = 'open';
    this.disputes.set(disputeId, dispute);
    return this.row(dispute, now);
  }

  /** THE SECOND MEMBER OF STAFF APPROVES, AND IT IS DONE. Never the one who proposed it. */
  approve(disputeId: string, staff: Gs1Staff, now: number = Date.now()): Gs1DisputeRow {
    const dispute = this.require(disputeId);
    const proposal = dispute.proposal;
    if (dispute.state !== 'proposed' || !proposal) throw new GlosError('INVALID_STATE', dispute.state === 'open' ? 'Nobody has said whose it is yet. One member of staff does; a second approves.' : 'This dispute is not waiting for an approval.');
    if (proposal.byKey === staff.key) throw new GlosError('CONFLICT', 'A second member of staff has to approve — not the one who proposed it');
    const holderIds = dispute.holders.map((h) => h.entityId);
    if (proposal.to === 'claimant') this.codes.award(dispute.companyPrefix, dispute.extensionDigit, dispute.claimant.entityId, holderIds, disputeId, `SeeBuyGet staff (${proposal.by}, ${staff.name})`, now);
    else this.codes.keepWith(dispute.companyPrefix, holderIds, disputeId, now);
    dispute.decided = { to: proposal.to, reason: proposal.reason, proposedBy: proposal.by, by: staff.name, at: iso(now) };
    dispute.state = 'decided';
    delete dispute.proposal;
    this.disputes.set(disputeId, dispute);
    this.media?.anchorGs1Dispute(disputeId, new Date(now));
    const p = dispute.companyPrefix;
    if (proposal.to === 'claimant') {
      const c = dispute.claimant;
      this.tell(c.did, disputeId, `The GS1 prefix ${p} is ${yours(c)}`, `Two members of SeeBuyGet staff looked at the licences and decided prefix ${p} is ${yours(c)}. ${labelsOf(c)} carry it from now on, under extension digit ${dispute.extensionDigit}. Their reason: ${proposal.reason}`);
      for (const h of dispute.holders) this.tell(h.did, disputeId, `The GS1 prefix ${p} is another business's`, `Two members of SeeBuyGet staff looked at the licences and decided prefix ${p} is ${c.name}'s. ${labelsOf(h)} no longer carry it; the loads you posted keep the codes they were given. Their reason: ${proposal.reason}`);
    } else {
      this.tell(dispute.claimant.did, disputeId, `The GS1 prefix ${p} stays with the business using it`, `Two members of SeeBuyGet staff looked at the licences and decided prefix ${p} is not ${yours(dispute.claimant)} to print under. Their reason: ${proposal.reason}`);
      for (const h of dispute.holders) this.tell(h.did, disputeId, `The GS1 prefix ${p} stays ${yours(h)}`, `Two members of SeeBuyGet staff looked at the licences and decided prefix ${p} stays ${yours(h)}. Nothing changes. Their reason: ${proposal.reason}`);
    }
    return this.row(dispute, now);
  }

  /* ------------------------------------------------------------------------------ inside -- */

  private require(disputeId: string): Gs1Dispute {
    const d = this.disputes.get(disputeId);
    if (!d) throw new GlosError('NOT_FOUND', 'No such dispute');
    return d;
  }

  /** A business — or a forwarder's client, told and answered through its forwarder (round 20). */
  private partyOf(key: string): Gs1Party {
    const forClient = clientOfCoder(key);
    if (forClient) {
      const e = this.entities.find(forClient.entityId);
      // Archived clients too: a dispute outlives a client the forwarder no longer sends for.
      const c = this.clients?.list(forClient.entityId, { archived: true }).find((x) => x.clientId === forClient.clientId);
      return { entityId: key, did: e?.did ?? '', name: c?.name ?? forClient.clientId, actsFor: forClient.entityId };
    }
    const e = this.entities.find(key);
    return { entityId: key, did: e?.did ?? '', name: e?.name ?? key };
  }

  private requireClient(entityId: string, clientId: string) {
    if (!this.clients) throw new GlosError('INVALID_STATE', 'Clients are not available here');
    return this.clients.require(entityId, clientId);
  }

  private viewFor(d: Gs1Dispute, entityId: string): Gs1DisputeView {
    const claimant = answeredBy(d.claimant) === entityId;
    const mine = claimant ? d.claimant : d.holders.find((h) => answeredBy(h) === entityId);
    return {
      disputeId: d.disputeId,
      companyPrefix: d.companyPrefix,
      extensionDigit: d.extensionDigit,
      side: claimant ? 'claimant' : 'holder',
      // A proposal waiting is staff's business: to the businesses it is still open.
      state: d.state === 'proposed' ? 'open' : d.state,
      openedAt: d.openedAt,
      answerBy: answerBy(d),
      claimantName: d.claimant.name,
      holderNames: d.holders.map((h) => h.name),
      licenceSent: Boolean(mine?.licenceRef),
      ...(mine?.actsFor ? { forClient: mine.name } : {}),
      ...(d.decided ? { decided: { mine: (d.decided.to === 'claimant') === claimant, reason: d.decided.reason, at: d.decided.at } } : {}),
      ...(d.withdrawnAt ? { withdrawnAt: d.withdrawnAt } : {}),
    };
  }

  private row(d: Gs1Dispute, now: number): Gs1DisputeRow {
    const party = (p: Gs1Party): Gs1PartyRow => {
      const using = this.codes.of(p.entityId);
      return {
        entityId: p.entityId,
        name: p.name,
        ...(p.licenceRef ? { licenceRef: p.licenceRef } : {}),
        ...(p.earlier?.length ? { earlier: p.earlier } : {}),
        ...(p.note ? { note: p.note } : {}),
        ...(p.sentAt ? { sentAt: p.sentAt } : {}),
        ...(using?.companyPrefix === d.companyPrefix ? { digitNow: using.extensionDigit } : {}),
        ...(p.actsFor ? { forwarder: this.entities.find(p.actsFor)?.name ?? p.actsFor } : {}),
      };
    };
    const { byKey: _key, ...proposal } = d.proposal ?? ({} as NonNullable<Gs1Dispute['proposal']>);
    void _key;
    return {
      disputeId: d.disputeId,
      companyPrefix: d.companyPrefix,
      extensionDigit: d.extensionDigit,
      state: d.state,
      openedAt: d.openedAt,
      answerBy: answerBy(d),
      mayDecide: d.state === 'open' && mayDecide(d, now),
      claimant: party(d.claimant),
      holders: d.holders.map(party),
      ...(d.proposal ? { proposal } : {}),
      ...(d.sentBack ? { sentBack: d.sentBack } : {}),
      ...(d.decided ? { decided: d.decided } : {}),
      ...(d.withdrawnAt ? { withdrawnAt: d.withdrawnAt } : {}),
    };
  }

  private tell(did: string, disputeId: string, title: string, body: string): void {
    if (!did || !this.notifications) return;
    void this.notifications.notify(did, { kind: 'gs1_dispute', title, body, tag: `gs1:${disputeId}`, data: { disputeId } }).catch(() => undefined);
  }
}

/** Round 20 — said to a forwarder about its client: the client's, never the forwarder's. */
function yours(p: Gs1Party): string {
  return p.actsFor ? `your client ${p.name}'s` : 'yours';
}

function labelsOf(p: Gs1Party): string {
  return p.actsFor ? `${p.name}'s labels` : 'Your labels';
}

/** The business that answers for a party: itself, or the forwarder that keeps a client's record. */
function answeredBy(p: Gs1Party): string {
  return p.actsFor ?? p.entityId;
}

function alive(d: Gs1Dispute): boolean {
  return d.state === 'open' || d.state === 'proposed';
}

function answerBy(d: Gs1Dispute): string {
  return iso(Date.parse(d.openedAt) + GS1_ANSWER_DAYS * DAY_MS);
}

/** Every business using the prefix has sent its licence, or the week it had is over. */
function mayDecide(d: Gs1Dispute, now: number): boolean {
  return d.holders.every((h) => h.licenceRef) || now >= Date.parse(answerBy(d));
}
