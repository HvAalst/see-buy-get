import { Injectable } from '@nestjs/common';
import { CredentialService } from '../../foundation/credentials/credential.service';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { BADGE_THRESHOLDS, ReputationRecord } from './reputation.types';

/**
 * BadgeService (M5-030/031/032/033). Auto-issues tamper-proof W3C VC trust badges when a
 * dimension crosses its threshold, revokes them via the M1 registry when it drops, supports
 * selective disclosure, and exports a portable reputation credential.
 */
@Injectable()
export class BadgeService {
  constructor(
    private readonly credentials: CredentialService,
    private readonly events: EventBus,
  ) {}

  /** Issue newly-earned badges, revoke ones no longer met (M5-030/031). */
  evaluate(record: ReputationRecord): void {
    for (const threshold of BADGE_THRESHOLDS) {
      const dim = record.dimensions[threshold.dimension];
      const qualifies = Boolean(dim && dim.value >= threshold.min && dim.samples >= threshold.minSamples);
      const held = record.badges.find((b) => b.name === threshold.name);

      if (qualifies && !held) {
        const vc = this.credentials.issue({ subject: record.did, type: ['TrustBadge', threshold.name], claims: { dimension: threshold.dimension, threshold: threshold.min } });
        record.badges.push({ name: threshold.name, vcId: vc.id });
        void this.events.publish(GlosEvent.Reputation.BadgeIssued, { did: record.did, badge: threshold.name, vcId: vc.id }, { source: 'm5' }).catch(() => undefined);
      } else if (!qualifies && held) {
        this.credentials.revoke(held.vcId); // M5-031
        record.badges = record.badges.filter((b) => b.name !== threshold.name);
      }
    }
  }

  /** Selective disclosure (M5-032): prove a badge without revealing the underlying score. */
  disclose(record: ReputationRecord, badgeName: string): { badge: string; proof: string } | null {
    const held = record.badges.find((b) => b.name === badgeName);
    if (!held) return null;
    return { badge: badgeName, proof: `zk:${held.vcId}` }; // ZK-proof stub
  }

  /** Portable reputation export as a signed VC (M5-033). */
  export(record: ReputationRecord): { vcId: string } {
    const vc = this.credentials.issue({
      subject: record.did,
      type: 'ReputationExport',
      claims: { composite: record.composite, samples: record.samples, badges: record.badges.map((b) => b.name) },
    });
    return { vcId: vc.id };
  }
}
