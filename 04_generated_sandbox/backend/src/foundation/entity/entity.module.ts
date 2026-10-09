import { Global, Module } from '@nestjs/common';
import { EntityService } from './entity.service';
import { EntityAdminService } from './entity-admin.service';
import { OperatorAccountService } from './operator-account.service';
import { CompanyDocumentService } from './company-documents.service';
import { CompanyReadinessService } from './company-readiness.service';
import { CompanyPapersWatch } from './company-papers-watch.service';
import { CompanyDeclarationService } from './company-declarations.service';

/** Global: every module that names who collects, who performs, or who owns an account needs this. */
@Global()
@Module({
  providers: [EntityService, EntityAdminService, OperatorAccountService, CompanyDocumentService, CompanyReadinessService, CompanyPapersWatch, CompanyDeclarationService],
  exports: [EntityService, EntityAdminService, OperatorAccountService, CompanyDocumentService, CompanyReadinessService, CompanyPapersWatch, CompanyDeclarationService],
})
export class EntityModule {}
