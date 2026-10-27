import { Body, Controller, Get, Header, Param, Post, Query, Res } from '@nestjs/common';
import { ApiQuery } from '@nestjs/swagger';
import type { Response } from 'express';
import { Actor } from '../../foundation/auth/actor.decorator';
import { AtTheCounter } from '../../foundation/auth/at-the-counter';
import type { IntrospectionResult } from '../../foundation/auth/auth.types';
import { Roles, Scopes } from '../../foundation/auth/scopes.decorator';
import { GlosError } from '../../foundation/http/glos-error';
import { zplOut } from '../../foundation/label/zpl';
import { CallOffService } from './call-off.service';
import { CallOffDto, CallOffView, CalledOffView, HandToDriverDto, HubHandoverView, MaxSpendView, RaiseMaxSpendDto, SwitchToShopDto } from './call-off.types';
import { MdpService } from './mdp.service';
import { ParcelService } from './parcel.service';
import type { PhygitalLabel } from './pudo.types';
import { VendorService } from './vendor.service';

/**
 * A STORE CALLS ONE OF ITS ORDERS OFF, from its own app (call-off.types.ts) — what it would do and cost, then doing it; signed
 * in as the store, as every change to a store is. And the hub a store's parcel was turned round at prints its new label, to put
 * over the old one.
 */
@Controller('sbg')
export class CallOffController {
  constructor(
    private readonly callOffs: CallOffService,
    private readonly vendors: VendorService,
    private readonly mdps: MdpService,
    private readonly parcels: ParcelService,
  ) {}

  /** What calling the order off would do now: its money back in full; brought back to the shop it was handed in at, at a price; or why not. */
  @Scopes('vendor:read:self')
  @Get('vendors/:id/orders/:parcelId/call-off')
  @ApiQuery({ name: 'backTo', required: false, description: 'Not handed in at a shop: the id of a shop, or door (the store’s own)' })
  preview(@Param('id') id: string, @Param('parcelId') parcelId: string, @Query('backTo') backTo: string | undefined, @Actor() actor: IntrospectionResult): CallOffView {
    this.assertStoreReads(id, actor);
    return this.callOffs.preview(id, parcelId, backTo?.trim() || undefined);
  }

  /** The store calls the order off. Staff change nothing in a store's name — and at a hub, calling off spends the store's money. */
  @Scopes('vendor:manage:self')
  @Post('vendors/:id/orders/:parcelId/call-off')
  callOff(@Param('id') id: string, @Param('parcelId') parcelId: string, @Body() dto: CallOffDto, @Actor() actor: IntrospectionResult): CalledOffView {
    const store = this.assertStoreSelf(id, actor);
    return this.callOffs.callOff(id, parcelId, actor?.actorName?.trim() || store.name, dto.reason?.trim() || 'called off by the store', Date.now(), { backTo: dto.backTo?.trim() || undefined, maxSpend: dto.maxSpend });
  }

  /**
   * The most the store pays for its parcel's way to its door, raised while no driver has taken the load (2026-10-27): the load
   * cannot be withdrawn — the goods would wait at the hub for nobody — so a figure nobody takes it for is raised instead.
   */
  @Scopes('vendor:manage:self')
  @Post('vendors/:id/loads/:freightId/max-spend')
  raiseMaxSpend(@Param('id') id: string, @Param('freightId') freightId: string, @Body() dto: RaiseMaxSpendDto, @Actor() actor: IntrospectionResult): MaxSpendView {
    this.assertStoreSelf(id, actor);
    return this.callOffs.raiseMaxSpend(id, freightId, dto.maxSpend);
  }

  /** What sending the box to a shop instead would do, while no driver has taken its load to the store's door (2026-10-27). */
  @Scopes('vendor:read:self')
  @Get('vendors/:id/loads/:freightId/to-shop')
  @ApiQuery({ name: 'backTo', required: false, description: 'The id of the shop it would go to' })
  switchPreview(@Param('id') id: string, @Param('freightId') freightId: string, @Query('backTo') backTo: string | undefined, @Actor() actor: IntrospectionResult): CallOffView {
    this.assertStoreReads(id, actor);
    return this.callOffs.switchPreview(id, freightId, backTo?.trim() || undefined);
  }

  /** The box to that shop instead: a new parcel from the hub, the load withdrawn. The store's own act, and its money. */
  @Scopes('vendor:manage:self')
  @Post('vendors/:id/loads/:freightId/to-shop')
  switchToShop(@Param('id') id: string, @Param('freightId') freightId: string, @Body() dto: SwitchToShopDto, @Actor() actor: IntrospectionResult): CalledOffView {
    const store = this.assertStoreSelf(id, actor);
    return this.callOffs.switchToShop(id, freightId, dto.backTo?.trim() || undefined, actor?.actorName?.trim() || store.name);
  }

  /** The boxes called off at this hub waiting for the driver of the load that takes them to their store's door. Its floor's. */
  @Roles('mdp', 'operator')
  @Get('mdps/:id/handovers')
  @AtTheCounter()
  handovers(@Param('id') id: string, @Actor() actor: IntrospectionResult): HubHandoverView[] {
    this.assertHub(id, actor);
    return this.callOffs.handoversAt(id);
  }

  /** The hub hands one to the driver who took its load — by their pass, scanned at the counter. Its floor's act: not staff's. */
  @Roles('mdp', 'operator')
  @Post('mdps/:id/handovers/:parcelId')
  @AtTheCounter()
  handToDriver(@Param('id') id: string, @Param('parcelId') parcelId: string, @Body() dto: HandToDriverDto, @Actor() actor: IntrospectionResult): HubHandoverView[] {
    const hub = this.assertHub(id, actor);
    if (actor?.role === 'operator') throw new GlosError('FORBIDDEN', 'A hub hands over at its own counter, signed in as the hub. Staff hand nothing over in its name');
    return this.callOffs.handToDriver(id, parcelId, dto.badge, actor?.actorName?.trim() || hub.name);
  }

  /** The new label of a parcel turned round at this hub — to print and put over the old one. Its floor's. */
  @Roles('mdp', 'operator')
  @Get('mdps/:id/parcels/:parcelId/label')
  @AtTheCounter()
  hubLabel(@Param('id') id: string, @Param('parcelId') parcelId: string, @Actor() actor: IntrospectionResult): PhygitalLabel {
    this.assertHub(id, actor);
    return this.parcels.hubLabel(id, parcelId);
  }

  /** The same label for the hub's thermal label printer (ZPL), sent to the printer as it is. */
  @Roles('mdp', 'operator')
  @Get('mdps/:id/parcels/:parcelId/label.zpl')
  @Header('Cache-Control', 'private, no-store')
  @AtTheCounter()
  hubLabelZpl(@Param('id') id: string, @Param('parcelId') parcelId: string, @Actor() actor: IntrospectionResult, @Res({ passthrough: true }) res: Response): string {
    this.assertHub(id, actor);
    this.parcels.hubLabel(id, parcelId);
    return zplOut(res, this.parcels.labelZplFor(parcelId));
  }

  /** The store itself, signed in as itself — and, calling off at a hub, spending its own money. Staff change nothing in its name. */
  private assertStoreSelf(id: string, actor: IntrospectionResult) {
    const store = this.vendors.get(id); // 404 if unknown
    if (actor?.role === 'operator') throw new GlosError('FORBIDDEN', 'A store makes its own changes, signed in as that store. Staff read a store under Stores and change nothing in its name');
    if (!actor?.did || actor.did !== store.did) throw new GlosError('FORBIDDEN', 'This store is not yours to change');
    return store;
  }

  /** …and reads its own orders. Staff read a parcel under Find a parcel. */
  private assertStoreReads(id: string, actor: IntrospectionResult): void {
    const store = this.vendors.get(id); // 404 if unknown
    if (actor?.role === 'operator') throw new GlosError('FORBIDDEN', 'A store’s own records are the store’s: its buyers, its collection codes, its messages to its systems. Staff read a store under Stores, and a parcel under Find a parcel');
    if (!actor?.did || actor.did !== store.did) throw new GlosError('FORBIDDEN', 'This store is not yours to view');
  }

  /** The hub itself, from its own sign-in; staff may read what its floor reads. */
  private assertHub(id: string, actor: IntrospectionResult) {
    const hub = this.mdps.require(id); // 404 if unknown
    if (actor?.role === 'operator') return hub;
    if (!actor?.did || actor.did !== hub.did) throw new GlosError('FORBIDDEN', 'Only the hub can do this, from its own sign-in');
    return hub;
  }
}
