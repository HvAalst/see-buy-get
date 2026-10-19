import { Controller, Get, Header, Param } from '@nestjs/common';
import { Actor } from '../../foundation/auth/actor.decorator';
import type { IntrospectionResult } from '../../foundation/auth/auth.types';
import { Scopes } from '../../foundation/auth/scopes.decorator';
import { GlosError } from '../../foundation/http/glos-error';
import { ParcelInvoiceService } from './parcel-invoice.service';
import { ParcelInvoiceView } from './parcel-invoice.types';
import { ParcelService } from './parcel.service';
import { VendorService } from './vendor.service';

/**
 * A STORE PARCEL'S PAPERS, IN THE STORE APP (round 13: "The store, with the label"). The commercial invoice a crossing
 * shipment made in the app goes with, read and printed by the store signed in — three copies, beside the label. Staff
 * read a store's papers, as they read its other records, and change nothing; nobody else sees them: they name the buyer.
 * The store's own system reads the same through the shipping API with its secret key.
 */
@Controller('sbg')
export class StorePapersController {
  constructor(
    private readonly vendors: VendorService,
    private readonly parcels: ParcelService,
    private readonly invoices: ParcelInvoiceService,
  ) {}

  @Scopes('vendor:read:self')
  @Get('vendors/:id/parcels/:parcelId/invoice')
  view(@Param('id') id: string, @Param('parcelId') parcelId: string, @Actor() actor: IntrospectionResult): ParcelInvoiceView {
    const parcel = this.crossingParcel(id, parcelId, actor);
    return this.invoices.view(parcel.parcelId, parcel.status === 'Created');
  }

  /** The three copies, one a page: printed with the label, and put in the pouch. */
  @Scopes('vendor:read:self')
  @Get('vendors/:id/parcels/:parcelId/invoice.html')
  @Header('Content-Type', 'text/html; charset=utf-8')
  page(@Param('id') id: string, @Param('parcelId') parcelId: string, @Actor() actor: IntrospectionResult): string {
    const parcel = this.crossingParcel(id, parcelId, actor);
    const current = this.invoices.current(parcel.parcelId);
    if (!current) throw new GlosError('NOT_FOUND', 'This parcel has no commercial invoice yet');
    return this.invoices.htmlFor(current);
  }

  /** One of this store's parcels that crosses a border, read by the store itself or by staff. */
  private crossingParcel(id: string, parcelId: string, actor: IntrospectionResult) {
    const vendor = this.vendors.get(id); // 404 if unknown
    if (actor?.role !== 'operator' && (!actor?.did || actor.did !== vendor.did)) throw new GlosError('FORBIDDEN', 'These are another store’s papers');
    let parcel;
    try {
      parcel = this.parcels.get(parcelId);
    } catch {
      throw new GlosError('NOT_FOUND', 'No such parcel of yours');
    }
    if (parcel.vendorId !== vendor.vendorId) throw new GlosError('NOT_FOUND', 'No such parcel of yours');
    if (!parcel.customs) throw new GlosError('NOT_FOUND', 'This parcel does not cross a border: it has no commercial invoice');
    return parcel;
  }
}
