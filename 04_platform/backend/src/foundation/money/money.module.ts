import { Global, Module } from '@nestjs/common';
import { FxService } from './fx.service';

/** Global: any module that puts a price on something across two markets needs the rate book. */
@Global()
@Module({
  providers: [FxService],
  exports: [FxService],
})
export class MoneyModule {}
