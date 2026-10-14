import { Global, Module } from '@nestjs/common';
import { InterestService } from './interest.service';

/**
 * Who is waiting for a country the network has not reached.
 *
 * Global like the presence it feeds: the join form writes to it, the console reads it, and the two-person
 * switch-on is the thing that finally answers it. Holding no domain dependency of its own, it can sit in
 * foundation without the registrar dance — it knows about countries and nothing else.
 */
@Global()
@Module({
  providers: [InterestService],
  exports: [InterestService],
})
export class InterestModule {}
