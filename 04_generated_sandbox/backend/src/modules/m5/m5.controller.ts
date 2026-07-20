import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { RatingService, SubmitRatingInput } from './rating.service';
import { ReputationStore } from './reputation-store.service';
import { BadgeService } from './badge.service';
import { ChallengeDto, DisputeDto, ExportDto, SubmitRatingDto } from './m5.dto';

interface ModuleInfo {
  module: string;
  name: string;
  epic: string;
  status: 'active';
}

/** M5 reputation endpoints. DID-authenticated (global guard; no @Public). */
@Controller('reputation')
export class M5Controller {
  constructor(
    private readonly ratings: RatingService,
    private readonly store: ReputationStore,
    private readonly badges: BadgeService,
  ) {}

  @Get('module-info')
  info(): ModuleInfo {
    return {
      module: 'M5',
      name: 'Trust & Reputation Layer (TRL)',
      epic: '02_epic_domains/epic_m5_trust_reputation.md',
      status: 'active',
    };
  }

  /** Operator network-health dashboard (M5-044). Declared before :did. */
  @Get('network-health')
  networkHealth() {
    return this.store.networkHealth();
  }

  /** Submit a structured, verification-anchored rating (M5-020/021). */
  @Post('ratings')
  submit(@Body() dto: SubmitRatingDto) {
    return this.ratings.submit(dto as unknown as SubmitRatingInput);
  }

  /** Ops/SSE dispute outcome → reputation adjustment (M5-050/051). */
  @Post(':did/dispute')
  dispute(@Param('did') did: string, @Body() dto: DisputeDto) {
    this.store.applyDispute(did, dto.tag, dto.atFault, dto.note);
    return this.store.view(did);
  }

  /** Public reputation view — scores, badges, dispute summary; no raw reviews/PII (M5-063). */
  @Get(':did')
  view(@Param('did') did: string) {
    return this.store.view(did);
  }

  /** Personal dashboard with history + explainability (M5-060/061). */
  @Get(':did/dashboard')
  dashboard(@Param('did') did: string) {
    return this.store.dashboard(did);
  }

  /** Right to challenge a rating (M5-062). */
  @Post(':did/challenge')
  challenge(@Param('did') did: string, @Body() dto: ChallengeDto) {
    return this.store.challenge(did, dto.ratingId);
  }

  /** Portable reputation export as a signed VC (M5-033). */
  @Post(':did/export')
  export(@Param('did') did: string, @Body() dto: ExportDto) {
    return this.badges.export(this.store.getOrCreate(did, dto.role));
  }
}
