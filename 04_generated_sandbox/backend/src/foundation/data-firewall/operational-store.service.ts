import { Injectable } from '@nestjs/common';
import { assertNoPii } from './pii-policy';
import { OperationalProfile } from './data-firewall.types';

/**
 * OperationalStore — the pseudonymous side of the data firewall (T-003, §3.4).
 * Stores ONLY operational profiles (DIDs, capabilities, reputation, vault references).
 * Every write is run through assertNoPii, so a profile carrying any PII-like field is
 * rejected at the boundary — the separation is enforced, not just documented. There is
 * deliberately no method that returns PII; that lives behind IdentityVault.reveal().
 */
@Injectable()
export class OperationalStore {
  private readonly profiles = new Map<string, OperationalProfile>();

  /** Insert/update an operational profile. Throws DataFirewallViolation if PII is present. */
  upsert(profile: OperationalProfile): OperationalProfile {
    assertNoPii(profile);
    const stored: OperationalProfile = { ...profile };
    this.profiles.set(profile.did, stored);
    return stored;
  }

  get(did: string): OperationalProfile | undefined {
    return this.profiles.get(did);
  }

  /** Update the pseudonymous reputation score (written by M5, read by M3). No-op if absent. */
  updateReputation(did: string, reputationScore: number): boolean {
    const profile = this.profiles.get(did);
    if (!profile) return false;
    profile.reputationScore = reputationScore;
    return true;
  }

  /** Pseudonymous query used by matching: find by capability, never by identity. */
  findByCapability(capability: string): OperationalProfile[] {
    return Array.from(this.profiles.values()).filter((p) => p.capabilities.includes(capability));
  }

  all(): OperationalProfile[] {
    return Array.from(this.profiles.values());
  }
}
