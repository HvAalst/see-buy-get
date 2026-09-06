import { Module } from '@nestjs/common';
import { HttpModule } from './foundation/http/http.module';
import { EventBusModule } from './foundation/events/event-bus.module';
import { DataFirewallModule } from './foundation/data-firewall/data-firewall.module';
import { CredentialModule } from './foundation/credentials/credential.module';
import { LedgerModule } from './foundation/ledger/ledger.module';
import { DidModule } from './foundation/did/did.module';
import { EntityModule } from './foundation/entity/entity.module';
import { BooksModule } from './foundation/books/books.module';
import { PayoutsModule } from './foundation/payouts/payouts.module';
import { MoneyModule } from './foundation/money/money.module';
import { AuthModule } from './foundation/auth/auth.module';
import { HealthModule } from './health/health.module';
import { M1Module } from './modules/m1/m1.module';
import { M2Module } from './modules/m2/m2.module';
import { M3Module } from './modules/m3/m3.module';
import { M4Module } from './modules/m4/m4.module';
import { M5Module } from './modules/m5/m5.module';
import { M6Module } from './modules/m6/m6.module';
import { M7Module } from './modules/m7/m7.module';
import { PudoModule } from './modules/pudo/pudo.module';
import { SseModule } from './modules/sse/sse.module';

/**
 * Root module.
 *
 * Foundations (Sprint 0): LedgerModule (T-004), DidModule (T-005), AuthModule (T-006,
 * registers the global auth guard). All global, so feature modules inject them directly.
 *
 * Feature module skeletons (T-001): M1 → M2 (+M6 parallel). M3/M4/M5/SSE/M7 added later.
 */
@Module({
  imports: [
    HttpModule,
    EventBusModule,
    DataFirewallModule,
    CredentialModule,
    LedgerModule,
    DidModule,
    EntityModule,
    BooksModule,
    PayoutsModule,
    MoneyModule,
    AuthModule,
    HealthModule,
    M1Module,
    M2Module,
    M3Module,
    M4Module,
    M5Module,
    M6Module,
    M7Module,
    PudoModule,
    SseModule,
  ],
})
export class AppModule {}
