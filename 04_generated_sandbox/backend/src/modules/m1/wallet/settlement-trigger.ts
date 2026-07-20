import { BadRequestException } from '@nestjs/common';
import { SettlementTrigger } from './wallet.types';

// Validation for the three settlement-trigger types (UDIW-043).

export function validateSettlementTrigger(trigger: SettlementTrigger): SettlementTrigger {
  switch (trigger?.type) {
    case 'instant':
      return trigger;
    case 'time_locked': {
      if (!Array.isArray(trigger.stages) || trigger.stages.length === 0) {
        throw new BadRequestException('time_locked trigger requires at least one stage');
      }
      const total = trigger.stages.reduce((sum, s) => sum + s.percent, 0);
      if (Math.round(total) !== 100) {
        throw new BadRequestException(`time_locked stages must sum to 100% (got ${total})`);
      }
      if (trigger.stages.some((s) => s.percent <= 0 || !s.milestone)) {
        throw new BadRequestException('each stage needs a milestone and a positive percent');
      }
      return trigger;
    }
    case 'condition_locked':
      if (!trigger.condition || !trigger.condition.kind) {
        throw new BadRequestException('condition_locked trigger requires a condition.kind');
      }
      return trigger;
    default:
      throw new BadRequestException('Unknown settlement trigger type');
  }
}
