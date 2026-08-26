import { Inject, Injectable } from '@nestjs/common';
import { GlosError } from '../../foundation/http/glos-error';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { createHash, randomBytes } from 'crypto';
import { DidService } from '../../foundation/did/did.service';
import { IdentityVault } from '../../foundation/data-firewall/identity-vault.service';
import { OperationalStore } from '../../foundation/data-firewall/operational-store.service';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { WalletService } from '../m1/wallet/wallet.service';
import { DEFAULT_BAG_BAYS, DEFAULT_PUDO_PRICE_PER_PARCEL, LOCK_THRESHOLD, MAX_BAG_BAYS, MIN_ANDROID_VERSION, MIN_OPEN_HOURS, MIN_SLOTS, NETWORK_JURISDICTION, TRADE_CREDIT_LIMIT } from './pudo.config';
import { EntityService } from '../../foundation/entity/entity.service';
import { BooksService } from '../../foundation/books/books.service';
import { ACCOUNT_CODES } from '../../foundation/books/books.types';
import { Geocoder, GEOCODER } from './geocoder';
import { countryOfSite, requireCountryCode } from './country';
import { MediaService } from './media.service';
import { averageOpenHours } from './hours';
import { Agent, AgentRequirements, AgentStatus, KycDocuments, ShelfConfig, WeeklyHours } from './pudo.types';
import { Equipment } from './cargo.types';

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

const fp = (value: string): string => createHash('sha256').update(value.trim().toLowerCase()).digest('hex');

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
  /** Hashed identity/device fingerprints for the DRAFT dedup check (18.5) — no PII stored here. */
  private readonly fingerprints = new Set<string>();

  constructor(
    private readonly dids: DidService,
    private readonly vault: IdentityVault,
    private readonly core: OperationalStore,
    private readonly wallet: WalletService,
    private readonly events: EventBus,
    private readonly media: MediaService,
    private readonly entities: EntityService,
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
  entityIdOf(agent: Agent): string {
    return agent.entityId ?? this.entities.requireForJurisdiction(this.countryOf(agent)).entityId;
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
    // WHICH COUNTRY, asked before anything else is spent on this application. A shop the network cannot
    // lawfully contract is refused here, by name — better than an approved shop discovering at its first
    // payout that no company in its country was ever party to the deal.
    const country = requireCountryCode(input.country);
    const entity = this.entities.requireForJurisdiction(country);

    // Location: a map pin AND/OR a physical address — at least one. Geocode the address if no pin.
    if (!input.location && !input.physicalAddress?.trim()) throw new GlosError('ADDRESS_REQUIRED', 'Provide a map pin (location) and/or a physical address');
    // A map pin is exact; otherwise resolve the address against the geocoder (real coords for a known
    // place, deterministic fallback for anything it can't place).
    const location = input.location ?? this.geocoder.geocode(input.physicalAddress!).location;

    // Eligibility filter (18.1) — block ineligible applicants up front.
    const unmet = this.unmetRequirements(input);
    if (unmet.length) throw new GlosError('REQUIREMENTS_NOT_MET', `Does not meet PUDO agent requirements: ${unmet.join('; ')}`);

    // Dedup check (18.5 DRAFT) — one national ID, one mobile, one device across the network.
    const prints = { id: fp(input.nationalId), mobile: fp(input.mobile), device: fp(input.deviceImei) };
    if (this.fingerprints.has(prints.id)) throw new GlosError('DUPLICATE', 'An agent with this national ID already exists');
    if (this.fingerprints.has(prints.mobile)) throw new GlosError('DUPLICATE', 'An agent with this mobile already exists');
    if (this.fingerprints.has(prints.device)) throw new GlosError('DUPLICATE', 'This device is already registered to another agent');

    const did = this.dids.generate(`pudo:${input.mobile}`, { role: 'pudo-agent' }).id;
    const { vaultRef } = this.vault.store({ fullName: input.fullName, governmentId: input.nationalId, phone: input.mobile }, { region: 'local' });
    this.core.upsert({ did, vaultRef, tier: 2, status: 'pending', capabilities: ['pudo-agent'], metadata: { zone: input.zone } });
    for (const p of Object.values(prints)) this.fingerprints.add(p);

    const agent: Agent = {
      agentId: `agt_${randomBytes(8).toString('hex')}`,
      did,
      vaultRef,
      shopName: input.shopName,
      zone: input.zone,
      // Where the shop IS, and the sister that follows from it. These are one decision written twice on
      // purpose: the country is the durable fact (a border is drawn from it), the entity is who invoices.
      country,
      entityId: entity.entityId,
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

  /** Vetting decision (18.5): approve → APPROVED_UNFUNDED (+ wallet); reject → DRAFT. Requirements + docs re-checked. */
  decideKyc(did: string, approve: boolean, by?: string): Agent {
    const agent = this.require(did);
    if (agent.status !== 'KYC_PENDING') throw new GlosError('INVALID_STATE', `Agent is ${agent.status}, expected KYC_PENDING`);
    if (!approve) return this.transition(agent, 'DRAFT');
    if (!agent.kyc) throw new GlosError('KYC_INCOMPLETE', 'Cannot approve: KYC documents missing');
    const unmet = this.unmetRequirements(agent);
    if (unmet.length) throw new GlosError('APPROVAL_BLOCKED', `Cannot approve: ${unmet.join('; ')}`);
    this.wallet.provision(did, { jurisdiction: 'US' });
    this.core.upsert({ did, vaultRef: agent.vaultRef, tier: 2, status: 'active', capabilities: ['pudo-agent'], metadata: { zone: agent.zone, by } });
    return this.transition(agent, 'APPROVED_UNFUNDED');
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

  /** Recompute the lock state from the wallet balance (called after every wallet movement). */
  refreshLock(did: string): Agent {
    const agent = this.require(did);
    // Lock on what the shop can actually SPEND — its float plus the trade-credit line — not on the float
    // alone. An empty till with credit left is a shop that can still serve the customer in front of it;
    // the shutter comes down at the end of the line, which is where 'no money, no scan' now bites.
    const balance = this.balance(did) + TRADE_CREDIT_LIMIT;
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
    return this.books.balance(this.entityIdOf(agent), ACCOUNT_CODES.RECEIVABLE_AGENT, undefined, did) || 0;
  }

  balance(did: string): number {
    // Derived from the books, not stored: the shop's balance IS its deposit account, and a deposit is a
    // liability of the sister (held negative), so it is flipped here at the presentation edge. One source
    // of truth — a cached figure that could disagree with the postings is the bug this whole slice removes.
    const agent = this.agents.get(did);
    if (!agent) return 0;
    // Deposit less any trade credit drawn: a shop that scanned on an empty float reads NEGATIVE, which is
    // the truth — they are in debt to the sister, and their next top-up clears it before anything else.
    const entityId = this.entityIdOf(agent);
    const deposit = -this.books.balance(entityId, ACCOUNT_CODES.DEPOSIT_AGENT, undefined, did);
    const credit = this.books.balance(entityId, ACCOUNT_CODES.RECEIVABLE_AGENT, undefined, did);
    return Math.round((deposit - credit) * 100) / 100 || 0;
  }

  get(did: string): Agent {
    return this.require(did);
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
