import { Global, Module } from '@nestjs/common';
import { FieldEncryption } from './field-encryption.service';
import { IdentityVault } from './identity-vault.service';
import { OperationalStore } from './operational-store.service';

/**
 * The data firewall (T-003, §3.4 / M1-E12). Global so M1 stores PII in the vault and
 * operational attributes in the core, and so M2/M3 read only the Operational Core.
 */
@Global()
@Module({
  providers: [FieldEncryption, IdentityVault, OperationalStore],
  exports: [FieldEncryption, IdentityVault, OperationalStore],
})
export class DataFirewallModule {}
