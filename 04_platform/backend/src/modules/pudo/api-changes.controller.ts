import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Public } from '../../foundation/auth/public.decorator';
import { API_RULE_CHANGES, noticeDaysOf } from '../../foundation/http/api-rules';
import { API_VERSIONS } from '../../foundation/http/api-versions';

export class ApiVersionView {
  @ApiProperty() version!: string;
  @ApiProperty() releasedAt!: string;
  @ApiPropertyOptional() announcedAt?: string;
  @ApiPropertyOptional() retiresAt?: string;
}

export class ApiRuleChangeView {
  @ApiProperty() id!: string;
  @ApiProperty() version!: string;
  @ApiProperty() summary!: string;
  @ApiProperty() announcedAt!: string;
  @ApiProperty() enforcedFrom!: string;
  @ApiProperty() safety!: boolean;
  /** The notice it was given, in days; 0 for a rule in force from release, before any company's system was connected. */
  @ApiProperty() noticeDays!: number;
  @ApiProperty() fromRelease!: boolean;
}

export class ApiChangesView {
  @ApiProperty({ type: [ApiVersionView] }) versions!: ApiVersionView[];
  @ApiProperty({ type: [ApiRuleChangeView] }) rules!: ApiRuleChangeView[];
}

/**
 * 2026-11-03 — THE API'S OWN LIST OF CHANGES (the user: "Notice first, build now"): its versions, and every rule a version
 * gained, with when it was announced and from when it refuses a system's call. Public: it is documentation, read beside a
 * company's keys in the Business and Fleet apps, and by anybody building a system against it.
 */
@ApiTags('API')
@Controller('sbg/api-changes')
export class ApiChangesController {
  @Public()
  @Get()
  @ApiOkResponse({ type: ApiChangesView })
  list(): ApiChangesView {
    return {
      versions: API_VERSIONS.map((v) => ({ ...v })),
      rules: [...API_RULE_CHANGES]
        .sort((a, b) => Date.parse(b.enforcedFrom) - Date.parse(a.enforcedFrom))
        .map((r) => ({ id: r.id, version: r.version, summary: r.summary, announcedAt: r.announcedAt, enforcedFrom: r.enforcedFrom, safety: !!r.safety, noticeDays: r.fromRelease ? 0 : noticeDaysOf(r), fromRelease: !!r.fromRelease })),
    };
  }
}
