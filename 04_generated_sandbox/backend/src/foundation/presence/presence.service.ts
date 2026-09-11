import { Injectable } from '@nestjs/common';
import { GlosError } from '../http/glos-error';
import { PersistentMap } from '../store/persistent-map';
import { EntityService } from '../entity/entity.service';
import { canTransact } from '../entity/entity.types';
import {
  LEVEL_DEFAULTS,
  PRESENCE_CAPABILITIES,
  type Presence,
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
export class PresenceService {
  private readonly presences = new PersistentMap<string, Presence>('presence');

  constructor(private readonly entities: EntityService) {}

  /**
   * What this country permits right now.
   *
   * AN UNKNOWN JURISDICTION IS `observed`, never the home sister's capabilities and never a default
   * that happens to be generous. A country nobody recorded is a country we are not in — and inheriting
   * a neighbour's permissions is the precise failure this whole design exists to prevent.
   */
  resolve(jurisdiction?: string): ResolvedPresence {
    const key = normalise(jurisdiction);
    const record = key ? this.presences.get(key) : undefined;
    const hasEntity = key ? this.hasTransactingEntity(key) : false;
    const level = record?.level ?? (hasEntity ? 'established' : 'observed');
    return {
      jurisdiction: key || '',
      level,
      capabilities: capabilitiesOf(level, record?.overrides),
      hasEntity,
      recorded: Boolean(record),
      note: record?.note,
      setBy: record?.setBy,
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

  /** Every country on record, plus every one that has a sister — the operator's whole map. */
  list(): ResolvedPresence[] {
    const keys = new Set<string>([...this.presences.keys()]);
    for (const entity of this.entities.list()) {
      const key = normalise(entity.jurisdiction);
      if (key && canTransact(entity)) keys.add(key);
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
  }): ResolvedPresence {
    const key = normalise(input.jurisdiction);
    if (!key) throw new GlosError('INVALID_INPUT', 'A presence needs the country it is about');
    if (input.level === 'established' && !this.hasTransactingEntity(key)) {
      throw new GlosError(
        'INVALID_STATE',
        `${key} cannot be established: no daughter company transacts there. Register the company first — this flag does not create one.`,
      );
    }
    // An override for a capability that does not exist is a silent no-op, and a silent no-op on a
    // permission is how somebody believes they granted something they did not.
    for (const name of Object.keys(input.overrides ?? {})) {
      if (!PRESENCE_CAPABILITIES.includes(name as PresenceCapability)) {
        throw new GlosError('INVALID_INPUT', `Unknown capability: ${name}`);
      }
    }
    this.presences.set(key, {
      jurisdiction: key,
      level: input.level,
      ...(input.overrides && Object.keys(input.overrides).length ? { overrides: input.overrides } : {}),
      ...(input.note?.trim() ? { note: input.note.trim() } : {}),
      ...(input.by?.trim() ? { setBy: input.by.trim() } : {}),
      setAt: new Date().toISOString(),
    });
    return this.resolve(key);
  }

  private hasTransactingEntity(jurisdiction: string): boolean {
    const entity = this.entities.forJurisdiction(jurisdiction);
    return Boolean(entity && canTransact(entity));
  }
}

/** Level defaults with the deliberate exceptions laid over them. */
export function capabilitiesOf(level: PresenceLevel, overrides?: Partial<Record<PresenceCapability, boolean>>): PresenceCapabilities {
  return { ...LEVEL_DEFAULTS[level], ...(overrides ?? {}) };
}

/** Country codes are compared, so they are stored one way. 'ke' and 'KE' are not two countries. */
function normalise(jurisdiction?: string): string {
  return (jurisdiction ?? '').trim().toUpperCase();
}
