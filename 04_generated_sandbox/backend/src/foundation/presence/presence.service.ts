import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { catalogueEntry } from '../countries/catalogue';
import { GlosError } from '../http/glos-error';
import { incotermEntry, putsDutyOnSeller } from '../incoterms/catalogue';
import { PersistentMap } from '../store/persistent-map';
import { EntityService } from '../entity/entity.service';
import { canTransact } from '../entity/entity.types';
import { sameSigner, type Signer } from '../entity/same-person';
import {
  LEVEL_DEFAULTS,
  PRESENCE_CAPABILITIES,
  type Presence,
  type PresenceProposal,
  type CapabilityLapse,
  type PresenceCapabilities,
  type PresenceCapability,
  type PresenceLevel,
  type ResolvedPresence,
  type TakeInPromise,
} from './presence.types';

/**
 * HOW ESTABLISHED WE ARE, COUNTRY BY COUNTRY.
 *
 * It lives outside `foundation/entity` on purpose: a presence must be able to exist for a jurisdiction
 * with NO entity at all, and putting it beside the sisters would make the interesting case — a country
 * we work in and cannot bill in — unrepresentable.
 *
 * `EntityService.requireForJurisdiction()` keeps its job unchanged and becomes the LAST line of defence
 * rather than the first question. It already refuses honestly ("No daughter company operates in X
 * yet") — the problem was never the answer, it was that the answer arrived when money moved, to a
 * shopkeeper holding a box, in words about daughter companies.
 */
@Injectable()
export class PresenceService implements OnApplicationBootstrap {
  private readonly presences = new PersistentMap<string, Presence>('presence');
  /** CA2 — changes that raise a country, waiting for a second person. Kept after they are decided. */
  private readonly proposals = new PersistentMap<string, PresenceProposal>('presence-proposals');
  /** Which ACCOUNT proposed each. Beside the proposal, not on it: a proposal is read whole by every member of staff. */
  private readonly proposerKeys = new PersistentMap<string, string>('presence-proposal-keys');

  constructor(private readonly entities: EntityService) {}

  /**
   * DEVELOPMENT ONLY: several countries, so trade across borders by truck can be tried end to end (user,
   * 2026-09-13). Production switches countries on from the catalogue, two people at a time — never from a seed.
   * Idempotent and never overwriting: a country somebody decided about keeps that decision.
   */
  onApplicationBootstrap(): void {
    if ((process.env.GLOS_ENV ?? '').toLowerCase() === 'production') return;
    for (const jurisdiction of DEVELOPMENT_COUNTRIES) {
      if (this.presences.has(jurisdiction) || this.hasTransactingEntity(jurisdiction)) continue;
      this.set({ jurisdiction, level: 'matched', note: 'Development: trade across borders', by: 'development seed' });
    }
  }

  /**
   * What this country permits right now.
   *
   * AN UNKNOWN JURISDICTION IS `observed`, never the home sister's capabilities and never a default
   * that happens to be generous. A country nobody recorded is a country we are not in — and inheriting
   * a neighbour's permissions is the precise failure this whole design exists to prevent.
   */
  resolve(jurisdiction?: string, now = Date.now()): ResolvedPresence {
    const key = normalise(jurisdiction);
    const record = key ? this.presences.get(key) : undefined;
    const hasEntity = key ? this.hasTransactingEntity(key) : false;
    const level = record?.level ?? (hasEntity ? 'established' : 'observed');
    // CA5 — a lapsed licence or policy switches off what it supported, whatever the level says.
    const lapses = key ? this.entities.lapsesFor(key, now) : [];
    return {
      jurisdiction: key || '',
      level,
      capabilities: withoutLapses(capabilitiesOf(level, record?.overrides), lapses),
      // CL1 — always an answer, never undefined: "no terms are switched on here" is a fact, not a missing field.
      incoterms: { origin: record?.incoterms?.origin ?? [], destination: record?.incoterms?.destination ?? [] },
      lapses,
      hasEntity,
      recorded: Boolean(record),
      note: record?.note,
      setBy: record?.setBy,
      approvedBy: record?.approvedBy,
      setAt: record?.setAt,
    };
  }

  /** One capability, for the paths that only care about one. */
  can(jurisdiction: string | undefined, capability: PresenceCapability): boolean {
    return this.resolve(jurisdiction).capabilities[capability];
  }

  /**
   * WHO ANSWERS FOR GOODS TAKEN IN HERE, given where the payer is.
   *
   * This is the rule the counter reads out loud, and it is deliberately answered from the JOURNEY
   * rather than from the shop: a shop in a country we cannot bill in may still hold our parcel, when
   * the person who paid sits in a country where a sister is already on the hook for it.
   *
   *   ours    a sister carries it — either this country's, or the payer's, the foreign leg then being
   *           a service we purchased (which is how a fleet is already paid: one invoice, one currency).
   *   theirs  no sister can, but goods may still move: a carrier prices it, is paid for it, and answers
   *           for it, with the shop acting as THAT CARRIER's agent. We record custody and prove it.
   *   none    this country may not take goods into custody at all.
   */
  takeInPromise(shopJurisdiction: string | undefined, payerJurisdiction?: string): TakeInPromise {
    const shop = this.resolve(shopJurisdiction);
    if (!shop.capabilities.takeIn) return 'none';
    if (shop.capabilities.merchantOfRecord) return 'ours';
    // The payer's sister can answer for goods abroad; it cannot conjure a take-in where take-in is
    // refused, which is why this is asked second and not first.
    if (payerJurisdiction && this.resolve(payerJurisdiction).capabilities.merchantOfRecord) return 'ours';
    return 'theirs';
  }

  /**
   * What may actually be covered here.
   *
   * ZERO BY CONSTRUCTION where no provision can pay an award — not "unset", not "to be decided". A
   * limit nobody can honour is worse than no limit, because somebody reads it and hands over goods.
   */
  coverCeiling(jurisdiction: string | undefined, limit: number): number {
    return this.can(jurisdiction, 'claims') ? limit : 0;
  }

  /**
   * THE DOOR. Refuse here, in the words of whoever is standing at the screen.
   *
   * The refusal already existed — requireForJurisdiction throws "No daughter company operates in X
   * yet" — but it arrived wherever the money path first touched it, which is to say at a shopkeeper
   * holding a box, about a subject they cannot act on. This one is asked FIRST and says what is true of
   * this country and this capability.
   */
  require(jurisdiction: string | undefined, capability: PresenceCapability): void {
    const resolved = this.resolve(jurisdiction);
    if (resolved.capabilities[capability]) return;
    const where = resolved.jurisdiction || 'that country';
    throw new GlosError('FORBIDDEN', REFUSAL[capability] + ` (${where}: ${LEVEL_WORD[resolved.level]})`);
  }

  /** Every country on record, plus every one that has a sister — the operator's whole map. */
  list(): ResolvedPresence[] {
    const keys = new Set<string>([...this.presences.keys()]);
    for (const entity of this.entities.list()) {
      const key = normalise(entity.jurisdiction);
      // Drafts and partners too: a country where a company is being prepared belongs on the map. A customer's
      // business does not: a shipper signing up from Germany is not us preparing Germany.
      if (key && entity.kind !== 'group' && entity.kind !== 'business') keys.add(key);
    }
    return [...keys].sort((a, b) => a.localeCompare(b)).map((k) => this.resolve(k));
  }

  /**
   * Set a country's standing. Operator-only at the route, and the change is NAMED.
   *
   * ESTABLISHED IS DERIVED, NEVER DECLARED: claiming it without a transacting sister is refused here
   * rather than reviewed later, because that claim is exactly the lie the ladder exists to prevent —
   * it would unlock a Merchant of Record, a float and a claims provision that do not exist.
   */
  set(input: {
    jurisdiction: string;
    level: PresenceLevel;
    overrides?: Partial<Record<PresenceCapability, boolean>>;
    note?: string;
    by?: string;
    /** CA2 — the second person, when this change raised the country. */
    approvedBy?: string;
    /** CL1 — the trade terms allowed here, per direction. Replaces the stored sets outright when given. */
    incoterms?: { origin?: string[]; destination?: string[] };
  }): ResolvedPresence {
    const key = this.check(input.jurisdiction, input.level, input.overrides, false, input.incoterms);
    this.presences.set(key, {
      jurisdiction: key,
      level: input.level,
      ...(input.overrides && Object.keys(input.overrides).length ? { overrides: input.overrides } : {}),
      ...(input.note?.trim() ? { note: input.note.trim() } : {}),
      ...(input.by?.trim() ? { setBy: input.by.trim() } : {}),
      ...(input.approvedBy?.trim() ? { approvedBy: input.approvedBy.trim() } : {}),
      ...(input.incoterms ? { incoterms: normaliseTerms(input.incoterms) } : {}),
      setAt: new Date().toISOString(),
    });
    return this.resolve(key);
  }

  /* ------------------------------------------------ CA2: two people switch a country on -- */

  /**
   * ASK for a change to a country's standing.
   *
   * A change that gives the country anything it cannot do now waits for a second, different, named person. A change
   * that gives it nothing — a lowering, a note — is applied at once and recorded, because refusing is the safe
   * direction and an emergency must not wait for a second signature.
   */
  propose(
    input: { jurisdiction: string; level: PresenceLevel; overrides?: Partial<Record<PresenceCapability, boolean>>; note?: string; by?: string; /** The proposer's account, where they have one. */ byKey?: string; incoterms?: { origin?: string[]; destination?: string[] } },
    now = Date.now(),
  ): { applied?: ResolvedPresence; proposal?: PresenceProposal } {
    const by = input.by?.trim();
    if (!by) throw new GlosError('FIELD_REQUIRED', 'Say who you are — every change to a country names the person who made it');
    const key = this.check(input.jurisdiction, input.level, input.overrides, true, input.incoterms);
    const gains = this.gainsOf(key, input.level, input.overrides);
    // CL1 — a term switched on is a gain like any other, and needs the second person.
    const termGains = this.termGainsOf(key, input.incoterms);
    if (!gains.length && !termGains.length) return { applied: this.set({ ...input, jurisdiction: key, by }) };
    const waiting = this.pendingFor(key, now);
    if (waiting) {
      throw new GlosError('CONFLICT', `A change to ${key} proposed by ${waiting.proposedBy} is already waiting for a second person — approve or decline it first`);
    }
    const overrides = input.overrides && Object.keys(input.overrides).length ? input.overrides : undefined;
    const proposal: PresenceProposal = {
      proposalId: `pp_${randomBytes(6).toString('hex')}`,
      jurisdiction: key,
      level: input.level,
      ...(overrides ? { overrides } : {}),
      ...(input.note?.trim() ? { note: input.note.trim() } : {}),
      gains,
      ...(termGains.length ? { termGains } : {}),
      ...(input.incoterms ? { incoterms: input.incoterms } : {}),
      proposedBy: by,
      proposedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + PROPOSAL_TTL_DAYS * 86_400_000).toISOString(),
      status: 'pending',
    };
    this.proposals.set(proposal.proposalId, proposal);
    if (input.byKey) this.proposerKeys.set(proposal.proposalId, input.byKey);
    return { proposal };
  }

  /** The second person says yes. Never the first: a person who proposed a change cannot approve it. */
  approve(proposalId: string, by?: string, now = Date.now(), byKey?: string): { proposal: PresenceProposal; presence: ResolvedPresence } {
    const proposal = this.assertApprovable(proposalId, by, now, byKey);
    const who = by!.trim();
    // Asked again: the world may have moved since it was proposed (a company closed, a record lapsed).
    const presence = this.set({
      jurisdiction: proposal.jurisdiction,
      level: proposal.level,
      overrides: proposal.overrides,
      incoterms: proposal.incoterms,
      note: proposal.note,
      by: proposal.proposedBy,
      approvedBy: who,
    });
    Object.assign(proposal, { status: 'approved', decidedBy: who, decidedAt: new Date(now).toISOString() });
    this.proposals.set(proposal.proposalId, proposal);
    return { proposal, presence };
  }

  /**
   * May this person approve this proposal right now? Throws the reason they may not. Asked on its own by the
   * caller that has to prepare something first (activating a company) before the approval is applied.
   */
  assertApprovable(proposalId: string, by?: string, now = Date.now(), byKey?: string): PresenceProposal {
    const proposal = this.requirePending(proposalId, now);
    const who = by?.trim();
    if (!who) throw new GlosError('FIELD_REQUIRED', 'Say who you are — the second person is named just like the first');
    if (sameSigner({ name: who, key: byKey }, this.proposerOf(proposal))) {
      throw new GlosError('FORBIDDEN', 'You proposed this change — a different person must approve it');
    }
    return proposal;
  }

  /** Did this reader propose it? What a screen asks before it offers them "Approve". */
  proposedByReader(proposalId: string, reader: Signer): boolean {
    const proposal = this.proposals.get(proposalId);
    return Boolean(proposal) && sameSigner(reader, this.proposerOf(proposal as PresenceProposal));
  }

  private proposerOf(proposal: PresenceProposal): Signer {
    return { name: proposal.proposedBy, key: this.proposerKeys.get(proposal.proposalId) };
  }

  /** Say no — anyone, including the proposer withdrawing it — and always with a reason that is kept. */
  decline(proposalId: string, by?: string, reason?: string, now = Date.now()): PresenceProposal {
    const proposal = this.requirePending(proposalId, now);
    const who = by?.trim();
    if (!who) throw new GlosError('FIELD_REQUIRED', 'Say who you are');
    if (!reason?.trim()) throw new GlosError('FIELD_REQUIRED', 'Say why — a declined change is kept with its reason');
    Object.assign(proposal, { status: 'declined', decidedBy: who, decidedAt: new Date(now).toISOString(), reason: reason.trim() });
    this.proposals.set(proposal.proposalId, proposal);
    return proposal;
  }

  /** Every proposal, waiting ones first, then the most recent. Expiry is applied as they are read. */
  listProposals(now = Date.now()): PresenceProposal[] {
    const all = [...this.proposals.values()];
    for (const proposal of all) this.expireIfDue(proposal, now);
    return all.sort((a, b) => Number(b.status === 'pending') - Number(a.status === 'pending') || b.proposedAt.localeCompare(a.proposedAt));
  }

  /** What this change would let the country do that it cannot do now. Empty means nobody needs to second it. */
  /**
   * CL1 — the terms this change would SWITCH ON that are not on now. Switching a term on is raising a
   * promise about what the network will accept, so it needs the second person exactly as a capability does.
   * Switching one OFF is a lowering and stays a one-person act, for the same reason a lapsed licence must
   * not wait for a signature.
   */
  termGainsOf(jurisdiction: string, incoterms?: { origin?: string[]; destination?: string[] }): string[] {
    if (!incoterms) return [];
    const now = this.resolve(jurisdiction).incoterms;
    const gained: string[] = [];
    for (const direction of ['origin', 'destination'] as const) {
      for (const code of incoterms[direction] ?? []) {
        const term = incotermEntry(code)?.code;
        if (term && !now[direction].includes(term)) gained.push(direction === 'origin' ? term + ' (as origin)' : term + ' (as destination)');
      }
    }
    return gained;
  }

  gainsOf(jurisdiction: string, level: PresenceLevel, overrides?: Partial<Record<PresenceCapability, boolean>>): PresenceCapability[] {
    const current = this.resolve(jurisdiction).capabilities;
    const next = capabilitiesOf(level, overrides);
    return PRESENCE_CAPABILITIES.filter((c) => next[c] && !current[c]);
  }

  /** The rules every standing obeys, asked by a proposal and again when it is applied. */
  private check(jurisdiction: string, level: PresenceLevel, overrides?: Partial<Record<PresenceCapability, boolean>>, proposing = false, incoterms?: { origin?: string[]; destination?: string[] }): string {
    const key = normalise(jurisdiction);
    if (!key) throw new GlosError('INVALID_INPUT', 'A presence needs the country it is about');
    // Only a country that exists may have a standing. Two letters are not a country.
    if (!catalogueEntry(key)) throw new GlosError('INVALID_INPUT', `${key} is not a country in the catalogue`);
    // Established and Partnered are what a real company MEANS. A proposal may name a company still in draft — the
    // approval activates it once its record is ready (CA3) — but a standing is never SET on one that is not active.
    const ours = proposing ? Boolean(this.entities.sisterRecordFor(key)) : this.hasTransactingEntity(key);
    if (level === 'established' && !ours) {
      throw new GlosError(
        'INVALID_STATE',
        `${key} cannot be established: no daughter company transacts there. Register the company first — this flag does not create one.`,
      );
    }
    if (level === 'partnered' && !this.entities.partnerFor(key, { includeDraft: proposing })) {
      throw new GlosError('INVALID_STATE', `${key} cannot be partnered: no partner company is recorded there. Record the partner first — this flag does not create one.`);
    }
    // CL1 — a term is SELECTED from the eleven, never invented, and the level floors the menu: a term that
    // obliges us to clear the import and bill the duty cannot be switched on where we neither collect tax
    // nor pay out. Refused when the person DECIDES, which is the same bargain as refusing a country whose
    // currency is not yet on the rate book — not discovered later at somebody's first shipment.
    if (incoterms) {
      const can = capabilitiesOf(level, overrides);
      for (const direction of ['origin', 'destination'] as const) {
        for (const code of incoterms[direction] ?? []) {
          const term = incotermEntry(code);
          if (!term) throw new GlosError('INVALID_INPUT', code + ' is not an Incoterm');
          if (direction === 'destination' && putsDutyOnSeller(term.code) && (!can.tax || !can.payouts)) {
            throw new GlosError(
              'INVALID_STATE',
              term.code + ' puts the import clearance and the duty on the seller, and ' + normalise(jurisdiction) + ' can neither collect tax nor pay out yet. Raise those first, or offer DAP or DPU instead.',
            );
          }
        }
      }
    }
    // An override for a capability that does not exist is a silent no-op, and a silent no-op on a
    // permission is how somebody believes they granted something they did not.
    for (const name of Object.keys(overrides ?? {})) {
      if (!PRESENCE_CAPABILITIES.includes(name as PresenceCapability)) throw new GlosError('INVALID_INPUT', `Unknown capability: ${name}`);
    }
    return key;
  }

  private requirePending(proposalId: string, now: number): PresenceProposal {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) throw new GlosError('NOT_FOUND', 'No such proposal');
    this.expireIfDue(proposal, now);
    if (proposal.status !== 'pending') throw new GlosError('INVALID_STATE', `This change was already ${proposal.status}`);
    return proposal;
  }

  private pendingFor(jurisdiction: string, now: number): PresenceProposal | undefined {
    return this.listProposals(now).find((p) => p.status === 'pending' && p.jurisdiction === jurisdiction);
  }

  private expireIfDue(proposal: PresenceProposal, now: number): void {
    if (proposal.status !== 'pending' || Date.parse(proposal.expiresAt) > now) return;
    Object.assign(proposal, { status: 'expired', decidedAt: proposal.expiresAt });
    this.proposals.set(proposal.proposalId, proposal);
  }

  private hasTransactingEntity(jurisdiction: string): boolean {
    const entity = this.entities.forJurisdiction(jurisdiction);
    return Boolean(entity && canTransact(entity));
  }
}

/** CA5 — the capabilities a lapsed licence or policy supported are off, whatever the level granted. */
function withoutLapses(capabilities: PresenceCapabilities, lapses: CapabilityLapse[]): PresenceCapabilities {
  const out = { ...capabilities };
  for (const lapse of lapses) out[lapse.capability] = false;
  return out;
}

/** A change to a country waits this long for a second person, then expires on the record. */
export const PROPOSAL_TTL_DAYS = 7;


/** The countries development starts with, beside the ones a company of ours already stands in. */
export const DEVELOPMENT_COUNTRIES = ['TZ', 'UG', 'RW', 'DE'];

/** Level defaults with the deliberate exceptions laid over them. */
export function capabilitiesOf(level: PresenceLevel, overrides?: Partial<Record<PresenceCapability, boolean>>): PresenceCapabilities {
  return { ...LEVEL_DEFAULTS[level], ...(overrides ?? {}) };
}

/** Country codes are compared, so they are stored one way. 'ke' and 'KE' are not two countries. */
function normalise(jurisdiction?: string): string {
  return (jurisdiction ?? '').trim().toUpperCase();
}

/**
 * What a refusal SAYS. One sentence each, about the thing the person was trying to do — never about
 * daughter companies, which is a fact about our paperwork and not about their parcel.
 */
const REFUSAL: Record<PresenceCapability, string> = {
  takeIn: 'The network does not operate in this country yet, so nothing can be taken in here',
  merchantOfRecord: 'We cannot charge customers in this country yet — a local carrier has to price and bill this',
  holdFloat: 'We cannot hold money in this country yet, so a shop here cannot keep a float with us',
  cashOnDelivery: 'We cannot handle cash in this country yet',
  claims: 'We cannot pay a claim in this country yet, so nothing here can be covered',
  tax: 'We do not collect tax in this country yet',
  payouts: 'We cannot pay out in this country yet',
  // CL5 — said as a fact about the law, not as a fault of the person holding the camera. They can still
  // record WHAT they were asked for; it is the photograph of the document we may not keep.
  fieldEvidence: 'We are not permitted to keep photographs of official documents in this country — say what happened and leave the paper out of it',
};

/** How a standing reads inside a refusal, so the message names the state and not only the country. */
const LEVEL_WORD: Record<PresenceLevel, string> = {
  observed: 'not operating',
  matched: 'matching only',
  partnered: 'local partner',
  established: 'established',
};

/** CL1 — canonical codes, de-duplicated, unknown ones already refused by check(). Order is the catalogue's. */
function normaliseTerms(input: { origin?: string[]; destination?: string[] }): { origin: string[]; destination: string[] } {
  const clean = (list?: string[]) => [...new Set((list ?? []).map((c) => incotermEntry(c)?.code).filter((c): c is string => Boolean(c)))];
  return { origin: clean(input.origin), destination: clean(input.destination) };
}
