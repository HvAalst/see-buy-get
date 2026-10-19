import { CanActivate, ExecutionContext, Injectable, createParamDecorator } from '@nestjs/common';
import { COMPANY_KEY_HEADER, CompanyKeyService } from './company-key.service';
import type { CompanyCaller } from './company-key.types';

interface KeyedRequest {
  headers?: Record<string, string | string[] | undefined>;
  sbgCompany?: CompanyCaller;
  sbgRateKey?: string;
}

/**
 * A COMPANY'S OWN SYSTEM CALLING, with its key (round 12). Refuses a call with no key, a key that is not ours, or one
 * taken away; otherwise leaves behind which company is calling and whose limit to spend. Runs BEFORE RateLimitGuard,
 * which reads what this leaves.
 */
@Injectable()
export class CompanyKeyGuard implements CanActivate {
  constructor(private readonly keys: CompanyKeyService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<KeyedRequest>();
    const raw = req.headers?.[COMPANY_KEY_HEADER];
    const caller = this.keys.resolve(Array.isArray(raw) ? raw[0] : raw);
    req.sbgCompany = caller;
    // Each key is counted as itself: a company's two systems do not share a limit.
    req.sbgRateKey = caller.keyId;
    return true;
  }
}

/** The company calling, for a handler behind CompanyKeyGuard. */
export const CompanyKey = createParamDecorator((_data: unknown, context: ExecutionContext): CompanyCaller => {
  const caller = context.switchToHttp().getRequest<KeyedRequest>().sbgCompany;
  if (!caller) throw new Error('CompanyKey read without CompanyKeyGuard');
  return caller;
});
