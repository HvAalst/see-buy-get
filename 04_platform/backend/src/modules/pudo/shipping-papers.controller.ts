import { Body, Controller, Get, Header, Param, Post, UseGuards } from '@nestjs/common';
import { Actor } from '../../foundation/auth/actor.decorator';
import { IntrospectionResult } from '../../foundation/auth/auth.types';
import { Roles, SignedIn } from '../../foundation/auth/scopes.decorator';
import { GlosError } from '../../foundation/http/glos-error';
import { BusinessMemberGuard } from './business-member.guard';
import { BusinessService } from './business.service';
import { CommercialInvoiceService } from './commercial-invoice.service';
import { CommercialInvoice, CommercialInvoiceView, OwnInvoicePaper } from './commercial-invoice.types';
import { DispatchService } from './dispatch.service';
import { ConsignmentNoteService } from './consignment-note.service';
import { Freight } from './dispatch.types';
import { tempBand } from './heavy-cargo';
import { packageLabelsHtml } from './package-labels';
import { CommercialInvoiceDto, OwnInvoicePaperDto } from './shipping-papers.dto';
import { PackageLabelsView } from './shipping-papers.types';
import { ShipperCodesService } from './shipper-codes.service';

/** What staff, a carrier or anybody but the shipper is told at the door that writes an invoice. */
const SHIPPER_ONLY = 'A commercial invoice is the shipper’s own paper: the business that posted the load writes it, and staff and carriers read it';

/**
 * THE PAPERS A SHIPPER PUTS ON ITS GOODS: the package labels — our code and, under its GS1 company prefix, the global
 * one beside it — and the commercial invoice customs reads at a border, in three copies.
 *
 * Read by whoever reads the load's consignment note (the sender, the carrier, staff). Written only by the business that
 * posted the load: staff read and change none of it, the same rule as every record a company keeps for itself.
 */
@Controller('sbg')
@UseGuards(BusinessMemberGuard)
export class ShippingPapersController {
  constructor(
    private readonly notes: ConsignmentNoteService,
    private readonly codes: ShipperCodesService,
    private readonly invoices: CommercialInvoiceService,
    private readonly businesses: BusinessService,
    private readonly dispatch: DispatchService,
  ) {}

  /** What the labels will carry: how many, and the SSCC of each package when the shipper's GS1 prefix gave them. */
  @SignedIn()
  @Get('dispatch/freight/:id/package-labels')
  labels(@Param('id') id: string, @Actor() actor: IntrospectionResult): PackageLabelsView {
    const f = this.notes.requireReader(id, actor);
    const issued = this.codes.codesFor(f.freightId);
    return {
      freightId: f.freightId,
      labels: Math.max(1, f.packages ?? 1),
      ...(f.packages ? { packages: f.packages } : {}),
      codes: issued?.codes ?? [],
      ...(issued ? { companyPrefix: issued.companyPrefix } : {}),
    };
  }

  /** The labels as a printable page: one 100 × 150 mm label a package. */
  @SignedIn()
  @Get('dispatch/freight/:id/package-labels.html')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'private, no-store')
  labelsHtml(@Param('id') id: string, @Actor() actor: IntrospectionResult): string {
    const f = this.notes.requireReader(id, actor);
    const note = this.notes.noteFor(f.freightId);
    const issued = this.codes.codesFor(f.freightId);
    const band = tempBand(f.natureCode);
    const invoice = this.invoices.current(f.freightId);
    return packageLabelsHtml({
      loadCode: f.code,
      description: f.description,
      ...(f.trackingKey ? { trackingKey: f.trackingKey } : {}),
      ...(note.trackingUrl ? { trackingUrl: note.trackingUrl } : {}),
      from: { name: note.sender.name, place: f.pickupLabel, ...(note.takingOver.country ? { country: note.takingOver.country } : {}) },
      to: { name: note.consignee.name, place: f.destLabel, ...(note.delivery.country ? { country: note.delivery.country } : {}) },
      ...(f.packages ? { packages: f.packages } : {}),
      codes: issued?.codes ?? [],
      ...(issued ? { companyPrefixLength: issued.companyPrefix.length } : {}),
      grossKg: f.weightKg,
      marks: [f.fragile ? 'Fragile' : '', band ? `Keep ${band.minC} °C to ${band.maxC} °C` : '', note.goods.dangerous ? 'Dangerous goods' : ''].filter(Boolean),
      ...(invoice ? { papers: `In the pouch: commercial invoice ${invoice.number}, ${invoice.copies} copies` } : {}),
    });
  }

  /** The load's commercial invoice: the one it travels with now, and the ones it replaced. */
  @SignedIn()
  @Get('dispatch/freight/:id/commercial-invoice')
  invoice(@Param('id') id: string, @Actor() actor: IntrospectionResult): CommercialInvoiceView {
    const f = this.notes.requireReader(id, actor);
    return this.invoices.view(f, this.mayWrite(f, actor), this.dispatch.postedByBusiness(f));
  }

  /**
   * Write and sign the load's commercial invoice — or a new one in place of the last, which stays on the record. The
   * business that posted the load, by a member who may act; staff are refused by name, because a staff sign-in passes
   * every role check.
   */
  @Roles('business')
  @Post('dispatch/freight/:id/commercial-invoice')
  writeInvoice(@Param('id') id: string, @Body() dto: CommercialInvoiceDto, @Actor() actor: IntrospectionResult): CommercialInvoice {
    if (actor?.role !== 'business') throw new GlosError('FORBIDDEN', SHIPPER_ONLY);
    const f = this.notes.requireReader(id, actor);
    const acting = this.businesses.requireMember(actor);
    if (!this.invoices.isShipper(f, acting.entity)) throw new GlosError('FORBIDDEN', SHIPPER_ONLY);
    return this.invoices.issue(f, { entity: acting.entity, name: acting.member.name }, dto);
  }

  /**
   * The shipper says its own paper invoice travels with the goods (or takes that back): the goods may then be taken
   * over without an invoice written here. The business that posted the load; staff are refused by name.
   */
  @Roles('business')
  @Post('dispatch/freight/:id/commercial-invoice/own-paper')
  ownPaper(@Param('id') id: string, @Body() dto: OwnInvoicePaperDto, @Actor() actor: IntrospectionResult): { ownPaper: OwnInvoicePaper | null } {
    if (actor?.role !== 'business') throw new GlosError('FORBIDDEN', SHIPPER_ONLY);
    const f = this.notes.requireReader(id, actor);
    const acting = this.businesses.requireMember(actor);
    if (!this.invoices.isShipper(f, acting.entity)) throw new GlosError('FORBIDDEN', SHIPPER_ONLY);
    return { ownPaper: this.invoices.sayOwnPaper(f, { entity: acting.entity, name: acting.member.name }, dto.travels) ?? null };
  }

  /** The invoice as a printable page: three copies, one a page. */
  @SignedIn()
  @Get('dispatch/freight/:id/commercial-invoice.html')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'private, no-store')
  invoiceHtml(@Param('id') id: string, @Actor() actor: IntrospectionResult): string {
    const f = this.notes.requireReader(id, actor);
    const current = this.invoices.current(f.freightId);
    if (!current) throw new GlosError('NOT_FOUND', 'This load has no commercial invoice yet');
    return this.invoices.htmlFor(current);
  }

  private mayWrite(f: Freight, actor: IntrospectionResult | undefined): boolean {
    if (actor?.role !== 'business') return false;
    try {
      const acting = this.businesses.requireMember(actor);
      return this.businesses.mayAct(acting) && this.invoices.isShipper(f, acting.entity) && f.status !== 'delivered' && f.status !== 'cancelled';
    } catch {
      return false;
    }
  }
}
