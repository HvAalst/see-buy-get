import { Injectable, OnModuleInit } from '@nestjs/common';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { ReputationStore } from './reputation-store.service';
import { DisputeTag } from './reputation.types';

/**
 * DisputeAdjustmentService (M5-050). Subscribes to SSE `settlement.dispute_resolved` and feeds
 * the outcome into reputation by the correct dimension (M5-051). SSE's dispute filing lands in a
 * later SSE sprint; this listener is ready for it now, and an ops endpoint can drive it meanwhile.
 */
@Injectable()
export class DisputeAdjustmentService implements OnModuleInit {
  constructor(
    private readonly events: EventBus,
    private readonly store: ReputationStore,
  ) {}

  onModuleInit(): void {
    this.events.subscribe<{ subjectDid: string; tag: DisputeTag; atFault: boolean; note?: string }>(
      GlosEvent.Settlement.DisputeResolved,
      (e) => {
        const { subjectDid, tag, atFault, note } = e.payload;
        if (subjectDid && tag) this.store.applyDispute(subjectDid, tag, atFault, note);
      },
    );
  }
}
