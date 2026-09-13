import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { catalogueEntry } from '../countries/catalogue';
import type { CapabilityLapse } from '../presence/presence.types';
import { datedItemsOf, emptyRecord, lapsesAt, lapsesOf, normaliseRecordPatch, type CompanyRecord } from './company-record.types';
import { GlosError } from '../http/glos-error';
import { PersistentMap } from '../store/persistent-map';
import { DidService } from '../did/did.service';
import { currencyForJurisdiction } from '../money/currency';
import { DEFAULT_TAX_LABEL, MAX_PLATFORM_FEE_PCT, MAX_PREMIUM_PCT, MAX_TAX_PCT, MIN_PLATFORM_FEE_PCT, MIN_TAX_PCT, PLATFORM_FEE_PCT } from '../../modules/pudo/pudo.config';
import {
  Entity,
  EntityChange,
  EntityPricing,
  InsuranceRule,
  LanePricing,
  RateOrigin,
  RateOrigins,
  RateStack,
  ResolvedInsurance,
  ResolvedRates,
  ResolvedTax,
  RuleOrigin,
  TaxRule,
  canHoldCustody,
  canTransact,
} from './entity.types';

/**
 * The group and its sisters, seeded at boot.
 *
 * Kept here rather than in a domain module because every module eventually needs to name an entity —
 * a quote leg needs the sister that will perform it, a shipment needs the sister that collects for it,
 * and the books (step 3) need the entity that owns every account.
 *
 * Adding a sister is a deliberate act, not configuration drift: it implies a registered company, a tax
 * registration and a settlement account in that country. So the seed list is explicit, and a
 * jurisdiction with no sister cannot be transacted in at all — which is the honest answer, rather than
 * quietly settling a Dutch vendor's parcels through Nairobi.
 */

const GROUP_SEED = { entityId: 'sbg', name: 'SeeBuyGet Group' };

/** The jurisdictions with a real daughter company. One line per country the network actually operates in. */
const SISTER_SEEDS: Array<{ entityId: string; name: string; jurisdiction: string }> = [
  { entityId: 'sbg-ke', name: 'SeeBuyGet Kenya', jurisdiction: 'KE' },
  // The second country, and the reason it is here: a border cannot be modelled with one company. Until
  // now every site in the network resolved to Kenya by construction, so "cross-border" had nowhere to
  // live — a shop in Addis would have been contracted to Nairobi, which is the exact fallback this list
  // exists to forbid. A sister in Ethiopia makes the border a fact two records disagree about, rather
  // than a case nobody can express. Adding a third is one line, and the same deliberate act.
  { entityId: 'sbg-et', name: 'SeeBuyGet Ethiopia', jurisdiction: 'ET' },
];

@Injectable()
export class EntityService implements OnApplicationBootstrap {
  // Durable: an entity's DID is referenced by records that outlive a restart, so it must not be reminted.
  private readonly entities = new PersistentMap<string, Entity>('entities');
  /** Per company, in the order they happened. See `changes()`. */
  private readonly changeLog = new PersistentMap<string, EntityChange[]>('entity-changes');

  constructor(private readonly dids: DidService) {}

  onApplicationBootstrap(): void {
    this.seed();
  }

  /** Idempotent: an entity that already exists keeps its DID, because other records point at it. */
  seed(): void {
    if (!this.entities.has(GROUP_SEED.entityId)) {
      this.entities.set(GROUP_SEED.entityId, {
        ...GROUP_SEED,
        did: this.dids.generate(`entity:${GROUP_SEED.entityId}`, { role: 'entity', kind: 'group' }).id,
        kind: 'group',
        // No jurisdiction, no currency, no custody. The mother licenses; she does not settle.
        createdAt: new Date().toISOString(),
      });
    }
    // Development only: in production a company of ours is created from the super-admin side (CA3), never from code.
    if ((process.env.GLOS_ENV ?? '').toLowerCase() === 'production') return;
    for (const seed of SISTER_SEEDS) {
      if (this.entities.has(seed.entityId)) continue;
      this.entities.set(seed.entityId, {
        ...seed,
        did: this.dids.generate(`entity:${seed.entityId}`, { role: 'entity', kind: 'sister', jurisdiction: seed.jurisdiction }).id,
        kind: 'sister',
        currency: currencyForJurisdiction(seed.jurisdiction),
        parentEntityId: GROUP_SEED.entityId,
        createdAt: new Date().toISOString(),
      });
    }
  }

  list(): Entity[] {
    return [...this.entities.values()].sort((a, b) => a.entityId.localeCompare(b.entityId));
  }

  sisters(): Entity[] {
    // Active only: a company still in draft is on the register (companies()) and nowhere near the money.
    return this.list().filter((e) => canTransact(e));
  }

  /** The mother. Present from boot; her absence would mean the seed never ran. */
  group(): Entity {
    const group = this.list().find((e) => e.kind === 'group');
    if (!group) throw new GlosError('INTERNAL', 'No group entity — the entity registry was not seeded');
    return group;
  }

  find(entityId?: string): Entity | undefined {
    return entityId ? this.entities.get(entityId) : undefined;
  }

  get(entityId: string): Entity {
    const entity = this.find(entityId);
    if (!entity) throw new GlosError('NOT_FOUND', `No such entity: ${entityId}`);
    return entity;
  }

  /** The sister that settles a country, if the network has one there. */
  forJurisdiction(jurisdiction?: string): Entity | undefined {
    if (!jurisdiction) return undefined;
    const code = jurisdiction.toUpperCase();
    return this.sisters().find((e) => e.jurisdiction === code);
  }

  /**
   * The sister that settles a country — refusing when there is none. A jurisdiction with no daughter
   * company is a place the network cannot legally transact, and saying so is better than falling back
   * to another country's sister, which would put revenue, tax and liability in the wrong company.
   */
  requireForJurisdiction(jurisdiction?: string): Entity {
    const entity = this.forJurisdiction(jurisdiction);
    if (!entity) throw new GlosError('NOT_FOUND', `No daughter company operates in ${jurisdiction ?? 'that jurisdiction'} yet`);
    return entity;
  }

  /**
   * Resolve an entity that is allowed to be a party to a transaction. This is the isolation gate: name
   * the group as a collector or a performer and it is refused here, not caught in review later.
   */
  requireTransacting(entityId: string): Entity {
    const entity = this.get(entityId);
    if (!canTransact(entity)) {
      throw new GlosError(
        'FORBIDDEN',
        entity.status === 'draft'
          ? `${entity.name} is still a draft: it cannot be a party to a transaction until two people switch it on`
          : `${entity.name} is ${entity.kind === 'partner' ? 'a partner company' : 'a holding company'}: it cannot be a party to a transaction`,
      );
    }
    return entity;
  }

  /** The margin this sister charges, falling back to the network default for one that never set it. */
  feePctOf(entityId: string): number {
    return this.ratesFor(entityId).totalPct;
  }

  /**
   * The three layers this sister prices with, for one lane of work.
   *
   * Resolution runs narrow to wide, and every step is a state some sister is genuinely in: the override
   * for this lane, then the sister's own default stack, then the single `feePct` it may have set before
   * there were layers — read as its MARGIN, which is what that number always was — then the network
   * default. A sister that has never touched any of it prices exactly as it did yesterday.
   *
   * Layers are resolved INDEPENDENTLY rather than as a whole object: a sister that sets a cost of risk on
   * dedicated freight and nothing else should keep its own margin, not fall back to the network's because
   * one field of the override was empty.
   */
  ratesFor(entityId: string, lane?: string): ResolvedRates {
    return EntityService.resolveRates(this.get(entityId), lane);
  }

  /** The resolution itself, over a plain shape — so a CANDIDATE can be checked before anything is stored. */
  static resolveRates(from: Pick<Entity, 'rates' | 'ratesByLane' | 'feePct'>, lane?: string): ResolvedRates {
    const forLane = lane ? from.ratesByLane?.[lane] : undefined;
    const pick = (of: (s: RateStack) => number | undefined): number | undefined => {
      const narrow = forLane ? of(forLane) : undefined;
      return narrow != null ? narrow : from.rates ? of(from.rates) : undefined;
    };
    const costOfRiskPct = pick((s) => s.costOfRiskPct) ?? 0;
    const profitOnRiskPct = pick((s) => s.profitOnRiskPct) ?? 0;
    // Margin alone has the two extra fallbacks, because margin is what the old single knob always meant.
    const marginPct = pick((s) => s.marginPct) ?? from.feePct ?? PLATFORM_FEE_PCT;
    const round4 = (n: number) => Math.round(n * 10_000) / 10_000;
    return {
      costOfRiskPct: round4(costOfRiskPct),
      profitOnRiskPct: round4(profitOnRiskPct),
      marginPct: round4(marginPct),
      totalPct: round4(costOfRiskPct + profitOnRiskPct + marginPct), // ADDED, never compounded
    };
  }

  /**
   * Turn one or more of a sister's knobs, for a lane or for everything it does.
   *
   * Only the layers actually named are changed — turning the cost-of-risk knob must not silently reset a
   * margin somebody set last month. Passing `null` for a layer clears it back to the fallback, which is a
   * different intention from leaving it alone and needs to be sayable.
   *
   * Bounded twice over: each layer on its own, and their SUM, so three innocent-looking numbers cannot
   * add up to a rate that prices a market out of existence.
   */
  setRates(entityId: string, input: { lane?: string; costOfRiskPct?: number | null; profitOnRiskPct?: number | null; marginPct?: number | null }, by?: string): Entity {
    const entity = this.requireTransacting(entityId);
    const before = EntityService.resolveRates(entity, input.lane);
    const apply = (into: RateStack): RateStack => {
      const next = { ...into };
      for (const key of ['costOfRiskPct', 'profitOnRiskPct', 'marginPct'] as const) {
        const v = input[key];
        if (v === undefined) continue; // not mentioned — leave whatever is there
        if (v === null) {
          delete next[key]; // explicitly cleared, back to the fallback
          continue;
        }
        if (!Number.isFinite(v) || v < MIN_PLATFORM_FEE_PCT || v > MAX_PLATFORM_FEE_PCT) {
          throw new GlosError('INVALID_INPUT', `Each rate must be between ${MIN_PLATFORM_FEE_PCT * 100}% and ${MAX_PLATFORM_FEE_PCT * 100}%`);
        }
        next[key] = Math.round(v * 10_000) / 10_000; // basis points is as fine as a rate needs to be
      }
      return next;
    };

    // Built as a CANDIDATE and checked before anything is stored. Validating a record we had already
    // mutated would leave a rejected rate sitting in memory until the next reload — the change would be
    // refused and applied at the same time.
    const rates = input.lane ? entity.rates : apply(entity.rates ?? {});
    const ratesByLane = input.lane ? { ...(entity.ratesByLane ?? {}), [input.lane]: apply(entity.ratesByLane?.[input.lane] ?? {}) } : entity.ratesByLane;

    // The ceiling is on the figure the customer would actually be charged, which is only knowable once the
    // fallbacks have had their say — three empty-looking overrides can still resolve to a real total.
    const resolved = EntityService.resolveRates({ rates, ratesByLane, feePct: entity.feePct }, input.lane);
    if (resolved.totalPct > MAX_PLATFORM_FEE_PCT) {
      throw new GlosError(
        'INVALID_INPUT',
        `Those rates come to ${Math.round(resolved.totalPct * 1000) / 10}%, over the ${MAX_PLATFORM_FEE_PCT * 100}% ceiling. They ADD UP — they do not compound.`,
      );
    }

    entity.rates = rates;
    entity.ratesByLane = ratesByLane;
    this.entities.set(entity.entityId, entity);
    this.record(entity.entityId, {
      at: new Date().toISOString(),
      by: by ?? 'unknown',
      what: 'rates',
      ...(input.lane ? { lane: input.lane } : {}),
      from: pctLine(before),
      to: pctLine(resolved),
    });
    return entity;
  }

  /**
   * The tax this sister charges on one lane of work — zero unless an operator has said otherwise.
   *
   * Same narrow-to-wide walk as the rates, and the same reason: a lane override, then the sister's own
   * rule, then nothing. Unlike a rate stack a tax rule resolves WHOLE rather than field by field, because
   * a rate and the name it is charged under are one statement — half of one jurisdiction's rule and half
   * of another's is not a rule any authority would recognise.
   */
  taxFor(entityId: string, lane?: string): ResolvedTax {
    return EntityService.resolveTax(this.get(entityId), lane);
  }

  /** The resolution itself, over a plain shape — so a CANDIDATE can be checked before anything is stored. */
  static resolveTax(from: Pick<Entity, 'tax' | 'taxByLane' | 'taxRegistration'>, lane?: string): ResolvedTax {
    const rule = (lane ? from.taxByLane?.[lane] : undefined) ?? from.tax;
    const ratePct = Math.round(Math.max(0, Number(rule?.ratePct) || 0) * 10_000) / 10_000;
    return {
      ratePct,
      label: rule?.label?.trim() || DEFAULT_TAX_LABEL,
      // Only ever stated where something is actually being collected. A registration number on a zero-rated
      // receipt is noise on the one hand and, on the other, an implied claim nobody made.
      registration: ratePct > 0 ? from.taxRegistration : undefined,
    };
  }

  /**
   * Set what a sister collects for its tax authority, for a lane or for everything it does.
   *
   * Two guards, and neither is arithmetic.
   *
   * A rate above zero requires a REGISTRATION. Charging tax you are not registered to collect is not a
   * rounding error in somebody's books — it is money taken from a customer in the name of an authority
   * that has never heard of you, and it is the actual offence. So the number and the authority to charge
   * it are set together or not at all.
   *
   * And only a SISTER may charge. The group is not the merchant of record anywhere; letting it hold a
   * rate would imply it collects tax on transactions it is deliberately never a party to.
   */
  setTax(entityId: string, input: { lane?: string; ratePct?: number | null; label?: string | null; registration?: string | null }, by?: string): Entity {
    const entity = this.requireTransacting(entityId);
    const before = EntityService.resolveTax(entity, input.lane);

    // Built as a CANDIDATE and checked before anything is stored — the same discipline as setRates, and
    // for the same reason: validating a record already mutated refuses the change and applies it at once.
    const registration = input.registration === undefined ? entity.taxRegistration : input.registration?.trim() || undefined;

    const apply = (into: TaxRule | undefined): TaxRule | undefined => {
      const next: TaxRule = { ...(into ?? { ratePct: 0 }) };
      if (input.ratePct !== undefined) {
        if (input.ratePct === null) return undefined; // cleared entirely — back to "no rule here"
        if (!Number.isFinite(input.ratePct) || input.ratePct < MIN_TAX_PCT || input.ratePct > MAX_TAX_PCT) {
          throw new GlosError('INVALID_INPUT', `A tax rate must be between ${MIN_TAX_PCT * 100}% and ${MAX_TAX_PCT * 100}% — it is a fraction, so sixteen percent is 0.16`);
        }
        next.ratePct = Math.round(input.ratePct * 10_000) / 10_000;
      }
      if (input.label !== undefined) {
        if (input.label === null) delete next.label;
        else next.label = input.label.trim().slice(0, 16) || undefined;
      }
      return next;
    };

    const tax = input.lane ? entity.tax : apply(entity.tax);
    let taxByLane = entity.taxByLane;
    if (input.lane) {
      const next: Record<string, TaxRule> = { ...(entity.taxByLane ?? {}) };
      const rule = apply(entity.taxByLane?.[input.lane]);
      // A cleared lane leaves no empty shell behind, so `taxByLane` never grows a key that means nothing —
      // and "this lane is not overridden" stays the same state it was before anybody touched it.
      if (rule) next[input.lane] = rule;
      else delete next[input.lane];
      taxByLane = next;
    }

    // Checked across EVERY rule this candidate would hold, not just the one being set — a sister with a
    // standing 16% on one lane must not be able to drop its registration by editing a different lane.
    const holds = [tax, ...Object.values(taxByLane ?? {})].filter((r): r is TaxRule => !!r);
    if (holds.some((r) => r.ratePct > 0) && !registration) {
      throw new GlosError('INVALID_INPUT', `${entity.name} has no tax registration — a rate above zero cannot be charged until it does. Set the registration in the same call.`);
    }

    entity.taxRegistration = registration;
    entity.tax = tax;
    entity.taxByLane = taxByLane;
    this.entities.set(entity.entityId, entity);
    this.record(entity.entityId, {
      at: new Date().toISOString(),
      by: by ?? 'unknown',
      what: 'tax',
      ...(input.lane ? { lane: input.lane } : {}),
      from: taxLine(before),
      to: taxLine(EntityService.resolveTax(entity, input.lane)),
    });
    return entity;
  }

  /**
   * The cover this sister gives on one lane of work — what it carries for free, and what it charges to
   * carry more. Zero and zero unless an operator has said otherwise.
   *
   * Resolved WHOLE like the tax rule rather than field by field: a free limit and the premium above it
   * are one commercial statement, and half of one policy spliced onto half of another is a policy the
   * sister never wrote.
   */
  insuranceFor(entityId: string, lane?: string): ResolvedInsurance {
    return EntityService.resolveInsurance(this.get(entityId), lane);
  }

  /** The resolution itself, over a plain shape — so a CANDIDATE can be checked before anything is stored. */
  static resolveInsurance(from: Pick<Entity, 'insurance' | 'insuranceByLane'>, lane?: string): ResolvedInsurance {
    const rule = (lane ? from.insuranceByLane?.[lane] : undefined) ?? from.insurance;
    const num = (v: unknown) => (Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : 0);
    return {
      premiumPct: Math.round(num(rule?.premiumPct) * 10_000) / 10_000,
      freeLimit: Math.round(num(rule?.freeLimit) * 100) / 100,
    };
  }

  /**
   * Set what a sister covers, for a lane or for everything it does.
   *
   * Bounded on the premium only. There is deliberately NO ceiling on the free limit: that is a sister
   * promising to carry more risk itself, which costs a customer nothing and is nobody's business to
   * refuse here. The premium is bounded because it is a charge, and a mistyped charge reaches somebody's
   * money.
   */
  setInsurance(entityId: string, input: { lane?: string; premiumPct?: number | null; freeLimit?: number | null }, by?: string): Entity {
    const entity = this.requireTransacting(entityId);
    const before = EntityService.resolveInsurance(entity, input.lane);

    const apply = (into: InsuranceRule | undefined): InsuranceRule | undefined => {
      const next: InsuranceRule = { ...(into ?? {}) };
      if (input.premiumPct !== undefined) {
        if (input.premiumPct === null) delete next.premiumPct;
        else {
          if (!Number.isFinite(input.premiumPct) || input.premiumPct < 0 || input.premiumPct > MAX_PREMIUM_PCT) {
            throw new GlosError('INVALID_INPUT', `A premium must be between 0% and ${MAX_PREMIUM_PCT * 100}% — it is a fraction, so two percent is 0.02`);
          }
          next.premiumPct = Math.round(input.premiumPct * 10_000) / 10_000;
        }
      }
      if (input.freeLimit !== undefined) {
        if (input.freeLimit === null) delete next.freeLimit;
        else {
          if (!Number.isFinite(input.freeLimit) || input.freeLimit < 0) throw new GlosError('INVALID_INPUT', 'A free cover limit cannot be negative');
          next.freeLimit = Math.round(input.freeLimit * 100) / 100;
        }
      }
      return Object.keys(next).length ? next : undefined;
    };

    // Built as a CANDIDATE and assigned only once every bound has held — the same discipline as setRates
    // and setTax, and for the same reason: a refused value must not also be an applied one.
    const insurance = input.lane ? entity.insurance : apply(entity.insurance);
    let insuranceByLane = entity.insuranceByLane;
    if (input.lane) {
      const next: Record<string, InsuranceRule> = { ...(entity.insuranceByLane ?? {}) };
      const rule = apply(entity.insuranceByLane?.[input.lane]);
      if (rule) next[input.lane] = rule;
      else delete next[input.lane];
      insuranceByLane = next;
    }

    entity.insurance = insurance;
    entity.insuranceByLane = insuranceByLane;
    this.entities.set(entity.entityId, entity);
    this.record(entity.entityId, {
      at: new Date().toISOString(),
      by: by ?? 'unknown',
      what: 'cover',
      ...(input.lane ? { lane: input.lane } : {}),
      from: coverLine(before, entity.currency),
      to: coverLine(EntityService.resolveInsurance(entity, input.lane), entity.currency),
    });
    return entity;
  }

  /**
   * Set a sister's margin. Only a sister has one — the group earns its licence fee, not a cut of every
   * parcel, and giving it a rate would imply it takes a slice of transactions it is not a party to.
   *
   * Changing the rate does NOT reprice anything already quoted: a parcel carries the rate it was minted
   * at, so a knob turned this morning cannot rewrite what a customer was told yesterday.
   */
  setFeePct(entityId: string, pct: number, by?: string): Entity {
    const entity = this.requireTransacting(entityId);
    if (!Number.isFinite(pct) || pct < MIN_PLATFORM_FEE_PCT || pct > MAX_PLATFORM_FEE_PCT) {
      throw new GlosError('INVALID_INPUT', `A margin must be between ${MIN_PLATFORM_FEE_PCT * 100}% and ${MAX_PLATFORM_FEE_PCT * 100}%`);
    }
    const before = EntityService.resolveRates(entity);
    entity.feePct = Math.round(pct * 10_000) / 10_000; // basis points is as fine as a margin needs to be
    this.entities.set(entity.entityId, entity);
    this.record(entity.entityId, {
      at: new Date().toISOString(),
      by: by ?? 'unknown',
      what: 'fee',
      from: pctLine(before),
      to: pctLine(EntityService.resolveRates(entity)),
    });
    return entity;
  }

  /** Whether this entity may hold a settlement account (step 3's custody question, answered early). */
  /**
   * Where each resolved rate actually CAME from — the same walk as `resolveRates`, reporting the step it
   * stopped at instead of the number it found.
   *
   * Deliberately a second function rather than a richer return from the first. `ResolvedRates` is stamped
   * on parcels and rides on quotes; a provenance label has no business travelling with a price for the
   * rest of that shipment's life. It is a fact about the CONFIGURATION, and it is only interesting to the
   * one screen where somebody is deciding whether to change it.
   *
   * It must stay in step with `resolveRates` — the two are tested against each other rather than by
   * inspection, because a wrong label here is worse than no label: it tells an operator a number is
   * inherited when they in fact own it.
   */
  /* ------------------------------------------- CA3 + CA7: companies created on purpose -- */

  /** Every company of ours and every partner, drafts included — the register of who stands where. Never the money. */
  companies(): Entity[] {
    return this.list().filter((e) => e.kind !== 'group');
  }

  /** Our company in a country, draft or active — for the record screens and the activation, never for money. */
  sisterRecordFor(jurisdiction?: string): Entity | undefined {
    const code = jurisdiction?.trim().toUpperCase();
    return code ? this.list().find((e) => e.kind === 'sister' && e.jurisdiction === code) : undefined;
  }

  /** A partner company in a country — active only, unless drafts are asked for. */
  partnerFor(jurisdiction?: string, opts?: { includeDraft?: boolean }): Entity | undefined {
    const code = jurisdiction?.trim().toUpperCase();
    if (!code) return undefined;
    const found = this.list().filter((e) => e.kind === 'partner' && e.jurisdiction === code);
    return found.find((e) => e.status !== 'draft') ?? (opts?.includeDraft ? found[0] : undefined);
  }

  /**
   * Create a company of ours, or a partner, in a country from the catalogue — as a DRAFT.
   *
   * A draft can do nothing: it is not a party to any transaction, holds no custody and is not found by any money
   * path. It exists so its record and papers can be put together, and it is switched on only when two people
   * approve the country up to it with that record ready.
   */
  createCompany(input: { kind: 'sister' | 'partner'; jurisdiction: string; name: string }, by?: string): Entity {
    const who = by?.trim();
    if (!who) throw new GlosError('FIELD_REQUIRED', 'Say who is creating this company — the register names the person');
    if (input.kind !== 'sister' && input.kind !== 'partner') throw new GlosError('VALIDATION_FAILED', 'A company is either ours (sister) or a partner');
    const country = catalogueEntry(input.jurisdiction);
    if (!country) throw new GlosError('INVALID_INPUT', `${(input.jurisdiction ?? '').toUpperCase()} is not a country in the catalogue`);
    const name = input.name?.trim();
    if (!name) throw new GlosError('FIELD_REQUIRED', 'Give the company its name');
    const existing = input.kind === 'sister' ? this.sisterRecordFor(country.code) : undefined;
    if (existing) throw new GlosError('CONFLICT', `${country.name} already has a company of ours: ${existing.name}`);

    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'partner';
    const base = input.kind === 'sister' ? `sbg-${country.code.toLowerCase()}` : `partner-${country.code.toLowerCase()}-${slug}`;
    let entityId = base;
    for (let n = 2; this.entities.has(entityId); n += 1) entityId = `${base}-${n}`;
    const now = new Date().toISOString();
    const entity: Entity = {
      entityId,
      name,
      kind: input.kind,
      jurisdiction: country.code,
      currency: country.currency,
      status: 'draft',
      record: emptyRecord(),
      did: this.dids.generate(`entity:${entityId}`, { role: 'entity', kind: input.kind, jurisdiction: country.code }).id,
      ...(input.kind === 'sister' ? { parentEntityId: GROUP_SEED.entityId } : {}),
      createdAt: now,
    };
    this.entities.set(entityId, entity);
    this.record(entityId, { at: now, by: who, what: 'created', from: '—', to: `${input.kind === 'sister' ? 'company of ours' : 'partner'} in ${country.name}, draft` });
    return entity;
  }

  /** A company's legal record, with every list present (an older record may predate a section). */
  recordOf(entityId: string): CompanyRecord {
    return { ...emptyRecord(), ...(this.get(entityId).record ?? {}) };
  }

  /** Save sections of a company's record. Each section sent replaces the one on record, the way a form is saved. */
  updateRecord(entityId: string, patch: Record<string, unknown>, by?: string): Entity {
    const entity = this.get(entityId);
    if (entity.kind === 'group') throw new GlosError('FORBIDDEN', 'The group keeps no operating record here — it is a party to nothing');
    const who = by?.trim();
    if (!who) throw new GlosError('FIELD_REQUIRED', 'Say who is changing this record');
    const clean = normaliseRecordPatch(patch ?? {}, { jurisdiction: entity.jurisdiction ?? '' });
    const sections = Object.keys(clean);
    if (!sections.length) throw new GlosError('VALIDATION_FAILED', 'Nothing to change');
    entity.record = { ...this.recordOf(entityId), ...clean };
    this.entities.set(entityId, entity);
    this.record(entityId, { at: new Date().toISOString(), by: who, what: 'record', from: '—', to: sections.join(', ') });
    return entity;
  }

  /** Switch a draft company on. Called only once two people have approved the country up to it (see the controller). */
  activate(entityId: string, by?: string): Entity {
    const entity = this.get(entityId);
    if (entity.kind === 'group') throw new GlosError('FORBIDDEN', 'The group is not switched on or off');
    if (entity.status !== 'draft') return entity;
    entity.status = 'active';
    this.entities.set(entityId, entity);
    this.record(entityId, { at: new Date().toISOString(), by: by?.trim() || 'unknown', what: 'activated', from: 'draft', to: 'active' });
    return entity;
  }

  /** CA5 — what lapsed licences and policies of the active companies in a country switch off there. */
  lapsesFor(jurisdiction?: string, now = Date.now()): CapabilityLapse[] {
    const code = jurisdiction?.trim().toUpperCase();
    if (!code) return [];
    return this.companies()
      .filter((e) => e.jurisdiction === code && e.status !== 'draft')
      .flatMap((e) => lapsesOf(e.entityId, e.record, now));
  }

  /** CA5 — every licence and policy lapsing within the window (or already lapsed), soonest first — the reminder list. */
  expiring(
    now = Date.now(),
    withinDays = 60,
  ): Array<{ entityId: string; name: string; jurisdiction?: string; source: 'licence' | 'insurance'; kind: string; reference: string; expiresAt: string; supports: string[]; lapsed: boolean; daysLeft: number }> {
    const DAY = 86_400_000;
    const horizon = now + withinDays * DAY;
    return this.companies()
      .flatMap((e) =>
        datedItemsOf(e.record)
          .filter((item) => lapsesAt(item.expiresAt) <= horizon)
          .map((item) => ({
            entityId: e.entityId,
            name: e.name,
            jurisdiction: e.jurisdiction,
            ...item,
            lapsed: lapsesAt(item.expiresAt) <= now,
            daysLeft: Math.ceil((lapsesAt(item.expiresAt) - now) / DAY) - 1,
          })),
      )
      .sort((a, b) => a.expiresAt.localeCompare(b.expiresAt));
  }

  /* ------------------------------------------------------------------ who may -- */

  /**
   * MAY THIS ADMINISTRATOR ACT ON THIS COMPANY? Reach follows the company structure and nothing else.
   *
   * You reach the entity your token names, and any entity that names it as PARENT. So a sister's admin
   * reaches its own company; the group's admin reaches the group and every sister under it. That is not
   * a permission list somebody has to maintain in step with the org chart — it IS the org chart, asked a
   * question, which is why a sister added tomorrow is administrable by the group the moment it exists.
   *
   * The group reaching its sisters does not touch the isolation rule the money model rests on: setting a
   * rate is a management act, never a transaction, and the group still cannot be a party to one.
   */
  mayAdminister(adminEntityId: string | undefined, targetEntityId: string): boolean {
    if (!adminEntityId) return false;
    if (adminEntityId === targetEntityId) return true;
    return this.find(targetEntityId)?.parentEntityId === adminEntityId;
  }

  /** Every company this administrator reaches — its own first, then the ones it is the parent of. */
  administrable(adminEntityId: string | undefined): Entity[] {
    if (!adminEntityId) return [];
    return this.list().filter((e) => this.mayAdminister(adminEntityId, e.entityId));
  }

  /* --------------------------------------------------------------- the record -- */

  /**
   * What was changed, by whom, and what it was before.
   *
   * Kept because the whole reason a company has administrators of its own is that a commercial decision
   * has a person behind it — and that is only true if the decision is recorded with the person on it.
   * Otherwise this slice has merely widened who may change a price.
   */
  changes(entityId: string, limit = 20): EntityChange[] {
    return [...(this.changeLog.get(entityId) ?? [])].reverse().slice(0, limit);
  }

  private record(entityId: string, change: EntityChange): void {
    const kept = [...(this.changeLog.get(entityId) ?? []), change];
    // A bounded history: the last 200 changes to one company's terms is years of them, and this file is
    // not an audit warehouse. If it ever needs to be, that is a decision to make on purpose.
    this.changeLog.set(entityId, kept.slice(-200));
  }

  static rateOrigins(from: Pick<Entity, 'rates' | 'ratesByLane' | 'feePct'>, lane?: string): RateOrigins {
    const forLane = lane ? from.ratesByLane?.[lane] : undefined;
    const originOf = (of: (s: RateStack) => number | undefined, isMargin = false): RateOrigin => {
      if (forLane && of(forLane) != null) return 'lane';
      if (from.rates && of(from.rates) != null) return 'sister';
      // Margin alone falls through the pre-layers knob, which is exactly what that number always meant.
      if (isMargin && from.feePct != null) return 'legacy-fee';
      return 'network';
    };
    return {
      costOfRiskPct: originOf((r) => r.costOfRiskPct),
      profitOnRiskPct: originOf((r) => r.profitOnRiskPct),
      marginPct: originOf((r) => r.marginPct, true),
    };
  }

  /** Where a tax rule came from. Whole, like the rule itself — `none` means nobody has ever set one. */
  static taxOrigin(from: Pick<Entity, 'tax' | 'taxByLane'>, lane?: string): RuleOrigin {
    if (lane && from.taxByLane?.[lane]) return 'lane';
    return from.tax ? 'sister' : 'none';
  }

  /** Where a cover rule came from. Same shape, same reason. */
  static insuranceOrigin(from: Pick<Entity, 'insurance' | 'insuranceByLane'>, lane?: string): RuleOrigin {
    if (lane && from.insuranceByLane?.[lane]) return 'lane';
    return from.insurance ? 'sister' : 'none';
  }

  /**
   * Everything one sister charges, on every lane, with the provenance of each answer and the bounds the
   * service will hold the next edit to.
   *
   * The LANES ARE THE CALLER'S — this file has always refused to learn what a parcel is, and a read model
   * is not a reason to start. The pudo module knows its own taxonomy and passes it in; the books only ever
   * hold numbers against keys.
   *
   * Includes the group, which cannot transact and therefore cannot be edited. Omitting it would be the
   * easier answer and the wrong one: an operator looking for the group's rates should find it and be told
   * why it has none, rather than wonder whether the screen is broken.
   */
  pricingFor(entityId: string, lanes: string[], opts?: { editable?: boolean }): EntityPricing {
    const entity = this.get(entityId);
    const rowFor = (lane?: string): LanePricing => ({
      ...(lane ? { lane } : {}),
      rates: EntityService.resolveRates(entity, lane),
      rateOrigin: EntityService.rateOrigins(entity, lane),
      tax: EntityService.resolveTax(entity, lane),
      taxOrigin: EntityService.taxOrigin(entity, lane),
      insurance: EntityService.resolveInsurance(entity, lane),
      insuranceOrigin: EntityService.insuranceOrigin(entity, lane),
    });

    return {
      entityId: entity.entityId,
      name: entity.name,
      kind: entity.kind,
      jurisdiction: entity.jurisdiction,
      currency: entity.currency,
      transacting: canTransact(entity),
      taxRegistration: entity.taxRegistration,
      // The default first: every lane row below is read against it, and a table whose fallback row is
      // buried in the middle makes "inherited from where?" a question you have to hunt for.
      lanes: [rowFor(), ...lanes.map((l) => rowFor(l))],
      recentChanges: this.changes(entity.entityId, 8),
      // A screen that renders controls it cannot use is a screen that lies about what you may do. The
      // caller's reach is decided by the guard; this only reports it, so the UI never has to guess.
      editable: (opts?.editable ?? false) && canTransact(entity),
      bounds: {
        minRatePct: MIN_PLATFORM_FEE_PCT,
        maxRatePct: MAX_PLATFORM_FEE_PCT,
        minTaxPct: MIN_TAX_PCT,
        maxTaxPct: MAX_TAX_PCT,
        maxPremiumPct: MAX_PREMIUM_PCT,
      },
    };
  }

  canHoldCustody(entityId: string): boolean {
    return canHoldCustody(this.get(entityId));
  }
}

/* ---------------------------------------------------------------- the record -- */

/**
 * A change, as one readable line. The audit trail is read by people asking "what did this used to be",
 * and two objects side by side do not answer that as well as one sentence does.
 */
function pct(n: number): string {
  return `${(n * 100).toFixed(2)}%`;
}

function pctLine(r: { costOfRiskPct: number; profitOnRiskPct: number; marginPct: number; totalPct: number }): string {
  return `${pct(r.totalPct)} (risk ${pct(r.costOfRiskPct)} + return ${pct(r.profitOnRiskPct)} + margin ${pct(r.marginPct)})`;
}

function taxLine(t: { ratePct: number; label: string }): string {
  return t.ratePct ? `${pct(t.ratePct)} ${t.label}` : 'none';
}

function coverLine(i: { premiumPct: number; freeLimit: number }, currency?: string): string {
  const free = i.freeLimit ? `${i.freeLimit} ${currency ?? ''}`.trim() : 'nothing';
  return `${free} free, premium ${pct(i.premiumPct)}`;
}
