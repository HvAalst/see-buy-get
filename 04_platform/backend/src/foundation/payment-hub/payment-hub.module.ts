import { Global, Logger, Module } from '@nestjs/common';
import { PaymentHubService } from './payment-hub.service';

/**
 * THE PAYMENT HUB (the payments plan, step 4). Global, like the payouts and Mollie: a partner's account is not one module's
 * business. Said at boot, so a server shows which providers it can reach — for now the stand-in alone, test money only.
 */
@Global()
@Module({
  providers: [PaymentHubService],
  exports: [PaymentHubService],
})
export class PaymentHubModule {
  constructor(hub: PaymentHubService) {
    new Logger('PaymentHubModule').log(`The payment hub reaches: ${hub.ready().join(', ')} (test money only, until a partner's key is kept and switched live)`);
  }
}
