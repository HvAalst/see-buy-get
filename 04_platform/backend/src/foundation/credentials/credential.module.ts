import { Global, Module } from '@nestjs/common';
import { CredentialService } from './credential.service';

/** Global VC registry — M1 issues background-check/capability VCs; M5 will issue badges. */
@Global()
@Module({
  providers: [CredentialService],
  exports: [CredentialService],
})
export class CredentialModule {}
