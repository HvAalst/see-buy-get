import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { IntrospectionResult } from '../../foundation/auth/auth.types';
import { GlosError } from '../../foundation/http/glos-error';
import { BusinessService } from './business.service';

const ANY_MEMBER_KEY = 'business:any-member';

/**
 * A change any member may make, viewers included — because it changes only their own place, not the business. Leaving
 * is the one there is: a viewer who could not leave would be held in a business by the role that was meant to limit them.
 */
export const AnyMember = () => SetMetadata(ANY_MEMBER_KEY, true);

/**
 * B1 — IS THIS PERSON STILL IN THE BUSINESS, AND MAY THEY CHANGE ANYTHING?
 *
 * Asked on every request a business sign-in makes, after the global AuthGuard has read the token (a controller's
 * guards run after the global one). The token says which business and which person; this reads whether that person
 * is still a member and in what role. So an owner removing somebody, or making them a viewer, holds from that
 * person's next click — not from whenever their session happens to end.
 *
 * A VIEWER READS. Anything but a read is refused for them here, once, rather than in each of the forty routes a
 * business reaches. What only an OWNER may do (the people, the business's own facts, asking for the check) is decided
 * in BusinessService, where the rule has a name.
 *
 * Every other caller passes straight through: this guard has an opinion about business sign-ins and nothing else.
 */
@Injectable()
export class BusinessMemberGuard implements CanActivate {
  constructor(
    private readonly businesses: BusinessService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request & { auth?: IntrospectionResult }>();
    if (request.auth?.role !== 'business') return true;
    const acting = this.businesses.requireMember(request.auth);
    const reading = request.method === 'GET' || request.method === 'HEAD';
    const anyMember = this.reflector.getAllAndOverride<boolean>(ANY_MEMBER_KEY, [context.getHandler(), context.getClass()]);
    if (!reading && !anyMember && !this.businesses.mayAct(acting)) {
      throw new GlosError('FORBIDDEN', 'You can see this business but not change anything in it. Ask an owner if you need to.');
    }
    return true;
  }
}
