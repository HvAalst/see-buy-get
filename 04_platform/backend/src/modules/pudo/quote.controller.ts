import { Body, Controller, Get, Header, Param, Post, Res, StreamableFile, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { Actor } from '../../foundation/auth/actor.decorator';
import { IntrospectionResult } from '../../foundation/auth/auth.types';
import { auditActor } from '../../foundation/auth/acting';
import { SignedIn } from '../../foundation/auth/scopes.decorator';
import { GlosError } from '../../foundation/http/glos-error';
import { NETWORK_CURRENCY } from './pudo.config';
import { DispatchService } from './dispatch.service';
import { DepartureService } from './departure.service';
import { DriverService } from './driver.service';
import { FleetManagerService } from './fleet-manager.service';
import { QuoteService, QuoteActor } from './quote.service';
import { Quote, QuoteParty } from './quote.types';
import { BusinessMemberGuard } from './business-member.guard';
import { EntityService } from '../../foundation/entity/entity.service';
import { QuoteProformaDto, QuoteStatusDto, RecordCarrierQuoteDto } from './quote.dto';

/**
 * QUOTATIONS FOR ANYONE — the figure one party asked another to pay, the proforma, and open or paid as a party
 * confirms it. Never a posting (the user, 2026-10-04). See quote.types.ts.
 *
 * The routes on ONE quotation answer only its two parties. A company acts by its entityId (a business, a company's
 * administrator); anybody else by their DID. Network staff read nothing here: there is nothing for them to decide.
 */
@Controller('sbg')
@UseGuards(BusinessMemberGuard)
export class QuoteController {
  constructor(
    private readonly quotes: QuoteService,
    private readonly dispatch: DispatchService,
    private readonly departures: DepartureService,
    private readonly drivers: DriverService,
    private readonly managers: FleetManagerService,
    private readonly entities: EntityService,
  ) {}

  @SignedIn()
  @Get('quotes/:quoteId')
  read(@Param('quoteId') quoteId: string, @Actor() actor: IntrospectionResult): Quote {
    return this.ownQuote(quoteId, actor);
  }

  /** Paid, or back to open — confirmed by a party, with their reference. */
  @SignedIn()
  @Post('quotes/:quoteId/status')
  setStatus(@Param('quoteId') quoteId: string, @Body() dto: QuoteStatusDto, @Actor() actor: IntrospectionResult): Quote {
    return this.quotes.setStatus(quoteId, dto.status, actorOf(actor), dto.reference);
  }

  /** The payer agrees to the figure. */
  @SignedIn()
  @Post('quotes/:quoteId/agree')
  agree(@Param('quoteId') quoteId: string, @Actor() actor: IntrospectionResult): Quote {
    return this.quotes.agree(quoteId, actorOf(actor));
  }

  /** Attach the proforma invoice — either party, kept as handed over. */
  @SignedIn()
  @Post('quotes/:quoteId/proforma')
  attachProforma(@Param('quoteId') quoteId: string, @Body() dto: QuoteProformaDto, @Actor() actor: IntrospectionResult): Quote {
    return this.quotes.attachProforma(quoteId, actorOf(actor), { dataUrl: dto.dataUrl, fileName: dto.fileName });
  }

  @SignedIn()
  @Get('quotes/:quoteId/proforma')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  proforma(@Param('quoteId') quoteId: string, @Actor() actor: IntrospectionResult, @Res({ passthrough: true }) res: Response): StreamableFile {
    const file = this.quotes.proformaFile(quoteId, actorOf(actor));
    res.setHeader('X-Fingerprint', file.fingerprint);
    res.setHeader('Access-Control-Expose-Headers', 'X-Fingerprint');
    return new StreamableFile(file.bytes, { type: file.contentType, disposition: `inline; filename="${file.fileName.replace(/"/g, '')}"` });
  }

  /* ------------------------------------------------- on a load and on a booking -- */

  /**
   * THE CARRIER'S QUOTATION FOR A LOAD — recorded by whoever posted it, from what the carrier sent them.
   *
   * Only once a carrier has the load (there is nobody to have quoted before). The figure defaults to the price the two
   * agreed on the board; the poster may state what the carrier actually invoiced. Kept as agreed: by posting and
   * claiming, both sides already said yes to it.
   */
  @SignedIn()
  @Get('dispatch/freight/:id/quote')
  freightQuote(@Param('id') id: string, @Actor() actor: IntrospectionResult): { quote: Quote | null } {
    const f = this.dispatch.requireFreightPublic(id);
    this.requirePoster(f.postedByDid, actor);
    return { quote: this.quotes.forSubject('freight', f.freightId) ?? null };
  }

  @SignedIn()
  @Post('dispatch/freight/:id/quote')
  recordFreightQuote(@Param('id') id: string, @Body() dto: RecordCarrierQuoteDto, @Actor() actor: IntrospectionResult): Quote {
    const f = this.dispatch.requireFreightPublic(id);
    this.requirePoster(f.postedByDid, actor);
    const carrierDid = this.dispatch.carrierOf(f);
    if (!carrierDid) throw new GlosError('INVALID_STATE', 'No carrier has taken this load yet, so nobody has quoted for it');
    const amount = dto.amount ?? f.lockedPrice;
    if (amount == null) throw new GlosError('FIELD_REQUIRED', 'Say what the carrier is asking', { field: 'amount' });
    return this.quotes.quote(
      {
        subject: { kind: 'freight', id: f.freightId, code: f.code },
        issuer: this.carrierParty(carrierDid),
        payer: this.payerParty(f.postedByDid!, actor),
        amount,
        currency: dto.currency ?? NETWORK_CURRENCY,
        note: dto.note,
        reference: dto.reference,
        agreed: true,
      },
      auditActor(actor),
    );
  }

  @SignedIn()
  @Get('departures/:departureId/bookings/:bookingId/quote')
  bookingQuote(@Param('departureId') departureId: string, @Param('bookingId') bookingId: string, @Actor() actor: IntrospectionResult): { quote: Quote | null } {
    const { booking } = this.bookingFor(departureId, bookingId, actor);
    return { quote: this.quotes.forSubject('booking', booking.bookingId) ?? null };
  }

  /** The run's price is the carrier's published rate, agreed by booking; the shipper may state what was invoiced. */
  @SignedIn()
  @Post('departures/:departureId/bookings/:bookingId/quote')
  recordBookingQuote(@Param('departureId') departureId: string, @Param('bookingId') bookingId: string, @Body() dto: RecordCarrierQuoteDto, @Actor() actor: IntrospectionResult): Quote {
    const { departure, booking } = this.bookingFor(departureId, bookingId, actor);
    return this.quotes.quote(
      {
        subject: { kind: 'booking', id: booking.bookingId, code: departure.lineName },
        issuer: this.carrierParty(departure.managerDid),
        payer: this.payerParty(booking.shipperDid, actor),
        amount: dto.amount ?? booking.price,
        currency: dto.currency ?? departure.rate.currency,
        note: dto.note,
        reference: dto.reference,
        agreed: true,
      },
      auditActor(actor),
    );
  }

  /* ------------------------------------------------------------------ helpers -- */

  private ownQuote(quoteId: string, actor: IntrospectionResult): Quote {
    const q = this.quotes.get(quoteId);
    if (!this.quotes.sideOf(q, actorOf(actor))) throw new GlosError('NOT_FOUND', 'No such quotation');
    return q;
  }

  private requirePoster(postedByDid: string | undefined, actor: IntrospectionResult): void {
    if (!postedByDid || !actor?.did || actor.did !== postedByDid) throw new GlosError('NOT_FOUND', 'Freight not found');
  }

  private bookingFor(departureId: string, bookingId: string, actor: IntrospectionResult) {
    const departure = this.departures.require(departureId);
    const booking = departure.bookings.find((b) => b.bookingId === bookingId);
    if (!booking || booking.kind !== 'sold' || !actor?.did || booking.shipperDid !== actor.did) throw new GlosError('NOT_FOUND', 'No such booking');
    return { departure, booking };
  }

  /** The one who pays: a business by its registered name and entityId, so everybody in it is the same party. */
  private payerParty(did: string, actor: IntrospectionResult): QuoteParty {
    const business = this.entities.byDid(did);
    if (business?.kind === 'business') return { name: business.name, entityId: business.entityId, did };
    return { name: actor.actorName || 'The shipper', did };
  }

  /** A carrier by name: a fleet by its trading name, an owner-driver by the name they drive under. */
  private carrierParty(did: string): QuoteParty {
    try {
      return { name: this.managers.get(did).companyName, did };
    } catch {
      try {
        return { name: this.drivers.get(did).displayName, did };
      } catch {
        return { name: 'The carrier', did };
      }
    }
  }
}

/** Who is acting: a company by its entityId (a business or an administrator), anybody else by their DID. */
function actorOf(actor: IntrospectionResult): QuoteActor {
  const company = actor?.role === 'business' || actor?.role === 'entity_admin' ? actor.tenant : undefined;
  return { name: auditActor(actor), ...(company ? { entityId: company } : {}), ...(actor?.did ? { did: actor.did } : {}) };
}
