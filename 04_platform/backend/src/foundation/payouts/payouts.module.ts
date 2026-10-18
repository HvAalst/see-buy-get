import { Global, Logger, Module } from '@nestjs/common';
import { MPESA_PAYOUT_RAIL, MpesaPayoutRail, mpesaPayoutConfigFromEnv } from './mpesa-payout-rail.adapter';
import { PayoutRailsController } from './payout-rails.controller';
import { PayoutService } from './payout.service';
import { SandboxPayoutRail } from './sandbox-rail.adapter';
import { PAYOUT_RAIL } from './payout.types';

/**
 * Global, like the books it draws down: paying a provider is not one module's business.
 *
 * The rail is bound by token so a real one — a mobile-money B2C call whose answer arrives on a callback —
 * replaces the sandbox adapter without a line changing anywhere else. Same seam as the geocoder and the
 * router, and for the same reason: the thing outside our walls is the thing most likely to be swapped.
 */
@Global()
@Module({
  controllers: [PayoutRailsController],
  providers: [
    PayoutService,
    SandboxPayoutRail,
    { provide: PAYOUT_RAIL, useExisting: SandboxPayoutRail },
    // KENYA'S WAY, where the environment sets it up (mpesa_rail.md). Said at start, as the inbound rail is.
    {
      provide: MPESA_PAYOUT_RAIL,
      useFactory: (): MpesaPayoutRail | null => {
        const config = mpesaPayoutConfigFromEnv();
        new Logger('PayoutsModule').log(config ? `M-Pesa payouts go through Daraja (${config.env}, shortcode ${config.shortcode})` : 'M-Pesa payouts are not set up: refused off a sandbox, stood in for on one');
        return config ? new MpesaPayoutRail(config) : null;
      },
    },
  ],
  exports: [PayoutService, PAYOUT_RAIL, MPESA_PAYOUT_RAIL],
})
export class PayoutsModule {}
