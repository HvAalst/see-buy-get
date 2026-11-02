import { Body, CallHandler, Controller, ExecutionContext, Get, Injectable, NestInterceptor, Optional, Param, Post } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsOptional, IsString, MaxLength } from 'class-validator';
import { AccountService } from './account.service';
import { NotificationService } from './notification.service';
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
 * 2026-11-02 — opening a session at a counter (or on a hub's floor): the keys this browser holds for the shops and hubs
 * whose own sign-in was used on it. The one that is this place's own phone is noted as a phone colleagues use, and the
 * place's fingerprint-or-face unlock is never kept there (the owner: "a 1 person shop could use fingerprint to unlock as
 * you said"). A key alone opens nothing; the others are compared and dropped.
 */
export class StaffSessionDto {
  @ApiPropertyOptional({ type: [String], description: 'The shop and hub phone keys this browser holds.' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  devices?: string[];
}

/**
 * THE PEOPLE AT A SHOP'S COUNTER (shop-staff.types.ts). The owner — the shop's own sign-in — adds and takes out; a person
 * answers their invitation and opens a session from their own phone + PIN sign-in. SeeBuyGet's staff pass every role
 * check and are refused by name: a shop's people are the shop's own.
 */
@Controller('sbg')
export class ShopStaffController {
  constructor(
    private readonly staff: ShopStaffService,
    // 2026-11-02 — the place's own phones, and its bell: a colleague's session on one of them takes its fingerprint off.
    @Optional() private readonly accounts?: AccountService,
    @Optional() private readonly notifications?: NotificationService,
  ) {}

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
  session(@Param('shopDid') shopDid: string, @Body() dto: StaffSessionDto, @Actor() actor: IntrospectionResult): ShopStaffSession {
    const session = this.staff.session(byPin(actor), shopDid);
    this.colleagueOn(shopDid, dto?.devices);
    return session;
  }

  /** A session on this hub's floor, under my name. */
  @Roles('consumer')
  @Post('hubs/:hubDid/staff-session')
  hubSession(@Param('hubDid') hubDid: string, @Body() dto: StaffSessionDto, @Actor() actor: IntrospectionResult): ShopStaffSession {
    const session = this.staff.session(byPin(actor), hubDid);
    this.colleagueOn(hubDid, dto?.devices);
    return session;
  }

  /**
   * A COLLEAGUE'S SESSION WAS OPENED ON THIS BROWSER (the owner, 2026-11-02: "a 1 person shop could use fingerprint to
   * unlock as you said"). Asked only once the session was granted. Where the browser is one of the place's own phones, it
   * is noted as one colleagues use; a fingerprint-or-face unlock on it goes at once, and the place is told in its bell —
   * never by text: texts carry only codes.
   */
  private colleagueOn(placeDid: string, devices: string[] | undefined): void {
    const seen = this.accounts?.counterSessionOn(placeDid, devices);
    if (!seen) return;
    const hub = seen.role === 'mdp';
    for (const addedAt of seen.dropped) {
      const day = new Date(addedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
      void this.notifications
        ?.notify(placeDid, {
          kind: 'security',
          title: 'Fingerprint unlock turned off on one of your phones',
          body: `Fingerprint unlock was turned off on the phone or browser confirmed on ${day} because a colleague signed in ${hub ? 'on the hub’s floor' : 'at the counter'} on it: whoever can unlock that phone could otherwise sign in as the ${hub ? 'hub' : 'shop'}. The password works there as before.`,
          link: '/',
          tag: `passkey:${placeDid}:counter:${addedAt}`,
        })
        .catch(() => undefined);
    }
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

/**
 * A SESSION AT A COUNTER IS OPENED WITH THE PIN — never with a fingerprint or face (2026-11-02). The counter's phone is the
 * shop's or the hub's, not the person's: it unlocks for whoever can unlock it — their finger, a colleague's, the phone's own
 * PIN — and what is done there is kept under one person's name. A sign-in a passkey opened says so (`openedBy`), and is
 * turned away here, refused before anything is minted.
 */
function byPin(actor: IntrospectionResult | undefined): string {
  if (actor?.openedBy === 'passkey') {
    throw new GlosError('FORBIDDEN', 'At a counter, sign in with your PIN: this phone is the shop’s, and what you do here is kept under your name.');
  }
  return personOf(actor);
}
