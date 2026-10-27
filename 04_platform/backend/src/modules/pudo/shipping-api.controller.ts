import { Body, Controller, Get, Header, Headers, Param, Post, Put, Query, Res, UseGuards } from '@nestjs/common';
import { ApiQuery } from '@nestjs/swagger';
import type { Response } from 'express';
import { GlosError } from '../../foundation/http/glos-error';
import { zplOut } from '../../foundation/label/zpl';
import { ParcelInvoice, ParcelInvoiceDto, ParcelInvoiceView } from './parcel-invoice.types';
import { IdempotencyService } from '../../foundation/http/idempotency.service';
import { OwnIdempotency } from '../../foundation/http/idempotency.interceptor';
import { Public } from '../../foundation/auth/public.decorator';
import { RateLimit, RateLimitGuard } from '../../foundation/http/rate-limit.guard';
import { ShippingApiService } from './shipping-api.service';
import { CallOffView } from './call-off.types';
import { ApiKeyGuard, CallerKey } from './api-key.guard';
import type { Caller } from './api-key.service';
import { CancelShipmentDto, MintShipmentDto, PublicQuoteDto, ShippingPhotoDto } from './pudo.dto';

/**
 * The public shipping API — SBG as a Shipment Service Provider.
 *
 * Its own controller rather than another route on the internal one, and the separation is the point: this
 * is the surface a merchant integrates once and builds a checkout on, so what it promises has to be stable
 * in a way an internal route does not. Keeping it apart is what will let it get merchant keys, a sandbox
 * mode and its own limits without any of that leaking into the field apps.
 *
 * Versioned by the platform's own `/v1` prefix, which is the mechanism the whole API already uses: a
 * breaking change is a `/v2`, and everything here is additive until then.
 *
 * A key is OPTIONAL here and stays that way. A merchant should be able to paste a button into a page and
 * see a price before they have an account — a product that demands a signup before it demonstrates
 * anything does not get integrated. A key buys a limit of your own and the costed breakdown.
 *
 * What it does NOT have yet, said plainly because an integrator will ask: idempotency keys, and minting.
 */
@Controller('sbg/shipping')
@UseGuards(ApiKeyGuard, RateLimitGuard) // in this order: the limit spends whoever the first guard found
export class ShippingApiController {
  constructor(
    private readonly shipping: ShippingApiService,
    private readonly idempotency: IdempotencyService,
  ) {}

  /**
   * What would this cost to ship? Creates nothing — no parcel, no account, no reservation.
   *
   * The one call the "calculate your shipping fee" button makes. A key is optional: send one in
   * `X-SBG-Key` and the limit becomes yours rather than your IP's, and a server-side key also returns the
   * costed breakdown.
   */
  @Public()
  @RateLimit(60, 60) // one a second, sustained, per caller — generous for a product page, useless for a scrape
  @Post('quotes')
  quote(@Body() dto: PublicQuoteDto, @CallerKey() caller: Caller) {
    return this.shipping.quote(dto, caller);
  }

  /**
   * Round 30 — the photo of what is in the box, sent before the shipment is made: the `photoId` it gives is what the
   * shipment names as `contentPhotoRef`. A secret key, as making the shipment needs. JPEG, PNG or WebP as a data URL,
   * up to 500 KB; one no shipment names is removed after two days (`keptUnusedUntil`).
   */
  @Public()
  @RateLimit(30, 60)
  @Post('photos')
  photo(@Body() dto: ShippingPhotoDto, @CallerKey() caller: Caller): { photoId: string; keptUnusedUntil: string } {
    return this.shipping.uploadPhoto(dto, caller);
  }

  /**
   * Turn a price into a shipment. Needs a SECRET key: a credential that ships things must never sit in a
   * page. Send an `Idempotency-Key` header and the same name is spent at most once, however many times a
   * flaky network makes you ask.
   *
   * A TEST key runs every check and creates nothing — see ShippingApiService.mint.
   */
  @Public() // "public" as in no session; the key is the credential, and mint requires a secret one
  @OwnIdempotency() // it reports `replayed` on its own body, which the global interceptor cannot do
  @RateLimit(30, 60)
  @Post('shipments')
  async mint(@Body() dto: MintShipmentDto, @CallerKey() caller: Caller, @Headers('idempotency-key') idempotencyKey?: string) {
    const { result, replayed } = await this.idempotency.run(
      // Scoped to the merchant: two of them choosing the same uuid is unlikely and must still be harmless.
      `shipments:${caller.vendorId ?? 'anonymous'}`,
      idempotencyKey,
      dto,
      () => this.shipping.mint(dto, caller),
    );
    // Said on the body rather than only in a header, because a client that retried needs to know it got
    // the FIRST answer back — and bodies are what get logged, compared and pasted into a support ticket.
    return { ...result, replayed };
  }

  /**
   * Where the network can deliver: every country it operates in and the areas inside it that have a
   * collection point somebody can actually stand at. What a destination picker is built from.
   */
  @Public()
  @RateLimit(120, 60)
  @Get('areas')
  areas() {
    return this.shipping.areas();
  }

  /**
   * Where is my shipment? The state of one you created, read back by the key that created it.
   *
   * The price comes off the parcel, not from a fresh quote: re-pricing a sold shipment would have this
   * endpoint disagree with the merchant's own invoice. Somebody else's shipment answers NOT FOUND rather
   * than FORBIDDEN — "you may not see this" tells a stranger the id is real.
   *
   * The collection code is NOT here. It arrives on the `ready_for_pickup` callback, at the moment it is
   * useful and to an endpoint the store registered; on a pollable read it would sit in every log file that
   * ever recorded a response body.
   */
  @Public()
  @RateLimit(120, 60)
  @Get('shipments/:shipmentId')
  shipment(@Param('shipmentId') shipmentId: string, @CallerKey() caller: Caller) {
    return this.shipping.shipment(shipmentId, caller);
  }

  /**
   * Call it off, while it still can be.
   *
   * A secret key, for the reason minting needs one: a credential that can undo a shipment must never sit
   * in a page. The window is the network's own — Created, At_PUDO or At_MDP — and once somebody is
   * carrying it, calling it off is a conversation rather than an API call. Before it left the shop it was handed
   * in at, its price comes back in full; AT A HUB it is brought back to that shop as a new shipment the store pays
   * for (`returnShipmentId` on the answer) — ask `GET …/call-off` first for what it would cost.
   *
   * THERE IS NO AMEND, deliberately. Moving a parcel's destination or changing its size changes what it
   * costs, and an "edit" that quietly re-prices something a buyer already paid for is the worst possible
   * version of this call. Cancel and create the replacement, so the new price is seen and agreed.
   */
  /**
   * What calling it off would do now (2026-10-27) — asked before calling it off, since at a hub calling off costs: it is brought
   * back to the shop it was handed in at, as a new shipment the store pays for. `refund` with what comes back, `bring_back`
   * with the price, the shop and the hub, or `no` with why.
   */
  @Public()
  @RateLimit(120, 60)
  @Get('shipments/:shipmentId/call-off')
  @ApiQuery({ name: 'backTo', required: false, description: 'At a hub, for a shipment not handed in at a shop: a collection point id, or door' })
  callOffPreview(@Param('shipmentId') shipmentId: string, @Query('backTo') backTo: string | undefined, @CallerKey() caller: Caller): CallOffView {
    return this.shipping.callOffPreview(shipmentId, caller, backTo);
  }

  @Public()
  @RateLimit(30, 60)
  @Post('shipments/:shipmentId/cancel')
  cancelShipment(@Param('shipmentId') shipmentId: string, @Body() dto: CancelShipmentDto, @CallerKey() caller: Caller) {
    return this.shipping.cancelShipment(shipmentId, caller, dto.reason, { backTo: dto.backTo?.trim() || undefined, maxSpend: dto.maxSpend });
  }

  /**
   * Round 28 — the shipment's label, asked for again: as it came when the shipment was made (`svg`, the default), or
   * `format=zpl` for a thermal label printer — 203 dpi, 100 × 150 mm — sent to the printer as it is. Asked for on each
   * request, so a system printing on two kinds of printer asks for each. With a secret key, once the shipment is paid.
   */
  @Public()
  @RateLimit(120, 60)
  @Get('shipments/:shipmentId/label')
  @ApiQuery({ name: 'format', required: false, enum: ['svg', 'zpl'] })
  label(@Param('shipmentId') shipmentId: string, @CallerKey() caller: Caller, @Res({ passthrough: true }) res: Response, @Query('format') format?: string) {
    if (format === undefined || format === 'svg') return this.shipping.label(shipmentId, caller);
    if (format === 'zpl') return zplOut(res, this.shipping.labelZpl(shipmentId, caller));
    throw new GlosError('INVALID_INPUT', 'format is svg (the default) or zpl', { field: 'format' });
  }

  /* -- round 13: a store parcel's papers abroad — its commercial invoice, read, printed and corrected with a secret key -- */

  @Public()
  @RateLimit(120, 60)
  @Get('shipments/:shipmentId/invoice')
  invoice(@Param('shipmentId') shipmentId: string, @CallerKey() caller: Caller): ParcelInvoiceView {
    return this.shipping.papers(shipmentId, caller);
  }

  /** The three copies, one a page: printed by the store with the label, and put in the pouch. */
  @Public()
  @RateLimit(120, 60)
  @Get('shipments/:shipmentId/invoice.html')
  @Header('Content-Type', 'text/html; charset=utf-8')
  invoicePage(@Param('shipmentId') shipmentId: string, @CallerKey() caller: Caller): string {
    return this.shipping.papersPage(shipmentId, caller);
  }

  /** Correct it, until the parcel is handed in: a new invoice replaces it, and the old one stays on the record. */
  @Public()
  @RateLimit(30, 60)
  @Put('shipments/:shipmentId/invoice')
  correctInvoice(@Param('shipmentId') shipmentId: string, @Body() dto: ParcelInvoiceDto, @CallerKey() caller: Caller): ParcelInvoice {
    return this.shipping.correctPapers(shipmentId, dto, caller);
  }
}
