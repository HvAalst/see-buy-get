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

  /** A HUB'S PEOPLE (the ISO 28000 check: "a hub's own people by name"): the hub's owner — its own sign-in — the same way. */
  @Roles('mdp')
  @Get('hub/staff')
  hubList(@Actor() actor: IntrospectionResult): ShopStaffView[] {
    return this.staff.list(ownerHubOf(actor));
  }

  @Roles('mdp')
  @Post('hub/staff')
  hubInvite(@Body() dto: ShopStaffInviteDto, @Actor() actor: IntrospectionResult): ShopStaffView {
    return this.staff.invite(ownerHubOf(actor), dto, 'the owner', Date.now(), 'hub');
  }

  @Roles('mdp')
  @Post('hub/staff/:memberId/remove')
  hubRemove(@Param('memberId') memberId: string, @Actor() actor: IntrospectionResult): ShopStaffView {
    return this.staff.remove(ownerHubOf(actor), memberId, 'the owner');
  }

  /** Who did what on the hub's floor, newest first: the owner's own record. */
  @Roles('mdp')
  @Get('hub/floor-log')
  floorLog(@Actor() actor: IntrospectionResult): CounterAct[] {
    return this.staff.counterLog(ownerHubOf(actor));
  }

  /** The shops — and hubs — I was added to, from my own sign-in, by phone and PIN. */
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

  /** A session on this hub's floor, under my name. */
  @Roles('consumer')
  @Post('hubs/:hubDid/staff-session')
  hubSession(@Param('hubDid') hubDid: string, @Actor() actor: IntrospectionResult): ShopStaffSession {
    return this.staff.session(personOf(actor), hubDid);
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
  // A hub's floor routes name the hub in the address (`mdps/:id/…`): the place, never what the act was about.
  const placeInPath = String((req as Request & { route?: { path?: string } }).route?.path ?? '').includes('/mdps/:id');
  if (params.parcelId) return params.parcelId;
  if (params.id && !placeInPath) return params.id;
  if (params.code) return params.code;
  const body = (req.body ?? {}) as { parcelId?: unknown; parcelIds?: unknown };
  if (typeof body.parcelId === 'string') return body.parcelId;
  if (Array.isArray(body.parcelIds)) {
    const ids = body.parcelIds.filter((x): x is string => typeof x === 'string');
    return ids.length > 3 ? `${ids.slice(0, 3).join(', ')} +${ids.length - 3}` : ids.join(', ') || undefined;
  }
  const a = (answer ?? {}) as { parcelId?: unknown; code?: unknown; freightId?: unknown };
  for (const v of [a.parcelId, a.code, a.freightId]) if (typeof v === 'string') return v;
  // A store's arrival at a hub, taken in or finished: the arrival itself.
  if (params.arrivalId) return params.arrivalId;
  return undefined;
}

/** The shop an OWNER's sign-in speaks for. SeeBuyGet's staff are refused by name; the shop's own never reach here (the guard, at-the-counter.ts). */
function ownerShopOf(actor: IntrospectionResult | undefined): string {
  if (actor?.role === 'operator') throw new GlosError('FORBIDDEN', 'A shop’s people are the shop’s own: staff of SeeBuyGet see none of them.');
  if (actor?.role !== 'agent' || !actor.did) throw new GlosError('FORBIDDEN', 'Sign in as the shop');
  return actor.did;
}

/** The hub an OWNER's sign-in speaks for. SeeBuyGet's staff are refused by name; the hub's own people never reach here. */
function ownerHubOf(actor: IntrospectionResult | undefined): string {
  if (actor?.role === 'operator') throw new GlosError('FORBIDDEN', 'A hub’s people are the hub’s own: staff of SeeBuyGet see none of them.');
  if (actor?.role !== 'mdp' || !actor.did) throw new GlosError('FORBIDDEN', 'Sign in as the hub');
  return actor.did;
}

function personOf(actor: IntrospectionResult | undefined): string {
  const did = actor?.personDid ?? actor?.did;
  if (!did) throw new GlosError('FORBIDDEN', 'Sign in first');
  return did;
}
