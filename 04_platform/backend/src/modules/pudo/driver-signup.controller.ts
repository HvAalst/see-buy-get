import { Body, Controller, Optional, Post } from '@nestjs/common';
import { AgreementService } from '../../foundation/documents/agreement.service';
import { countryOfPhone } from '../../foundation/countries/catalogue';
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
  constructor(
    private readonly accounts: AccountService,
    // 2026-10-25 — the person signing up as a driver has agreed to what counts now, or agrees with this sign-up.
    @Optional() private readonly agreements?: AgreementService,
  ) {}

  @Roles('consumer')
  @Post('drivers/signups')
  signUp(@Body() dto: DriverSignupDto, @Actor() actor: IntrospectionResult): { did: string; entityStatus?: string } {
    const personDid = actor?.personDid ?? actor?.did;
    if (!personDid) throw new GlosError('FORBIDDEN', 'Sign in first');
    const country = (dto.profile as { driver?: { jurisdiction?: string } })?.driver?.jurisdiction ?? countryOfPhone(dto.phone);
    this.agreements?.assertFor(actor, dto.agreement, 'drivers/signups', country);
    return this.accounts.signUpDriver(personDid, dto.phone, dto.profile);
  }
}
