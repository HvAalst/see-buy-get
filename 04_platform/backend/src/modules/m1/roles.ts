import { Tier } from '../../foundation/data-firewall/data-firewall.types';
import { ParticipantRole } from './participant.types';

// Tier capability model (UDIW-011). Tiers are cumulative: a higher tier unlocks everything
// below it plus its own. Roles activate when the account reaches their minimum tier.

export const ROLE_MIN_TIER: Record<ParticipantRole, Tier> = {
  [ParticipantRole.Shipper]: 1, // ship small parcels at T1
  [ParticipantRole.Carrier]: 2, // last-mile delivery needs verified individual
  [ParticipantRole.WarehouseOperator]: 3, // business verification
  [ParticipantRole.CustomsBroker]: 3,
};

/** Capabilities unlocked AT each tier (not cumulative on their own — see capabilitiesForTier). */
const TIER_CAPABILITIES: Record<Tier, string[]> = {
  1: ['track-shipments', 'ship-small-parcel'],
  2: ['last-mile-delivery'],
  3: ['freight-forwarding', 'api-access'],
  4: ['dg-handling', 'certified-operations'],
};

/** Cumulative capabilities for a tier (T3 includes T1+T2+T3). */
export function capabilitiesForTier(tier: Tier): string[] {
  const result: string[] = [];
  for (let t = 1 as Tier; t <= tier; t = (t + 1) as Tier) {
    result.push(...TIER_CAPABILITIES[t]);
  }
  return result;
}

export function roleStatusForTier(role: ParticipantRole, tier: Tier): 'pending' | 'active' {
  return tier >= ROLE_MIN_TIER[role] ? 'active' : 'pending';
}
