import { Body, Controller, Get, Headers, Param, Post, UseGuards } from '@nestjs/common';
import { IdempotencyService } from '../../foundation/http/idempotency.service';
import { OwnIdempotency } from '../../foundation/http/idempotency.interceptor';
import { Public } from '../../foundation/auth/public.decorator';
import { RateLimit, RateLimitGuard } from '../../foundation/http/rate-limit.guard';
import { ShippingApiService } from './shipping-api.service';
import { ApiKeyGuard, CallerKey } from './api-key.guard';
import type { Caller } from './api-key.service';
import { CancelShipmentDto, MintShipmentDto, PublicQuoteDto } from './pudo.dto';

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
   * carrying it, calling it off is a conversation rather than an API call.
   *
   * THERE IS NO AMEND, deliberately. Moving a parcel's destination or changing its size changes what it
   * costs, and an "edit" that quietly re-prices something a buyer already paid for is the worst possible
   * version of this call. Cancel and create the replacement, so the new price is seen and agreed.
   */
  @Public()
  @RateLimit(30, 60)
  @Post('shipments/:shipmentId/cancel')
  cancelShipment(@Param('shipmentId') shipmentId: string, @Body() dto: CancelShipmentDto, @CallerKey() caller: Caller) {
    return this.shipping.cancelShipment(shipmentId, caller, dto.reason);
  }
}
