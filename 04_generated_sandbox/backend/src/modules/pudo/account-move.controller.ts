import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { actingPerson } from '../../foundation/auth/acting';
import { Actor } from '../../foundation/auth/actor.decorator';
import { IntrospectionResult } from '../../foundation/auth/auth.types';
import { Public } from '../../foundation/auth/public.decorator';
import { Roles } from '../../foundation/auth/scopes.decorator';
import { RateLimit, RateLimitGuard } from '../../foundation/http/rate-limit.guard';
import { AccountMoveService } from './account-move.service';
import { ApproveMoveDto, AskMoveDto, CheckMoveDto, MoveAsked, MoveList, MoveRow, MoveStatus, MoveStatusDto, MoveStopped, RefuseMoveDto } from './account-move.types';
import { staffOf } from './staff-of';

/**
 * TWO MEMBERS OF STAFF MOVE AN ACCOUNT (account-move.types.ts). Three kinds of caller, three doors:
 *
 *  - NOBODY SIGNED IN asks, and later reads what became of it with the reference they were handed. Both limited by
 *    where they come from: asking writes a notice to an account's holder, and a reference is not to be guessed at.
 *  - THE ACCOUNT'S HOLDER, signed in, stops a request against their own account. Keyed to the token, never to a
 *    number in the body.
 *  - STAFF read the requests, check one, approve one, refuse one. Checking and approving are never the same person.
 */
@Controller('sbg')
export class AccountMoveController {
  constructor(private readonly moves: AccountMoveService) {}

  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit(10, 15 * 60)
  @Post('identity/move-requests')
  ask(@Body() dto: AskMoveDto): MoveAsked {
    return this.moves.ask(dto);
  }

  /** What became of a request. The reference goes in the body: it is not a thing to leave in an address. */
  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit(30, 15 * 60)
  @Post('identity/move-requests/status')
  @HttpCode(200)
  status(@Body() dto: MoveStatusDto): MoveStatus {
    return this.moves.status(dto.reference);
  }

  /** "That was not me." Ends every request waiting against the account of whoever is signed in. */
  @Post('account/move-requests/stop')
  @HttpCode(200)
  stop(@Actor() actor: IntrospectionResult): MoveStopped {
    return { stopped: this.moves.stop(actingPerson(actor)) };
  }

  @Roles('operator')
  @Get('account-moves')
  list(@Actor() actor: IntrospectionResult): MoveList {
    return this.moves.list(reader(actor));
  }

  @Roles('operator')
  @Get('account-moves/:moveId')
  one(@Param('moveId') moveId: string, @Actor() actor: IntrospectionResult): MoveRow {
    return this.moves.one(moveId, reader(actor));
  }

  /** The first member of staff: who is asking was checked, and this is what was checked. Moves nothing. */
  @Roles('operator')
  @Post('account-moves/:moveId/check')
  @HttpCode(200)
  check(@Param('moveId') moveId: string, @Body() dto: CheckMoveDto, @Actor() actor: IntrospectionResult): MoveRow {
    return this.moves.check(moveId, staffOf(actor, dto.by), dto.what);
  }

  /** The second, different member of staff approves — and the account moves. */
  @Roles('operator')
  @Post('account-moves/:moveId/approve')
  @HttpCode(200)
  approve(@Param('moveId') moveId: string, @Body() dto: ApproveMoveDto, @Actor() actor: IntrospectionResult): MoveRow {
    return this.moves.approve(moveId, staffOf(actor, dto.by));
  }

  @Roles('operator')
  @Post('account-moves/:moveId/refuse')
  @HttpCode(200)
  refuse(@Param('moveId') moveId: string, @Body() dto: RefuseMoveDto, @Actor() actor: IntrospectionResult): MoveRow {
    return this.moves.refuse(moveId, staffOf(actor, dto.by), dto.reason);
  }
}

/** Who is reading, where the sign-in says — so a row can say "you checked this one". Nobody, on the shared key. */
function reader(actor: IntrospectionResult): { name: string; key: string } | undefined {
  return actor?.actorName && actor.revocationKey ? { name: actor.actorName, key: actor.revocationKey } : undefined;
}
