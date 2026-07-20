import { Injectable, OnModuleInit } from '@nestjs/common';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { DisruptionService } from './disruption.service';
import { PartnerFeedSource } from './sources/partner-feed.source';
import { ProcessedSignal, RawSignal, SignalSource } from './signal.types';
import { Disruption } from './twin.types';

/**
 * SignalIngestService (M7-021, feed layer). The real-signal entry point into the control tower:
 * external feeds either **push** advisories (`submit`, e.g. a partner webhook) or are **polled**
 * (`pollAll`) through registered `SignalSource` connectors. Each raw signal is deduped by upstream
 * id, classified, and turned into a Disruption — which fires the autonomous response loop downstream.
 */
@Injectable()
export class SignalIngestService implements OnModuleInit {
  private readonly sources = new Map<string, SignalSource>();
  private readonly seen = new Set<string>();
  private readonly processed: ProcessedSignal[] = [];

  constructor(
    private readonly disruption: DisruptionService,
    private readonly events: EventBus,
  ) {}

  onModuleInit(): void {
    this.registerSource(new PartnerFeedSource());
  }

  registerSource(source: SignalSource): void {
    this.sources.set(source.id, source);
  }

  listSources(): string[] {
    return [...this.sources.keys()];
  }

  recent(limit = 20): ProcessedSignal[] {
    return this.processed.slice(-limit).reverse();
  }

  /** Push path: ingest a single externally-supplied advisory (webhook). Null if already seen. */
  submit(raw: RawSignal): Disruption | null {
    const key = `${raw.source}:${raw.externalId ?? raw.headline}`;
    if (this.seen.has(key)) return null;
    this.seen.add(key);

    void this.events.publish(GlosEvent.Orchestration.SignalReceived, { ...raw }, { source: 'm7' }).catch(() => undefined);
    const disruption = this.disruption.ingest({
      type: raw.type,
      zone: raw.zone,
      center: raw.center,
      radiusKm: raw.radiusKm,
      severity: raw.severity,
      keywords: [raw.headline].filter(Boolean),
    });
    this.processed.push({ source: raw.source, zone: raw.zone, headline: raw.headline, type: disruption.type, disruptionId: disruption.id, at: new Date().toISOString() });
    return disruption;
  }

  /** Poll path: fetch current advisories from every registered connector; new ones are ingested. */
  async pollAll(): Promise<Disruption[]> {
    const created: Disruption[] = [];
    for (const source of this.sources.values()) {
      const raws = await source.poll();
      for (const raw of raws) {
        const disruption = this.submit({ ...raw, source: source.id });
        if (disruption) created.push(disruption);
      }
    }
    return created;
  }
}
