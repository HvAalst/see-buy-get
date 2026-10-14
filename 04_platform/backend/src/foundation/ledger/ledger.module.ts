import { Global, Module } from '@nestjs/common';
import { LedgerService } from './ledger.service';
import { FabricLedgerAdapter } from './fabric-ledger.adapter';
import { LEDGER_ADAPTER } from './ledger.types';

/**
 * Global so any module can inject LedgerService. The permissioned ledger is Hyperledger Fabric
 * (M2-050); swap FabricLedgerAdapter for another LedgerAdapter to change networks. (Unit tests
 * provide the in-memory adapter directly.)
 */
@Global()
@Module({
  providers: [LedgerService, { provide: LEDGER_ADAPTER, useClass: FabricLedgerAdapter }],
  exports: [LedgerService],
})
export class LedgerModule {}
