import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { actingPerson } from '../../foundation/auth/acting';
import { Actor } from '../../foundation/auth/actor.decorator';
import { IntrospectionResult } from '../../foundation/auth/auth.types';
import { Public } from '../../foundation/auth/public.decorator';
import { Roles } from '../../foundation/auth/scopes.decorator';
import { RateLimit, RateLimitGuard } from '../../foundation/http/rate-limit.guard';
import { IdDisputeService } from './id-dispute.service';
import {
  AppointmentDto,
  ApproveDisputeDto,
  CheckDisputeDto,
  DisputeList,
  DisputeOpened,
  DisputePhotoDto,
  DisputeReferenceDto,
  DisputeRow,
  DisputeStatus,
  OpenDisputeDto,
  OwnIdDto,
  OwnIdSaved,
  ReadCardDto,
  RetakeDto,
  SendBackDisputeDto,
} from './id-dispute.types';
import { staffOf } from './staff-of';

/**
 * TWO PEOPLE SAY ONE NATIONAL ID IS THEIRS (id-dispute.types.ts). Three kinds of caller, three doors:
 *
 *  - EITHER OF THE TWO PEOPLE, by their own reference: open it, send photographs, read where it stands, withdraw it,
 *    make an appointment. A reference is what each of them holds — the claimant was handed theirs after confirming a
 *    phone number, the holder is shown theirs signed in — so these are limited by where they come from, and the
 *    reference goes in the body: it is not a thing to leave in an address.
 *  - THE HOLDER, signed in, says the number on their record was never theirs and puts their own there. Keyed to the
 *    token, never to anything in the body but the number.
 *  - STAFF read the disputes, read a card, ask for photographs again, say whose it is, approve, send back. Saying
 *    and approving are never the same person.
 */
@Controller('sbg')
export class IdDisputeController {
  constructor(private readonly disputes: IdDisputeService) {}

  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit(10, 15 * 60)
  @Post('identity/id-disputes')
  open(@Body() dto: OpenDisputeDto): DisputeOpened {
    return this.disputes.open(dto);
  }

  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit(60, 15 * 60)
  @Post('identity/id-disputes/status')
  @HttpCode(200)
  status(@Body() dto: DisputeReferenceDto): DisputeStatus {
    return this.disputes.status(dto.reference);
  }

  /** One of the three photographs. Taken again, it replaces the one before. */
  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit(40, 15 * 60)
  @Post('identity/id-disputes/photo')
  @HttpCode(200)
  photo(@Body() dto: DisputePhotoDto): DisputeStatus {
    return this.disputes.photo(dto);
  }

  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit(20, 15 * 60)
  @Post('identity/id-disputes/send')
  @HttpCode(200)
  send(@Body() dto: DisputeReferenceDto): DisputeStatus {
    return this.disputes.send(dto.reference);
  }

  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit(20, 15 * 60)
  @Post('identity/id-disputes/withdraw')
  @HttpCode(200)
  withdraw(@Body() dto: DisputeReferenceDto): DisputeStatus {
    return this.disputes.withdraw(dto.reference);
  }

  /** Still disputed: a day to come in. Answers with the ticket. */
  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit(20, 15 * 60)
  @Post('identity/id-disputes/appointment')
  @HttpCode(200)
  appoint(@Body() dto: AppointmentDto): DisputeStatus {
    return this.disputes.appoint(dto.reference, dto.date, dto.at);
  }

  /** "The number on my record is not mine — this one is." Ends a dispute over their ID at once, or a hold it left. */
  @Post('account/id-disputes/own-id')
  @HttpCode(200)
  ownId(@Body() dto: OwnIdDto, @Actor() actor: IntrospectionResult): OwnIdSaved {
    return this.disputes.ownId(actingPerson(actor), dto.nationalId);
  }

  @Roles('operator')
  @Get('id-disputes')
  list(@Actor() actor: IntrospectionResult): DisputeList {
    return this.disputes.list(reader(actor));
  }

  @Roles('operator')
  @Get('id-disputes/:disputeId')
  one(@Param('disputeId') disputeId: string, @Actor() actor: IntrospectionResult): DisputeRow {
    return this.disputes.one(disputeId, reader(actor));
  }

  /** The number read on a card: only whether it is the disputed one comes back, and is kept. */
  @Roles('operator')
  @Post('id-disputes/:disputeId/card')
  @HttpCode(200)
  card(@Param('disputeId') disputeId: string, @Body() dto: ReadCardDto, @Actor() actor: IntrospectionResult): DisputeRow {
    return this.disputes.readCard(disputeId, staffOf(actor, dto.by), dto.side, dto.number);
  }

  @Roles('operator')
  @Post('id-disputes/:disputeId/retake')
  @HttpCode(200)
  retake(@Param('disputeId') disputeId: string, @Body() dto: RetakeDto, @Actor() actor: IntrospectionResult): DisputeRow {
    return this.disputes.retake(disputeId, staffOf(actor, dto.by), dto.side, dto.reason);
  }

  /** The first member of staff says whose it is — from the photographs, or after an appointment. Changes nothing. */
  @Roles('operator')
  @Post('id-disputes/:disputeId/check')
  @HttpCode(200)
  check(@Param('disputeId') disputeId: string, @Body() dto: CheckDisputeDto, @Actor() actor: IntrospectionResult): DisputeRow {
    return this.disputes.check(disputeId, staffOf(actor, dto.by), dto);
  }

  /** The second, different member of staff approves — and it is done. */
  @Roles('operator')
  @Post('id-disputes/:disputeId/approve')
  @HttpCode(200)
  approve(@Param('disputeId') disputeId: string, @Body() dto: ApproveDisputeDto, @Actor() actor: IntrospectionResult): DisputeRow {
    return this.disputes.approve(disputeId, staffOf(actor, dto.by));
  }

  @Roles('operator')
  @Post('id-disputes/:disputeId/send-back')
  @HttpCode(200)
  sendBack(@Param('disputeId') disputeId: string, @Body() dto: SendBackDisputeDto, @Actor() actor: IntrospectionResult): DisputeRow {
    return this.disputes.sendBack(disputeId, staffOf(actor, dto.by), dto.why);
  }
}

/** Who is reading, where the sign-in says — so a row can say "you proposed this one". Nobody, on the shared key. */
function reader(actor: IntrospectionResult): { name: string; key: string } | undefined {
  return actor?.actorName && actor.revocationKey ? { name: actor.actorName, key: actor.revocationKey } : undefined;
}
