import { Controller, Get, Header, Param, Post, Query } from '@nestjs/common';
import { Actor } from '../../foundation/auth/actor.decorator';
import type { IntrospectionResult } from '../../foundation/auth/auth.types';
import { Roles, SignedIn } from '../../foundation/auth/scopes.decorator';
import { EntityService } from '../../foundation/entity/entity.service';
import { fiscalWayOf } from '../../foundation/fiscal/fiscal-ways';
import { GlosError } from '../../foundation/http/glos-error';
import { FiscalInvoiceQueryDto } from './fiscal-invoice.dto';
import { FiscalInvoiceService } from './fiscal-invoice.service';
import { FiscalInvoice, FiscalInvoiceList } from './fiscal-invoice.types';
import { ParcelService } from './parcel.service';
import { PersonService } from './person.service';
import { VendorService } from './vendor.service';

/**
 * THE KENYAN COMPANY'S TAX INVOICES (KRA eTIMS; Kenya only). Read by the company — network staff, or its own admin —
 * and each by its buyer: the shop, the store, or the person who sent the parcel. Sent again by the company only. Not at
 * the counter: a shop's tax papers are the owner's, never a counter assistant's (at-the-counter.ts).
 */
@Controller('sbg')
export class FiscalInvoiceController {
  constructor(
    private readonly invoices: FiscalInvoiceService,
    private readonly entities: EntityService,
    private readonly parcels: ParcelService,
    private readonly persons: PersonService,
    private readonly vendors: VendorService,
  ) {}

  @Roles('operator', 'entity_admin')
  @Get('fiscal-invoices')
  list(@Query() q: FiscalInvoiceQueryDto, @Actor() actor: IntrospectionResult): FiscalInvoiceList {
    const reach = actor?.role === 'operator' ? undefined : new Set(this.entities.administrable(actor?.tenant).map((e) => e.entityId));
    if (q.entityId && reach && !reach.has(q.entityId)) throw new GlosError('NOT_FOUND', `No such company: ${q.entityId}`);
    const entityIds = q.entityId ? new Set([q.entityId]) : reach;
    // Whether the company asked about uses eTIMS at all — said by the server, so no screen keeps its own list of countries.
    const way = q.entityId ? fiscalWayOf(this.entities.find(q.entityId)?.jurisdiction) : undefined;
    return { ...this.invoices.list({ ...(entityIds ? { entityIds } : {}), state: q.state, limit: q.limit, offset: q.offset }), ...(way ? { way } : {}) };
  }

  /** A shop's or a store's own tax invoices, the newest first: what it claims its VAT back with. */
  @SignedIn()
  @Get('fiscal-invoices/mine')
  mine(@Actor() actor: IntrospectionResult): FiscalInvoice[] {
    if (!actor?.did) return [];
    if (actor.role === 'agent') return this.invoices.forBuyer('shop', actor.did);
    const store = this.vendors.byDid(actor.did);
    return store ? this.invoices.forBuyer('store', store.vendorId) : [];
  }

  @SignedIn()
  @Get('fiscal-invoices/:invoiceId')
  one(@Param('invoiceId') invoiceId: string, @Actor() actor: IntrospectionResult): FiscalInvoice {
    return this.readable(invoiceId, actor);
  }

  /**
   * The invoice as a page to print or keep, once KRA has signed it: the buyer's first opening is the original, every
   * other a copy (KRA's rules for a till).
   */
  @SignedIn()
  @Get('fiscal-invoices/:invoiceId/invoice.html')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'private, no-store')
  page(@Param('invoiceId') invoiceId: string, @Actor() actor: IntrospectionResult): string {
    const inv = this.readable(invoiceId, actor);
    return this.invoices.pageFor(inv, !this.isCompany(inv, actor));
  }

  /** The invoices for one parcel or load that the caller may read: none, rather than a refusal that says it exists. */
  @SignedIn()
  @Get('parcels/:id/fiscal-invoices')
  forParcel(@Param('id') id: string, @Actor() actor: IntrospectionResult): FiscalInvoice[] {
    return this.invoices.forRef(id).filter((inv) => this.mayRead(inv, actor));
  }

  /** Send one again — one KRA refused, once what it refused is fixed; then the ones held behind it go too. The company's act. */
  @Roles('operator', 'entity_admin')
  @Post('fiscal-invoices/:invoiceId/retry')
  retry(@Param('invoiceId') invoiceId: string, @Actor() actor: IntrospectionResult): Promise<FiscalInvoice> {
    const inv = this.invoices.require(invoiceId);
    if (!this.isCompany(inv, actor)) throw new GlosError('NOT_FOUND', 'No such invoice');
    return this.invoices.retry(invoiceId);
  }

  private readable(invoiceId: string, actor: IntrospectionResult): FiscalInvoice {
    const inv = this.invoices.require(invoiceId);
    if (!this.mayRead(inv, actor)) throw new GlosError('NOT_FOUND', 'No such invoice');
    return inv;
  }

  private isCompany(inv: FiscalInvoice, actor: IntrospectionResult | undefined): boolean {
    if (actor?.role === 'operator') return true;
    return actor?.role === 'entity_admin' && this.entities.mayAdminister(actor.tenant, inv.entityId);
  }

  /** The company that issued it, and its buyer. Nobody else learns that it exists. */
  private mayRead(inv: FiscalInvoice, actor: IntrospectionResult | undefined): boolean {
    if (this.isCompany(inv, actor)) return true;
    if (!actor?.did) return false;
    switch (inv.buyer.kind) {
      case 'shop':
        return actor.role === 'agent' && actor.did === inv.buyer.id;
      case 'store':
        try {
          return Boolean(inv.buyer.id) && this.vendors.get(inv.buyer.id!).did === actor.did;
        } catch {
          return false;
        }
      case 'person':
        // The person who sent it, read by the parcel's own rule: whoever its sender's account is today.
        if (actor.role !== 'consumer' || !inv.ref) return false;
        try {
          return this.parcels.sentBy(inv.ref, this.persons.requireByDid(actor.did));
        } catch {
          return false;
        }
    }
  }
}
