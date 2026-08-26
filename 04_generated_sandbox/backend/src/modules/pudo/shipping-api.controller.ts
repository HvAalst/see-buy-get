import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { Public } from '../../foundation/auth/public.decorator';
import { RateLimit, RateLimitGuard } from '../../foundation/http/rate-limit.guard';
import { ShippingApiService } from './shipping-api.service';
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
 * What it does NOT have yet, said plainly because an integrator will ask: merchant keys, a sandbox mode,
 * idempotency keys, and a per-merchant limit. Today the limit is per IP and the quote is anonymous.
 */
@Controller('sbg/shipping')
@UseGuards(RateLimitGuard)
export class ShippingApiController {
  constructor(private readonly shipping: ShippingApiService) {}

  /**
   * What would this cost to ship? Creates nothing — no parcel, no account, no reservation.
   *
   * The one call the "calculate your shipping fee" button makes.
   */
  @Public()
  @RateLimit(60, 60) // one a second, sustained, per caller — generous for a product page, useless for a scrape
  @Post('quotes')
  quote(@Body() dto: PublicQuoteDto) {
    return this.shipping.quote(dto);
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
