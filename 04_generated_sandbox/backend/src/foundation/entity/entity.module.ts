import { Global, Module } from '@nestjs/common';
import { EntityService } from './entity.service';

/** Global: every module that names who collects, who performs, or who owns an account needs this. */
@Global()
@Module({
  providers: [EntityService],
  exports: [EntityService],
})
export class EntityModule {}
