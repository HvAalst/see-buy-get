import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Actor } from '../../foundation/auth/actor.decorator';
import type { IntrospectionResult } from '../../foundation/auth/auth.types';
import { ForTheDeveloper, isStoreDeveloper } from '../../foundation/auth/for-the-developer';
import { StoreActivityService } from './store-activity.service';
import { StoreActivityResponse } from './store-activity.types';
import { Public } from '../../foundation/auth/public.decorator';
import { Scopes } from '../../foundation/auth/scopes.decorator';
import { GlosError } from '../../foundation/http/glos-error';
import { RateLimit, RateLimitGuard } from '../../foundation/http/rate-limit.guard';
import { StoreDeveloperService } from './store-developer.service';
import { InviteStoreDeveloperDto, StoreDeveloperLinkDto, StoreDeveloperLinkSent, StoreDeveloperSession, StoreDeveloperSessionDto, StoreDevelopersResponse, StoreDeveloperView } from './store-developer.types';
import { VendorService } from './vendor.service';

/**
 * 2026-11-15 — A STORE'S DEVELOPER (store-developer.service.ts): the owner invites and takes out; the developer asks for a
 * link and signs in with it. The owner's doors are the store's own and nobody else's — never a developer's, never staff's.
 */
@Controller('sbg')
export class StoreDeveloperController {
  constructor(
    private readonly developers: StoreDeveloperService,
    private readonly vendors: VendorService,
    private readonly activity: StoreActivityService,
  ) {}

  /** 2026-11-15 — who did what on Connect, newest first: the owner and the store's developers read it alike. */
  @Scopes('vendor:manage:self')
  @ForTheDeveloper()
  @Get('vendors/:id/activity')
  history(@Param('id') id: string, @Actor() actor: IntrospectionResult): StoreActivityResponse {
    this.assertStoreReads(id, actor);
    return { items: this.activity.list(id) };
  }

  @Scopes('vendor:manage:self')
  @Get('vendors/:id/developers')
  list(@Param('id') id: string, @Actor() actor: IntrospectionResult): StoreDevelopersResponse {
    this.assertOwnerReads(id, actor);
    return { items: this.developers.list(id) };
  }

  @Scopes('vendor:manage:self')
  @Post('vendors/:id/developers')
  invite(@Param('id') id: string, @Body() dto: InviteStoreDeveloperDto, @Actor() actor: IntrospectionResult): StoreDeveloperView {
    this.assertOwner(id, actor);
    const invited = this.developers.invite(id, dto, actor.actorName ?? 'the owner');
    this.activity.note(id, actor, { act: 'developer_invited', name: invited.name });
    return invited;
  }

  @Scopes('vendor:manage:self')
  @Post('vendors/:id/developers/:devId/remove')
  remove(@Param('id') id: string, @Param('devId') devId: string, @Actor() actor: IntrospectionResult): StoreDeveloperView {
    this.assertOwner(id, actor);
    const out = this.developers.remove(id, devId);
    this.activity.note(id, actor, { act: 'developer_removed', name: out.name });
    return out;
  }

  /** A developer asks for a fresh sign-in link, by the email the owner gave. */
  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit(5, 15 * 60)
  @Post('store-developers/link')
  link(@Body() dto: StoreDeveloperLinkDto): StoreDeveloperLinkSent {
    return this.developers.requestLink(dto.email);
  }

  /** A link's one-time code, for a developer's session. */
  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit(20, 15 * 60)
  @Post('store-developers/session')
  session(@Body() dto: StoreDeveloperSessionDto): StoreDeveloperSession {
    return this.developers.session(dto.code);
  }

  /** A store's own records are the store's: its history is read by the store's own sign-ins — the owner's, or its developer's. */
  private assertStoreReads(id: string, actor: IntrospectionResult): void {
    const vendor = this.vendors.get(id);
    if (actor?.role === 'operator') throw new GlosError('FORBIDDEN', 'A store’s own records are the store’s: its buyers, its collection codes, its messages to its systems. Staff read a store under Stores, and a parcel under Find a parcel');
    if (!actor?.did || actor.did !== vendor.did) throw new GlosError('FORBIDDEN', 'This store is not yours to view');
  }

  /** A store's own records are the store's: who its developers are is read by the owner's own sign-in alone. */
  private assertOwnerReads(id: string, actor: IntrospectionResult): void {
    const vendor = this.vendors.get(id);
    if (actor?.role === 'operator') throw new GlosError('FORBIDDEN', 'A store’s own records are the store’s: its buyers, its collection codes, its messages to its systems. Staff read a store under Stores, and a parcel under Find a parcel');
    if (!actor?.did || actor.did !== vendor.did) throw new GlosError('FORBIDDEN', 'This store is not yours to view');
    if (isStoreDeveloper(actor)) throw new GlosError('FORBIDDEN', 'The owner sees who the store’s developers are');
  }

  /** A store makes its own changes, signed in as that store — the owner's own sign-in, not a developer's, not staff's. */
  private assertOwner(id: string, actor: IntrospectionResult): void {
    const vendor = this.vendors.get(id);
    if (actor?.role === 'operator') throw new GlosError('FORBIDDEN', 'A store makes its own changes, signed in as that store. Staff read a store under Stores and change nothing in its name');
    if (!actor?.did || actor.did !== vendor.did) throw new GlosError('FORBIDDEN', 'This store is not yours to change');
    if (isStoreDeveloper(actor)) throw new GlosError('FORBIDDEN', 'The owner invites and takes out developers, signed in as the store');
  }
}
