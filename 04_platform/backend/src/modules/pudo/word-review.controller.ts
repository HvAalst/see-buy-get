import { Body, Controller, Get, Header, Param, Put, Query } from '@nestjs/common';
import { ApiOkResponse, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { Actor } from '../../foundation/auth/actor.decorator';
import { IntrospectionResult } from '../../foundation/auth/auth.types';
import { Public } from '../../foundation/auth/public.decorator';
import { Roles } from '../../foundation/auth/scopes.decorator';
import { staffOf } from './staff-of';
import { WordReviewService } from './word-review.service';

export class ReviewedWordsView {
  @ApiProperty() locale!: string;
  @ApiProperty() country!: string;
  /** Version 2, phrase by phrase: only the phrases the country said in its own words. */
  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' } }) words!: Record<string, string>;
}

export class WordReviewStepView {
  @ApiPropertyOptional() text?: string;
  @ApiPropertyOptional() kept?: boolean;
  @ApiProperty() by!: string;
  @ApiProperty() at!: string;
}

export class WordReviewView {
  @ApiProperty() country!: string;
  @ApiProperty() locale!: string;
  @ApiProperty() key!: string;
  @ApiPropertyOptional() text?: string;
  @ApiPropertyOptional() kept?: boolean;
  @ApiProperty() by!: string;
  @ApiProperty() at!: string;
  @ApiProperty({ type: [WordReviewStepView] }) history!: WordReviewStepView[];
}

export class WordReviewList {
  @ApiProperty({ type: [WordReviewView] }) items!: WordReviewView[];
}

export class ReviewWordDto {
  /** Version 2's words. */
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4000) text?: string;
  /** Version 1 stands as written. */
  @ApiPropertyOptional() @IsOptional() @IsBoolean() keep?: boolean;
}

/**
 * 2026-11-03 — THE LANGUAGES REVIEW SHEET'S DOORS (the owner: "languages are reviewed per country sbg company"). The apps
 * read a country's version 2 of a language — public, as the words of the apps are; the console's Languages screen reads and
 * writes it, for the countries its member of staff works in.
 */
@ApiTags('Languages')
@Controller('sbg/words')
export class WordReviewController {
  constructor(private readonly reviews: WordReviewService) {}

  @Public()
  @Get(':locale')
  @Header('Cache-Control', 'public, max-age=300')
  @ApiOkResponse({ type: ReviewedWordsView })
  words(@Param('locale') locale: string, @Query('country') country: string): ReviewedWordsView {
    const c = WordReviewService.checked(locale, country);
    return { ...c, words: this.reviews.wordsOf(c.locale, c.country) };
  }

  @Roles('operator')
  @Get(':locale/:country/reviews')
  @ApiOkResponse({ type: WordReviewList })
  list(@Param('locale') locale: string, @Param('country') country: string): WordReviewList {
    return { items: this.reviews.list(locale, country) };
  }

  @Roles('operator')
  @Put(':locale/:country/:key')
  @ApiOkResponse({ type: WordReviewView })
  review(@Param('locale') locale: string, @Param('country') country: string, @Param('key') key: string, @Body() dto: ReviewWordDto, @Actor() actor: IntrospectionResult): WordReviewView {
    return this.reviews.review(locale, country, key, dto, staffOf(actor).name);
  }
}
