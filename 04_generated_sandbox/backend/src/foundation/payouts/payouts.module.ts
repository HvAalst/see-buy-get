import { Global, Module } from '@nestjs/common';
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
  providers: [PayoutService, SandboxPayoutRail, { provide: PAYOUT_RAIL, useExisting: SandboxPayoutRail }],
  exports: [PayoutService, PAYOUT_RAIL],
})
export class PayoutsModule {}
