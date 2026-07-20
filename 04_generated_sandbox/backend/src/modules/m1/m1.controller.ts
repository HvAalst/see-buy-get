import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Public } from '../../foundation/auth/public.decorator';
import { IdentityService } from './identity.service';
import { AddRoleDto, RegisterDto, VerifyBusinessDto, VerifyIdentityDto } from './identity.dto';
import { AccountSummary } from './participant.types';
import { LivenessChallenge } from './liveness/liveness.service';

interface ModuleInfo {
  module: string;
  name: string;
  epic: string;
  status: 'scaffold' | 'active';
}

@Controller('identity')
export class M1Controller {
  constructor(private readonly identity: IdentityService) {}

  /** Module info — protected (requires a token). */
  @Get()
  info(): ModuleInfo {
    return {
      module: 'M1',
      name: 'Unified Digital Identity & Wallet (UDIW)',
      epic: '02_epic_domains/epic_m1_identity_wallet.md',
      status: 'active',
    };
  }

  // --- Onboarding (public: the front door, pre-credentials) ---

  @Public()
  @Post('register')
  register(@Body() dto: RegisterDto): AccountSummary {
    const { deviceFingerprint, paymentInstrumentHash, ...rest } = dto;
    return this.identity.register({ ...rest, signals: { deviceFingerprint, paymentInstrumentHash } });
  }

  @Public()
  @Post('liveness/challenge')
  livenessChallenge(): LivenessChallenge {
    return this.identity.issueLivenessChallenge();
  }

  @Public()
  @Post('accounts/:accountId/roles')
  addRole(@Param('accountId') accountId: string, @Body() dto: AddRoleDto): AccountSummary {
    return this.identity.addRole(accountId, dto.role);
  }

  @Public()
  @Post('accounts/:accountId/verify-identity')
  verifyIdentity(@Param('accountId') accountId: string, @Body() dto: VerifyIdentityDto) {
    return this.identity.verifyIdentity(accountId, dto);
  }

  @Public()
  @Post('accounts/:accountId/verify-business')
  verifyBusiness(@Param('accountId') accountId: string, @Body() dto: VerifyBusinessDto): AccountSummary {
    return this.identity.verifyBusiness(accountId, dto);
  }

  @Public()
  @Get('accounts/:accountId')
  getAccount(@Param('accountId') accountId: string): AccountSummary {
    return this.identity.getAccount(accountId);
  }
}
