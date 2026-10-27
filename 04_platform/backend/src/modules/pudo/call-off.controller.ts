import { Body, Controller, Get, Header, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Actor } from '../../foundation/auth/actor.decorator';
import { AtTheCounter } from '../../foundation/auth/at-the-counter';
import type { IntrospectionResult } from '../../foundation/auth/auth.types';
import { Roles, Scopes } from '../../foundation/auth/scopes.decorator';
import { GlosError } from '../../foundation/http/glos-error';
import { zplOut } from '../../foundation/label/zpl';
import { CallOffService } from './call-off.service';
import { CallOffDto, CallOffView, CalledOffView } from './call-off.types';
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
  preview(@Param('id') id: string, @Param('parcelId') parcelId: string, @Actor() actor: IntrospectionResult): CallOffView {
    this.assertStoreReads(id, actor);
    return this.callOffs.preview(id, parcelId);
  }

  /** The store calls the order off. Staff change nothing in a store's name — and at a hub, calling off spends the store's money. */
  @Scopes('vendor:manage:self')
  @Post('vendors/:id/orders/:parcelId/call-off')
  callOff(@Param('id') id: string, @Param('parcelId') parcelId: string, @Body() dto: CallOffDto, @Actor() actor: IntrospectionResult): CalledOffView {
    const store = this.assertStoreSelf(id, actor);
    return this.callOffs.callOff(id, parcelId, actor?.actorName?.trim() || store.name, dto.reason?.trim() || 'called off by the store');
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
