import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { RestingAccounts } from './resting-accounts';

/**
 * Registers the global AuthGuard so every endpoint requires a valid token unless @Public().
 * Depends on DidModule (global) for DID-bound token introspection.
 */
@Global()
@Module({
  controllers: [AuthController],
  providers: [AuthService, RestingAccounts, { provide: APP_GUARD, useClass: AuthGuard }],
  exports: [AuthService, RestingAccounts],
})
export class AuthModule {}
