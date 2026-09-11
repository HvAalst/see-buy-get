import { Global, Module } from '@nestjs/common';
import { PresenceService } from './presence.service';

/**
 * Global, for the same reason the entities are: every path that takes money, makes a promise or takes
 * goods into custody eventually has to ask how established we are where it is standing.
 */
@Global()
@Module({
  providers: [PresenceService],
  exports: [PresenceService],
})
export class PresenceModule {}
