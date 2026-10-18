import { Body, CallHandler, Controller, ExecutionContext, Get, Injectable, NestInterceptor, Param, Post } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';
import type { Request } from 'express';
import { Observable, tap } from 'rxjs';
import { Actor } from '../../foundation/auth/actor.decorator';
import { IntrospectionResult } from '../../foundation/auth/auth.types';
import { Roles } from '../../foundation/auth/scopes.decorator';
import { GlosError } from '../../foundation/http/glos-error';
import { COUNTER_ACTS, ShopStaffService } from './shop-staff.service';
import { CounterAct, ShopInvitationView, ShopStaffSession, ShopStaffView } from './shop-staff.types';

export class ShopStaffInviteDto {
  @ApiProperty({ description: 'The number they sign in with.' })
  @IsString()
  @MaxLength(40)
  phone: string;

  @ApiProperty({ description: 'What the shop calls them; every act of theirs is recorded under it.' })
  @IsString()
  @MaxLength(60)
  name: string;
}

/**
 * THE PEOPLE AT A SHOP'S COUNTER (shop-staff.types.ts). The owner — the shop's own sign-in — adds and takes out; a person
 * answers their invitation and opens a session from their own phone + PIN sign-in. SeeBuyGet's staff pass every role
 * check and are refused by name: a shop's people are the shop's own.
 */
@Controller('sbg')
export class ShopStaffController {
  constructor(private readonly staff: ShopStaffService) {}

  @Roles('agent')
  @Get('shop/staff')
  list(@Actor() actor: IntrospectionResult): ShopStaffView[] {
    return this.staff.list(ownerShopOf(actor));
  }

  @Roles('agent')
  @Post('shop/staff')
  invite(@Body() dto: ShopStaffInviteDto, @Actor() actor: IntrospectionResult): ShopStaffView {
    return this.staff.invite(ownerShopOf(actor), dto, 'the owner');
  }

  @Roles('agent')
  @Post('shop/staff/:memberId/remove')
  remove(@Param('memberId') memberId: string, @Actor() actor: IntrospectionResult): ShopStaffView {
    return this.staff.remove(ownerShopOf(actor), memberId, 'the owner');
  }

  /** Who did what at the counter, newest first: the owner's own record, never on a parcel. */
  @Roles('agent')
  @Get('shop/counter-log')
  counterLog(@Actor() actor: IntrospectionResult): CounterAct[] {
    return this.staff.counterLog(ownerShopOf(actor));
  }

  /** The shops I was added to — from my own sign-in, by phone and PIN. */
  @Roles('consumer')
  @Get('shop-invitations')
  mine(@Actor() actor: IntrospectionResult): ShopInvitationView[] {
    return this.staff.mine(personOf(actor));
  }

  @Roles('consumer')
  @Post('shop-invitations/:memberId/accept')
  accept(@Param('memberId') memberId: string, @Actor() actor: IntrospectionResult): ShopInvitationView {
    return this.staff.accept(personOf(actor), memberId);
  }

  @Roles('consumer')
  @Post('shop-invitations/:memberId/decline')
  decline(@Param('memberId') memberId: string, @Actor() actor: IntrospectionResult): { declined: true } {
    return this.staff.decline(personOf(actor), memberId);
  }

  /** A session at this shop's counter, under my name. */
  @Roles('consumer')
  @Post('shops/:shopDid/staff-session')
  session(@Param('shopDid') shopDid: string, @Actor() actor: IntrospectionResult): ShopStaffSession {
    return this.staff.session(personOf(actor), shopDid);
  }
}

/**
 * EVERY ACT AT A COUNTER, UNDER WHO DID IT — written once the act succeeded, for the routes `COUNTER_ACTS` names, so no
 * route can forget to. The shop's owner reads it; nothing of it goes on the parcel, which other shops can read.
 */
@Injectable()
export class CounterLogInterceptor implements NestInterceptor {
  constructor(private readonly staff: ShopStaffService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const handler = ctx.getHandler().name;
    if (!(handler in COUNTER_ACTS)) return next.handle();
    const req = ctx.switchToHttp().getRequest<Request & { auth?: IntrospectionResult }>();
    return next.handle().pipe(tap((answer) => this.staff.note(req.auth, handler, refOf(req, answer), (req.body ?? {}) as Record<string, unknown>)));
  }
}

/** What an act was about: the parcel or bag in the address, the parcels in the body, or what the answer names. */
function refOf(req: Request, answer: unknown): string | undefined {
  const params = (req.params ?? {}) as Record<string, string | undefined>;
  if (params.id) return params.id;
  if (params.code) return params.code;
  const body = (req.body ?? {}) as { parcelId?: unknown; parcelIds?: unknown };
  if (typeof body.parcelId === 'string') return body.parcelId;
  if (Array.isArray(body.parcelIds)) {
    const ids = body.parcelIds.filter((x): x is string => typeof x === 'string');
    return ids.length > 3 ? `${ids.slice(0, 3).join(', ')} +${ids.length - 3}` : ids.join(', ') || undefined;
  }
  const a = (answer ?? {}) as { parcelId?: unknown; code?: unknown; freightId?: unknown };
  for (const v of [a.parcelId, a.code, a.freightId]) if (typeof v === 'string') return v;
  return undefined;
}

/** The shop an OWNER's sign-in speaks for. SeeBuyGet's staff are refused by name; the shop's own never reach here (the guard, at-the-counter.ts). */
function ownerShopOf(actor: IntrospectionResult | undefined): string {
  if (actor?.role === 'operator') throw new GlosError('FORBIDDEN', 'A shop’s people are the shop’s own: staff of SeeBuyGet see none of them.');
  if (actor?.role !== 'agent' || !actor.did) throw new GlosError('FORBIDDEN', 'Sign in as the shop');
  return actor.did;
}

function personOf(actor: IntrospectionResult | undefined): string {
  const did = actor?.personDid ?? actor?.did;
  if (!did) throw new GlosError('FORBIDDEN', 'Sign in first');
  return did;
}
