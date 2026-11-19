import { Global, Logger, Module } from '@nestjs/common';
import { MollieConnectService } from './mollie-connect.service';

/**
 * MOLLIE, for a payment straight to the carrier (the payments plan, part 2). Global, like the payouts: a carrier's own
 * account is not one module's business. Said at boot, so a server shows which way it connects carriers, if any.
 */
@Global()
@Module({
  providers: [MollieConnectService],
  exports: [MollieConnectService],
})
export class MollieModule {
  constructor(mollie: MollieConnectService) {
    const via = mollie.via();
    new Logger('MollieModule').log(
      via === 'oauth'
        ? `Carriers connect their own Mollie account through the Connect app (${mollie.cfg.testmode ? 'test payments' : 'live'})`
        : via === 'test_key'
          ? 'Mollie runs on SeeBuyGet’s own test key: test payments only, until the Connect app is set up'
          : 'Mollie is not set up: carriers in the Netherlands are not offered it',
    );
  }
}
