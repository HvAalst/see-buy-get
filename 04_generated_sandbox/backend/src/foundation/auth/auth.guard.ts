import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { IS_PUBLIC_KEY } from './public.decorator';

/**
 * Global guard (T-006). Rejects any request without a valid Bearer token unless the
 * route/controller is marked @Public(). The introspected claims are attached to the
 * request as `auth` for downstream handlers.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authService: AuthService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request & { auth?: unknown }>();
    const token = AuthGuard.extractBearer(request.header('authorization'));
    if (!token) throw new UnauthorizedException('Missing Bearer token');

    const result = this.authService.introspect(token);
    if (!result.active) throw new UnauthorizedException(`Inactive token: ${result.reason ?? 'unknown'}`);

    request.auth = result;
    return true;
  }

  private static extractBearer(header?: string): string | null {
    if (!header) return null;
    const [scheme, value] = header.split(' ');
    return scheme?.toLowerCase() === 'bearer' && value ? value : null;
  }
}
