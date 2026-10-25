import { Global, Module } from '@nestjs/common';
import { AgreementService } from './agreement.service';
import { DocumentsService } from './documents.service';

/**
 * The documents a sign-up agrees to, and who agreed to which version. Global: every door that makes an account asks
 * it, and the console writes the documents. It knows about nothing but itself.
 */
@Global()
@Module({
  providers: [DocumentsService, AgreementService],
  exports: [DocumentsService, AgreementService],
})
export class DocumentsModule {}
