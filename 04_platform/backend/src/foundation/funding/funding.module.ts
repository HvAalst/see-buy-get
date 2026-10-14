import { Global, Logger, Module } from '@nestjs/common';
import { FundingService } from './funding.service';
import { SandboxFundingRail } from './sandbox-funding-rail.adapter';
import { MpesaFundingRail, mpesaConfigFromEnv } from './mpesa-funding-rail.adapter';
import { FUNDING_RAIL, FundingRail } from './funding.types';
import { FundingController } from './funding.controller';

/**
 * Global, like the books it posts to and like the payouts it mirrors: money arriving is not one module's
 * business, and a shop's float and a store's prepaid balance come in through the same door.
 *
 * WHICH RAIL IS DECIDED BY CONFIGURATION, NOT BY A FLAG.
 *
 * There is no `GLOS_USE_MPESA=1`. The M-Pesa rail is used when — and only when — it has everything it
 * needs to work: credentials, a shortcode, a passkey and a public callback base. A boolean switch beside
 * an incomplete configuration is how a deployment ends up with a rail that accepts top-up requests and
 * can neither prompt anybody nor be called back, which fails in the one place nobody is looking.
 *
 * Both choices are announced at boot, because "which rail is this deployment on" is the first question
 * anybody asks when a payment does not arrive, and reading it out of the environment is a worse way to
 * find out than reading it in the log.
 */
@Global()
@Module({
  controllers: [FundingController],
  providers: [
    FundingService,
    SandboxFundingRail,
    {
      provide: FUNDING_RAIL,
      inject: [SandboxFundingRail],
      useFactory: (sandbox: SandboxFundingRail): FundingRail => {
        const logger = new Logger('FundingRail');
        const config = mpesaConfigFromEnv();
        if (!config) {
          logger.log('no payment provider is configured — money can only be confirmed by staff against a statement');
          return sandbox;
        }
        logger.log(`M-Pesa (${config.env}) on ${config.kind} ${config.shortcode}: STK push, with the paybill as the fallback`);
        return new MpesaFundingRail(config);
      },
    },
  ],
  exports: [FundingService, FUNDING_RAIL],
})
export class FundingModule {}
