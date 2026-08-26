import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { Public } from '../../foundation/auth/public.decorator';
import { RateLimit, RateLimitGuard } from '../../foundation/http/rate-limit.guard';
import { ShippingApiService } from './shipping-api.service';
import { ApiKeyGuard, CallerKey } from './api-key.guard';
import type { Caller } from './api-key.service';
import { PublicQuoteDto } from './pudo.dto';

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
  constructor(private readonly shipping: ShippingApiService) {}

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
   * Where the network can deliver: every country it operates in and the areas inside it that have a
   * collection point somebody can actually stand at. What a destination picker is built from.
   */
  @Public()
  @RateLimit(120, 60)
  @Get('areas')
  areas() {
    return this.shipping.areas();
  }
}
