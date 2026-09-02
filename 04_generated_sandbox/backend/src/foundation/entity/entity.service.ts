import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { GlosError } from '../http/glos-error';
import { PersistentMap } from '../store/persistent-map';
import { DidService } from '../did/did.service';
import { currencyForJurisdiction } from '../money/currency';
import { MAX_PLATFORM_FEE_PCT, MIN_PLATFORM_FEE_PCT, PLATFORM_FEE_PCT } from '../../modules/pudo/pudo.config';
import { Entity, RateStack, ResolvedRates, canHoldCustody, canTransact } from './entity.types';

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
    return this.list().filter((e) => e.kind === 'sister');
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
      throw new GlosError('FORBIDDEN', `${entity.name} is a holding company: it cannot be a party to a transaction`);
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
  setRates(entityId: string, input: { lane?: string; costOfRiskPct?: number | null; profitOnRiskPct?: number | null; marginPct?: number | null }): Entity {
    const entity = this.requireTransacting(entityId);
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
    return entity;
  }

  /**
   * Set a sister's margin. Only a sister has one — the group earns its licence fee, not a cut of every
   * parcel, and giving it a rate would imply it takes a slice of transactions it is not a party to.
   *
   * Changing the rate does NOT reprice anything already quoted: a parcel carries the rate it was minted
   * at, so a knob turned this morning cannot rewrite what a customer was told yesterday.
   */
  setFeePct(entityId: string, pct: number): Entity {
    const entity = this.requireTransacting(entityId);
    if (!Number.isFinite(pct) || pct < MIN_PLATFORM_FEE_PCT || pct > MAX_PLATFORM_FEE_PCT) {
      throw new GlosError('INVALID_INPUT', `A margin must be between ${MIN_PLATFORM_FEE_PCT * 100}% and ${MAX_PLATFORM_FEE_PCT * 100}%`);
    }
    entity.feePct = Math.round(pct * 10_000) / 10_000; // basis points is as fine as a margin needs to be
    this.entities.set(entity.entityId, entity);
    return entity;
  }

  /** Whether this entity may hold a settlement account (step 3's custody question, answered early). */
  canHoldCustody(entityId: string): boolean {
    return canHoldCustody(this.get(entityId));
  }
}
