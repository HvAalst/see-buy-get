import { Global, Module } from '@nestjs/common';
import { DidService } from './did.service';
import { DidController } from './did.controller';

/** Global so M2 (party↔DID linking) and the M6 auth shim can inject DidService. */
@Global()
@Module({
  controllers: [DidController],
  providers: [DidService],
  exports: [DidService],
})
export class DidModule {}
