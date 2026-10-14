import { StaffOnlyOutsideSandbox } from '../../foundation/auth/engine-surface';
import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { MatchingService } from './matching.service';
import { AvailabilityService } from './availability.service';
import { BatchMatchingService } from './batch-matching.service';
import { PredictionService } from './prediction.service';
import { FairnessService } from './fairness.service';
import { BatchDto, BlockDto, BroadcastDto, DemandDto, ForceAssignDto } from './matching.dto';
import { DemandInput } from './matching.types';

interface ModuleInfo {
  module: string;
  name: string;
  epic: string;
  status: 'active';
}

/** M3 matching endpoints. DID-authenticated (global guard; no @Public). */
@StaffOnlyOutsideSandbox()
@Controller('matching')
export class M3Controller {
  constructor(
    private readonly matching: MatchingService,
    private readonly availability: AvailabilityService,
    private readonly batch: BatchMatchingService,
    private readonly prediction: PredictionService,
    private readonly fairness: FairnessService,
  ) {}

  @Get('module-info')
  info(): ModuleInfo {
    return {
      module: 'M3',
      name: 'Dynamic Matchmaking & Pricing Engine (DME)',
      epic: '02_epic_domains/epic_m3_matching_pricing.md',
      status: 'active',
    };
  }

  /** Carrier availability heartbeat (M3-020). Each beat also feeds the availability forecaster. */
  @Post('availability')
  broadcast(@Body() dto: BroadcastDto) {
    const entry = this.availability.broadcast(dto);
    this.prediction.observe();
    return entry;
  }

  /** Side-effect-free quote: ranked eligible carriers + price + explanation (M3-030/060). */
  @Post('quote')
  quote(@Body() dto: DemandDto) {
    return this.matching.quote(dto as unknown as DemandInput);
  }

  /** Submit demand → match (M3-010/021/030/040). */
  @Post('demands')
  match(@Body() dto: DemandDto) {
    return this.matching.match(dto as unknown as DemandInput);
  }

  /** Context-aware batch matching: solve many demands jointly (M3-031). */
  @Post('batch')
  batchMatch(@Body() dto: BatchDto) {
    return this.batch.solve(dto.demands as unknown as DemandInput[], dto.window);
  }

  /** Predicted capacity for a zone (M3-022). */
  @Get('forecast/:zone')
  forecast(@Param('zone') zone: string) {
    return this.prediction.forecast(zone);
  }

  /** Pre-book against predicted availability at an indicative price (M3-022/042). */
  @Post('prebook')
  prebook(@Body() dto: DemandDto) {
    return this.prediction.preBook(dto as unknown as DemandInput);
  }

  /** Algorithmic-fairness / offer-distribution dashboard (M3-035/061). */
  @Get('fairness')
  fairnessReport() {
    return this.fairness.report();
  }

  @Post('matches/:id/accept')
  accept(@Param('id') id: string) {
    return this.matching.accept(id);
  }

  @Post('matches/:id/reject')
  reject(@Param('id') id: string) {
    return this.matching.reject(id);
  }

  /** Override: force-assign a carrier (M3-062). Reason mandatory; flagged for review. */
  @Post('matches/:id/force-assign')
  forceAssign(@Param('id') id: string, @Body() dto: ForceAssignDto) {
    return this.matching.forceAssign(id, dto.carrierDid, dto.reason, dto.by);
  }

  /** Override: block a match (M3-062). Reason mandatory; flagged for review. */
  @Post('matches/:id/block')
  block(@Param('id') id: string, @Body() dto: BlockDto) {
    return this.matching.block(id, dto.reason, dto.by);
  }

  /** Full match incl. audit trail (M3-054). */
  @Get('matches/:id')
  get(@Param('id') id: string) {
    return this.matching.get(id);
  }
}
