import { Injectable } from '@nestjs/common';
import { GlosError } from '../../foundation/http/glos-error';
import { randomBytes } from 'crypto';
import { OperationalStore } from '../../foundation/data-firewall/operational-store.service';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { AgentService } from './agent.service';
import { ParcelService } from './parcel.service';

export interface RatingRecord {
  id: string;
  parcelId: string;
  agentDid: string;
  stars: number; // 1–5
  raterMobile: string;
  at: string;
}

/**
 * RatingService (P-008, ↔ M5 TRL light + graduation). PUDO Light reputation is a single 0–5 star
 * rating per delivered parcel plus an agent-retention metric — no Bayesian prior, no portable VC.
 * Crucially it writes the agent's running composite back to the **shared OperationalStore**, the same
 * pseudonymous core M5/M3 read, so the rating data graduates onto GLOS-grade reputation with no
 * schema migration (Compendium Ch 8 mapping).
 */
@Injectable()
export class RatingService {
  private readonly ratings: RatingRecord[] = [];
  private readonly tally = new Map<string, { sum: number; count: number }>(); // agentDid → stars

  constructor(
    private readonly parcels: ParcelService,
    private readonly agents: AgentService,
    private readonly core: OperationalStore,
    private readonly events: EventBus,
  ) {}

  /** Rate a delivered parcel (1–5 stars). Updates the agent composite + writes it to the core. */
  rate(input: { parcelId: string; stars: number; raterMobile: string }): { rating: RatingRecord; agentComposite: number } {
    const parcel = this.parcels.get(input.parcelId);
    if (parcel.status !== 'Delivered') throw new GlosError('INVALID_STATE', 'Only a delivered parcel can be rated');
    if (!(input.stars >= 1 && input.stars <= 5)) throw new GlosError('INVALID_RATING', 'Stars must be 1–5');

    const agentDid = parcel.originAgentDid;
    const record: RatingRecord = { id: `rat_${randomBytes(6).toString('hex')}`, parcelId: input.parcelId, agentDid, stars: input.stars, raterMobile: input.raterMobile, at: new Date().toISOString() };
    this.ratings.push(record);

    const t = this.tally.get(agentDid) ?? { sum: 0, count: 0 };
    t.sum += input.stars;
    t.count += 1;
    this.tally.set(agentDid, t);
    const composite = Math.round((t.sum / t.count) * 100) / 100;

    // Graduation: write the composite to the shared operational core (what M3/M5 match on).
    this.core.updateReputation(agentDid, composite);
    void this.events.publish(GlosEvent.Reputation.RatingSubmitted, { subjectDid: agentDid, parcelId: input.parcelId, stars: input.stars }, { source: 'pudo' }).catch(() => undefined);
    void this.events.publish(GlosEvent.Reputation.ScoreUpdated, { subjectDid: agentDid, composite }, { source: 'pudo' }).catch(() => undefined);
    return { rating: record, agentComposite: composite };
  }

  agentRating(agentDid: string): { agentDid: string; stars: number; count: number } {
    const t = this.tally.get(agentDid) ?? { sum: 0, count: 0 };
    return { agentDid, stars: t.count ? Math.round((t.sum / t.count) * 100) / 100 : 0, count: t.count };
  }

  /** Network agent-retention metric: share of onboarded agents still ACTIVE (steel-thread KPI). */
  retention(): { activeShare: number; active: number; total: number } {
    const all = this.agents.list();
    const active = all.filter((a) => a.status === 'ACTIVE').length;
    return { activeShare: all.length ? Math.round((active / all.length) * 100) / 100 : 0, active, total: all.length };
  }

  list(): RatingRecord[] {
    return [...this.ratings].reverse();
  }
}
