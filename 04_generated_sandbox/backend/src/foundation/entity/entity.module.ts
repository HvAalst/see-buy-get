import { Global, Module } from '@nestjs/common';
import { EntityService } from './entity.service';
import { EntityAdminService } from './entity-admin.service';

/** Global: every module that names who collects, who performs, or who owns an account needs this. */
@Global()
@Module({
  providers: [EntityService, EntityAdminService],
  exports: [EntityService, EntityAdminService],
})
export class EntityModule {}
