import { Global, Module } from '@nestjs/common';
import { EntityService } from './entity.service';
import { EntityAdminService } from './entity-admin.service';
import { CompanyDocumentService } from './company-documents.service';
import { CompanyReadinessService } from './company-readiness.service';

/** Global: every module that names who collects, who performs, or who owns an account needs this. */
@Global()
@Module({
  providers: [EntityService, EntityAdminService, CompanyDocumentService, CompanyReadinessService],
  exports: [EntityService, EntityAdminService, CompanyDocumentService, CompanyReadinessService],
})
export class EntityModule {}
