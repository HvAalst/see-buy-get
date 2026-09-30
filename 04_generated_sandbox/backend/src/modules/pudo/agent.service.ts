import { Inject, Injectable } from '@nestjs/common';
import { GlosError } from '../../foundation/http/glos-error';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { randomBytes } from 'crypto';
import { RegistrationPrints, type IdentityFields, type PrintField } from '../../foundation/identity/registration-prints';
import { DidService } from '../../foundation/did/did.service';
import { IdentityVault } from '../../foundation/data-firewall/identity-vault.service';
import { OperationalStore } from '../../foundation/data-firewall/operational-store.service';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { WalletService } from '../m1/wallet/wallet.service';
import { DEFAULT_BAG_BAYS, DEFAULT_PUDO_PRICE_PER_PARCEL, LOCK_THRESHOLD, MAX_BAG_BAYS, MIN_ANDROID_VERSION, MIN_OPEN_HOURS, MIN_SLOTS, NETWORK_JURISDICTION, TRADE_CREDIT_LIMIT } from './pudo.config';
import { EntityService } from '../../foundation/entity/entity.service';
import { PresenceService } from '../../foundation/presence/presence.service';
import { BooksService } from '../../foundation/books/books.service';
import { ACCOUNT_CODES } from '../../foundation/books/books.types';
import { Geocoder, GEOCODER } from './geocoder';
import { countryOfSite, requireCountryCode } from './country';
import { MediaService } from './media.service';
import { averageOpenHours } from './hours';
import { Agent, AgentRequirements, AgentStatus, KycDocuments, ShelfConfig, WeeklyHours } from './pudo.types';
import { Equipment } from './cargo.types';

/**
 * WHAT THIS SHOP IS STUCK ON, as one short key — and the single definition of it.
 *
 * Used for two things that must never disagree: the stamp recording what the applicant was last told,
 * and the sweep deciding whether to tell them again. Two expressions of "the same gap" would mean a shop
 * nudged twice about one thing, or never nudged about a new one.
 *
 * Empty string = nothing to say, which is the honest answer for a shop that is simply live.
 */
export function signupGapOf(a: {
  status: AgentStatus;
  /** Only the refs are read — never `submittedAt` — so this takes the shape it actually needs rather
   *  than a whole KycDocuments, and a caller holding a partial record can ask the same question. */
  kyc?: { idCopyRef?: string; tradingLicenceRef?: string; shopPhotoRefs?: string[] };
  kycRejection?: { at: string };
}): string {
  if (a.status === 'APPROVED_UNFUNDED') return 'unfunded';
  if (a.status !== 'DRAFT') return '';
  // A rejection is keyed to its own text: a second look that fails for a NEW reason is news again.
  if (a.kycRejection) return `rejected:${a.kycRejection.at}`;
  const missing = [a.kyc?.idCopyRef ? null : 'id', a.kyc?.tradingLicenceRef ? null : 'licence', a.kyc?.shopPhotoRefs?.length ? null : 'photos'].filter(Boolean);
  return missing.length ? `missing:${missing.join(',')}` : '';
}

interface RegisterAgentInput {
  shopName: string;
  zone: string;
  country?: string; // ISO-3166 alpha-2; defaults to the deployment's home country

  location?: { lat: number; lng: number }; // map pin
  physicalAddress?: string; // typed address — one of pin/address is required
  landmark: string;
  openingHours: WeeklyHours;
  shelf: ShelfConfig;
  pricePerParcel?: number; // open-data handling fee (defaults if unset)
  fullName: string;
  nationalId: string;
  mobile: string;
  deviceImei: string;
  requirements: AgentRequirements;
  equipment?: Equipment[]; // S32c — declared load/unload equipment on hand (beyond manual)
}

/** The same sentences as before, with the field they name carried beside them for the app to act on. */
const SHOP_HELD: Record<Exclude<PrintField, 'licence'>, string> = {
  nationalId: 'An agent with this national ID already exists',
  phone: 'An agent with this mobile already exists',
  device: 'This device is already registered to another agent',
};

/**
 * AgentService (P-002, ↔ M1 UDIW Tiers 1–2 / M1-ONB). Manages the PUDO agent (Tier 2 shopkeeper)
 * lifecycle: DRAFT → KYC_PENDING → APPROVED_UNFUNDED → ACTIVE → LOCKED. Reuses the GLOS backbone — a
 * DID per agent (DidService), the Golden Record PII in the IdentityVault (never in the core), a
 * tier-2 entry in the Operational Core (so the agent graduates onto M1/M3 with no migration), and an
 * M1 wallet for the pre-paid balance. 'No money, no scan' lock is driven by the wallet balance.
 */
@Injectable()
export class AgentService {
  // Durable: the agent golden record (status, shelf, zone, wallet link). A signed-up agent — and the
  // wallet balance keyed to them — is meaningless after a restart if this record is gone.
  private readonly agents = new PersistentMap<string, Agent>('pudo-agents'); // keyed by DID
  /** Keyed identity/device prints for the DRAFT dedup check (18.5) — on disk, and no PII in them. */
  private readonly prints = new RegistrationPrints('shop');

  constructor(
    private readonly dids: DidService,
    private readonly vault: IdentityVault,
    private readonly core: OperationalStore,
    private readonly wallet: WalletService,
    private readonly events: EventBus,
    private readonly media: MediaService,
    private readonly entities: EntityService,
    private readonly presence: PresenceService,
    private readonly books: BooksService,
    @Inject(GEOCODER) private readonly geocoder: Geocoder,
  ) {}

  /** The sister this deployment's shops and hubs belong to — the fallback for pre-entity records. */
  homeEntityId(): string {
    return this.entities.requireForJurisdiction(NETWORK_JURISDICTION).entityId;
  }

  /** The country this shop stands in — declared at registration, this deployment's home for older records. */
  countryOf(agent: Agent): string {
    return countryOfSite(agent);
  }

  /**
   * The sister that contracts this shop — resolved from the country the shop is IN, not from the country
   * the deployment happens to run in. Those were the same answer while the network was one country and
   * are not the same question, which is what made a shop in Addis come out contracted to Nairobi.
   */
  /**
   * The sister that contracts this shop, or NOTHING where none does.
   *
   * For READS. Every path that moves money keeps asking , which refuses by name — the two
   * exist separately so that a list can render a shop we cannot bill without a question about money
   * taking the whole screen down.
   */
  entityIdOrNone(agent: Agent): string | undefined {
    return agent.entityId ?? this.entities.forJurisdiction(this.countryOf(agent))?.entityId;
  }

  entityIdOf(agent: Agent): string {
    if (agent.entityId) return agent.entityId;
    // THE MONEY GATE, and the last line of defence rather than the first question. A shop can exist
    // where no sister does; what it cannot do is have money run through one. Asked of the presence
    // first so the refusal says what is true of that country rather than "no daughter company".
    const country = this.countryOf(agent);
    this.presence.require(country, 'holdFloat');
    return this.entities.requireForJurisdiction(country).entityId;
  }

  /** The agent-eligibility filter (18.1). Returns the list of unmet hard requirements. */
  unmetRequirements(input: { shelf: ShelfConfig; openingHours: WeeklyHours; requirements: AgentRequirements }): string[] {
    const r = input.requirements;
    const fails: string[] = [];
    if ((input.shelf.rows ?? 0) * (input.shelf.cols ?? 0) < MIN_SLOTS) fails.push(`shelf must have ≥ ${MIN_SLOTS} slots (rows × columns)`);
    if (averageOpenHours(input.openingHours) < MIN_OPEN_HOURS) fails.push(`must open ≥ ${MIN_OPEN_HOURS} hours/day on average`);
    if ((r.androidVersion ?? 0) < MIN_ANDROID_VERSION) fails.push(`device must be Android ${MIN_ANDROID_VERSION}+`);
    if (!r.reliablePower) fails.push('reliable power source required');
    if (!r.tradingLicence?.trim()) fails.push('valid trading licence required');
    if (!r.criminalRecordClear) fails.push('clean criminal record required');
    return fails;
  }

  /** Capture shop + identity, run the eligibility filter + dedup, mint a DID, vault the Golden Record → DRAFT. */
  register(input: RegisterAgentInput): Agent {
    // WHICH COUNTRY, asked before anything else is spent on this application — and asked of the
    // PRESENCE rather than of the company register.
    //
    // This used to demand a sister company, which meant a country we had not incorporated in could hold
    // no shops at all: no matching, no custody, no proof, nothing. That is the binary the ladder exists
    // to break. A shop may now stand anywhere the network is allowed to take goods in, and whether its
    // money runs through a sister of ours is a SECOND question with its own answer.
    const country = requireCountryCode(input.country);
    this.presence.require(country, 'takeIn');
    // Undefined where we are matching only. Every money path asks for it by name and refuses there;
    // nothing else needs it.
    const entity = this.entities.forJurisdiction(country);

    // Location: a map pin AND/OR a physical address — at least one. Geocode the address if no pin.
    if (!input.location && !input.physicalAddress?.trim()) throw new GlosError('ADDRESS_REQUIRED', 'Provide a map pin (location) and/or a physical address');
    // A map pin is exact; otherwise resolve the address against the geocoder (real coords for a known
    // place, deterministic fallback for anything it can't place).
    const location = input.location ?? this.geocoder.geocode(input.physicalAddress!).location;

    // Eligibility filter (18.1) — block ineligible applicants up front.
    const unmet = this.unmetRequirements(input);
    if (unmet.length) throw new GlosError('REQUIREMENTS_NOT_MET', `Does not meet PUDO agent requirements: ${unmet.join('; ')}`);

    // Dedup check (18.5 DRAFT) — one national ID, one mobile, one device across the network.
    const identity: IdentityFields = [
      ['nationalId', input.nationalId],
      ['phone', input.mobile],
      ['device', input.deviceImei],
    ];
    const held = this.prints.taken(identity);
    if (held) throw new GlosError('DUPLICATE', SHOP_HELD[held as Exclude<PrintField, 'licence'>], { field: held, register: 'shop' });

    const did = this.dids.generate(`pudo:${input.mobile}`, { role: 'pudo-agent' }).id;
    const { vaultRef } = this.vault.store({ fullName: input.fullName, governmentId: input.nationalId, phone: input.mobile }, { region: 'local' });
    this.core.upsert({ did, vaultRef, tier: 2, status: 'pending', capabilities: ['pudo-agent'], metadata: { zone: input.zone } });
    this.prints.claim(identity, did);

    const agent: Agent = {
      agentId: `agt_${randomBytes(8).toString('hex')}`,
      did,
      vaultRef,
      shopName: input.shopName,
      zone: input.zone,
      // Where the shop IS, and the sister that follows from it. These are one decision written twice on
      // purpose: the country is the durable fact (a border is drawn from it), the entity is who invoices.
      country,
      ...(entity ? { entityId: entity.entityId } : {}),
      location,
      physicalAddress: input.physicalAddress?.trim() || undefined,
      landmark: input.landmark,
      openState: 'open',
      openingHours: input.openingHours,
      shelf: input.shelf,
      pricePerParcel: input.pricePerParcel ?? DEFAULT_PUDO_PRICE_PER_PARCEL,
      // S32c: every shop can do manual handling; a well-equipped PUDO declares more (a pallet jack, a
      // forklift) so it can be a dedicated-freight origin/destination without a handling gap.
      equipment: [...new Set<Equipment>(['MAN', ...(input.equipment ?? [])])],
      deviceImei: input.deviceImei,
      requirements: input.requirements,
      equipmentDepositPaid: false,
      status: 'DRAFT',
      lastPingAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
    this.agents.set(did, agent);
    // Tell them what is still needed while they are still holding the phone. Fire-and-forget like every
    // other publish here: a notification that fails must never fail a registration.
    void this.events
      .publish(GlosEvent.Pudo.AgentRegistered, { did, agentId: agent.agentId, shopName: agent.shopName }, { source: 'pudo' })
      .catch(() => undefined);
    return agent;
  }

  /** Upload KYC documents (ID copy, trading licence, shop photos) → KYC_PENDING (18.5). */
  submitKyc(did: string, documents: { idCopyRef: string; tradingLicenceRef: string; shopPhotoRefs: string[] }): Agent {
    const agent = this.require(did);
    if (agent.status !== 'DRAFT') throw new GlosError('INVALID_STATE', `Agent is ${agent.status}, expected DRAFT`);
    if (!documents.idCopyRef || !documents.tradingLicenceRef || !(documents.shopPhotoRefs?.length > 0)) {
      throw new GlosError('KYC_INCOMPLETE', 'KYC requires an ID copy, a trading licence, and at least one shop photo');
    }
    agent.kyc = { idCopyRef: documents.idCopyRef, tradingLicenceRef: documents.tradingLicenceRef, shopPhotoRefs: documents.shopPhotoRefs, submittedAt: new Date().toISOString() } as KycDocuments;
    return this.transition(agent, 'KYC_PENDING');
  }

  /**
   * Vetting decision (18.5): approve → APPROVED_UNFUNDED (+ wallet); reject → DRAFT. Requirements + docs re-checked.
   *
   * A REJECTION CARRIES A REASON, and it is not optional — the same rule the claims queue already obeys,
   * for the same reason: the applicant is shown it. Without one, a rejection sent a shop back to DRAFT
   * silently, where it was indistinguishable from a shop that had never sent anything, and the person who
   * had to fix it was told neither that a decision had been made nor what was wrong with what they sent.
   *
   * The documents are CLEARED on a rejection. They have to be: `unfinished()` reads the papers to work out
   * what is missing, so refs left behind on a rejected record made the chase list report nothing missing
   * for a shop that could not proceed — and the shop would have had no way to replace a rejected licence,
   * because `submitKyc` only accepts a full set and only from DRAFT.
   */
  decideKyc(did: string, approve: boolean, by?: string, reason?: string): Agent {
    const agent = this.require(did);
    if (agent.status !== 'KYC_PENDING') throw new GlosError('INVALID_STATE', `Agent is ${agent.status}, expected KYC_PENDING`);
    if (!approve) {
      const why = reason?.trim();
      if (!why) throw new GlosError('REASON_REQUIRED', 'A rejection must say why: the applicant is shown it');
      agent.kycRejection = { reason: why, at: new Date().toISOString(), ...(by ? { by } : {}) };
      agent.kyc = undefined;
      const rejected = this.transition(agent, 'DRAFT');
      void this.events
        .publish(GlosEvent.Pudo.AgentKycRejected, { did, agentId: agent.agentId, shopName: agent.shopName, reason: why }, { source: 'pudo' })
        .catch(() => undefined);
      return rejected;
    }
    // Approved: the old refusal stops being the news. Kept nowhere, because a shop that got in does not
    // carry a note saying it once did not.
    agent.kycRejection = undefined;
    if (!agent.kyc) throw new GlosError('KYC_INCOMPLETE', 'Cannot approve: KYC documents missing');
    const unmet = this.unmetRequirements(agent);
    if (unmet.length) throw new GlosError('APPROVAL_BLOCKED', `Cannot approve: ${unmet.join('; ')}`);
    this.wallet.provision(did, { jurisdiction: 'US' });
    this.core.upsert({ did, vaultRef: agent.vaultRef, tier: 2, status: 'active', capabilities: ['pudo-agent'], metadata: { zone: agent.zone, by } });
    this.transition(agent, 'APPROVED_UNFUNDED');
    // A shop we hold no money for has no float to fund, so "unfunded" is not a step it can ever leave —
    // found by driving it: a shop in a matching-only country was approved and then stuck forever. Only
    // that shop is re-derived here; a shop with a float still waits for its first top-up, as before.
    return this.balance(did) === null ? this.refreshLock(did) : agent;
  }

  /** Record the $50 refundable equipment/starter-kit deposit (18.3). */
  recordDeposit(did: string): Agent {
    const agent = this.require(did);
    agent.equipmentDepositPaid = true;
    return agent;
  }

  /** Agents awaiting a KYC decision (the operator review queue). */
  kycQueue(): Agent[] {
    return [...this.agents.values()].filter((a) => a.status === 'KYC_PENDING');
  }

  /**
   * Shops that started joining and stopped — and are waiting on THEMSELVES, not on us.
   *
   * The KYC queue above is a decision list: everything in it needs network staff to say yes or no. These
   * do not, which is exactly why nobody was looking at them: a shop sits in DRAFT because its owner
   * never sent their documents, and one sits APPROVED_UNFUNDED because they never put money in the
   * float. Neither ever appeared anywhere except as a grey word in a table, and the oldest of them had
   * been stuck for a month.
   *
   * For a network that grows by shops joining, this is the most valuable list in the console: every row
   * is somebody who wanted in and hit something. It is a CHASE list, not a queue — which is why it is a
   * separate call rather than more rows in the one that carries a badge.
   */
  unfinished(): Array<{
    did: string;
    shopName: string;
    zone: string;
    status: string;
    since: string;
    /** Why they are stuck — the thing to say when somebody rings them. */
    reason: 'needs-documents' | 'needs-first-top-up' | 'was-rejected';
    /** For a DRAFT shop, which documents are actually missing. Empty for an unfunded one. */
    missing: string[];
    /** Why we said no, on a shop that was rejected rather than one that never sent anything. */
    rejectedWhy?: string;
    /** Whether the applicant has been told about the state they are in. A row that says NO here is the
     *  loose end itself: somebody is waiting on us to have already spoken. */
    told: boolean;
  }> {
    return [...this.agents.values()]
      .filter((a) => a.status === 'DRAFT' || a.status === 'APPROVED_UNFUNDED')
      .map((a) => {
        // A shop we REJECTED is not a shop that never sent anything, and the chase list must not read the
        // two as one row: what you say on the phone is different, and only one of them is our own doing.
        const reason = a.status !== 'DRAFT' ? ('needs-first-top-up' as const) : a.kycRejection ? ('was-rejected' as const) : ('needs-documents' as const);
        return {
          did: a.did,
          shopName: a.shopName,
          zone: a.zone,
          status: a.status,
          since: a.createdAt,
          reason,
          missing:
            a.status === 'DRAFT'
              ? [
                  a.kyc?.idCopyRef ? null : 'id',
                  a.kyc?.tradingLicenceRef ? null : 'licence',
                  a.kyc?.shopPhotoRefs?.length ? null : 'photos',
                ].filter((x): x is string => Boolean(x))
              : [],
          ...(a.kycRejection ? { rejectedWhy: a.kycRejection.reason } : {}),
          told: Boolean(a.signupNudgedFor) && a.signupNudgedFor === signupGapOf(a),
        };
      })
      // Longest stuck first: the shop that signed up a month ago and never came back is the one nobody
      // has called, and the one most likely to be gone for good.
      .sort((a, b) => a.since.localeCompare(b.since));
  }

  /** Recompute the lock state from the wallet balance (called after every wallet movement). */
  refreshLock(did: string): Agent {
    const agent = this.require(did);
    // Lock on what the shop can actually SPEND — its float plus the trade-credit line — not on the float
    // alone. An empty till with credit left is a shop that can still serve the customer in front of it;
    // the shutter comes down at the end of the line, which is where 'no money, no scan' now bites.
    // A shop with no money rail has no float to lock ON: it never scans against a balance, so the
    // shutter this computes has nothing to fall on. Left exactly as it stands.
    const float = this.balance(did);
    if (float === null) {
      // NO FLOAT, NOT AN EMPTY ONE. 'No money, no scan' guards money of ours at the counter; where none can
      // move (the carrier's promise, or work a sister buys) there is nothing to fund, so an approved shop is
      // active. It still cannot take cash — the take-in door refuses that by country, not by balance.
      if (agent.status === 'APPROVED_UNFUNDED' || agent.status === 'LOCKED') {
        this.transition(agent, 'ACTIVE');
        void this.events.publish(GlosEvent.Pudo.AgentActivated, { did, agentId: agent.agentId }, { source: 'pudo' }).catch(() => undefined);
      }
      return agent;
    }
    const balance = float + TRADE_CREDIT_LIMIT;
    if ((agent.status === 'APPROVED_UNFUNDED' || agent.status === 'LOCKED') && balance >= LOCK_THRESHOLD) {
      this.transition(agent, 'ACTIVE');
      void this.events.publish(GlosEvent.Pudo.AgentActivated, { did, agentId: agent.agentId }, { source: 'pudo' }).catch(() => undefined);
    } else if (agent.status === 'ACTIVE' && balance < LOCK_THRESHOLD) {
      this.transition(agent, 'LOCKED');
      void this.events.publish(GlosEvent.Pudo.AgentLocked, { did, agentId: agent.agentId, balance }, { source: 'pudo' }).catch(() => undefined);
    }
    return agent;
  }

  /** 'No money, no scan' gate for accepting parcels (UDIW-043 light). */
  canScan(did: string): boolean {
    const agent = this.require(did);
    // A shop approved before a float-less shop could activate is still sitting in APPROVED_UNFUNDED, and no
    // money movement will ever reach it to re-derive that. Asked where the gate is asked, it moves on.
    if (agent.status !== 'ACTIVE' && this.balance(did) === null) this.refreshLock(did);
    return this.require(did).status === 'ACTIVE';
  }

  ping(did: string): Agent {
    const agent = this.require(did);
    agent.lastPingAt = new Date().toISOString();
    return agent;
  }

  /** Agent marks the shop open or temporarily closed (Risk #30 mitigation). */
  setAvailability(did: string, open: boolean): Agent {
    const agent = this.require(did);
    agent.openState = open ? 'open' : 'closed';
    return agent;
  }

  /** Update the weekly opening schedule. */
  setHours(did: string, openingHours: WeeklyHours): Agent {
    const agent = this.require(did);
    agent.openingHours = openingHours;
    return agent;
  }

  /** Reconfigure the shelf grid (rows × columns). */
  setShelf(did: string, shelf: ShelfConfig): Agent {
    const agent = this.require(did);
    if (shelf.rows < 1 || shelf.cols < 1) throw new GlosError('INVALID_INPUT', 'Shelf needs at least one row and column');
    agent.shelf = shelf;
    return agent;
  }

  /**
   * How many bags this shop can stage at once. Read through here, never off the record: the field is absent
   * on every shop that existed before bays did, and on every shop that has never been asked.
   */
  bagBaysOf(agent: Agent): number {
    const n = agent.bagBays;
    return typeof n === 'number' && Number.isFinite(n) && n >= 1 ? Math.floor(n) : DEFAULT_BAG_BAYS;
  }

  /** The shop declares its floor room for outbound bags (the shelf's counterpart for the other pile). */
  setBagBays(did: string, bays: number): Agent {
    const agent = this.require(did);
    if (!Number.isFinite(bays) || bays < 1 || bays > MAX_BAG_BAYS) {
      throw new GlosError('INVALID_INPUT', `Bag space must be between 1 and ${MAX_BAG_BAYS} bags`);
    }
    agent.bagBays = Math.floor(bays);
    this.agents.set(did, agent); // durable record, mutated in place — re-store so the snapshot flushes
    return agent;
  }

  /** Move the shop's map pin (the agent drags it on the My-shop map). */
  setLocation(did: string, location: { lat: number; lng: number }): Agent {
    const agent = this.require(did);
    agent.location = location;
    return agent;
  }

  /**
   * Point the shop-front photo at an uploaded media (or clear it with an empty string). Mirrors the person
   * avatar (person.service): the shop must OWN the media and it must have been uploaded AS an avatar, then it
   * is LINKED to the agent so the retention sweep keeps it (unlinked 'avatar' media is orphan-reaped ~48h
   * after upload). The superseded photo's bytes are dropped — one shop photo per shop.
   */
  setShopfront(did: string, mediaId: string | undefined): Agent {
    const agent = this.require(did);
    const next = (mediaId ?? '').trim() || undefined;
    if (next) {
      const ref = this.media.get(next);
      if (!ref || ref.ownerDid !== did) throw new GlosError('FORBIDDEN', 'That image is not yours to use');
      if (ref.kind !== 'avatar') throw new GlosError('INVALID_INPUT', 'That image was not uploaded as a shop photo');
      this.media.link(next, { type: 'agent', id: did }, 'avatar');
    }
    if (agent.shopfrontMediaId && agent.shopfrontMediaId !== next) {
      this.media.purgeByOwner(agent.shopfrontMediaId, did); // one shop photo — drop the old bytes
    }
    agent.shopfrontMediaId = next;
    return agent;
  }

  /** Trade credit outstanding — what the shop owes the sister for parcels scanned on an empty float. */
  creditOwed(did: string): number {
    const agent = this.agents.get(did);
    if (!agent) return 0;
    // No money rail, no credit line. Nothing was ever lent here, so nothing is owed.
    const entityId = this.entityIdOrNone(agent);
    if (!entityId) return 0;
    return this.books.balance(entityId, ACCOUNT_CODES.RECEIVABLE_AGENT, undefined, did) || 0;
  }

  balance(did: string): number | null {
    // Derived from the books, not stored: the shop's balance IS its deposit account, and a deposit is a
    // liability of the sister (held negative), so it is flipped here at the presentation edge. One source
    // of truth — a cached figure that could disagree with the postings is the bug this whole slice removes.
    const agent = this.agents.get(did);
    if (!agent) return 0;
    // Deposit less any trade credit drawn: a shop that scanned on an empty float reads NEGATIVE, which is
    // the truth — they are in debt to the sister, and their next top-up clears it before anything else.
    // A SHOP WHERE WE HOLD NO MONEY HAS NO BALANCE — not a zero one. Answered here rather than thrown,
    // because this is a READ: one shop in a matching-only country must never be able to refuse the
    // operator the whole shop list. The money PATHS still go through entityIdOf and still refuse.
    const entityId = this.entityIdOrNone(agent);
    if (!entityId) return null;
    const deposit = -this.books.balance(entityId, ACCOUNT_CODES.DEPOSIT_AGENT, undefined, did);
    const credit = this.books.balance(entityId, ACCOUNT_CODES.RECEIVABLE_AGENT, undefined, did);
    return Math.round((deposit - credit) * 100) / 100 || 0;
  }

  get(did: string): Agent {
    return this.require(did);
  }

  /** The same lookup that does NOT throw — for callers whose whole job is best-effort, like the
   *  notification dispatcher: a shop that no longer exists is a reason to say nothing, not to raise. */
  find(did: string): Agent | undefined {
    return this.agents.get(did);
  }

  /** Set the agent's open-data per-parcel handling price (public, drives the shipment quote). */
  setPrice(did: string, pricePerParcel: number): Agent {
    if (pricePerParcel < 0) throw new GlosError('AMOUNT_INVALID', 'Price cannot be negative');
    const agent = this.require(did);
    agent.pricePerParcel = Math.round(pricePerParcel * 100) / 100;
    return agent;
  }

  list(): Agent[] {
    return [...this.agents.values()];
  }

  // --- internals ---

  private transition(agent: Agent, status: AgentStatus): Agent {
    agent.status = status;
    return agent;
  }

  private require(did: string): Agent {
    const agent = this.agents.get(did);
    if (!agent) throw new GlosError('NOT_FOUND', `PUDO agent not found: ${did}`);
    return agent;
  }
}
