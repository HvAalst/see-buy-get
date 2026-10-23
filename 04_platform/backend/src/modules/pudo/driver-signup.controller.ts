import { Body, Controller, Post } from '@nestjs/common';
import { Actor } from '../../foundation/auth/actor.decorator';
import type { IntrospectionResult } from '../../foundation/auth/auth.types';
import { Roles } from '../../foundation/auth/scopes.decorator';
import { GlosError } from '../../foundation/http/glos-error';
import { AccountService } from './account.service';
import { DriverSignupDto } from './driver-signup.types';

/**
 * A DRIVER SIGNS UP SIGNED IN AS THEMSELVES (the user, 2026-10-23: "PIN in the sign-up"). The front page signs the
 * person in first — a code to the phone, a PIN, a recovery email the first time — and makes the driver under that
 * sign-in, so the Driver app opens with the same phone and PIN straight away. See AccountService.signUpDriver.
 */
@Controller('sbg')
export class DriverSignupController {
  constructor(private readonly accounts: AccountService) {}

  @Roles('consumer')
  @Post('drivers/signups')
  signUp(@Body() dto: DriverSignupDto, @Actor() actor: IntrospectionResult): { did: string; entityStatus?: string } {
    const personDid = actor?.personDid ?? actor?.did;
    if (!personDid) throw new GlosError('FORBIDDEN', 'Sign in first');
    return this.accounts.signUpDriver(personDid, dto.phone, dto.profile);
  }
}
